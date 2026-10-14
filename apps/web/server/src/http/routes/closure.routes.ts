import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { runProjectsHandler } from './projects.routes.js';
import type { ClosureService } from '../../services/closure-service.js';

/** Ticket 17 routes: closure surface, request and independent decision. */
export function registerClosureRoutes(app: FastifyInstance, closure: ClosureService, identity: LocalIdentity): void {
  app.get('/api/engagements/:id/closure', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return closure.get(identity.id, id);
  }));
  app.post('/api/engagements/:id/closure/request', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    return closure.request(identity.id, id, request.body);
  }));
  app.post('/api/engagements/:id/closure/decision', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    return closure.decide(identity.id, id, request.body);
  }));
}
