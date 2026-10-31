import type { AuditLogRecord, AuditLogStore, ListAuditLogsQuery, RecordAuditInput } from "../../src/db/audit-log-store.js";

export class FakeAuditLogStore implements AuditLogStore {
  private logs: AuditLogRecord[] = [];
  private nextId = 1;

  private matches(log: AuditLogRecord, query: Omit<ListAuditLogsQuery, "limit" | "offset">): boolean {
    if (query.category && log.category !== query.category) return false;
    if (query.action && log.action !== query.action) return false;
    if (query.result && log.result !== query.result) return false;
    if (query.q && !log.message.toLowerCase().includes(query.q.toLowerCase())) return false;
    if (query.since && log.createdAt < query.since) return false;
    if (query.until && log.createdAt > query.until) return false;
    return true;
  }

  public async record(input: RecordAuditInput): Promise<AuditLogRecord> {
    const log: AuditLogRecord = {
      id: `audit-${this.nextId++}`,
      level: input.level ?? "info",
      category: input.category,
      action: input.action,
      result: input.result,
      actor: input.actor ?? "",
      message: input.message ?? "",
      sessionHint: input.sessionHint ?? null,
      clientIp: input.clientIp ?? null,
      userAgent: input.userAgent ?? null,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      resourceAvailable: input.resourceAvailable ?? true,
      detail: input.detail ?? null,
      createdAt: new Date(),
    };
    this.logs.unshift(log);
    return log;
  }

  public async list(query: ListAuditLogsQuery): Promise<{ logs: AuditLogRecord[]; total: number }> {
    const matched = this.logs.filter((log) => this.matches(log, query));
    return { logs: matched.slice(query.offset, query.offset + query.limit), total: matched.length };
  }

  public async summary(query: Omit<ListAuditLogsQuery, "limit" | "offset">): Promise<{ total: number; failures: number; recent7d: number }> {
    const matched = this.logs.filter((log) => this.matches(log, query));
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
    return {
      total: matched.length,
      failures: matched.filter((log) => log.result === "failure").length,
      recent7d: matched.filter((log) => log.createdAt >= sevenDaysAgo).length,
    };
  }

  public async get(id: string): Promise<AuditLogRecord | null> {
    return this.logs.find((log) => log.id === id) ?? null;
  }
}
