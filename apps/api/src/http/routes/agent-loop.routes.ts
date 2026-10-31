import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { RuntimeRun, RuntimeTransport } from "../../adapters/runtime/client.js";
import type { AuthStore } from "../../db/auth-store.js";
import type { ConversationStore } from "../../db/conversation-store.js";
import { runAgentTurn, TERMINAL_RUN_STATUSES as TERMINAL_STATUSES } from "../../services/agent-turn.js";
import { createRequireSession } from "../plugins/auth-guard.js";
import { replyRuntimeError } from "./conversations.routes.js";

export interface AgentLoopRoutesOptions {
  authStore: AuthStore;
  conversationStore: ConversationStore;
  runtime: RuntimeTransport;
  /** How long POST /api/eino-agent blocks waiting for a terminal run before replying "still running". Default 20s. */
  syncWaitMs?: number;
  defaultAssistantId?: string;
}

interface ChatRequestBody {
  message?: unknown;
  conversationId?: unknown;
  projectId?: unknown;
  role?: unknown;
}

interface CancelBody {
  conversationId?: unknown;
}

const asString = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

async function notImplementedForThisDeployment(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

function titleFromMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) return "New conversation";
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

export function registerAgentLoopRoutes(app: FastifyInstance, options: AgentLoopRoutesOptions): void {
  const { authStore, conversationStore, runtime } = options;
  const syncWaitMs = options.syncWaitMs ?? 20_000;
  const defaultAssistantId = options.defaultAssistantId ?? "raptix";
  const requireSession = createRequireSession(authStore);

  app.post<{ Body: ChatRequestBody }>("/api/eino-agent", { preHandler: requireSession }, async (request, reply) => {
    const message = asString(request.body?.message);
    if (!message) {
      await reply.code(400).send({ error: "Invalid request body" });
      return;
    }

    let conversation = asString(request.body?.conversationId)
      ? await conversationStore.findById(request.body.conversationId as string)
      : null;

    try {
      if (!conversation) {
        const runtimeThreadId = randomUUID();
        await runtime.createThread(runtimeThreadId);
        conversation = await conversationStore.create({
          title: titleFromMessage(message),
          projectId: asString(request.body?.projectId),
          roleName: asString(request.body?.role),
          runtimeThreadId,
        });
      }

      const turn = await runAgentTurn({
        conversation,
        message,
        runtime,
        conversationStore,
        defaultAssistantId,
        waitMs: syncWaitMs,
      });

      await reply.send({
        response: turn.response,
        conversationId: conversation.id,
        time: new Date().toISOString(),
        finalizable: false,
        finalized: turn.finalized,
        status: turn.status,
        ...(turn.finalized && turn.status !== "success" ? { completionReason: turn.status } : {}),
        evidenceVerified: false,
      });
    } catch (error) {
      await replyRuntimeError(reply, error);
    }
  });

  app.get("/api/agent-loop/tasks", { preHandler: requireSession }, async (_request, reply) => {
    await reply.send({ tasks: await collectTasks(conversationStore, runtime, (status) => !TERMINAL_STATUSES.has(status)) });
  });

  app.get("/api/agent-loop/tasks/completed", { preHandler: requireSession }, async (_request, reply) => {
    await reply.send({ tasks: await collectTasks(conversationStore, runtime, (status) => TERMINAL_STATUSES.has(status)) });
  });

  app.post<{ Body: CancelBody }>(
    "/api/agent-loop/cancel",
    { preHandler: requireSession },
    async (request, reply) => {
      const conversationId = asString(request.body?.conversationId);
      if (!conversationId) {
        await reply.code(400).send({ error: "Invalid request body" });
        return;
      }
      const conversation = await conversationStore.findById(conversationId);
      if (!conversation) {
        await reply.code(404).send({ error: "Conversation not found" });
        return;
      }
      try {
        const runs = await runtime.listRuns(conversation.runtimeThreadId, 0, 5);
        const active = runs.find((run) => !TERMINAL_STATUSES.has(run.status));
        if (active) await runtime.cancelRun(conversation.runtimeThreadId, active.runId);
        await reply.send({ success: true });
      } catch (error) {
        await replyRuntimeError(reply, error);
      }
    },
  );

  // SSE streaming (eino-agent/stream, multi-agent/stream) needs a translation from LangGraph's
  // stream_mode wire format to apps/ui-app's SSE event shape (realtime-api-contracts.md) -- not
  // built this pass. multi-agent (non-streaming) has no clean Raptix equivalent: subagent dispatch
  // already happens automatically within a single run (intelligence/agents), there is no separate
  // "invoke N agents explicitly" endpoint to map onto.
  for (const [method, path] of [
    ["POST", "/api/eino-agent/stream"],
    ["POST", "/api/multi-agent"],
    ["POST", "/api/multi-agent/stream"],
    ["GET", "/api/agent-loop/task-events"],
  ] as const) {
    app.route({ method, url: path, preHandler: requireSession, handler: notImplementedForThisDeployment });
  }
}

interface TaskView {
  id: string;
  conversationId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** Scans every known conversation's runtime thread for runs matching `include`. Fine at single-operator scale. */
async function collectTasks(
  conversationStore: ConversationStore,
  runtime: RuntimeTransport,
  include: (status: string) => boolean,
): Promise<TaskView[]> {
  const { conversations } = await conversationStore.list({ limit: 200, offset: 0 });
  const tasks: TaskView[] = [];
  for (const conversation of conversations) {
    let runs: RuntimeRun[];
    try {
      runs = await runtime.listRuns(conversation.runtimeThreadId, 0, 5);
    } catch {
      continue; // Runtime unavailable or thread gone -- skip, don't fail the whole list.
    }
    for (const run of runs) {
      if (!include(run.status)) continue;
      tasks.push({
        id: run.runId,
        conversationId: conversation.id,
        status: run.status,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      });
    }
  }
  return tasks;
}
