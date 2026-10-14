import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { runProjectsHandler } from './projects.routes.js';
import type { MembersService } from '../../services/members-service.js';

/**
 * W19 members routes, extended by integration ticket 07: the truthful
 * members view, plus owner-only invite/remove/role mutations in multi-user
 * mode. In local single-user mode the mutations keep answering 503 with
 * their explicit reason — the identity is trusted from the session/resolver,
 * never from the request body.
 */
export function registerMembersRoutes(app: FastifyInstance, members: MembersService, identity: LocalIdentity): void {
  app.get('/api/engagements/:id/members', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return members.list(identity.id, id);
  }));
  app.post('/api/engagements/:id/members', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    return members.invite(identity.id, id, request.body);
  }));
  app.patch('/api/engagements/:id/members/:memberId', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, memberId } = request.params as { id: string; memberId: string };
    return members.updateRole(identity.id, id, memberId, request.body);
  }));
  app.delete('/api/engagements/:id/members/:memberId', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, memberId } = request.params as { id: string; memberId: string };
    return members.removeMember(identity.id, id, memberId);
  }));
}
