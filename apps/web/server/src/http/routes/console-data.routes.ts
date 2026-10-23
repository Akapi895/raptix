import type { FastifyInstance } from 'fastify';
import { runProjectsHandler } from './projects.routes.js';
import type { ConsoleDataService, KnowledgeQuery } from '../../services/console-data-service.js';
import { ProjectApiError } from '../../services/projects-service.js';

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{1,6}$/.test(value)) return undefined;
  return Number(value);
}

/** Generated console data: the knowledge index and the capability catalog. Organization-wide reference data, read-only. */
export function registerConsoleDataRoutes(app: FastifyInstance, data: ConsoleDataService): void {
  app.get('/api/knowledge/item', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const id = optionalText((request.query as Record<string, unknown>).id);
    if (id === undefined) throw new ProjectApiError(400, 'A knowledge entry id is required.');
    return data.knowledgeContent(id);
  }));
  app.get('/api/knowledge', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    const query = request.query as Record<string, unknown>;
    const parsed: KnowledgeQuery = {
      q: optionalText(query.q),
      source: optionalText(query.source),
      type: optionalText(query.type),
      page: optionalNumber(query.page),
      pageSize: optionalNumber(query.pageSize),
    };
    return data.listKnowledge(parsed);
  }));
  app.get('/api/capabilities/catalog', (request, reply) => runProjectsHandler(request, reply, async () => {
    reply.header('Cache-Control', 'no-store');
    return data.capabilityCatalog();
  }));
}
