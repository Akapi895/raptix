import type { GuardConfigRecord, ToolGuardStore } from "../../src/db/tool-guard-store.js";

export class FakeToolGuardStore implements ToolGuardStore {
  private config: GuardConfigRecord = { enabled: false, rules: [] };

  public async get(): Promise<GuardConfigRecord> {
    return this.config;
  }

  public async set(config: GuardConfigRecord): Promise<GuardConfigRecord> {
    this.config = config;
    return this.config;
  }
}
