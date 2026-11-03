import type { FastifyInstance } from 'fastify';
import { specialistAdditionsSchema, type SpecialistAdditions, type SpecialistCatalog } from '@raptix/web-contracts';
import type { AuthStore } from '../../db/auth-store.js';
import type { ProjectStore } from '../../db/project-store.js';
import type { RuntimeTransport } from '../../adapters/runtime/client.js';
import { SpecialistConfigConflict, type SpecialistConfigurationService } from '../../services/specialist-configuration.js';
import { createRequireSession } from '../plugins/auth-guard.js';
import { replyRuntimeError } from './conversations.routes.js';

interface Scope { project_id?: string }
interface Identity { id: string }
const params = { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' } } };
const querystring = { type: 'object', additionalProperties: false, properties: { project_id: { type: 'string', minLength: 1, maxLength: 128 } } };

export function registerSpecialistConfigurationRoutes(app: FastifyInstance, options: {
  authStore: AuthStore; projectStore: ProjectStore; runtime: RuntimeTransport; configuration: SpecialistConfigurationService;
}): void {
  const preHandler = createRequireSession(options.authStore);
  // The modal requests its catalog and configuration together. Share discovery only
  // while in flight; subsequent reads and admission still check live availability.
  const catalogs = new Map<string, Promise<SpecialistCatalog>>();
  const catalogFor = (id: string): Promise<SpecialistCatalog> => {
    const pending = catalogs.get(id);
    if (pending) return pending;
    const discovery = options.runtime.specialistRequest('/_raptix/specialists/catalog?specialist_id=' + encodeURIComponent(id)) as Promise<SpecialistCatalog>;
    catalogs.set(id, discovery);
    void discovery.then(() => catalogs.delete(id), () => catalogs.delete(id));
    return discovery;
  };

  app.get<{ Params: Identity }>('/api/specialists/:id/catalog', { preHandler, schema: { params } }, async (request, reply) => {
    try { return await catalogFor(request.params.id); } catch (error) { return replyRuntimeError(reply, error); }
  });

  app.get<{ Params: Identity; Querystring: Scope }>('/api/specialists/:id/configuration', { preHandler, schema: { params, querystring } }, async (request, reply) => {
    if (request.query.project_id && !await options.projectStore.findById(request.query.project_id)) return reply.code(404).send({ error: 'Project not found' });
    try { return await options.configuration.read(request.params.id, request.query.project_id ?? null, await catalogFor(request.params.id)); }
    catch (error) { return replyRuntimeError(reply, error); }
  });

  app.put<{ Params: Identity; Querystring: Scope; Body: { revision: number; additions: SpecialistAdditions } }>('/api/specialists/:id/configuration', {
    preValidation: async (request, reply) => {
      const body = request.body;
      if (!body || typeof body !== 'object') return;
      if (Object.keys(body).some(k => !['revision', 'additions'].includes(k)) || (body.additions && Object.keys(body.additions).some(k => !['skills', 'tools', 'mcp'].includes(k)))) {
        return reply.code(400).send({ error: 'Only revision and additive capability IDs may be configured' });
      }
    },
    preHandler, schema: { params, querystring, body: { type: 'object', additionalProperties: false, required: ['revision', 'additions'], properties: {
      revision: { type: 'integer', minimum: 0 }, additions: specialistAdditionsSchema,
    } } },
  }, async (request, reply) => {
    if (request.query.project_id && !await options.projectStore.findById(request.query.project_id)) return reply.code(404).send({ error: 'Project not found' });
    try {
      const catalog = await catalogFor(request.params.id);
      await options.configuration.update(request.params.id, request.query.project_id ?? null, request.body.additions, request.body.revision);
      return await options.configuration.read(request.params.id, request.query.project_id ?? null, catalog);
    } catch (error) {
      if (error instanceof SpecialistConfigConflict) return reply.code(409).send({ error: error.message });
      return replyRuntimeError(reply, error);
    }
  });
}
