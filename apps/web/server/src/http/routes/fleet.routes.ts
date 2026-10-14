import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { runProjectsHandler } from './projects.routes.js';
import type { FleetService } from '../../services/fleet-service.js';

/** Ticket 13 routes: engagement-scoped agent fleet and subagent branch reads. */
export function registerFleetRoutes(app: FastifyInstance, fleet: FleetService, identity: LocalIdentity): void {
  app.get('/api/engagements/:id/fleet', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return fleet.fleet(identity.id, id);
  }));
}
