import type { PrismaClient } from "../generated/prisma/client.js";

export interface ExternalMcpServerRecord {
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExternalMcpStore {
  list(): Promise<ExternalMcpServerRecord[]>;
  get(name: string): Promise<ExternalMcpServerRecord | null>;
  upsert(name: string, config: Record<string, unknown>): Promise<ExternalMcpServerRecord>;
  delete(name: string): Promise<boolean>;
}

function toRecord(row: { name: string; configJson: string; enabled: boolean; createdAt: Date; updatedAt: Date }): ExternalMcpServerRecord {
  return { name: row.name, config: JSON.parse(row.configJson) as Record<string, unknown>, enabled: row.enabled, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export class PrismaExternalMcpStore implements ExternalMcpStore {
  public constructor(private readonly db: PrismaClient) {}

  public async list(): Promise<ExternalMcpServerRecord[]> {
    const rows = await this.db.externalMcpServer.findMany({ orderBy: { name: "asc" } });
    return rows.map(toRecord);
  }

  public async get(name: string): Promise<ExternalMcpServerRecord | null> {
    const row = await this.db.externalMcpServer.findUnique({ where: { name } });
    return row ? toRecord(row) : null;
  }

  public async upsert(name: string, config: Record<string, unknown>): Promise<ExternalMcpServerRecord> {
    const enabled = config.external_mcp_enable !== false;
    const configJson = JSON.stringify(config);
    const row = await this.db.externalMcpServer.upsert({
      where: { name },
      create: { name, configJson, enabled },
      update: { configJson, enabled },
    });
    return toRecord(row);
  }

  public async delete(name: string): Promise<boolean> {
    try {
      await this.db.externalMcpServer.delete({ where: { name } });
      return true;
    } catch {
      return false;
    }
  }
}
