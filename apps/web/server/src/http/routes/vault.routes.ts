import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { runProjectsHandler } from './projects.routes.js';
import type { VaultService } from '../../services/vault-service.js';

/**
 * W18 vault routes: default responses are redacted metadata only. Plaintext
 * leaves the server exclusively through the explicit reveal endpoint, and
 * revocation is a first-class audited action.
 */
export function registerVaultRoutes(app: FastifyInstance, vault: VaultService, identity: LocalIdentity): void {
  app.get('/api/engagements/:id/vault/secrets', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return vault.list(identity.id, id);
  }));
  app.post('/api/engagements/:id/vault/secrets', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    const view = await vault.create(identity.id, id, request.body);
    reply.code(201);
    return view;
  }));
  app.post('/api/engagements/:id/vault/secrets/:secretId/reveal', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id, secretId } = request.params as { id: string; secretId: string };
    return vault.reveal(identity.id, id, secretId);
  }));
  app.delete('/api/engagements/:id/vault/secrets/:secretId', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, secretId } = request.params as { id: string; secretId: string };
    return vault.revoke(identity.id, id, secretId);
  }));
}
