import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { runProjectsHandler } from './projects.routes.js';
import type { ReportsService } from '../../services/reports-service.js';

/** Ticket 11 routes: report lifecycle, independent review and delivery records. */
export function registerReportsRoutes(app: FastifyInstance, reports: ReportsService, identity: LocalIdentity): void {
  app.get('/api/engagements/:id/report-records', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return reports.list(identity.id, id);
  }));
  app.post('/api/engagements/:id/report-records', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    return reports.create(identity.id, id, request.body);
  }));
  app.patch('/api/engagements/:id/report-records/:reportId', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, reportId } = request.params as { id: string; reportId: string };
    return reports.update(identity.id, id, reportId, request.body);
  }));
  app.post('/api/engagements/:id/report-records/:reportId/review', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, reportId } = request.params as { id: string; reportId: string };
    const action = (request.body ?? {}) as { action?: string };
    if (action.action === 'submit') return reports.submitReview(identity.id, id, reportId);
    return reports.decideReview(identity.id, id, reportId, request.body);
  }));
  app.post('/api/engagements/:id/report-records/:reportId/deliveries', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, reportId } = request.params as { id: string; reportId: string };
    return reports.deliver(identity.id, id, reportId, request.body);
  }));
}
