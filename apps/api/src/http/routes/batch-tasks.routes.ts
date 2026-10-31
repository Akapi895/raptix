import type { FastifyInstance } from "fastify";
import type { RuntimeTransport } from "../../adapters/runtime/client.js";
import type { BatchQueueRecord, BatchQueueStore, BatchTaskRecord } from "../../db/batch-queue-store.js";
import type { AuthStore } from "../../db/auth-store.js";
import type { ConversationStore } from "../../db/conversation-store.js";
import { startBatchQueue } from "../../services/batch-processor.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface BatchTaskRoutesOptions {
  authStore: AuthStore;
  batchQueueStore: BatchQueueStore;
  conversationStore: ConversationStore;
  runtime: RuntimeTransport;
  defaultAssistantId?: string;
  /** Per-task wait inside a batch run, separate from POST /api/eino-agent's own syncWaitMs. Default 20s. */
  taskWaitMs?: number;
}

const asString = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];

/** apps/ui-app's taskSchema (src/features/tasks/model.ts). */
function taskWire(task: BatchTaskRecord): Record<string, unknown> {
  return {
    id: task.id,
    message: task.message,
    conversationId: task.conversationId ?? undefined,
    status: task.status,
    startedAt: task.startedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    error: task.error ?? undefined,
    result: task.result ?? undefined,
  };
}

/** apps/ui-app's queueSchema. */
function queueWire(queue: BatchQueueRecord): Record<string, unknown> {
  return {
    id: queue.id,
    workflowId: "",
    title: queue.title,
    role: queue.role,
    hitlPolicy: queue.hitlPolicy,
    scheduleMode: queue.scheduleMode,
    cronExpr: queue.cronExpr,
    nextRunAt: queue.nextRunAt?.toISOString() ?? null,
    scheduleEnabled: queue.scheduleEnabled,
    lastScheduleTriggerAt: queue.lastScheduleTriggerAt?.toISOString() ?? null,
    lastScheduleError: queue.lastScheduleError ?? undefined,
    lastRunError: queue.lastRunError ?? undefined,
    projectId: queue.projectId ?? undefined,
    concurrency: queue.concurrency,
    tasks: queue.tasks.map(taskWire),
    status: queue.status,
    createdAt: queue.createdAt.toISOString(),
    startedAt: queue.startedAt?.toISOString() ?? null,
    completedAt: queue.completedAt?.toISOString() ?? null,
    currentIndex: queue.currentIndex,
  };
}

export function registerBatchTaskRoutes(app: FastifyInstance, options: BatchTaskRoutesOptions): void {
  const { authStore, batchQueueStore, conversationStore, runtime } = options;
  const defaultAssistantId = options.defaultAssistantId ?? "raptix";
  const taskWaitMs = options.taskWaitMs ?? 20_000;
  const requireSession = createRequireSession(authStore);

  function startInBackground(queueId: string): void {
    void startBatchQueue(queueId, { store: batchQueueStore, conversationStore, runtime, defaultAssistantId, taskWaitMs }).catch(
      (error: unknown) => app.log.error({ err: error, queueId }, "batch queue processing failed"),
    );
  }

  app.get<{ Querystring: { page?: string; limit?: string; status?: string; keyword?: string } }>(
    "/api/batch-tasks",
    { preHandler: requireSession },
    async (request, reply) => {
      const limit = Number(request.query.limit ?? 10) || 10;
      const page = Number(request.query.page ?? 1) || 1;
      const { queues, total } = await batchQueueStore.list({
        status: request.query.status && request.query.status !== "all" ? request.query.status : undefined,
        search: request.query.keyword,
        limit,
        offset: (page - 1) * limit,
      });
      await reply.send({ queues: queues.map(queueWire), total, total_pages: Math.max(1, Math.ceil(total / limit)) });
    },
  );

  app.post<{ Body: Record<string, unknown> }>("/api/batch-tasks", { preHandler: requireSession }, async (request, reply) => {
    const title = asString(request.body?.title);
    const messages = asStringArray(request.body?.tasks);
    if (!title || messages.length === 0) {
      await reply.code(400).send({ error: "Invalid request body" });
      return;
    }
    const queue = await batchQueueStore.create({
      title,
      role: asString(request.body?.role),
      hitlPolicy: asString(request.body?.hitlPolicy),
      scheduleMode: asString(request.body?.scheduleMode),
      cronExpr: asString(request.body?.cronExpr),
      projectId: asString(request.body?.projectId),
      concurrency: typeof request.body?.concurrency === "number" ? request.body.concurrency : undefined,
      messages,
    });
    await reply.send(queueWire(queue));
    if (request.body?.executeNow === true) startInBackground(queue.id);
  });

  app.delete<{ Params: { queueId: string } }>(
    "/api/batch-tasks/:queueId",
    { preHandler: requireSession },
    async (request, reply) => {
      const deleted = await batchQueueStore.delete(request.params.queueId);
      if (!deleted) {
        await reply.code(404).send({ error: "Queue not found" });
        return;
      }
      await reply.send({ success: true });
    },
  );

  app.get<{ Params: { queueId: string } }>(
    "/api/batch-tasks/:queueId",
    { preHandler: requireSession },
    async (request, reply) => {
      const queue = await batchQueueStore.findById(request.params.queueId);
      if (!queue) {
        await reply.code(404).send({ error: "Queue not found" });
        return;
      }
      await reply.send(queueWire(queue));
    },
  );

  app.put<{ Params: { queueId: string }; Body: Record<string, unknown> }>(
    "/api/batch-tasks/:queueId/metadata",
    { preHandler: requireSession },
    async (request, reply) => {
      const queue = await batchQueueStore.updateMetadata(request.params.queueId, {
        title: asString(request.body?.title),
        role: asString(request.body?.role),
        hitlPolicy: asString(request.body?.hitlPolicy),
        concurrency: typeof request.body?.concurrency === "number" ? request.body.concurrency : undefined,
      });
      if (!queue) {
        await reply.code(404).send({ error: "Queue not found" });
        return;
      }
      await reply.send(queueWire(queue));
    },
  );

  app.post<{ Params: { queueId: string } }>(
    "/api/batch-tasks/:queueId/pause",
    { preHandler: requireSession },
    async (request, reply) => {
      const queue = await batchQueueStore.findById(request.params.queueId);
      if (!queue) {
        await reply.code(404).send({ error: "Queue not found" });
        return;
      }
      await batchQueueStore.setStatus(queue.id, "paused");
      await reply.send(queueWire({ ...queue, status: "paused" }));
    },
  );

  app.post<{ Params: { queueId: string }; Body: { taskIds?: unknown } }>(
    "/api/batch-tasks/:queueId/rerun",
    { preHandler: requireSession },
    async (request, reply) => {
      const queue = await batchQueueStore.findById(request.params.queueId);
      if (!queue) {
        await reply.code(404).send({ error: "Queue not found" });
        return;
      }
      const taskIds = asStringArray(request.body?.taskIds);
      await batchQueueStore.resetTasks(queue.id, taskIds.length > 0 ? taskIds : undefined);
      startInBackground(queue.id);
      const refreshed = await batchQueueStore.findById(queue.id);
      await reply.send(queueWire(refreshed ?? queue));
    },
  );

  app.put<{ Params: { queueId: string }; Body: { scheduleMode?: unknown; cronExpr?: unknown } }>(
    "/api/batch-tasks/:queueId/schedule",
    { preHandler: requireSession },
    async (request, reply) => {
      const queue = await batchQueueStore.updateSchedule(request.params.queueId, {
        scheduleMode: asString(request.body?.scheduleMode),
        cronExpr: asString(request.body?.cronExpr),
      });
      if (!queue) {
        await reply.code(404).send({ error: "Queue not found" });
        return;
      }
      await reply.send(queueWire(queue));
    },
  );

  app.put<{ Params: { queueId: string }; Body: { enabled?: unknown } }>(
    "/api/batch-tasks/:queueId/schedule-enabled",
    { preHandler: requireSession },
    async (request, reply) => {
      const enabled = typeof request.body?.enabled === "boolean" ? request.body.enabled : true;
      const queue = await batchQueueStore.setScheduleEnabled(request.params.queueId, enabled);
      if (!queue) {
        await reply.code(404).send({ error: "Queue not found" });
        return;
      }
      await reply.send(queueWire(queue));
    },
  );

  app.post<{ Params: { queueId: string } }>(
    "/api/batch-tasks/:queueId/start",
    { preHandler: requireSession },
    async (request, reply) => {
      const queue = await batchQueueStore.findById(request.params.queueId);
      if (!queue) {
        await reply.code(404).send({ error: "Queue not found" });
        return;
      }
      startInBackground(queue.id);
      await reply.send(queueWire({ ...queue, status: "running" }));
    },
  );

  app.post<{ Params: { queueId: string }; Body: { message?: unknown } }>(
    "/api/batch-tasks/:queueId/tasks",
    { preHandler: requireSession },
    async (request, reply) => {
      const message = asString(request.body?.message);
      if (!message) {
        await reply.code(400).send({ error: "Invalid request body" });
        return;
      }
      const task = await batchQueueStore.addTask(request.params.queueId, message);
      if (!task) {
        await reply.code(404).send({ error: "Queue not found" });
        return;
      }
      await reply.send(taskWire(task));
    },
  );

  app.delete<{ Params: { queueId: string; taskId: string } }>(
    "/api/batch-tasks/:queueId/tasks/:taskId",
    { preHandler: requireSession },
    async (request, reply) => {
      const deleted = await batchQueueStore.deleteTask(request.params.queueId, request.params.taskId);
      if (!deleted) {
        await reply.code(404).send({ error: "Task not found" });
        return;
      }
      await reply.send({ success: true });
    },
  );

  app.put<{ Params: { queueId: string; taskId: string }; Body: { message?: unknown } }>(
    "/api/batch-tasks/:queueId/tasks/:taskId",
    { preHandler: requireSession },
    async (request, reply) => {
      const task = await batchQueueStore.updateTask(request.params.queueId, request.params.taskId, {
        message: asString(request.body?.message),
      });
      if (!task) {
        await reply.code(404).send({ error: "Task not found" });
        return;
      }
      await reply.send(taskWire(task));
    },
  );

  app.post<{ Params: { queueId: string; taskId: string } }>(
    "/api/batch-tasks/:queueId/tasks/:taskId/run",
    { preHandler: requireSession },
    async (request, reply) => {
      const reset = await batchQueueStore.resetTasks(request.params.queueId, [request.params.taskId]);
      if (reset === 0) {
        // Not failed/cancelled -- still fine to try running if it's pending; only 404 when the task truly doesn't exist.
        const task = await batchQueueStore.updateTask(request.params.queueId, request.params.taskId, {});
        if (!task) {
          await reply.code(404).send({ error: "Task not found" });
          return;
        }
      }
      startInBackground(request.params.queueId);
      await reply.send({ success: true });
    },
  );

  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/api/batch-tasks/runs",
    { preHandler: requireSession },
    async (request, reply) => {
      const limit = Number(request.query.limit ?? 50) || 50;
      const offset = Number(request.query.offset ?? 0) || 0;
      const { runs, hasMore } = await batchQueueStore.listRuns(offset, limit);
      await reply.send({
        runs: runs.map((run) => ({
          ...taskWire(run),
          queueId: run.queueId,
          taskId: run.id,
          title: run.queueTitle,
          workflowId: "",
          conversationId: run.conversationId ?? "",
        })),
        hasMore,
      });
    },
  );
}
