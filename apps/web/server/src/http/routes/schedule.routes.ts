import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { runProjectsHandler } from './projects.routes.js';
import type { ScheduleService } from '../../services/schedule-service.js';

/** W11 (ADR-0073) routes: durable operation schedule intents and their lifecycle. */
export function registerScheduleRoutes(app: FastifyInstance, schedules: ScheduleService, identity: LocalIdentity): void {
  app.get('/api/engagements/:id/schedules', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return schedules.list(identity.id, id);
  }));
  app.post('/api/engagements/:id/schedules', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    return schedules.create(identity.id, id, request.body);
  }));
  app.post('/api/engagements/:id/schedules/:scheduleId/cancel', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, scheduleId } = request.params as { id: string; scheduleId: string };
    return schedules.cancel(identity.id, id, scheduleId, request.body);
  }));
  app.post('/api/engagements/:id/schedules/:scheduleId/reschedule', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, scheduleId } = request.params as { id: string; scheduleId: string };
    return schedules.reschedule(identity.id, id, scheduleId, request.body);
  }));
}
