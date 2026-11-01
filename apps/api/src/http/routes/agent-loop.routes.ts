import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { RuntimeRun, RuntimeTransport } from "../../adapters/runtime/client.js";
import type { AuthStore } from "../../db/auth-store.js";
import type { ConversationStore } from "../../db/conversation-store.js";
import type { ProjectStore } from "../../db/project-store.js";
import { runConfigurableFor } from "../../adapters/sandbox/routing.js";
import { extractLastAssistantText } from "../../adapters/runtime/message-extract.js";
import type { RuntimeEvent } from "../../adapters/runtime/stream.js";
import { RuntimeUnavailableError } from "../../adapters/runtime/errors.js";
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
  projectStore: ProjectStore;
  sandboxKey?: string;
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

/**
 * Best-effort project-scoped sandbox routing for the non-streaming chat path
 * and batch tasks -- neither requires a project the way /stream does
 * (POST /api/eino-agent predates per-project sandboxes and some callers
 * still don't set one), so this degrades to "no routing, runtime default
 * sandbox" instead of failing the run. When it CAN resolve one, the run's
 * tool calls (and any HITL approval they trigger) land in the right
 * project's sandbox instead of silently using whichever one the runtime
 * defaults to.
 */
async function sandboxConfigFor(options: AgentLoopRoutesOptions, projectId: string | null | undefined): Promise<Record<string, unknown> | undefined> {
  if (!projectId || !options.sandboxKey) return undefined;
  const project = await options.projectStore.findById(projectId);
  if (!project) return undefined;
  return { ...runConfigurableFor(project.workspaceSlug, options.sandboxKey), recursion_limit: 1000 };
}

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

  app.post<{ Body: ChatRequestBody }>("/api/eino-agent/stream", { preHandler: requireSession }, async (request, reply) => {
    const message = asString(request.body?.message);
    if (!message?.trim()) return reply.code(400).send({ error: "Enter a message" });
    const conversationId = asString(request.body?.conversationId);
    let conversation = conversationId ? await conversationStore.findById(conversationId) : null;
    if (conversationId && !conversation) return reply.code(404).send({ error: "Conversation not found" });
    const projectId = conversation?.projectId ?? asString(request.body?.projectId);
    if (!projectId) return reply.code(400).send({ error: "Select a project before chatting so the agent uses its own workspace." });
    const project = await options.projectStore.findById(projectId);
    if (!project) return reply.code(404).send({ error: "Project not found" });
    if (!options.sandboxKey) return reply.code(503).send({ error: "Project sandbox key is not configured" });
    try {
      if (!conversation) {
        const runtimeThreadId = randomUUID();
        await runtime.createThread(runtimeThreadId);
        conversation = await conversationStore.create({ title: titleFromMessage(message), projectId, runtimeThreadId });
      }
      const configurable = runConfigurableFor(project.workspaceSlug, options.sandboxKey);
      const userMessage = await conversationStore.appendMessage(conversation.id, "user", message);
      const output = new PassThrough();
      reply.header("content-type", "text/event-stream; charset=utf-8").header("cache-control", "no-cache, no-transform").header("x-accel-buffering", "no");
      const pump = streamReply(output, options, conversation, userMessage.id, message, configurable);
      pump.catch(() => { request.log.error("Chat stream delivery failed"); output.destroy(); });
      return reply.send(output);
    } catch (error) { return replyRuntimeError(reply, error); }
  });

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
        config: await sandboxConfigFor(options, conversation.projectId),
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

  app.get<{ Querystring: { conversationId?: string } }>(
    "/api/agent-loop/task-events",
    { preHandler: requireSession },
    async (request, reply) => {
      const conversationId = asString(request.query.conversationId);
      if (!conversationId) return reply.code(400).send({ error: "conversationId is required" });
      const conversation = await conversationStore.findById(conversationId);
      if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
      const runs = await runtime.listRuns(conversation.runtimeThreadId, 0, 5);
      const active = runs.find((run) => !TERMINAL_STATUSES.has(run.status));
      if (!active) return reply.code(404).send({ error: "No active run for this conversation" });

      const output = new PassThrough();
      reply.header("content-type", "text/event-stream; charset=utf-8").header("cache-control", "no-cache, no-transform").header("x-accel-buffering", "no");
      const pump = joinReply(output, runtime, conversation.id, conversation.runtimeThreadId, active.runId);
      pump.catch(() => { request.log.error("Task-event join delivery failed"); output.destroy(); });
      return reply.send(output);
    },
  );

  // Explicit multi-agent dispatch has no clean Raptix equivalent: subagent dispatch
  // already happens automatically within a single run (intelligence/agents), there is no separate
  // "invoke N agents explicitly" endpoint to map onto.
  for (const [method, path] of [
    ["POST", "/api/multi-agent"],
    ["POST", "/api/multi-agent/stream"],
  ] as const) {
    app.route({ method, url: path, preHandler: requireSession, handler: notImplementedForThisDeployment });
  }
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function writeEvent(output: PassThrough, type: string, message: string, data: Record<string, unknown>): Promise<void> {
  if (output.destroyed) return; // A detached browser never cancels the run or prevents persisting its answer.
  if (output.write(`data: ${JSON.stringify({ type, message, data })}\n\n`)) return;
  await new Promise<void>(resolve => {
    const ready = () => { output.off("drain", ready); output.off("close", ready); resolve(); };
    output.once("drain", ready).once("close", ready);
  });
}

/** Only visible text is projected. Reasoning, config, credentials and raw graph state stay inside the BFF. */
async function projectRuntimeEvent(event: RuntimeEvent, emit: (type: string, message: string, data?: Record<string, unknown>) => Promise<void>, seen: Set<string>): Promise<void> {
  if (event.event === "error") throw new RuntimeUnavailableError("The agent run failed; check the runtime logs.");
  if (event.event === "updates") {
    for (const stage of Object.keys(record(event.data))) await emit("progress", stage, { stage });
  }
  if (event.event !== "messages/partial" && event.event !== "messages/complete") return;
  for (const chunk of Array.isArray(event.data) ? event.data : []) {
    const message = record(chunk);
    if (message.type !== "ai" || typeof message.id !== "string") continue;
    const content = typeof message.content === "string" ? message.content : Array.isArray(message.content)
      ? message.content.map(block => { const b = record(block); return b.type === "text" && typeof b.text === "string" ? b.text : ""; }).join("") : "";
    if (!content) continue;
    if (!seen.has(message.id)) { seen.add(message.id); await emit("response_start", "", { streamId: message.id }); }
    await emit("response_delta", content, { streamId: message.id, accumulated: content });
  }
}

async function streamReply(output: PassThrough, options: AgentLoopRoutesOptions, conversation: { id: string; runtimeThreadId: string }, userMessageId: string, message: string, configurable: Record<string, string>): Promise<void> {
  const emit = (type: string, text = "", data: Record<string, unknown> = {}) => writeEvent(output, type, text, { ...data, conversationId: conversation.id });
  const heartbeat = setInterval(() => { if (!output.destroyed && output.writableLength === 0) output.write(": heartbeat\n\n"); }, 15_000);
  try {
    await emit("conversation");
    await emit("message_saved", "", { userMessageId });
    await emit("progress", "Starting agent");
    let runId = "";
    const seen = new Set<string>();
    const input = { messages: [{ role: "user", content: message }], engagement_name: configurable.engagement_name, workspace_path: "/workspace" };
    for await (const event of options.runtime.streamRun(conversation.runtimeThreadId, options.defaultAssistantId ?? "raptix", input, { configurable, recursion_limit: 1000 }, AbortSignal.timeout(30 * 60_000))) {
      if (event.event === "metadata" && typeof record(event.data).run_id === "string") runId = record(event.data).run_id as string;
      await projectRuntimeEvent(event, emit, seen);
    }
    if (!runId) throw new RuntimeUnavailableError("Runtime stream ended without a run identity");
    let run = await options.runtime.getRun(conversation.runtimeThreadId, runId);
    // The HTTP stream can close just before the runtime records its terminal status.
    const deadline = Date.now() + (options.syncWaitMs ?? 5000);
    while (!TERMINAL_STATUSES.has(run.status) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
      run = await options.runtime.getRun(conversation.runtimeThreadId, runId);
    }
    if (run.status !== "success") {
      await emit(run.status === "interrupted" ? "cancelled" : "error", `Agent run status: ${run.status}`, { retryable: false });
      await emit("done", "", { status: run.status === "interrupted" ? "cancelled" : "failed" });
      return;
    }
    const state = await options.runtime.getThreadState(conversation.runtimeThreadId);
    const last = Array.isArray(state.values.messages) ? record(state.values.messages.at(-1)) : {};
    const role = last.type ?? last.role ?? record(last.kwargs).type;
    if (role !== "ai" && role !== "assistant") throw new RuntimeUnavailableError("Run finished without a new assistant answer");
    const answer = extractLastAssistantText(state.values);
    if (!answer) throw new RuntimeUnavailableError("Run finished without an assistant answer");
    const saved = await options.conversationStore.appendMessage(conversation.id, "assistant", answer);
    await emit("response", answer, { messageId: saved.id, finalized: true, finalizable: false, evidenceVerified: false, completionReason: "stop", mcpExecutionIds: [] });
    await emit("done", "", { status: "success" });
  } catch (error) {
    await emit("error", error instanceof RuntimeUnavailableError ? error.message : "Unable to complete the agent turn", { retryable: false });
    await emit("done", "", { status: "failed" });
  } finally {
    clearInterval(heartbeat);
    output.end();
  }
}

/**
 * Reattaches to a run already started by `streamReply` (e.g. the browser
 * left the conversation and came back). Only observes -- the original
 * `streamReply` call is still the one driving the run and persisting its
 * answer (a detached browser never cancels the run, see `writeEvent`), so
 * this never creates, cancels or saves anything; it just re-projects events
 * for whoever is watching now.
 */
async function joinReply(output: PassThrough, runtime: RuntimeTransport, conversationId: string, threadId: string, runId: string): Promise<void> {
  const emit = (type: string, text = "", data: Record<string, unknown> = {}) => writeEvent(output, type, text, { ...data, conversationId });
  const heartbeat = setInterval(() => { if (!output.destroyed && output.writableLength === 0) output.write(": heartbeat\n\n"); }, 15_000);
  try {
    const seen = new Set<string>();
    for await (const event of runtime.joinRun(threadId, runId, AbortSignal.timeout(30 * 60_000))) {
      await projectRuntimeEvent(event, emit, seen);
    }
    const run = await runtime.getRun(threadId, runId);
    await emit("done", "", { status: run.status === "success" ? "success" : run.status === "interrupted" ? "cancelled" : "failed" });
  } catch (error) {
    await emit("error", error instanceof RuntimeUnavailableError ? error.message : "Lost the connection to the running agent", { retryable: false });
    await emit("done", "", { status: "failed" });
  } finally {
    clearInterval(heartbeat);
    output.end();
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
