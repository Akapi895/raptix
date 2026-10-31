import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuditLogRecord, AuditLogStore } from "../../db/audit-log-store.js";
import type { AuthStore } from "../../db/auth-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface AuditRoutesOptions {
  authStore: AuthStore;
  auditLogStore: AuditLogStore;
}

interface AuditQuery {
  page?: string;
  page_size?: string;
  category?: string;
  action?: string;
  result?: string;
  q?: string;
  since?: string;
  until?: string;
  format?: string;
}

function toWire(log: AuditLogRecord) {
  return {
    id: log.id,
    createdAt: log.createdAt.toISOString(),
    level: log.level,
    category: log.category,
    action: log.action,
    result: log.result,
    actor: log.actor,
    message: log.message,
    sessionHint: log.sessionHint ?? undefined,
    clientIp: log.clientIp ?? undefined,
    userAgent: log.userAgent ?? undefined,
    resourceType: log.resourceType ?? undefined,
    resourceId: log.resourceId ?? undefined,
    resourceAvailable: log.resourceAvailable,
    detail: log.detail ?? undefined,
  };
}

function filtersFromQuery(query: AuditQuery) {
  const since = query.since ? new Date(query.since) : undefined;
  const until = query.until ? new Date(query.until) : undefined;
  return {
    category: query.category,
    action: query.action,
    result: query.result,
    q: query.q,
    since: since && !Number.isNaN(since.getTime()) ? since : undefined,
    until: until && !Number.isNaN(until.getTime()) ? until : undefined,
  };
}

function toCsv(logs: AuditLogRecord[]): string {
  const header = ["id", "createdAt", "level", "category", "action", "result", "actor", "message"];
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = logs.map((log) =>
    [log.id, log.createdAt.toISOString(), log.level, log.category, log.action, log.result, log.actor, log.message].map((v) => escape(String(v))).join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

/**
 * Real storage + read. Write points are wired into auth.routes.ts only
 * this pass (login success/failure, logout, change-password) -- a real
 * but deliberately partial instrumentation. Retrofitting every mutating
 * route across Tiers 1-5 to write audit entries is future work, not done
 * here to keep this tier's diff bounded.
 */
export function registerAuditRoutes(app: FastifyInstance, options: AuditRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);
  const { auditLogStore } = options;

  app.get("/api/audit/logs", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const query = request.query as AuditQuery;
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Number(query.page_size) || 20);
    const { logs, total } = await auditLogStore.list({ ...filtersFromQuery(query), limit: pageSize, offset: (page - 1) * pageSize });
    return { logs: logs.map(toWire), total, page, page_size: pageSize };
  });

  app.get("/api/audit/summary", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const query = request.query as AuditQuery;
    const filters = filtersFromQuery(query);
    const summary = await auditLogStore.summary(filters);
    const hasFilters = Boolean(filters.category || filters.action || filters.result || filters.q || filters.since || filters.until);
    return { total: summary.total, failures: summary.failures, recent_7d: summary.recent7d, has_filters: hasFilters };
  });

  app.get("/api/audit/logs/export", { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as AuditQuery;
    const { logs } = await auditLogStore.list({ ...filtersFromQuery(query), limit: 10000, offset: 0 });
    if (query.format === "csv") {
      await reply.header("content-type", "text/csv").send(toCsv(logs));
      return;
    }
    await reply.header("content-type", "application/json").send(JSON.stringify(logs.map(toWire)));
  });

  app.get("/api/audit/logs/:id", { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const log = await auditLogStore.get(id);
    if (!log) {
      await reply.code(404).send({ error: "audit log not found" });
      return;
    }
    return toWire(log);
  });
}
