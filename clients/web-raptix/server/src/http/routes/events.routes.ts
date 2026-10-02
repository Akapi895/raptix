import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import type { StreamService } from '../../services/runtime/stream-service.js';
import { ProjectPolicyError } from '../../security/project-policy.js';
import { runProjectsHandler } from './projects.routes.js';
export function registerEventRoutes(app: FastifyInstance, service: StreamService, identity: LocalIdentity): void {
  app.get('/api/engagements/:id/threads/:thread/runs/:run/events', (request, reply) => runProjectsHandler(request, reply, async () => {
    const query = request.query as Record<string, unknown>;
    if (Object.keys(query).some(k => k !== 'cursor') || request.headers['last-event-id'] !== undefined && query.cursor !== undefined && request.headers['last-event-id'] !== query.cursor) throw new ProjectPolicyError('bad_request', 'Invalid stream cursor selection');
    const { id, thread, run } = request.params as { id: string; thread: string; run: string };
    const controller = new AbortController();
    const abort = (): void => { controller.abort(); };
    reply.raw.once('close', abort); request.raw.once('aborted', abort);
    try {
      const body = await service.open(identity.id, { engagementId: id, threadId: thread, runId: run }, request.headers['last-event-id'] ?? query.cursor, controller.signal);
      body.once('close', () => { reply.raw.removeListener('close', abort); request.raw.removeListener('aborted', abort); controller.abort(); });
      return reply.header('Content-Type', 'text/event-stream; charset=utf-8').header('Cache-Control', 'no-cache, no-transform').header('X-Accel-Buffering', 'no').send(body);
    } catch (error) { reply.raw.removeListener('close', abort); request.raw.removeListener('aborted', abort); controller.abort(); throw error; }
  }));
}
