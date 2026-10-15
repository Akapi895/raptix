import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../generated/prisma/client.js';
import {
  CLEAR_SESSION_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashPassword,
  hashToken,
  isSameOrigin,
  issueSessionMaterial,
  sessionCookieHeader,
  verifyPassword,
} from '../../auth/multi-user.js';
import type { ActorContextStore } from '../../auth/request-identity.js';
import { ProjectApiError } from '../../services/projects-service.js';

/**
 * Ticket 07 session routes. Login verifies the scrypt hash server-side,
 * issues an opaque cookie-bound session with a per-session CSRF token, and
 * enforces the same-origin policy on every mutation. Bootstrap admin
 * credentials arrive only through server env (never through the wire).
 */

export interface AuthSessionView {
  readonly authenticated: boolean;
  readonly actor?: { readonly id: string; readonly username: string; readonly displayName: string };
  readonly csrfToken?: string;
  readonly mode: 'multi-user';
}

const LOGIN_MAX = 200;

export function registerAuthRoutes(app: FastifyInstance, db: PrismaClient, actors: ActorContextStore, secureCookies: boolean): void {
  app.post('/api/auth/login', async (request, reply) => {
    const requestOrigin = request.headers.origin;
    if (!isSameOrigin(requestOrigin, request.headers.host)) {
      throw new ProjectApiError(403, 'Cross-origin sign-in is refused.');
    }
    const body = (request.body ?? {}) as { username?: unknown; password?: unknown };
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (username.length === 0 || username.length > LOGIN_MAX || password.length === 0 || password.length > LOGIN_MAX) {
      throw new ProjectApiError(400, 'username and password are required (1-200 characters).');
    }
    const user = await db.webUser.findUnique({ where: { username } });
    if (user === null || user.status !== 'active' || !verifyPassword(password, user.passwordHash)) {
      // Uniform refusal: no user-existence oracle.
      throw new ProjectApiError(401, 'Invalid username or password.');
    }
    const material = issueSessionMaterial();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const sessionOrigin = (request.headers.origin as string) ?? '';
    await db.webSession.create({ data: { id: material.sessionId, userId: user.id, csrfToken: material.csrfToken, origin: sessionOrigin, expiresAt } });
    void reply.header('Set-Cookie', sessionCookieHeader(material.token, expiresAt, secureCookies));
    return { authenticated: true, actor: { id: user.id, username: user.username, displayName: user.displayName }, csrfToken: material.csrfToken, mode: 'multi-user' as const };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const cookie = request.headers.cookie;
    let token: string | null = null;
    for (const part of (cookie ?? '').split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === SESSION_COOKIE && rest.length > 0) token = rest.join('=');
    }
    if (token !== null) {
      await db.webSession.deleteMany({ where: { id: hashToken(token) } });
    }
    void reply.header('Set-Cookie', CLEAR_SESSION_COOKIE);
    return { authenticated: false, mode: 'multi-user' as const };
  });

  app.get('/api/auth/session', async (request) => {
    const session = request.webSession;
    if (session === undefined) return { authenticated: false, mode: 'multi-user' as const } satisfies AuthSessionView;
    const user = await db.webUser.findUnique({ where: { id: actors.actorId }, select: { username: true, displayName: true, status: true } });
    if (user === null || user.status !== 'active') return { authenticated: false, mode: 'multi-user' as const } satisfies AuthSessionView;
    return {
      authenticated: true,
      actor: { id: actors.actorId, username: user.username, displayName: user.displayName },
      csrfToken: session.csrfToken,
      mode: 'multi-user' as const,
    } satisfies AuthSessionView;
  });
}

/** Creates the bootstrap admin from server env at startup. Idempotent. */
export async function ensureBootstrapAdmin(db: PrismaClient, username: string, password: string, displayName: string): Promise<void> {
  const existing = await db.webUser.findUnique({ where: { username } });
  if (existing !== null) return;
  await db.webUser.create({ data: { username, displayName, passwordHash: hashPassword(password) } });
}
