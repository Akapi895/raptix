import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import type { RunService } from '../../services/runtime/run-service.js';
import { ProjectPolicyError } from '../../security/project-policy.js';
import { runProjectsHandler } from './projects.routes.js';

export function registerRunRoutes(app: FastifyInstance, service: RunService, identity: LocalIdentity): void {
  const prefix = '/api/engagements/:id';
  app.post(`${prefix}/threads`, (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    const ack = await service.createThread(identity.id, id, request.body);
    reply.status(ack.state === 'accepted' ? 201 : 202); return ack;
  }));
  app.post(`${prefix}/threads/:thread/runs`, (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, thread } = request.params as { id: string; thread: string };
    const ack = await service.submit(identity.id, id, thread, request.body);
    reply.status(202); return ack;
  }));
  app.post(`${prefix}/threads/:thread/resume`, (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, thread } = request.params as { id: string; thread: string };
    const ack = await service.resume(identity.id, id, thread, request.body);
    reply.status(202); return ack;
  }));
  app.post(`${prefix}/threads/:thread/runs/:run/cancel`, (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, thread, run } = request.params as { id: string; thread: string; run: string };
    const view = await service.cancelRun(identity.id, id, thread, run);
    reply.status(200); return view;
  }));
  app.get(`${prefix}/threads`, (request, reply) => runProjectsHandler(request, reply, () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return service.listThreads(identity.id, id);
  }));
  app.get(`${prefix}/instances`, (request, reply) => runProjectsHandler(request, reply, () => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return service.listInstances(identity.id, id);
  }));
  app.post(`${prefix}/instances/:thread/:dispatch/messages`, (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, thread, dispatch } = request.params as { id: string; thread: string; dispatch: string };
    const ack = await service.sendInstanceMessage(identity.id, id, thread, dispatch, request.body);
    reply.status(ack.status === 'accepted' ? 202 : 200);
    return ack;
  }));
  app.post(`${prefix}/instances/:thread/:dispatch/messages/forward`, (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, thread, dispatch } = request.params as { id: string; thread: string; dispatch: string };
    const ack = await service.forwardInstanceMessage(identity.id, id, thread, dispatch, request.body);
    reply.status(ack.status === 'accepted' ? 202 : 200);
    return ack;
  }));
  app.post(`${prefix}/instances/:thread/:dispatch/cancel`, (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, thread, dispatch } = request.params as { id: string; thread: string; dispatch: string };
    const ack = await service.cancelInstance(identity.id, id, thread, dispatch, request.body);
    reply.status(202);
    return ack;
  }));
  app.post(`${prefix}/instances/:thread/:dispatch/commands`, (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, thread, dispatch } = request.params as { id: string; thread: string; dispatch: string };
    const ack = await service.commandInstance(identity.id, id, thread, dispatch, request.body);
    reply.status(202);
    return ack;
  }));
  app.get(`${prefix}/instances/:thread/:dispatch/messages`, (request, reply) => runProjectsHandler(request, reply, () => {
    reply.header('Cache-Control', 'no-store');
    const { id, thread, dispatch } = request.params as { id: string; thread: string; dispatch: string };
    return service.instanceMailbox(identity.id, id, thread, dispatch);
  }));
  app.get(`${prefix}/threads/:thread`, (request, reply) => runProjectsHandler(request, reply, () => {
    reply.header('Cache-Control', 'no-store');
    const { id, thread } = request.params as { id: string; thread: string };
    return service.snapshot(identity.id, id, thread);
  }));
  app.get(`${prefix}/threads/:thread/runs`, (request, reply) => runProjectsHandler(request, reply, () => {
    reply.header('Cache-Control', 'no-store');
    const { id, thread } = request.params as { id: string; thread: string };
    return service.listRuns(identity.id, id, thread, request.query);
  }));
  app.get(`${prefix}/threads/:thread/runs/:run`, (request, reply) => runProjectsHandler(request, reply, () => {
    reply.header('Cache-Control', 'no-store');
    const { id, thread, run } = request.params as { id: string; thread: string; run: string };
    return service.getRun(identity.id, id, thread, run);
  }));
  app.get(`${prefix}/threads/:thread/operation`, (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const { id, thread } = request.params as { id: string; thread: string };
    return service.operation(identity.id, id, thread);
  }));
  app.post(`${prefix}/threads/:thread/runs/:run/pause`, (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, thread, run } = request.params as { id: string; thread: string; run: string };
    const view = await service.pauseRun(identity.id, id, thread, run);
    reply.status(202); return view;
  }));
  app.post(`${prefix}/threads/:thread/rebind`, (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, thread } = request.params as { id: string; thread: string };
    return service.rebindThread(identity.id, id, thread, request.body);
  }));
  app.post(`${prefix}/threads/:thread/resume-run`, (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, thread } = request.params as { id: string; thread: string };
    const ack = await service.resumeRun(identity.id, id, thread, request.body);
    reply.status(202); return ack;
  }));
  app.post(`${prefix}/threads/:thread/complete`, (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id, thread } = request.params as { id: string; thread: string };
    if (request.body !== undefined && (typeof request.body !== 'object' || request.body === null || Object.keys(request.body).length)) throw new ProjectPolicyError('bad_request', 'Completion does not accept overrides');
    return service.completeOperation(identity.id, id, thread);
  }));
  app.post(`${prefix}/requests/:requestId/reconcile`, (request, reply) => runProjectsHandler(request, reply, () => {
    if (request.body !== undefined && (typeof request.body !== 'object' || request.body === null || Array.isArray(request.body) || Object.keys(request.body).length)) throw new ProjectPolicyError('bad_request', 'Reconciliation does not accept runtime overrides');
    const { id, requestId } = request.params as { id: string; requestId: string };
    return service.reconcile(identity.id, id, requestId);
  }));
}
