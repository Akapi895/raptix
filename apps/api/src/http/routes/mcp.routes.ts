import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RuntimeTransport } from "../../adapters/runtime/client.js";
import type { AuthStore } from "../../db/auth-store.js";
import type { ConversationStore } from "../../db/conversation-store.js";
import type { ExternalMcpStore } from "../../db/external-mcp-store.js";
import { findExecutionById } from "../../services/execution-derivation.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface McpRoutesOptions {
  authStore: AuthStore;
  conversationStore: ConversationStore;
  runtime: RuntimeTransport;
  externalMcpStore: ExternalMcpStore;
}

/**
 * `/api/mcp/tools` would need a live registry of Raptix's own ~159
 * @tool-decorated functions (docs/architecture/tool-classification.md) --
 * no HTTP introspection endpoint for that catalog exists anywhere in the
 * runtime. Hardcoding a copy here would silently drift from the real
 * catalog; stub honestly instead.
 */
async function toolsNotImplemented(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

/**
 * Per-tool-call cancellation has no primitive in the LangGraph runtime HTTP
 * API -- only whole-run cancellation exists (POST /api/agent-loop/cancel,
 * Tier 2). Stub rather than silently cancel the whole run under a
 * single-call-cancel label, which would surprise the operator.
 */
async function cancelNotImplemented(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

export function registerMcpRoutes(app: FastifyInstance, options: McpRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);
  const { conversationStore, runtime, externalMcpStore } = options;

  app.get("/api/mcp/tools", { preHandler: requireSession }, toolsNotImplemented);

  app.get("/api/mcp/external", { preHandler: requireSession }, async () => {
    const servers = await externalMcpStore.list();
    return { servers: servers.map((server) => ({ name: server.name, enabled: server.enabled, config: server.config })) };
  });

  app.get("/api/mcp/executions/:id", { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const execution = await findExecutionById(id, conversationStore, runtime);
    if (!execution) {
      await reply.code(404).send({ error: "execution not found" });
      return;
    }
    return execution;
  });

  app.post("/api/mcp/executions/:id/cancel", { preHandler: requireSession }, cancelNotImplemented);
}
