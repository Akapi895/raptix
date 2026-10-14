import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { runProjectsHandler } from './projects.routes.js';
import type { WorkspaceSettingsService } from '../../services/workspace-settings-service.js';
import type { AuditService } from '../../services/audit-service.js';

/** Ticket 16 routes: versioned workspace settings and the authoritative audit views. */
export function registerWorkspaceSettingsRoutes(app: FastifyInstance, settings: WorkspaceSettingsService, identity: LocalIdentity): void {
  app.get('/api/workspace/settings', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    return settings.list(identity.id);
  }));
  app.put('/api/workspace/settings/:key', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { key } = request.params as { key: string };
    return settings.put(identity.id, key, request.body);
  }));
}

export function registerAuditRoutes(app: FastifyInstance, audit: AuditService, identity: LocalIdentity): void {
  app.get('/api/audit', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const q = request.query as { action?: string; actor?: string; q?: string; limit?: string };
    return audit.workspaceAudit(identity.id, {
      action: q.action,
      actor: q.actor,
      q: q.q,
      limit: q.limit !== undefined ? Number(q.limit) : undefined,
    });
  }));
  app.get('/api/engagements/:id/audit', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    const q = request.query as { action?: string; actor?: string; q?: string; limit?: string };
    return audit.engagementAudit(identity.id, id, {
      action: q.action,
      actor: q.actor,
      q: q.q,
      limit: q.limit !== undefined ? Number(q.limit) : undefined,
    });
  }));
}
