import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import type { WebShellService } from '../../services/webshell-service.js';
import type { WebShellAcquisitionService } from '../../services/webshell-acquisition-service.js';
import { runProjectsHandler } from './projects.routes.js';

/** Manual WebShell sessions, separate from C2 (ADR-0105). All reads and results are no-store. */
export function registerWebShellRoutes(app: FastifyInstance, service: WebShellService, identity: LocalIdentity): void {
  const prefix = '/api/engagements/:id/webshell/connections';
  app.get(prefix, (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return runProjectsHandler(request, reply, () => service.list(identity.id, id));
  });
  app.post(prefix, (request, reply) => {
    const { id } = request.params as { id: string };
    return runProjectsHandler(request, reply, () => service.create(identity.id, id, request.body));
  });
  app.get(`${prefix}/:connectionId`, (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id, connectionId } = request.params as { id: string; connectionId: string };
    return runProjectsHandler(request, reply, () => service.get(identity.id, id, connectionId));
  });
  app.patch(`${prefix}/:connectionId`, (request, reply) => {
    const { id, connectionId } = request.params as { id: string; connectionId: string };
    return runProjectsHandler(request, reply, () => service.update(identity.id, id, connectionId, request.body));
  });
  app.post(`${prefix}/:connectionId/close`, (request, reply) => {
    const { id, connectionId } = request.params as { id: string; connectionId: string };
    return runProjectsHandler(request, reply, () => service.close(identity.id, id, connectionId));
  });
  app.post(`${prefix}/:connectionId/probe`, (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id, connectionId } = request.params as { id: string; connectionId: string };
    return runProjectsHandler(request, reply, () => service.probe(identity.id, id, connectionId, request.body));
  });
  app.get(`${prefix}/:connectionId/probes`, (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id, connectionId } = request.params as { id: string; connectionId: string };
    return runProjectsHandler(request, reply, () => service.probes(identity.id, id, connectionId));
  });
  app.get(`${prefix}/:connectionId/commands`, (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id, connectionId } = request.params as { id: string; connectionId: string };
    return runProjectsHandler(request, reply, () => service.commands(identity.id, id, connectionId));
  });
  app.post(`${prefix}/:connectionId/commands`, (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id, connectionId } = request.params as { id: string; connectionId: string };
    return runProjectsHandler(request, reply, () => service.execute(identity.id, id, connectionId, request.body));
  });
  app.get(`${prefix}/:connectionId/commands/:commandId`, (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id, connectionId, commandId } = request.params as { id: string; connectionId: string; commandId: string };
    return runProjectsHandler(request, reply, () => service.command(identity.id, id, connectionId, commandId));
  });
}

/** Acquisition routes: derive+refine a sealed PoC into a connection (ADR-0105 §4). */
export function registerWebShellAcquisitionRoutes(app: FastifyInstance, service: WebShellAcquisitionService, identity: LocalIdentity): void {
  const prefix = '/api/engagements/:id/webshell/acquisitions';
  app.get(prefix, (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return runProjectsHandler(request, reply, () => service.list(identity.id, id));
  });
  app.post(prefix, (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    return runProjectsHandler(request, reply, () => service.create(identity.id, id, request.body));
  });
  app.get(`${prefix}/:acquisitionId`, (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id, acquisitionId } = request.params as { id: string; acquisitionId: string };
    return runProjectsHandler(request, reply, () => service.get(identity.id, id, acquisitionId));
  });
  app.post(`${prefix}/:acquisitionId/retry`, (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id, acquisitionId } = request.params as { id: string; acquisitionId: string };
    return runProjectsHandler(request, reply, () => service.retry(identity.id, id, acquisitionId));
  });
}
