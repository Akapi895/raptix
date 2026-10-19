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

export function registerThreadHitlRoutes(app: FastifyInstance, ownership: RuntimeOwnershipService, identity: LocalIdentity): void {
  app.patch('/api/engagements/:id/threads/:thread/hitl', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id, thread } = request.params as { id: string; thread: string };
    const view = await ownership.setThreadHitl(identity.id, id, thread, parseThreadHitl(request.body));
    return { threadId: view.threadId, hitlEnabled: view.hitlEnabled ?? true };
  }));
}
