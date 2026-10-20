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
  app.post(`${prefix}/artifacts/workspace-evidence/import`, (request, reply) => runProjectsHandler(request, reply, () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return artifacts.importWorkspaceEvidence(identity.id, id);
  }));
  app.get(`${prefix}/artifacts/captures`, (request, reply) => runProjectsHandler(request, reply, () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return artifacts.listCaptures(identity.id, id);
  }));
  app.patch(`${prefix}/artifacts/captures/:captureId/classification`, (request, reply) => runProjectsHandler(request, reply, () => {
    const { id, captureId } = request.params as { id: string; captureId: string };
    return artifacts.classifyCapture(identity.id, id, captureId, request.body);
  }));
  app.get(`${prefix}/artifacts/captures/:captureId/content`, (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, captureId } = request.params as { id: string; captureId: string };
    const result = await artifacts.downloadCapture(identity.id, id, captureId);
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-SHA256', result.capture.digest);
    reply.header('X-Content-Length', String(result.capture.sizeBytes));
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.capture.filename ?? 'capture')}`);
    return reply.send(result.bytes);
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
