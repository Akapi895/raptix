import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { runProjectsHandler } from './projects.routes.js';
import type { ScopeService } from '../../services/scope-service.js';

/**
 * Ticket 08 routes: operator-managed scope/ROE revisions and the asset
 * inventory. The identity is the trusted session actor; role checks live in
 * the service (owner > operator > reviewer > viewer via membership policy).
 */
export function registerScopeRoutes(app: FastifyInstance, scope: ScopeService, identity: LocalIdentity): void {
  app.get('/api/engagements/:id/scope/revisions', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return scope.revisions(identity.id, id);
  }));
  app.post('/api/engagements/:id/scope/revisions', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    return scope.submitRevision(identity.id, id, request.body);
  }));
  app.post('/api/engagements/:id/scope/revisions/:revisionId/decision', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, revisionId } = request.params as { id: string; revisionId: string };
    return scope.decideRevision(identity.id, id, revisionId, request.body);
  }));
  app.get('/api/engagements/:id/assets/inventory', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return scope.assets(identity.id, id);
  }));
  app.post('/api/engagements/:id/assets/inventory', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    return scope.addAsset(identity.id, id, request.body);
  }));
  app.post('/api/engagements/:id/assets/inventory/import', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    return scope.importAssets(identity.id, id, request.body);
  }));
  app.patch('/api/engagements/:id/assets/inventory/:assetId', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, assetId } = request.params as { id: string; assetId: string };
    return scope.classifyAsset(identity.id, id, assetId, request.body);
  }));
}
