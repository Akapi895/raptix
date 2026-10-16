import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { runProjectsHandler } from './projects.routes.js';
import type { DocumentDraftService } from '../../services/document-draft-service.js';

/**
 * O06 (ADR-0083): document source/draft/publish routes over the allowlisted
 * planning documents. The document name is opaque — the server resolves the
 * engagement workspace slug itself; no filesystem path crosses the API. Role
 * checks live in the service (viewer reads, operator writes).
 */
export function registerDocumentRoutes(app: FastifyInstance, documents: DocumentDraftService, identity: LocalIdentity): void {
  const noStore = (reply: { header: (name: string, value: string) => unknown }): void => { reply.header('Cache-Control', 'no-store'); };
  app.get('/api/engagements/:id/documents/:name', (request, reply) => runProjectsHandler(request, reply, async () => {
    noStore(reply);
    const { id, name } = request.params as { id: string; name: string };
    return documents.source(identity.id, id, name);
  }));
  app.put('/api/engagements/:id/documents/:name/draft', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, name } = request.params as { id: string; name: string };
    return documents.saveDraft(identity.id, id, name, request.body);
  }));
  app.delete('/api/engagements/:id/documents/:name/draft', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, name } = request.params as { id: string; name: string };
    return documents.discardDraft(identity.id, id, name);
  }));
  app.post('/api/engagements/:id/documents/:name/publish', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, name } = request.params as { id: string; name: string };
    return documents.publish(identity.id, id, name, request.body);
  }));
}
