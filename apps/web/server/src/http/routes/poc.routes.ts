import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import type { FindingPocService } from '../../services/finding-poc-service.js';
import { runProjectsHandler } from './projects.routes.js';

/** The sealed Proof of Concept of a workspace finding: read it, and reproduce it with a value for this run (ADR-0104). */
export function registerPocRoutes(app: FastifyInstance, poc: FindingPocService, identity: LocalIdentity): void {
  const prefix = '/api/engagements/:id/workspace-findings/:ref';
  app.get(`${prefix}/poc`, (request, reply) => runProjectsHandler(request, reply, () => {
    const { id, ref } = request.params as { id: string; ref: string };
    return poc.read(identity.id, id, ref);
  }));
  app.post(`${prefix}/reproduce`, (request, reply) => runProjectsHandler(request, reply, () => {
    const { id, ref } = request.params as { id: string; ref: string };
    return poc.reproduce(identity.id, id, ref, (request.body ?? {}) as { token?: unknown });
  }));
}
