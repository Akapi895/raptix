import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { runProjectsHandler } from './projects.routes.js';
import type { InboxService } from '../../services/inbox-service.js';

/** Ticket 15 routes: command-center aggregate, task inbox and durable notices. */
export function registerInboxRoutes(app: FastifyInstance, inbox: InboxService, identity: LocalIdentity): void {
  app.get('/api/engagements/:id/overview', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return inbox.overview(identity.id, id);
  }));
  app.get('/api/tasks', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    return inbox.tasks(identity.id);
  }));
  app.get('/api/overview/findings', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    return inbox.findingsSummary(identity.id);
  }));
  app.get('/api/overview/operations', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    return inbox.operationsSummary(identity.id);
  }));
  app.get('/api/overview/c2', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    return inbox.c2Summary(identity.id);
  }));
  app.get('/api/notices', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    return inbox.notices(identity.id);
  }));
  app.post('/api/notices/read-all', (request, reply) => runProjectsHandler(request, reply, async () => inbox.markAllNoticesRead(identity.id)));
  app.post('/api/notices/:noticeId/read', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { noticeId } = request.params as { noticeId: string };
    return inbox.markNoticeRead(identity.id, noticeId);
  }));
  app.post('/api/notices/:noticeId/dismiss', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { noticeId } = request.params as { noticeId: string };
    return inbox.markNoticeDismissed(identity.id, noticeId);
  }));
}
