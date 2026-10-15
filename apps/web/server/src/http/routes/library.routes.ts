import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { runProjectsHandler } from './projects.routes.js';
import type { LibraryService } from '../../services/library-service.js';

/** Ticket 14 routes: tradecraft library reads and engagement-scoped observed analysis. */
export function registerLibraryRoutes(app: FastifyInstance, library: LibraryService, identity: LocalIdentity): void {
  app.get('/api/library', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    return library.library();
  }));
  app.get('/api/library/skills/:name', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { name } = request.params as { name: string };
    return library.skillDetail(name);
  }));
  app.get('/api/library/techniques/:id', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return library.techniqueDetail(id);
  }));
  app.get('/api/engagements/:id/analysis', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return library.analysis(identity.id, id);
  }));
}
