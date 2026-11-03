import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import type { ExternalMcpServerRecord, ExternalMcpStore } from "../../db/external-mcp-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface ExternalMcpRoutesOptions {
  authStore: AuthStore;
  externalMcpStore: ExternalMcpStore;
}

function toWire(server: ExternalMcpServerRecord) {
  // status/tool_count/error are live-state fields (apps/ui-app's MCPServer type) this store
  // cannot observe -- RAPTIX_MCP__SERVERS is read once at the langgraph container's startup,
  // with no live reload or per-server RPC (execution/tools/mcp/client.py). Reporting a
  // status here would be a guess dressed up as fact; "unknown" says so honestly.
  return { status: "unknown", config: server.config };
}

/**
 * start/stop would need a live control-plane RPC into the running langgraph
 * container to add/remove a server from its in-memory MultiServerMCPClient
 * -- none exists (RAPTIX_MCP__SERVERS is parsed once at process startup).
 * The stored config here is what the operator *wants* wired in on next
 * restart, not something this endpoint can action live.
 */
async function toggleNotImplemented(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

export function registerExternalMcpRoutes(app: FastifyInstance, options: ExternalMcpRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);
  const { externalMcpStore } = options;

  app.get("/api/external-mcp", { preHandler: requireSession }, async () => {
    const servers = await externalMcpStore.list();
    const enabled = servers.filter((server) => server.enabled).length;
    return {
      servers: Object.fromEntries(servers.map((server) => [server.name, toWire(server)])),
      stats: { total: servers.length, enabled, disabled: servers.length - enabled, connected: 0 },
    };
  });

  app.get("/api/external-mcp/stats", { preHandler: requireSession }, async () => {
    const servers = await externalMcpStore.list();
    const enabled = servers.filter((server) => server.enabled).length;
    return { total: servers.length, enabled, disabled: servers.length - enabled, connected: 0 };
  });

  app.get("/api/external-mcp/:name", { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    const server = await externalMcpStore.get(name);
    if (!server) {
      await reply.code(404).send({ error: "server not found" });
      return;
    }
    return toWire(server);
  });

  app.put("/api/external-mcp/:name", { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    const body = request.body as { config?: Record<string, unknown> } | undefined;
    if (!body?.config || typeof body.config !== "object") {
      await reply.code(400).send({ error: "config is required" });
      return;
    }
    const saved = await externalMcpStore.upsert(name, body.config);
    return toWire(saved);
  });

  app.delete("/api/external-mcp/:name", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const { name } = request.params as { name: string };
    const deleted = await externalMcpStore.delete(name);
    return { success: deleted };
  });

  app.post("/api/external-mcp/:name/start", { preHandler: requireSession }, toggleNotImplemented);
  app.post("/api/external-mcp/:name/stop", { preHandler: requireSession }, toggleNotImplemented);
}
