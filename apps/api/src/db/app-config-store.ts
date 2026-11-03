import type { PrismaClient } from "../generated/prisma/client.js";

export interface AppConfigStore {
  get(key: string): Promise<Record<string, unknown> | null>;
  set(key: string, value: Record<string, unknown>): Promise<Record<string, unknown>>;
  compareAndSet(key: string, previous: Record<string, unknown> | null, value: Record<string, unknown>): Promise<boolean>;
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

  public async compareAndSet(key: string, previous: Record<string, unknown> | null, value: Record<string, unknown>): Promise<boolean> {
    if (previous === null) {
      const created = await this.db.appConfig.createMany({ data: [{ key, valueJson: JSON.stringify(value) }], skipDuplicates: true });
      return created.count === 1;
    }
    const updated = await this.db.appConfig.updateMany({ where: { key, valueJson: JSON.stringify(previous) }, data: { valueJson: JSON.stringify(value) } });
    return updated.count === 1;
  }
}
