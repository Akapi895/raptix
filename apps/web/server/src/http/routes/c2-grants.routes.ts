import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { runProjectsHandler } from './projects.routes.js';
import type { C2GrantsService } from '../../services/c2-grants-service.js';

/** Ticket 12 routes: expiring per-user C2 session grants. */
export function registerC2GrantRoutes(app: FastifyInstance, grants: C2GrantsService, identity: LocalIdentity): void {
  app.get('/api/engagements/:id/c2/grants', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return grants.list(identity.id, id);
  }));
  app.post('/api/engagements/:id/c2/grants', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    return grants.request(identity.id, id, request.body);
  }));
  app.post('/api/engagements/:id/c2/grants/:grantId/decision', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, grantId } = request.params as { id: string; grantId: string };
    return grants.decide(identity.id, id, grantId, request.body);
  }));
}
