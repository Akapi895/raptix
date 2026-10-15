/** Serialize scoped HTTP mutations against closure with a shared PostgreSQL fence. */
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import { assertEngagementOpen } from '../services/closure-service.js';
import { requireEngagementAccess } from '../auth/membership-policy.js';
import { ProjectApiError } from '../services/projects-service.js';

export function registerEngagementMutationFence(app: FastifyInstance, db: PrismaClient, actorId: () => string): void {
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (!(route.url === '/api/engagements/:id' || route.url.startsWith('/api/engagements/:id/')) || methods.every((m) => ['GET', 'HEAD', 'OPTIONS'].includes(m))) return;
    const handler = route.handler;
    route.handler = async function (request, reply) {
      const { id } = request.params as { id: string };
      return db.$transaction(async (tx) => {
        // Every mutation, including closure confirmation, holds this fence
        // until its handler finishes. A pre-close authorization cannot commit
        // after a concurrent closure has acquired the same engagement fence.
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${id}, 0)) AS locked`;
        if (!lock?.locked) throw new ProjectApiError(409, 'Another engagement mutation is in progress. Retry with the same request identity.');
        await requireEngagementAccess({ db: tx as PrismaClient, actorId: actorId(), multiUser: true }, id, 'viewer');
        const recovery = route.url.includes('/closure/') || route.url.endsWith('/estops') || request.method === 'DELETE' && route.url.includes('/vault/');
        if (!recovery) await assertEngagementOpen(tx as PrismaClient, id);
        return handler.call(this, request, reply);
      }, { maxWait: 30_000, timeout: 60_000 });
    };
  });
}
