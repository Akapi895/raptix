import type { FastifyInstance, FastifyReply } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import type { ConversationStore } from "../../db/conversation-store.js";
import type { WebShellConnectionFields, WebShellConnectionRecord, WebShellStore } from "../../db/webshell-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface WebShellRoutesOptions {
  authStore: AuthStore;
  webshellStore: WebShellStore;
  conversationStore: ConversationStore;
}

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** apps/ui-app's WebshellConnection shape (src/features/webshell/model.ts). */
function toWire(connection: WebShellConnectionRecord): Record<string, unknown> {
  return {
    id: connection.id,
    project_id: connection.projectId ?? "",
    url: connection.url,
    password: connection.password,
    type: connection.type,
    method: connection.method,
    cmdParam: connection.cmdParam,
    remark: connection.remark,
    encoding: connection.encoding,
    os: connection.os,
    createdAt: connection.createdAt.toISOString(),
  };
}

function fieldsFromBody(body: Record<string, unknown> | undefined): WebShellConnectionFields {
  if (!body) return {};
  return {
    ...(body.project_id !== undefined ? { projectId: asString(body.project_id) ?? null } : {}),
    ...(body.url !== undefined ? { url: asString(body.url) ?? "" } : {}),
    ...(body.password !== undefined ? { password: asString(body.password) ?? "" } : {}),
    ...(body.type !== undefined ? { type: asString(body.type) ?? "php" } : {}),
    ...(body.method !== undefined ? { method: asString(body.method) ?? "post" } : {}),
    ...(body.cmdParam !== undefined ? { cmdParam: asString(body.cmdParam) ?? "" } : {}),
    ...(body.remark !== undefined ? { remark: asString(body.remark) ?? "" } : {}),
    ...(body.encoding !== undefined ? { encoding: asString(body.encoding) ?? "auto" } : {}),
    ...(body.os !== undefined ? { os: asString(body.os) ?? "auto" } : {}),
  };
}

/**
 * exec/file would issue the actual HTTP request to `connection.url` with the
 * stored password to run a command or move a file on the target. That is a
 * raw outbound HTTP relay to an operator-supplied URL, bypassing Raptix's
 * sandbox-mediated network egress and RoE/scope checks entirely -- this
 * repo's guard-rail rule (CONTRIBUTING_AGENT.md: "do not weaken guard rails
 * without an ADR + threat model") forbids introducing that kind of
 * unguarded relay casually. Stub honestly rather than build it without a
 * safety gate.
 */
async function notImplementedForThisDeployment(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

export function registerWebShellRoutes(app: FastifyInstance, options: WebShellRoutesOptions): void {
  const { authStore, webshellStore, conversationStore } = options;
  const requireSession = createRequireSession(authStore);

  app.get("/api/webshell/connections", { preHandler: requireSession }, async (_request, reply) => {
    await reply.send({ connections: (await webshellStore.list()).map(toWire) });
  });

  app.post<{ Body: Record<string, unknown> }>(
    "/api/webshell/connections",
    { preHandler: requireSession },
    async (request, reply) => {
      const url = asString(request.body?.url);
      if (!url) {
        await reply.code(400).send({ error: "Invalid request body" });
        return;
      }
      const connection = await webshellStore.create({ ...fieldsFromBody(request.body), url });
      await reply.send(toWire(connection));
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/webshell/connections/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const deleted = await webshellStore.delete(request.params.id);
      if (!deleted) {
        await reply.code(404).send({ error: "Connection not found" });
        return;
      }
      await reply.send({ success: true });
    },
  );

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/webshell/connections/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const connection = await webshellStore.update(request.params.id, fieldsFromBody(request.body));
      if (!connection) {
        await reply.code(404).send({ error: "Connection not found" });
        return;
      }
      await reply.send(toWire(connection));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/webshell/connections/:id/ai-conversations",
    { preHandler: requireSession },
    async (request, reply) => {
      const connection = await webshellStore.findById(request.params.id);
      if (!connection) {
        await reply.code(404).send({ error: "Connection not found" });
        return;
      }
      const ids = await webshellStore.linkedConversationIds(connection.id);
      await reply.send({ conversations: ids.map((id) => ({ id })) });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/webshell/connections/:id/ai-history",
    { preHandler: requireSession },
    async (request, reply) => {
      const connection = await webshellStore.findById(request.params.id);
      if (!connection) {
        await reply.code(404).send({ error: "Connection not found" });
        return;
      }
      const [latestId] = await webshellStore.linkedConversationIds(connection.id);
      const messages = latestId ? await conversationStore.listMessages(latestId) : [];
      await reply.send({
        conversationId: latestId ?? "",
        messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString() })),
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/webshell/connections/:id/state",
    { preHandler: requireSession },
    async (request, reply) => {
      const connection = await webshellStore.findById(request.params.id);
      if (!connection) {
        await reply.code(404).send({ error: "Connection not found" });
        return;
      }
      await reply.send(JSON.parse(connection.stateJson));
    },
  );

  app.put<{ Params: { id: string }; Body: unknown }>(
    "/api/webshell/connections/:id/state",
    { preHandler: requireSession },
    async (request, reply) => {
      const connection = await webshellStore.setState(request.params.id, JSON.stringify(request.body ?? {}));
      if (!connection) {
        await reply.code(404).send({ error: "Connection not found" });
        return;
      }
      await reply.send({ success: true });
    },
  );

  app.post("/api/webshell/exec", { preHandler: requireSession }, notImplementedForThisDeployment);
  app.post("/api/webshell/file", { preHandler: requireSession }, notImplementedForThisDeployment);
}
