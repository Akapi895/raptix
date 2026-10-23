import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { EXPORT_FORMATS, isExportFormat } from '../../services/export-service.js';
import type { ExportService } from '../../services/export-service.js';
import { TIMELINE_MAX_LIMIT, type TimelineService } from '../../services/timeline-service.js';
import { runProjectsHandler } from './projects.routes.js';

/**
 * W14 operations timeline and engagement export. Export supports exactly
 * `json` and `markdown`; any other format answers 400 — the legacy silent
 * fallback to Markdown is gone.
 */
export function registerTimelineRoutes(app: FastifyInstance, timeline: TimelineService, exports: ExportService, identity: LocalIdentity): void {
  const prefix = '/api/engagements/:id';
  app.get(`${prefix}/timeline`, (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    const query = request.query as { limit?: unknown };
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > TIMELINE_MAX_LIMIT)) {
      reply.code(400);
      return { statusCode: 400, error: { code: 'bad_request', message: `limit must be an integer from 1 to ${TIMELINE_MAX_LIMIT}.` } };
    }
    return timeline.timeline(identity.id, id, { limit });
  }));
  app.get(`${prefix}/export`, (request, reply) => runProjectsHandler(request, reply, async () => {
    const query = request.query as { format?: unknown };
    if (!isExportFormat(query.format)) {
      reply.code(400);
      return { statusCode: 400, error: { code: 'bad_request', message: `Unsupported export format. Supported formats: ${EXPORT_FORMATS.join(', ')}.` } };
    }
    const { id } = request.params as { id: string };
    const result = await exports.export(identity.id, id, query.format);
    reply.header('Content-Type', result.contentType);
    reply.header('Content-Disposition', `attachment; filename="${result.filename}"`);
    reply.header('Cache-Control', 'no-store');
    return result.body;
  }));
}
