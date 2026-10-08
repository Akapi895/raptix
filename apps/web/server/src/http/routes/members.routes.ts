import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { runProjectsHandler } from './projects.routes.js';
import type { MembersService } from '../../services/members-service.js';

/**
 * W19 members routes: the truthful members view plus explicit 503 answers
 * for invite/removal — the unsupported actions carry their reason instead
 * of a silent no-op or a fake membership row.
 */
export function registerMembersRoutes(app: FastifyInstance, members: MembersService, identity: LocalIdentity): void {
  app.get('/api/engagements/:id/members', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return members.list(identity.id, id);
  }));
  app.post('/api/engagements/:id/members', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    return members.invite(identity.id, id);
  }));
  app.delete('/api/engagements/:id/members/:memberId', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, memberId } = request.params as { id: string; memberId: string };
    return members.removeMember(identity.id, id, memberId);
  }));
}
