import type { AppConfigStore } from "../../src/db/app-config-store.js";

export class FakeAppConfigStore implements AppConfigStore {
  private values = new Map<string, Record<string, unknown>>();

  public async get(key: string): Promise<Record<string, unknown> | null> {
    return this.values.get(key) ?? null;
  }

  public async set(key: string, value: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.values.set(key, value);
    return value;
  }
}
