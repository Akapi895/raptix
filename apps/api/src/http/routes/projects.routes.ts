import type { FastifyInstance, FastifyReply } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import type { ConversationStore } from "../../db/conversation-store.js";
import type { ProjectRecord, ProjectStore } from "../../db/project-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface ProjectRoutesOptions {
  authStore: AuthStore;
  projectStore: ProjectStore;
  conversationStore: ConversationStore;
}

interface ListQuery {
  status?: string;
  search?: string;
  limit?: string;
  offset?: string;
}

interface CreateBody {
  name?: unknown;
  description?: unknown;
  scope_json?: unknown;
  status?: unknown;
}

interface UpdateBody {
  name?: unknown;
  description?: unknown;
  scope_json?: unknown;
  status?: unknown;
  pinned?: unknown;
}

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const asNullableString = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === "string" ? value : undefined;

/** apps/ui-app's Project shape (src/api/types/project.ts): snake_case, unlike Conversation's camelCase. */
function toWire(project: ProjectRecord): Record<string, unknown> {
  return {
    id: project.id,
    name: project.name,
    description: project.description ?? "",
    scope_json: project.scopeJson ?? "",
    status: project.status,
    pinned: project.pinned,
    created_at: project.createdAt.toISOString(),
    updated_at: project.updatedAt.toISOString(),
    conversation_count: project.conversationCount,
    vulnerability_count: project.vulnerabilityCount,
    asset_count: project.assetCount,
  };
}

/** Fact graph / fact-edge sub-resources need the Neo4j AKG client (Tier 5, knowledge/graph) -- not built yet. */
async function notImplementedForThisDeployment(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

export function registerProjectRoutes(app: FastifyInstance, options: ProjectRoutesOptions): void {
  const { authStore, projectStore, conversationStore } = options;
  const requireSession = createRequireSession(authStore);

  app.get<{ Querystring: ListQuery }>("/api/projects", { preHandler: requireSession }, async (request, reply) => {
    const limit = Number(request.query.limit ?? 20) || 20;
    const offset = Number(request.query.offset ?? 0) || 0;
    const { projects, total } = await projectStore.list({
      status: request.query.status,
      search: request.query.search,
      limit,
      offset,
    });
    await reply.send({ projects: projects.map(toWire), total, limit, offset });
  });

  app.post<{ Body: CreateBody }>("/api/projects", { preHandler: requireSession }, async (request, reply) => {
    const name = asString(request.body?.name);
    if (!name) {
      await reply.code(400).send({ error: "Invalid request body" });
      return;
    }
    const project = await projectStore.create({
      name,
      description: asString(request.body?.description),
      scopeJson: asString(request.body?.scope_json),
      status: asString(request.body?.status),
    });
    await reply.send(toWire(project));
  });

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await projectStore.findById(request.params.id);
      if (!project) {
        await reply.code(404).send({ error: "Project not found" });
        return;
      }
      await reply.send(toWire(project));
    },
  );

  app.put<{ Params: { id: string }; Body: UpdateBody }>(
    "/api/projects/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await projectStore.update(request.params.id, {
        name: asNullableString(request.body?.name),
        description: asNullableString(request.body?.description),
        scopeJson: asNullableString(request.body?.scope_json),
        status: asNullableString(request.body?.status),
        pinned: typeof request.body?.pinned === "boolean" ? request.body.pinned : undefined,
      });
      if (!project) {
        await reply.code(404).send({ error: "Project not found" });
        return;
      }
      await reply.send(toWire(project));
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/projects/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const deleted = await projectStore.delete(request.params.id);
      if (!deleted) {
        await reply.code(404).send({ error: "Project not found" });
        return;
      }
      await reply.send({ success: true });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/stats",
    { preHandler: requireSession },
    async (request, reply) => {
      const stats = await projectStore.stats(request.params.id);
      if (!stats) {
        await reply.code(404).send({ error: "Project not found" });
        return;
      }
      await reply.send(stats);
    },
  );

  app.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string } }>(
    "/api/projects/:id/conversations",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await projectStore.findById(request.params.id);
      if (!project) {
        await reply.code(404).send({ error: "Project not found" });
        return;
      }
      const limit = Number(request.query.limit ?? 50) || 50;
      const offset = Number(request.query.offset ?? 0) || 0;
      const { conversations, total } = await conversationStore.list({ projectId: project.id, limit, offset });
      await reply.send({
        conversations: conversations.map((c) => ({
          id: c.id,
          title: c.title,
          projectId: c.projectId ?? "",
          roleName: c.roleName ?? "",
          agentMode: c.agentMode,
          pinned: c.pinned,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        })),
        total,
        limit,
        offset,
      });
    },
  );

  // Fact graph / facts / promote-attack-chain: Neo4j AKG wiring (Tier 5) is not built yet.
  for (const [method, path] of [
    ["GET", "/api/projects/:id/fact-edges"],
    ["POST", "/api/projects/:id/fact-edges"],
    ["DELETE", "/api/projects/:id/fact-edges/:edgeId"],
    ["GET", "/api/projects/:id/fact-graph"],
    ["GET", "/api/projects/:id/facts"],
    ["POST", "/api/projects/:id/facts"],
    ["DELETE", "/api/projects/:id/facts/:factId"],
    ["PUT", "/api/projects/:id/facts/:factId"],
    ["POST", "/api/projects/:id/facts/deprecate"],
    ["POST", "/api/projects/:id/facts/restore"],
    ["POST", "/api/projects/:id/promote-attack-chain/:conversationId"],
  ] as const) {
    app.route({ method, url: path, preHandler: requireSession, handler: notImplementedForThisDeployment });
  }
}
