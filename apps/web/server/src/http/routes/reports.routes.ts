import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { runProjectsHandler } from './projects.routes.js';
import type { ReportsService } from '../../services/reports-service.js';

/** Ticket 11 routes: report lifecycle, independent review and delivery records. */
export function registerReportsRoutes(app: FastifyInstance, reports: ReportsService, identity: LocalIdentity): void {
  app.get('/api/engagements/:id/report-records/:reportId/export', (request, reply) => runProjectsHandler(request, reply, () => {
    const { id, reportId } = request.params as { id: string; reportId: string };
    const { format } = request.query as { format?: string };
    reply.header('Cache-Control', 'no-store');
    return reports.exportReport(identity.id, id, reportId, format ?? 'markdown');
  }));
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
  app.post('/api/engagements/:id/report-records/:reportId/revision', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, reportId } = request.params as { id: string; reportId: string };
    return reports.revise(identity.id, id, reportId, request.body);
  }));
  // P06: versioned templates, report setup (template, period, named reviewer) and pinned finding selection.
  app.get('/api/engagements/:id/report-templates', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return reports.listTemplates(identity.id, id);
  }));
  app.post('/api/engagements/:id/report-templates', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    return reports.createTemplate(identity.id, id, request.body);
  }));
  app.patch('/api/engagements/:id/report-records/:reportId/setup', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, reportId } = request.params as { id: string; reportId: string };
    return reports.updateSetup(identity.id, id, reportId, request.body);
  }));
  app.put('/api/engagements/:id/report-records/:reportId/findings', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, reportId } = request.params as { id: string; reportId: string };
    return reports.setFindings(identity.id, id, reportId, request.body);
  }));
  // P07: recipient acknowledgement of a completed delivery, recorded separately from the delivery.
  app.post('/api/engagements/:id/report-records/:reportId/deliveries/:deliveryId/acknowledgements', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, reportId, deliveryId } = request.params as { id: string; reportId: string; deliveryId: string };
    return reports.acknowledge(identity.id, id, reportId, deliveryId, request.body);
  }));
}
