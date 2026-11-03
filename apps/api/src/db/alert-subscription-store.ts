import type { PrismaClient } from "../generated/prisma/client.js";

export interface AlertSubscriptionRecord {
  enabled: boolean;
  minSeverity: string;
}

export interface AlertSubscriptionStore {
  get(): Promise<AlertSubscriptionRecord>;
  set(fields: AlertSubscriptionRecord): Promise<AlertSubscriptionRecord>;
}

const SINGLETON_ID = "singleton";

export class PrismaAlertSubscriptionStore implements AlertSubscriptionStore {
  public constructor(private readonly db: PrismaClient) {}

  public async get(): Promise<AlertSubscriptionRecord> {
    const row = await this.db.alertSubscription.findUnique({ where: { id: SINGLETON_ID } });
    return row ? { enabled: row.enabled, minSeverity: row.minSeverity } : { enabled: false, minSeverity: "high" };
  }

  public async set(fields: AlertSubscriptionRecord): Promise<AlertSubscriptionRecord> {
    const row = await this.db.alertSubscription.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, enabled: fields.enabled, minSeverity: fields.minSeverity },
      update: { enabled: fields.enabled, minSeverity: fields.minSeverity },
    });
    return { enabled: row.enabled, minSeverity: row.minSeverity };
  }
}
