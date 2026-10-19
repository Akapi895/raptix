import type { FastifyInstance } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import type { EnvironmentFacade } from '../../services/environments/environment-facade.js';
import { runProjectsHandler } from './projects.routes.js';

/** Project lifecycle facade shared by the Web UI and the CLI (ADR-0092). */
export function registerEnvironmentRoutes(app: FastifyInstance, facade: EnvironmentFacade, identity: LocalIdentity): void {
  const prefix = '/api/engagements/:id/environment';
  app.get(prefix, (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    return facade.state(identity.id, id);
  }));
  app.post(`${prefix}/commands`, (request, reply) => runProjectsHandler(request, reply, async () => {
    const { id } = request.params as { id: string };
    const { statusCode, result } = await facade.command(identity.id, id, request.body);
    reply.status(statusCode);
    return result;
  }));
}
