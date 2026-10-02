import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { runProjectsHandler } from './projects.routes.js';
import type { CampaignService } from '../../services/campaign-service.js';
import type { C2Service } from '../../services/c2-service.js';

/**
 * W17 campaign routes: scoped persistence-backed drafts plus truthful
 * provider jobs, and the C2 session/commands routes that enforce engagement
 * scoping before stating the unavailable provider. Generate/deploy return
 * the durable job (status `unavailable`) — never a fabricated delivery.
 */
export function registerCampaignRoutes(app: FastifyInstance, campaigns: CampaignService, c2: C2Service, identity: LocalIdentity): void {
  app.get('/api/engagements/:id/campaigns', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return campaigns.list(identity.id, id);
  }));
  app.post('/api/engagements/:id/campaigns', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    const view = await campaigns.create(identity.id, id, request.body);
    reply.code(201);
    return view;
  }));
  app.get('/api/engagements/:id/campaigns/:campaignId', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id, campaignId } = request.params as { id: string; campaignId: string };
    return campaigns.get(identity.id, id, campaignId);
  }));
  app.post('/api/engagements/:id/campaigns/:campaignId/generate', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id, campaignId } = request.params as { id: string; campaignId: string };
    return campaigns.runJob(identity.id, id, campaignId, 'generate');
  }));
  app.post('/api/engagements/:id/campaigns/:campaignId/deploy', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id, campaignId } = request.params as { id: string; campaignId: string };
    return campaigns.runJob(identity.id, id, campaignId, 'deploy');
  }));

  app.get('/api/engagements/:id/c2/sessions', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return c2.sessions(identity.id, id);
  }));
  app.post('/api/engagements/:id/c2/sessions/:sessionId/commands', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id, sessionId } = request.params as { id: string; sessionId: string };
    return c2.dispatchCommand(identity.id, id, sessionId);
  }));
}
