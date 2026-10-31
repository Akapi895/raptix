import type { PrismaClient } from "../generated/prisma/client.js";

export interface AuditLogRecord {
  id: string;
  level: string;
  category: string;
  action: string;
  result: string;
  actor: string;
  message: string;
  sessionHint: string | null;
  clientIp: string | null;
  userAgent: string | null;
  resourceType: string | null;
  resourceId: string | null;
  resourceAvailable: boolean;
  detail: Record<string, unknown> | null;
  createdAt: Date;
}

export interface RecordAuditInput {
  level?: string;
  category: string;
  action: string;
  result: string;
  actor?: string;
  message?: string;
  sessionHint?: string;
  clientIp?: string;
  userAgent?: string;
  resourceType?: string;
  resourceId?: string;
  resourceAvailable?: boolean;
  detail?: Record<string, unknown>;
}

export interface ListAuditLogsQuery {
  category?: string;
  action?: string;
  result?: string;
  q?: string;
  since?: Date;
  until?: Date;
  limit: number;
  offset: number;
}

export interface AuditLogStore {
  record(input: RecordAuditInput): Promise<AuditLogRecord>;
  list(query: ListAuditLogsQuery): Promise<{ logs: AuditLogRecord[]; total: number }>;
  summary(query: Omit<ListAuditLogsQuery, "limit" | "offset">): Promise<{ total: number; failures: number; recent7d: number }>;
  get(id: string): Promise<AuditLogRecord | null>;
}

function toRecord(row: {
  id: string;
  level: string;
  category: string;
  action: string;
  result: string;
  actor: string;
  message: string;
  sessionHint: string | null;
  clientIp: string | null;
  userAgent: string | null;
  resourceType: string | null;
  resourceId: string | null;
  resourceAvailable: boolean;
  detailJson: string | null;
  createdAt: Date;
}): AuditLogRecord {
  return { ...row, detail: row.detailJson ? (JSON.parse(row.detailJson) as Record<string, unknown>) : null };
}

function whereClause(query: Omit<ListAuditLogsQuery, "limit" | "offset">) {
  return {
    ...(query.category ? { category: query.category } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.result ? { result: query.result } : {}),
    ...(query.q ? { message: { contains: query.q, mode: "insensitive" as const } } : {}),
    ...(query.since || query.until
      ? { createdAt: { ...(query.since ? { gte: query.since } : {}), ...(query.until ? { lte: query.until } : {}) } }
      : {}),
  };
}

export class PrismaAuditLogStore implements AuditLogStore {
  public constructor(private readonly db: PrismaClient) {}

  public async record(input: RecordAuditInput): Promise<AuditLogRecord> {
    const row = await this.db.auditLog.create({
      data: {
        level: input.level ?? "info",
        category: input.category,
        action: input.action,
        result: input.result,
        actor: input.actor ?? "",
        message: input.message ?? "",
        sessionHint: input.sessionHint,
        clientIp: input.clientIp,
        userAgent: input.userAgent,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        resourceAvailable: input.resourceAvailable ?? true,
        detailJson: input.detail ? JSON.stringify(input.detail) : undefined,
      },
    });
    return toRecord(row);
  }

  public async list(query: ListAuditLogsQuery): Promise<{ logs: AuditLogRecord[]; total: number }> {
    const where = whereClause(query);
    const [rows, total] = await Promise.all([
      this.db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: query.limit, skip: query.offset }),
      this.db.auditLog.count({ where }),
    ]);
    return { logs: rows.map(toRecord), total };
  }

  public async summary(query: Omit<ListAuditLogsQuery, "limit" | "offset">): Promise<{ total: number; failures: number; recent7d: number }> {
    const where = whereClause(query);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
    const [total, failures, recent7d] = await Promise.all([
      this.db.auditLog.count({ where }),
      this.db.auditLog.count({ where: { ...where, result: "failure" } }),
      this.db.auditLog.count({ where: { ...where, createdAt: { gte: sevenDaysAgo } } }),
    ]);
    return { total, failures, recent7d };
  }

  public async get(id: string): Promise<AuditLogRecord | null> {
    const row = await this.db.auditLog.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }
}
