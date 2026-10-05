import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import type { ApprovalsService } from '../../services/approvals-service.js';
import { runProjectsHandler } from './projects.routes.js';

/** W11 file-backed tool HITL: engagement-scoped pending approvals and decisions. */
export function registerApprovalRoutes(app: FastifyInstance, service: ApprovalsService, identity: LocalIdentity): void {
  const prefix = '/api/engagements/:id';
  app.get(`${prefix}/approvals`, (request, reply) => runProjectsHandler(request, reply, () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return service.list(identity.id, id);
  }));
  app.post(`${prefix}/approvals`, (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    const decided = await service.decide(identity.id, id, request.body);
    reply.status(200); return decided;
  }));
}
