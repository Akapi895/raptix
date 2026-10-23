import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { runProjectsHandler } from './projects.routes.js';
import type { FindingsWorkflowService } from '../../services/findings-workflow-service.js';

/** Ticket 10 routes: curated finding lifecycle and evidence authoring. */
export function registerFindingsWorkflowRoutes(app: FastifyInstance, findings: FindingsWorkflowService, identity: LocalIdentity): void {
  app.get('/api/engagements/:id/curated-findings/suggestions', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    return findings.suggestions(identity.id, (request.params as { id: string }).id);
  }));
  app.post('/api/engagements/:id/curated-findings/suggestions', (request, reply) => runProjectsHandler(request, reply, async () => {
    return findings.setSuggestion(identity.id, (request.params as { id: string }).id, request.body);
  }));
  app.get('/api/engagements/:id/curated-findings/options', (request, reply) => runProjectsHandler(request, reply, async () => {
    return findings.options(identity.id, (request.params as { id: string }).id);
  }));
  app.get('/api/engagements/:id/curated-findings/:findingId/activity', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id, findingId } = request.params as { id: string; findingId: string };
    return findings.activity(identity.id, id, findingId, request.query);
  }));
  app.get('/api/engagements/:id/curated-findings', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return findings.list(identity.id, id);
  }));
  app.get('/api/findings', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    return findings.listAccessible(identity.id);
  }));
  app.post('/api/engagements/:id/curated-findings',(request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    return findings.create(identity.id, id, request.body);
  }));
  app.post('/api/engagements/:id/curated-findings/import', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    return findings.importDraft(identity.id, id, request.body);
  }));
  app.patch('/api/engagements/:id/curated-findings/:findingId', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, findingId } = request.params as { id: string; findingId: string };
    return findings.update(identity.id, id, findingId, request.body);
  }));
  app.post('/api/engagements/:id/curated-findings/:findingId/transition', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, findingId } = request.params as { id: string; findingId: string };
    return findings.transition(identity.id, id, findingId, request.body);
  }));
  app.post('/api/engagements/:id/curated-findings/:findingId/comments', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, findingId } = request.params as { id: string; findingId: string };
    return findings.addComment(identity.id, id, findingId, request.body);
  }));
  app.post('/api/engagements/:id/curated-findings/:findingId/retests', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, findingId } = request.params as { id: string; findingId: string };
    return findings.recordRetest(identity.id, id, findingId, request.body);
  }));
  app.post('/api/engagements/:id/curated-findings/:findingId/evidence', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, findingId } = request.params as { id: string; findingId: string };
    return findings.attachEvidence(identity.id, id, findingId, request.body);
  }));
}
