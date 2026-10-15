import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { ProjectPolicyError } from '../../security/project-policy.js';
import type { ArtifactsService } from '../../services/artifacts-service.js';
import type { FindingsService } from '../../services/findings-service.js';
import { runProjectsHandler } from './projects.routes.js';

/** W12 findings projection + engagement-scoped artifact browser. */
export function registerFindingsRoutes(
  app: FastifyInstance,
  findings: FindingsService,
  artifacts: ArtifactsService,
  identity: LocalIdentity,
): void {
  const prefix = '/api/engagements/:id';
  app.post(`${prefix}/artifacts/captures`, (request, reply) => runProjectsHandler(request, reply, () => {
    const { id } = request.params as { id: string };
    return artifacts.upload(identity.id, id, request.body);
  }));
  app.get(`${prefix}/findings`, (request, reply) => runProjectsHandler(request, reply, () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return findings.list(identity.id, id);
  }));
  app.get(`${prefix}/artifacts`, (request, reply) => runProjectsHandler(request, reply, () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return artifacts.list(identity.id, id);
  }));
  app.get(`${prefix}/artifacts/content`, (request, reply) => runProjectsHandler(request, reply, () => {
    reply.header('Cache-Control', 'no-store');
    const query = request.query as { path?: unknown };
    if (typeof query.path !== 'string' || !query.path) throw new ProjectPolicyError('bad_request', 'Missing artifact path');
    const { id } = request.params as { id: string };
    return artifacts.content(identity.id, id, query.path);
  }));
}
