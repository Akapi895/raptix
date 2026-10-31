import type { PrismaClient } from "../generated/prisma/client.js";

export interface AppConfigStore {
  get(key: string): Promise<Record<string, unknown> | null>;
  set(key: string, value: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export class PrismaAppConfigStore implements AppConfigStore {
  public constructor(private readonly db: PrismaClient) {}

  public async get(key: string): Promise<Record<string, unknown> | null> {
    const row = await this.db.appConfig.findUnique({ where: { key } });
    return row ? (JSON.parse(row.valueJson) as Record<string, unknown>) : null;
  }

  public async set(key: string, value: Record<string, unknown>): Promise<Record<string, unknown>> {
    const valueJson = JSON.stringify(value);
    const row = await this.db.appConfig.upsert({
      where: { key },
      create: { key, valueJson },
      update: { valueJson },
    });
    return JSON.parse(row.valueJson) as Record<string, unknown>;
  }
}
