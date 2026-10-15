import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { runProjectsHandler } from './projects.routes.js';
import type { GovernanceService } from '../../services/governance-service.js';

/** Ticket 09 routes: business plans, preflight, operation bindings and emergency stops. */
export function registerGovernanceRoutes(app: FastifyInstance, governance: GovernanceService, identity: LocalIdentity, cancelRun?: (threadId: string, runId: string | null, actorId: string, engagementId: string) => Promise<string>): void {
  app.get('/api/engagements/:id/plans', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return governance.plans(identity.id, id);
  }));
  app.post('/api/engagements/:id/plans', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    return governance.savePlan(identity.id, id, request.body);
  }));
  app.post('/api/engagements/:id/plans/:planId/propose', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, planId } = request.params as { id: string; planId: string };
    return governance.proposePlan(identity.id, id, planId);
  }));
  app.post('/api/engagements/:id/plans/:planId/decision', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, planId } = request.params as { id: string; planId: string };
    return governance.decidePlan(identity.id, id, planId, request.body);
  }));
  app.post('/api/engagements/:id/plans/:planId/revisions', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, planId } = request.params as { id: string; planId: string };
    return governance.revisePlan(identity.id, id, planId, request.body);
  }));
  app.get('/api/engagements/:id/plans/:planId/compare', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id, planId } = request.params as { id: string; planId: string };
    const query = request.query as { baseId?: string };
    return governance.comparePlans(identity.id, id, planId, query.baseId ?? '');
  }));
  app.get('/api/engagements/:id/preflight', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    const query = request.query as { threadId?: string };
    return governance.preflight(identity.id, id, query.threadId ?? null);
  }));
  app.post('/api/engagements/:id/bindings', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { planId?: string; threadId?: string };
    if (typeof body.planId !== 'string' || body.planId.length === 0) {
      const err = new Error('planId is required.') as Error & { statusCode?: number };
      err.statusCode = 400;
      throw err;
    }
    return governance.bindPlan(identity.id, id, body.planId, body.threadId ?? null);
  }));
  app.get('/api/engagements/:id/estops', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    return governance.emergencyStops(identity.id, id);
  }));
  app.post('/api/engagements/:id/estops', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    return governance.emergencyStop(identity.id, id, request.body, cancelRun);
  }));

  // W10: explicit resolution clears the work blocker; it never resumes runs.
  app.post('/api/engagements/:id/estops/:stopId/resolve', (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, stopId } = request.params as { id: string; stopId: string };
    return governance.resolveEmergencyStop(identity.id, id, stopId, request.body);
  }));
}
