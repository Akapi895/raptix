/** Serialize scoped HTTP mutations against closure with a shared PostgreSQL fence. */
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import { assertEngagementOpen } from '../services/closure-service.js';
import { requireEngagementAccess } from '../auth/membership-policy.js';
import { ProjectApiError } from '../services/projects-service.js';

/**
 * W05 fence keys (per engagement id):
 *  - key 0: regular mutations. Held for the whole handler, including provider
 *    I/O — a second concurrent mutation is refused with 409 instead of
 *    queueing behind it.
 *  - key 1: the emergency lane (closure transitions, vault deletion). Never
 *    held by regular mutations, so closure/estop decisions do not queue
 *    behind long-running provider calls.
 * POST /estops is exempt from this wrapper entirely: it persists its latch
 * inside its own short key-1 transaction (GovernanceService.emergencyStop)
 * BEFORE the runtime cancel side effect, so an in-flight command can never
 * delay or refuse an emergency stop. Closure confirm keeps key 0 so a
 * pre-close mutation can never commit after the closure transition; it also
 * takes key 1 to serialize against the emergency lane. Lock acquisition is
 * strictly key 0 → key 1, so the combination is deadlock-free.
 */
export function registerEngagementMutationFence(app: FastifyInstance, db: PrismaClient, actorId: () => string): void {
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (!(route.url === '/api/engagements/:id' || route.url.startsWith('/api/engagements/:id/')) || methods.every((m) => ['GET', 'HEAD', 'OPTIONS'].includes(m))) return;
    if (route.url.endsWith('/estops')) return;
    const handler = route.handler;
    route.handler = async function (request, reply) {
      const { id } = request.params as { id: string };
      const recovery = route.url.includes('/closure/') || request.method === 'DELETE' && route.url.includes('/vault/');
      return db.$transaction(async (tx) => {
        // Every mutation, including closure confirmation, holds this fence
        // until its handler finishes. A pre-close authorization cannot commit
        // after a concurrent closure has acquired the same engagement fence.
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${id}, 0)) AS locked`;
        if (!lock?.locked) throw new ProjectApiError(409, 'Another engagement mutation is in progress. Retry with the same request identity.');
        if (recovery) {
          const [emergency] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${id}, 1)) AS locked`;
          if (!emergency?.locked) throw new ProjectApiError(409, 'An emergency stop or closure transition is in progress. Retry with the same request identity.');
        }
        await requireEngagementAccess({ db: tx as PrismaClient, actorId: actorId(), multiUser: true }, id, 'viewer');
        if (!recovery) await assertEngagementOpen(tx as PrismaClient, id);
        return handler.call(this, request, reply);
      }, { maxWait: 30_000, timeout: 60_000 });
    };
  });
}
