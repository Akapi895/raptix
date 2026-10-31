import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { RuntimeTransport } from "../../adapters/runtime/client.js";
import { RuntimeRejectedError, RuntimeUnavailableError } from "../../adapters/runtime/errors.js";
import type { AuthStore } from "../../db/auth-store.js";
import type { ConversationRecord, ConversationStore, MessageRecord } from "../../db/conversation-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface ConversationRoutesOptions {
  authStore: AuthStore;
  conversationStore: ConversationStore;
  runtime: RuntimeTransport;
}

interface ListQuery {
  project_id?: string;
  projectId?: string;
  search?: string;
  limit?: string;
  offset?: string;
}

interface CreateBody {
  title?: unknown;
  projectId?: unknown;
}

interface RenameBody {
  title?: unknown;
}

interface PinnedBody {
  pinned?: unknown;
}

interface ProjectBody {
  projectId?: unknown;
}

const asString = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

/** apps/ui-app's Conversation shape (src/api/types/conversation.ts): camelCase, unlike Project's snake_case. */
function toWire(conversation: ConversationRecord, messages?: MessageRecord[]): Record<string, unknown> {
  return {
    id: conversation.id,
    title: conversation.title,
    projectId: conversation.projectId ?? "",
    roleName: conversation.roleName ?? "",
    agentMode: conversation.agentMode,
    pinned: conversation.pinned,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    ...(messages
      ? {
          messages: messages.map((m) => ({
            id: m.id,
            conversationId: m.conversationId,
            role: m.role,
            content: m.content,
            reasoningContent: "",
            mcpExecutionIds: [],
            processDetails: [],
            createdAt: m.createdAt.toISOString(),
            updatedAt: m.updatedAt.toISOString(),
          })),
        }
      : {}),
  };
}

export function registerConversationRoutes(app: FastifyInstance, options: ConversationRoutesOptions): void {
  const { authStore, conversationStore, runtime } = options;
  const requireSession = createRequireSession(authStore);

  app.get<{ Querystring: ListQuery }>(
    "/api/conversations",
    { preHandler: requireSession },
    async (request, reply) => {
      const limit = Number(request.query.limit ?? 50) || 50;
      const offset = Number(request.query.offset ?? 0) || 0;
      const projectId = asString(request.query.project_id) ?? asString(request.query.projectId);
      const { conversations, total } = await conversationStore.list({
        projectId,
        search: asString(request.query.search),
        limit,
        offset,
      });
      await reply.send({ conversations: conversations.map((c) => toWire(c)), total, limit, offset });
    },
  );

  app.post<{ Body: CreateBody }>("/api/conversations", { preHandler: requireSession }, async (request, reply) => {
    const title = asString(request.body?.title) ?? "New conversation";
    const projectId = asString(request.body?.projectId);
    const runtimeThreadId = randomUUID();
    try {
      await runtime.createThread(runtimeThreadId);
    } catch (error) {
      await replyRuntimeError(reply, error);
      return;
    }
    const conversation = await conversationStore.create({ title, projectId, runtimeThreadId });
    await reply.send(toWire(conversation));
  });

  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const conversation = await conversationStore.findById(request.params.id);
      if (!conversation) {
        await reply.code(404).send({ error: "Conversation not found" });
        return;
      }
      const messages = await conversationStore.listMessages(conversation.id);
      await reply.send(toWire(conversation, messages));
    },
  );

  app.put<{ Params: { id: string }; Body: RenameBody }>(
    "/api/conversations/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const title = asString(request.body?.title);
      if (!title) {
        await reply.code(400).send({ error: "Invalid request body" });
        return;
      }
      const conversation = await conversationStore.rename(request.params.id, title);
      if (!conversation) {
        await reply.code(404).send({ error: "Conversation not found" });
        return;
      }
      await reply.send(toWire(conversation));
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/conversations/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const deleted = await conversationStore.delete(request.params.id);
      if (!deleted) {
        await reply.code(404).send({ error: "Conversation not found" });
        return;
      }
      await reply.send({ success: true });
    },
  );

  app.put<{ Params: { id: string }; Body: PinnedBody }>(
    "/api/conversations/:id/pinned",
    { preHandler: requireSession },
    async (request, reply) => {
      if (typeof request.body?.pinned !== "boolean") {
        await reply.code(400).send({ error: "Invalid request body" });
        return;
      }
      const conversation = await conversationStore.setPinned(request.params.id, request.body.pinned);
      if (!conversation) {
        await reply.code(404).send({ error: "Conversation not found" });
        return;
      }
      await reply.send(toWire(conversation));
    },
  );

  app.put<{ Params: { id: string }; Body: ProjectBody }>(
    "/api/conversations/:id/project",
    { preHandler: requireSession },
    async (request, reply) => {
      const projectId = asString(request.body?.projectId) ?? null;
      const conversation = await conversationStore.setProject(request.params.id, projectId);
      if (!conversation) {
        await reply.code(404).send({ error: "Conversation not found" });
        return;
      }
      await reply.send(toWire(conversation));
    },
  );

  // Turn-editing, plan/task breakdown, results digest and token-usage accounting all read
  // transcript/run detail this pass doesn't build (replay, plan extraction, usage metering).
  // Explicit 501s, not fabricated empty successes.
  for (const [method, path] of [
    ["POST", "/api/conversations/:id/delete-turn"],
    ["GET", "/api/conversations/:id/plan-tasks"],
    ["GET", "/api/conversations/:id/results"],
    ["GET", "/api/conversations/:id/token-usage"],
  ] as const) {
    app.route({ method, url: path, preHandler: requireSession, handler: notImplementedForThisDeployment });
  }
}

async function notImplementedForThisDeployment(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

/** Shared with agent-loop.routes.ts: translates the runtime adapter's errors into {error:string} HTTP responses. */
export async function replyRuntimeError(
  reply: import("fastify").FastifyReply,
  error: unknown,
): Promise<void> {
  if (error instanceof RuntimeRejectedError) {
    await reply.code(error.status).send({ error: error.message });
    return;
  }
  if (error instanceof RuntimeUnavailableError) {
    await reply.code(503).send({ error: error.message });
    return;
  }
  throw error;
}
