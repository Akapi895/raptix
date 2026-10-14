import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import { checkSession, type ResolvedSession } from './multi-user.js';

/**
 * Ticket 07 HTTP boundary: in multi-user mode every request must carry a
 * valid session (cookie) â€” mutations additionally the per-session CSRF
 * header â€” and the resolved trusted actor is exposed to route handlers
 * through an AsyncLocalStorage-backed identity view, so the existing
 * owner-scoped services keep working unchanged and concurrently safe.
 */

const LOCAL_ACTOR = 'local';

export interface MultiUserAuthOptions {
  readonly db: PrismaClient;
  /** Route urls that answer without a session (login + health probes). */
  readonly publicUrls: readonly string[];
}

export interface RequestSession extends ResolvedSession {}

declare module 'fastify' {
  interface FastifyRequest {
    /** Present only in multi-user mode after the session check passed. */
    webSession?: RequestSession;
  }
}

export class ActorContextStore {
  private readonly storage = new AsyncLocalStorage<string>();

  /** Per-request actor id; falls back to the local operator outside a request. */
  public get actorId(): string {
    return this.storage.getStore() ?? LOCAL_ACTOR;
  }

  public run<T>(actorId: string, fn: () => T): T {
    return this.storage.run(actorId, fn);
  }

  public enterWith(actorId: string): void {
    this.storage.enterWith(actorId);
  }
}

async function lookupSession(db: PrismaClient, sessionId: string): Promise<ResolvedSession | null> {
  const row = await db.webSession.findUnique({ where: { id: sessionId } });
  if (row === null) return null;
  const user = await db.webUser.findUnique({ where: { id: row.userId }, select: { status: true } });
  if (user === null || user.status !== 'active') return null;
  return { sessionId: row.id, userId: row.userId, csrfToken: row.csrfToken, origin: row.origin, expiresAt: row.expiresAt };
}

export function registerMultiUserAuth(app: FastifyInstance, store: ActorContextStore, options: MultiUserAuthOptions): void {
  // Callback-style onRequest + actors.run(..., done): this is the documented
  // Fastify pattern for binding an AsyncLocalStorage context to the rest of
  // the request lifecycle â€” an async/await + enterWith hook does not
  // propagate into handlers reliably.
  app.addHook('onRequest', (request, reply, done) => {
    void (async () => {
      const url = request.routeOptions?.url ?? '';
      const decision = await checkSession(
        {
          cookieHeader: request.headers.cookie,
          origin: request.headers.origin,
          host: request.headers.host,
          method: request.method,
          csrfHeader: (request.headers['x-csrf-token'] as string | undefined) ?? undefined,
        },
        (sessionId) => lookupSession(options.db, sessionId),
      );
      if (decision.ok) {
        request.webSession = decision.session;
        store.run(decision.session.userId, () => done());
        return;
      }
      if (options.publicUrls.includes(url)) {
        done();
        return;
      }
      await reply.code(decision.status).send({
        error: { code: decision.status === 401 ? 'unauthorized' : 'forbidden', message: decision.reason },
      });
      done();
    })().catch((err: unknown) => {
      done(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

/**
 * Identity view handed to route registrations in multi-user mode. The `id`
 * getter resolves the trusted per-request actor instead of a fixed operator.
 */
export function sessionAwareIdentity(store: ActorContextStore): { readonly id: string; readonly mode: 'multi-user' } {
  return {
    get id() {
      return store.actorId;
    },
    mode: 'multi-user',
  };
}
