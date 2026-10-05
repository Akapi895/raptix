import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { EngagementDeleteConflictError } from '../../services/settings-service.js';
import type { SettingsService } from '../../services/settings-service.js';
import { runProjectsHandler } from './projects.routes.js';

/**
 * W15 settings routes: the persisted settings view plus the explicit danger
 * delete. Saving reuses the existing PATCH /api/engagements/:id, so every
 * write path keeps the same validation and lifecycle policy.
 */
export function registerSettingsRoutes(app: FastifyInstance, settings: SettingsService, identity: LocalIdentity): void {
  app.get('/api/engagements/:id/settings', (request, reply) => runProjectsHandler(request, reply, () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return settings.settings(identity.id, id);
  }));
  app.delete('/api/engagements/:id', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    try {
      return await settings.deleteEngagement(identity.id, id);
    } catch (error) {
      if (error instanceof EngagementDeleteConflictError) {
        reply.code(409);
        return { statusCode: 409, error: { code: 'conflict', message: error.message } };
      }
      throw error;
    }
  }));
}
