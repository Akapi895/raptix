import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RuntimeTransport } from "../../adapters/runtime/client.js";
import type { AuthStore } from "../../db/auth-store.js";
import type { ConversationStore } from "../../db/conversation-store.js";
import type { HiddenExecutionStore } from "../../db/hidden-execution-store.js";
import { type DerivedExecution, listAllExecutions } from "../../services/execution-derivation.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface MonitorRoutesOptions {
  authStore: AuthStore;
  conversationStore: ConversationStore;
  runtime: RuntimeTransport;
  hiddenExecutionStore: HiddenExecutionStore;
}

function toWire(execution: DerivedExecution) {
  return {
    id: execution.id,
    toolName: execution.toolName,
    status: execution.status === "completed" ? "completed" : "pending",
    startTime: execution.createdAt,
    endTime: execution.status === "completed" ? execution.createdAt : null,
    conversationId: execution.conversationId,
    conversationTitle: execution.conversationTitle,
    arguments: execution.arguments,
    result: execution.result,
  };
}

function summarize(executions: DerivedExecution[]) {
  const totalCalls = executions.length;
  const successCalls = executions.filter((execution) => execution.status === "completed").length;
  const toolCount = new Set(executions.map((execution) => execution.toolName)).size;
  const lastCallTime = executions.reduce<string | null>((latest, execution) => {
    if (!execution.createdAt) return latest;
    return !latest || execution.createdAt > latest ? execution.createdAt : latest;
  }, null);
  // failedCalls/blockedCalls: no live signal distinguishes a tool error from a successful
  // ToolMessage in the derived thread-state view (see execution-derivation.ts) -- reported
  // as 0 rather than guessed from message content.
  return { totalCalls, successCalls, failedCalls: 0, blockedCalls: 0, toolCount, lastCallTime };
}

function topTools(executions: DerivedExecution[], limit: number) {
  const counts = new Map<string, number>();
  for (const execution of executions) counts.set(execution.toolName, (counts.get(execution.toolName) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([toolName, totalCalls]) => ({ toolName, totalCalls }));
}

const RANGE_BUCKETS: Record<string, { buckets: number; stepMs: number }> = {
  "24h": { buckets: 24, stepMs: 60 * 60 * 1000 },
  "7d": { buckets: 7, stepMs: 24 * 60 * 60 * 1000 },
  "30d": { buckets: 30, stepMs: 24 * 60 * 60 * 1000 },
};

function buildTimeline(executions: DerivedExecution[], range: string) {
  const config = RANGE_BUCKETS[range] ?? RANGE_BUCKETS["7d"]!;
  const now = Date.now();
  const points: { t: string; total: number; failed: number; blocked: number }[] = [];
  for (let index = config.buckets - 1; index >= 0; index -= 1) {
    const bucketStart = now - index * config.stepMs;
    const bucketEnd = bucketStart + config.stepMs;
    const total = executions.filter((execution) => {
      if (!execution.createdAt) return false;
      const time = new Date(execution.createdAt).getTime();
      return time >= bucketStart && time < bucketEnd;
    }).length;
    points.push({ t: new Date(bucketStart).toISOString(), total, failed: 0, blocked: 0 });
  }
  return points;
}

export function registerMonitorRoutes(app: FastifyInstance, options: MonitorRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);
  const { conversationStore, runtime, hiddenExecutionStore } = options;

  async function visibleExecutions(): Promise<DerivedExecution[]> {
    const [all, hidden] = await Promise.all([listAllExecutions(conversationStore, runtime), hiddenExecutionStore.listHidden()]);
    return all.filter((execution) => !hidden.has(execution.id));
  }

  app.get("/api/monitor", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const query = request.query as { page?: string; page_size?: string; status?: string; tool?: string };
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Number(query.page_size) || 20);
    let executions = await visibleExecutions();
    if (query.status) executions = executions.filter((execution) => execution.status === query.status);
    if (query.tool) executions = executions.filter((execution) => execution.toolName === query.tool);
    executions.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    const total = executions.length;
    const paged = executions.slice((page - 1) * pageSize, page * pageSize);
    return {
      executions: paged.map(toWire),
      summary: summarize(executions),
      topTools: topTools(executions, 10),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  });

  app.get("/api/monitor/stats", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const query = request.query as { top?: string };
    const executions = await visibleExecutions();
    return { summary: summarize(executions), topTools: topTools(executions, Number(query.top) || 10) };
  });

  app.get("/api/monitor/calls-timeline", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const query = request.query as { range?: string };
    const executions = await visibleExecutions();
    return { points: buildTimeline(executions, query.range ?? "7d") };
  });

  app.delete("/api/monitor/execution/:id", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    await hiddenExecutionStore.hide(id);
    return { success: true };
  });

  app.delete("/api/monitor/executions", { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { ids?: string[] } | undefined;
    if (!Array.isArray(body?.ids)) {
      await reply.code(400).send({ error: "ids must be an array" });
      return;
    }
    await hiddenExecutionStore.hideMany(body.ids);
    return { deleted: body.ids.length };
  });
}
