import type { PrismaClient } from "../generated/prisma/client.js";

export interface GuardRuleRecord {
  id: string;
  name: string;
  enabled: boolean;
  pattern: string;
  message: string;
}

export interface GuardConfigRecord {
  enabled: boolean;
  rules: GuardRuleRecord[];
}

export interface ToolGuardStore {
  get(): Promise<GuardConfigRecord>;
  set(config: GuardConfigRecord): Promise<GuardConfigRecord>;
}

const SINGLETON_ID = "singleton";

export class PrismaToolGuardStore implements ToolGuardStore {
  public constructor(private readonly db: PrismaClient) {}

  public async get(): Promise<GuardConfigRecord> {
    const row = await this.db.toolGuardConfig.findUnique({ where: { id: SINGLETON_ID } });
    if (!row) return { enabled: false, rules: [] };
    return { enabled: row.enabled, rules: JSON.parse(row.rulesJson) as GuardRuleRecord[] };
  }

  public async set(config: GuardConfigRecord): Promise<GuardConfigRecord> {
    const rulesJson = JSON.stringify(config.rules);
    const row = await this.db.toolGuardConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, enabled: config.enabled, rulesJson },
      update: { enabled: config.enabled, rulesJson },
    });
    return { enabled: row.enabled, rules: JSON.parse(row.rulesJson) as GuardRuleRecord[] };
  }
}
