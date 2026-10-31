import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import type { MarkdownAgentFields, MarkdownAgentRecord, MarkdownAgentStore } from "../../db/markdown-agent-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface MarkdownAgentRoutesOptions {
  authStore: AuthStore;
  markdownAgentStore: MarkdownAgentStore;
}

const BASE = "/api/multi-agent/markdown-agents";

/** `filename` on the wire is `${id}.md` -- derived, never stored separately (see schema.prisma's note). */
const toFilename = (id: string) => `${id}.md`;
const toId = (filename: string) => filename.replace(/\.md$/, "");

function toWire(agent: MarkdownAgentRecord) {
  return {
    filename: toFilename(agent.id),
    id: agent.id,
    name: agent.name,
    description: agent.description,
    is_orchestrator: agent.isOrchestrator,
    tools: agent.tools,
    instruction: agent.instruction,
    bind_role: agent.bindRole,
    max_iterations: agent.maxIterations,
    kind: agent.kind,
  };
}

function fieldsFromBody(body: Record<string, unknown> | undefined): MarkdownAgentFields | null {
  if (!body || typeof body.name !== "string" || !body.name) return null;
  const tools = Array.isArray(body.tools) ? body.tools.filter((tool): tool is string => typeof tool === "string") : [];
  return {
    name: body.name,
    description: typeof body.description === "string" ? body.description : "",
    isOrchestrator: body.is_orchestrator === true,
    tools,
    instruction: typeof body.instruction === "string" ? body.instruction : "",
    bindRole: typeof body.bind_role === "string" ? body.bind_role : "",
    maxIterations: typeof body.max_iterations === "number" ? body.max_iterations : 0,
    kind: typeof body.kind === "string" ? body.kind : "",
  };
}

/**
 * Real CRUD. Markdown agents are stored structurally in Postgres, not as
 * actual .md files on disk -- the retired Go backend parsed real files;
 * there is nothing here to parse, so the `raw` field apps/ui-app's own
 * MarkdownAgent type carries (and never reads) is simply omitted. Not
 * wired into POST /api/multi-agent (stubbed 501 since Tier 2) -- this
 * storage is real, dispatching an agent defined here is not, the same
 * posture as Tier 5/6's AI roles and tool-guard config.
 */
export function registerMarkdownAgentRoutes(app: FastifyInstance, options: MarkdownAgentRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);
  const { markdownAgentStore } = options;

  app.get(BASE, { preHandler: requireSession }, async () => {
    const agents = await markdownAgentStore.list();
    return { agents: agents.map(toWire) };
  });

  app.get(`${BASE}/:filename`, { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { filename } = request.params as { filename: string };
    const agent = await markdownAgentStore.get(toId(filename));
    if (!agent) {
      await reply.code(404).send({ error: "markdown agent not found" });
      return;
    }
    return toWire(agent);
  });

  app.post(BASE, { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { id?: string } & Record<string, unknown> | undefined;
    const fields = fieldsFromBody(body);
    if (!body?.id || !fields) {
      await reply.code(400).send({ error: "id and name are required" });
      return;
    }
    const existing = await markdownAgentStore.get(body.id);
    if (existing) {
      await reply.code(409).send({ error: "a markdown agent with this id already exists" });
      return;
    }
    const agent = await markdownAgentStore.create(body.id, fields);
    return toWire(agent);
  });

  app.put(`${BASE}/:filename`, { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { filename } = request.params as { filename: string };
    const fields = fieldsFromBody(request.body as Record<string, unknown>);
    if (!fields) {
      await reply.code(400).send({ error: "name is required" });
      return;
    }
    const agent = await markdownAgentStore.update(toId(filename), fields);
    if (!agent) {
      await reply.code(404).send({ error: "markdown agent not found" });
      return;
    }
    return toWire(agent);
  });

  app.delete(`${BASE}/:filename`, { preHandler: requireSession }, async (request: FastifyRequest) => {
    const { filename } = request.params as { filename: string };
    const deleted = await markdownAgentStore.delete(toId(filename));
    return { success: deleted };
  });
}
