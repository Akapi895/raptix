import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { runProjectsHandler } from './projects.routes.js';
import type { LibraryReviewService } from '../../services/library-review-service.js';

/** ADR-0070 routes: engagement-scoped library review proposals (never a corpus mutation API). */
export function registerLibraryReviewRoutes(app: FastifyInstance, reviews: LibraryReviewService, identity: LocalIdentity): void {
  app.get('/api/engagements/:id/library-proposals', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return reviews.list(identity.id, id);
  }));
  app.post('/api/engagements/:id/library-proposals', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    return reviews.submit(identity.id, id, request.body);
  }));
  app.get('/api/engagements/:id/library-proposals/:proposalId', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id, proposalId } = request.params as { id: string; proposalId: string };
    return reviews.get(identity.id, id, proposalId);
  }));
  app.post('/api/engagements/:id/library-proposals/:proposalId/amendments', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, proposalId } = request.params as { id: string; proposalId: string };
    return reviews.amend(identity.id, id, proposalId, request.body);
  }));
  app.post('/api/engagements/:id/library-proposals/:proposalId/propose', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, proposalId } = request.params as { id: string; proposalId: string };
    return reviews.propose(identity.id, id, proposalId);
  }));
  app.post('/api/engagements/:id/library-proposals/:proposalId/decision', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, proposalId } = request.params as { id: string; proposalId: string };
    return reviews.decide(identity.id, id, proposalId, request.body);
  }));
  app.get('/api/engagements/:id/library-proposals/:proposalId/export', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, proposalId } = request.params as { id: string; proposalId: string };
    return reviews.export(identity.id, id, proposalId);
  }));
}
