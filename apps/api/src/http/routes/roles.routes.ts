import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AiRoleRecord, AiRoleStore } from "../../db/ai-role-store.js";
import type { AuthStore } from "../../db/auth-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface RolesRoutesOptions {
  authStore: AuthStore;
  aiRoleStore: AiRoleStore;
}

/** apps/ui-app's Role shape (features/roles/model.ts, internal/config/config.go RoleConfig). */
function toWire(role: AiRoleRecord) {
  return {
    name: role.name,
    description: role.description,
    icon: role.icon,
    user_prompt: role.userPrompt,
    tools: role.tools,
    mcps: role.mcps,
    enabled: role.enabled,
    workflow_id: role.workflowId,
    workflow_policy: role.workflowPolicy,
  };
}

function fieldsFromBody(body: Record<string, unknown> | undefined) {
  if (!body) return {};
  const strings = (value: unknown): string[] | undefined => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined);
  return {
    ...(body.description !== undefined ? { description: String(body.description ?? "") } : {}),
    ...(body.icon !== undefined ? { icon: String(body.icon ?? "") } : {}),
    ...(body.user_prompt !== undefined ? { userPrompt: String(body.user_prompt ?? "") } : {}),
    ...(body.tools !== undefined ? { tools: strings(body.tools) ?? [] } : {}),
    ...(body.mcps !== undefined ? { mcps: strings(body.mcps) ?? [] } : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled === true } : {}),
    ...(body.workflow_id !== undefined ? { workflowId: String(body.workflow_id ?? "") } : {}),
    ...(body.workflow_policy !== undefined ? { workflowPolicy: String(body.workflow_policy ?? "") } : {}),
  };
}

/**
 * "AI roles" (agent personas apps/ui-app lets an operator author) are
 * stored and returned faithfully, but `tools`/`mcps` are opaque name
 * lists -- never validated against Raptix's real tool/MCP catalog, since
 * no HTTP introspection of that catalog exists anywhere apps/api touches
 * (same reasoning as Tier 5's config/tools stub). Not to be confused with
 * Raptix's own agent specialist roles (intelligence/agents) or with user
 * RBAC (apps/ui-app's own frontend has no feature for that at all -- see
 * this tier's plan note).
 */
export function registerRolesRoutes(app: FastifyInstance, options: RolesRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);
  const { aiRoleStore } = options;

  app.get("/api/roles", { preHandler: requireSession }, async () => {
    const roles = await aiRoleStore.list();
    return { roles: roles.map(toWire) };
  });

  app.get("/api/roles/:name", { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    const role = await aiRoleStore.get(name);
    if (!role) {
      await reply.code(404).send({ error: "role not found" });
      return;
    }
    return toWire(role);
  });

  app.post("/api/roles", { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { name?: string } & Record<string, unknown> | undefined;
    if (!body?.name) {
      await reply.code(400).send({ error: "name is required" });
      return;
    }
    const existing = await aiRoleStore.get(body.name);
    if (existing) {
      await reply.code(409).send({ error: "a role with this name already exists" });
      return;
    }
    const role = await aiRoleStore.create(body.name, fieldsFromBody(body));
    return toWire(role);
  });

  app.put("/api/roles/:name", { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    const role = await aiRoleStore.update(name, fieldsFromBody(request.body as Record<string, unknown>));
    if (!role) {
      await reply.code(404).send({ error: "role not found" });
      return;
    }
    return toWire(role);
  });

  app.delete("/api/roles/:name", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const deleted = await aiRoleStore.delete(name);
    return { success: deleted };
  });
}
