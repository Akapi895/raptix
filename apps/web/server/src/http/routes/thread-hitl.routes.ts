import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import type { RuntimeOwnershipService } from '../../services/runtime-ownership.js';
import { ProjectPolicyError } from '../../security/project-policy.js';
import { runProjectsHandler } from './projects.routes.js';

/** The body is exactly `{ "enabled": boolean }`; anything else is refused before the conversation is read. */
export function parseThreadHitl(raw: unknown): boolean {
  const invalid = (): ProjectPolicyError => new ProjectPolicyError('bad_request', 'The HITL switch must be {"enabled": true|false}.');
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || Object.keys(raw).some((k) => k !== 'enabled')) throw invalid();
  const enabled = (raw as { enabled?: unknown }).enabled;
  if (typeof enabled !== 'boolean') throw invalid();
  return enabled;
}

/** ADR-0092 I07: one thread's verified message count, as a human (operator) read it from the legacy runtime. */
function parseMigrationManifest(raw: unknown): { threadId: string; verifiedMessageCount: number; sourceSlug: string }[] {
  const invalid = (): ProjectPolicyError => new ProjectPolicyError('bad_request', 'The manifest is a non-empty array of {threadId, verifiedMessageCount, sourceSlug}.');
  if (!Array.isArray(raw) || raw.length === 0) throw invalid();
  return raw.map((entry) => {
    if (typeof entry !== 'object' || entry === null) throw invalid();
    const { threadId, verifiedMessageCount, sourceSlug } = entry as Record<string, unknown>;
    if (typeof threadId !== 'string' || typeof verifiedMessageCount !== 'number' || typeof sourceSlug !== 'string') throw invalid();
    return { threadId, verifiedMessageCount, sourceSlug };
  });
}

export function registerThreadHitlRoutes(app: FastifyInstance, ownership: RuntimeOwnershipService, identity: LocalIdentity): void {
  app.patch('/api/engagements/:id/threads/:thread/hitl', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id, thread } = request.params as { id: string; thread: string };
    const view = await ownership.setThreadHitl(identity.id, id, thread, parseThreadHitl(request.body));
    return { threadId: view.threadId, hitlEnabled: view.hitlEnabled ?? true };
  }));
  // ADR-0092 I07: an operator imports the message counts it verified from the legacy runtime before cutover. Rebind
  // later refuses any thread this manifest did not name.
  app.post('/api/engagements/:id/migration/manifest', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    const imported = await ownership.importMigrationManifest(identity.id, id, parseMigrationManifest(request.body));
    reply.status(201);
    return { imported };
  }));
}
