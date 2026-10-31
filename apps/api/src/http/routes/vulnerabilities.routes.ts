import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { RuntimeTransport } from "../../adapters/runtime/client.js";
import type { AlertSubscriptionStore } from "../../db/alert-subscription-store.js";
import type { AuthStore } from "../../db/auth-store.js";
import type { ConversationStore } from "../../db/conversation-store.js";
import type { VulnerabilityFields, VulnerabilityRecord, VulnerabilityStore } from "../../db/vulnerability-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";
import { replyRuntimeError } from "./conversations.routes.js";

export interface VulnerabilityRoutesOptions {
  authStore: AuthStore;
  vulnerabilityStore: VulnerabilityStore;
  conversationStore: ConversationStore;
  runtime: RuntimeTransport;
  alertSubscriptionStore: AlertSubscriptionStore;
}

interface ListQuery {
  limit?: string;
  offset?: string;
  project_id?: string;
  conversation_id?: string;
  severity?: string;
  status?: string;
  task_id?: string;
  conversation_tag?: string;
  task_tag?: string;
  q?: string;
  search?: string;
  mode?: string;
  group_by?: string;
}

const asString = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

/** apps/ui-app's Vulnerability shape (src/api/types/vulnerability.ts). */
function toWire(vuln: VulnerabilityRecord): Record<string, unknown> {
  return {
    id: vuln.id,
    conversation_id: vuln.conversationId ?? "",
    project_id: vuln.projectId ?? "",
    conversation_tag: vuln.conversationTag ?? "",
    task_tag: vuln.taskTag ?? "",
    task_id: vuln.taskId ?? "",
    task_queue_id: vuln.taskQueueId ?? "",
    title: vuln.title,
    description: vuln.description,
    severity: vuln.severity,
    status: vuln.status,
    type: vuln.type,
    target: vuln.target,
    preconditions: vuln.preconditions,
    reproduction_steps: vuln.reproductionSteps,
    evidence: vuln.evidence,
    impact: vuln.impact,
    recommendation: vuln.recommendation,
    retest_notes: vuln.retestNotes,
    retest_log: vuln.retestLog,
    created_at: vuln.createdAt.toISOString(),
    updated_at: vuln.updatedAt.toISOString(),
  };
}

function fieldsFromBody(body: Record<string, unknown> | undefined): VulnerabilityFields {
  if (!body) return {};
  return {
    ...(body.conversation_id !== undefined ? { conversationId: asString(body.conversation_id) } : {}),
    ...(body.project_id !== undefined ? { projectId: asString(body.project_id) } : {}),
    ...(body.conversation_tag !== undefined ? { conversationTag: asString(body.conversation_tag) } : {}),
    ...(body.task_tag !== undefined ? { taskTag: asString(body.task_tag) } : {}),
    ...(body.title !== undefined ? { title: asString(body.title) } : {}),
    ...(body.severity !== undefined ? { severity: asString(body.severity) } : {}),
    ...(body.description !== undefined ? { description: asString(body.description) ?? "" } : {}),
    ...(body.status !== undefined ? { status: asString(body.status) ?? "open" } : {}),
    ...(body.type !== undefined ? { type: asString(body.type) ?? "" } : {}),
    ...(body.target !== undefined ? { target: asString(body.target) ?? "" } : {}),
    ...(body.preconditions !== undefined ? { preconditions: asString(body.preconditions) ?? "" } : {}),
    ...(body.reproduction_steps !== undefined ? { reproductionSteps: asString(body.reproduction_steps) ?? "" } : {}),
    ...(body.evidence !== undefined ? { evidence: asString(body.evidence) ?? "" } : {}),
    ...(body.impact !== undefined ? { impact: asString(body.impact) ?? "" } : {}),
    ...(body.recommendation !== undefined ? { recommendation: asString(body.recommendation) ?? "" } : {}),
    ...(body.retest_notes !== undefined ? { retestNotes: asString(body.retest_notes) ?? "" } : {}),
  };
}

function listFilters(query: ListQuery) {
  return {
    projectId: query.project_id,
    conversationId: query.conversation_id,
    severity: query.severity,
    status: query.status,
    taskId: query.task_id,
    conversationTag: query.conversation_tag,
    taskTag: query.task_tag,
    search: query.q ?? query.search,
  };
}

export function registerVulnerabilityRoutes(app: FastifyInstance, options: VulnerabilityRoutesOptions): void {
  const { authStore, vulnerabilityStore, conversationStore, runtime, alertSubscriptionStore } = options;
  const requireSession = createRequireSession(authStore);

  app.get<{ Querystring: ListQuery }>(
    "/api/vulnerabilities",
    { preHandler: requireSession },
    async (request, reply) => {
      const limit = Number(request.query.limit ?? 20) || 20;
      const offset = Number(request.query.offset ?? 0) || 0;
      const { vulnerabilities, total } = await vulnerabilityStore.list({ ...listFilters(request.query), limit, offset });
      await reply.send({
        vulnerabilities: vulnerabilities.map(toWire),
        total,
        page: Math.floor(offset / limit) + 1,
        page_size: limit,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      });
    },
  );

  app.post<{ Body: Record<string, unknown> }>(
    "/api/vulnerabilities",
    { preHandler: requireSession },
    async (request, reply) => {
      const title = asString(request.body?.title);
      const severity = asString(request.body?.severity);
      if (!title || !severity) {
        await reply.code(400).send({ error: "Invalid request body" });
        return;
      }
      const vuln = await vulnerabilityStore.create({ ...fieldsFromBody(request.body), title, severity });
      await reply.send(toWire(vuln));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/vulnerabilities/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const vuln = await vulnerabilityStore.findById(request.params.id);
      if (!vuln) {
        await reply.code(404).send({ error: "Vulnerability not found" });
        return;
      }
      await reply.send(toWire(vuln));
    },
  );

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/vulnerabilities/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const vuln = await vulnerabilityStore.update(request.params.id, fieldsFromBody(request.body));
      if (!vuln) {
        await reply.code(404).send({ error: "Vulnerability not found" });
        return;
      }
      await reply.send(toWire(vuln));
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/vulnerabilities/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const deleted = await vulnerabilityStore.delete(request.params.id);
      if (!deleted) {
        await reply.code(404).send({ error: "Vulnerability not found" });
        return;
      }
      await reply.send({ success: true });
    },
  );

  // Branches a new conversation seeded with `prompt`; the frontend sends it as the first chat
  // message itself via POST /api/eino-agent, same as any other conversation.
  app.post<{ Params: { id: string }; Body: { prompt?: unknown } }>(
    "/api/vulnerabilities/:id/retest",
    { preHandler: requireSession },
    async (request, reply) => {
      const vuln = await vulnerabilityStore.findById(request.params.id);
      if (!vuln) {
        await reply.code(404).send({ error: "Vulnerability not found" });
        return;
      }
      const prompt = asString(request.body?.prompt) ?? `Retest: ${vuln.title}`;
      const runtimeThreadId = randomUUID();
      try {
        await runtime.createThread(runtimeThreadId);
      } catch (error) {
        await replyRuntimeError(reply, error);
        return;
      }
      const conversation = await conversationStore.create({
        title: `Retest: ${vuln.title}`,
        projectId: vuln.projectId ?? undefined,
        runtimeThreadId,
      });
      await vulnerabilityStore.recordRetest(vuln.id, conversation.id, prompt);
      await reply.send({ conversation: { id: conversation.id }, prompt });
    },
  );

  app.delete<{ Querystring: ListQuery }>(
    "/api/vulnerabilities/batch",
    { preHandler: requireSession },
    async (request, reply) => {
      const { vulnerabilities } = await vulnerabilityStore.list({ ...listFilters(request.query), limit: 10_000, offset: 0 });
      const deleted = await vulnerabilityStore.batchDelete(vulnerabilities.map((v) => v.id));
      await reply.send({ deleted });
    },
  );

  // mode/group_by are accepted but only "group by conversation" is implemented; other modes fall back to it.
  app.get<{ Querystring: ListQuery }>(
    "/api/vulnerabilities/export",
    { preHandler: requireSession },
    async (request, reply) => {
      const { vulnerabilities } = await vulnerabilityStore.list({ ...listFilters(request.query), limit: 10_000, offset: 0 });
      const groups = new Map<string, VulnerabilityRecord[]>();
      for (const vuln of vulnerabilities) {
        const key = vuln.conversationId ?? "unassigned";
        const group = groups.get(key) ?? [];
        group.push(vuln);
        groups.set(key, group);
      }
      const files = [...groups.entries()].map(([conversationId, items]) => ({
        filename: `${conversationId}.md`,
        content: items
          .map((v) => `## ${v.title}\n\n- Severity: ${v.severity}\n- Status: ${v.status}\n- Target: ${v.target}\n\n${v.description}`)
          .join("\n\n---\n\n"),
      }));
      await reply.send({ files });
    },
  );

  app.get("/api/vulnerabilities/filter-options", { preHandler: requireSession }, async (_request, reply) => {
    await reply.send(await vulnerabilityStore.filterOptions());
  });

  app.get("/api/vulnerabilities/stats", { preHandler: requireSession }, async (_request, reply) => {
    const stats = await vulnerabilityStore.stats();
    await reply.send({ total: stats.total, by_severity: stats.bySeverity, by_status: stats.byStatus });
  });

  app.get("/api/vulnerability-alerts/subscription", { preHandler: requireSession }, async (_request, reply) => {
    const subscription = await alertSubscriptionStore.get();
    await reply.send({ enabled: subscription.enabled, min_severity: subscription.minSeverity });
  });

  app.put<{ Body: { enabled?: unknown; min_severity?: unknown } }>(
    "/api/vulnerability-alerts/subscription",
    { preHandler: requireSession },
    async (request, reply) => {
      const enabled = typeof request.body?.enabled === "boolean" ? request.body.enabled : false;
      const minSeverity = asString(request.body?.min_severity) ?? "high";
      const subscription = await alertSubscriptionStore.set({ enabled, minSeverity });
      await reply.send({ enabled: subscription.enabled, min_severity: subscription.minSeverity });
    },
  );
}
