import type { ExternalMcpServerRecord, ExternalMcpStore } from "../../src/db/external-mcp-store.js";

export class FakeExternalMcpStore implements ExternalMcpStore {
  private servers = new Map<string, ExternalMcpServerRecord>();

  public async list(): Promise<ExternalMcpServerRecord[]> {
    return [...this.servers.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  public async get(name: string): Promise<ExternalMcpServerRecord | null> {
    return this.servers.get(name) ?? null;
  }

  public async upsert(name: string, config: Record<string, unknown>): Promise<ExternalMcpServerRecord> {
    const now = new Date();
    const existing = this.servers.get(name);
    const enabled = config.external_mcp_enable !== false;
    const record: ExternalMcpServerRecord = { name, config, enabled, createdAt: existing?.createdAt ?? now, updatedAt: now };
    this.servers.set(name, record);
    return record;
  }

  public async delete(name: string): Promise<boolean> {
    return this.servers.delete(name);
  }
}
