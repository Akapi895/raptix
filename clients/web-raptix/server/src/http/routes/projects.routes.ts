import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { LocalIdentity } from '../../auth/identity-provider.js';
import { ProjectPolicyError } from '../../security/project-policy.js';
import { ProjectApiError } from '../../services/projects-service.js';
import type { ProjectsService } from '../../services/projects-service.js';
import type { RuntimeOwnershipService } from '../../services/runtime-ownership.js';
import type { RuntimeContextService } from '../../services/runtime/runtime-context.js';
import { apiErrorBody } from '../error-handler.js';

export interface ProjectRoutesDeps {
  readonly service: ProjectsService;
  /** Local single-user identity; userId is derived from `identity.id`. */
  readonly identity: LocalIdentity;
  readonly ownership?: RuntimeOwnershipService;
  readonly runtimeContext?: RuntimeContextService;
}

const POLICY_ERROR_STATUS: Record<ProjectPolicyError['code'], number> = {
  bad_request: 400,
  conflict: 409,
  not_found: 404,
};

/**
 * Typed translation: known policy/service errors become their HTTP status
 * with the (bounded, input-shaped) message; anything unknown is logged for
 * the server only and answered with a sanitized 500 envelope that carries no
 * error detail and never echoes request payloads or filesystem paths.
 */
async function sendProjectsError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
): Promise<FastifyReply> {
  if (error instanceof ProjectPolicyError) {
    const status = POLICY_ERROR_STATUS[error.code];
    return reply.status(status).send(apiErrorBody(status, error.message, error.details));
  }
  if (error instanceof ProjectApiError) {
    return reply
      .status(error.statusCode)
      .send(apiErrorBody(error.statusCode, error.message));
  }
  request.log.error({ err: error }, 'projects request failed');
  return reply.status(500).send(apiErrorBody(500, 'Internal server error'));
}

async function runProjectsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
  action: () => Promise<unknown>,
): Promise<unknown> {
  try {
    return await action();
  } catch (error) {
    return sendProjectsError(request, reply, error);
  }
}

function readProjectId(request: FastifyRequest): string {
  const params = request.params as { id?: unknown };
  return typeof params.id === 'string' ? params.id : '';
}

/**
 * Project/engagement API (W02 scope): GET/POST /api/engagements and
 * GET/PATCH /api/engagements/:id. GET is side-effect-free (no legacy
 * workspace auto-import). DELETE is intentionally not registered — legacy
 * deletion is not DB-only-safe to expose, so the typed 404 envelope answers
 * instead.
 */
export function registerProjectRoutes(
  app: FastifyInstance,
  deps: ProjectRoutesDeps,
): void {
  const { service, identity } = deps;
  if (deps.runtimeContext) {
    const context = deps.runtimeContext;
    app.get('/api/agents', (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return runProjectsHandler(request, reply, () => context.agents());
    });
    app.get('/api/engagements/:id/runtime-context', (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return runProjectsHandler(request, reply, async () => (await context.resolve(identity.id, readProjectId(request), request.query)).publicView);
    });
  }
  if (deps.ownership) {
    const ownership = deps.ownership;
    app.get('/api/engagements/:id/requests/:requestId', (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { id, requestId } = request.params as { id: string; requestId: string };
      return runProjectsHandler(request, reply, () => ownership.recover(identity.id, id, requestId));
    });
    app.get('/api/engagements/:id/thread-bindings/:threadId', (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { id, threadId } = request.params as { id: string; threadId: string };
      return runProjectsHandler(request, reply, () => ownership.getBinding(identity.id, id, threadId));
    });
  }

  app.get('/api/engagements/:id/plan-docs', (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return runProjectsHandler(request, reply, () => service.getPlanning(identity.id, readProjectId(request)));
  });
  app.get('/api/engagements/:id/opplan', (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return runProjectsHandler(request, reply, async () => (await service.getPlanning(identity.id, readProjectId(request))).documents.opplan);
  });

  app.get('/api/engagements', (request, reply) =>
    runProjectsHandler(request, reply, () =>
      service.listProjects(identity.id),
    ),
  );

  app.post('/api/engagements', (request, reply) =>
    runProjectsHandler(request, reply, async () => {
      const project = await service.createProject(identity.id, request.body);
      reply.status(201);
      return project;
    }),
  );

  app.get('/api/engagements/:id', (request, reply) =>
    runProjectsHandler(request, reply, () =>
      service.getProject(identity.id, readProjectId(request)),
    ),
  );

  app.patch('/api/engagements/:id', (request, reply) =>
    runProjectsHandler(request, reply, () =>
      service.patchProject(
        identity.id,
        readProjectId(request),
        request.body,
      ),
    ),
  );
}
