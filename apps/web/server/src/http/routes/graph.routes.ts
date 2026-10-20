import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { GraphUnavailableError } from '../../services/graph-service.js';
import type { GraphService } from '../../services/graph-service.js';
import { runProjectsHandler } from './projects.routes.js';

/**
 * W13 engagement-scoped graph and derived asset projections. The graph store
 * failing stays distinguishable from an empty graph: failures answer 503 with
 * the server-owned unavailable reason, emptiness answers 200 with empty arrays.
 */
export function registerGraphRoutes(app: FastifyInstance, graphs: GraphService, identity: LocalIdentity): void {
  const prefix = '/api/engagements/:id';
  const handler = (operation: (id: string) => Promise<unknown>) => (request: FastifyRequest, reply: FastifyReply) =>
    runProjectsHandler(request, reply, async () => {
      reply.header('Cache-Control', 'no-store');
      try {
        return await operation((request.params as { id: string }).id);
      } catch (error) {
        if (error instanceof GraphUnavailableError) {
          reply.code(503);
          return { error: 'Knowledge graph unavailable' };
        }
        throw error;
      }
    });
  app.get(`${prefix}/graph`, handler(id => graphs.graph(identity.id, id)));
  app.get(`${prefix}/assets`, handler(id => graphs.assets(identity.id, id)));
  app.post(`${prefix}/assets/catalog/reconcile`, handler(id => graphs.reconcileCatalog(identity.id, id)));
}
