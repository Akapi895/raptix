import type { WebShellConnectionFields, WebShellConnectionRecord, WebShellStore } from "../../src/db/webshell-store.js";

export class FakeWebShellStore implements WebShellStore {
  private readonly connections = new Map<string, WebShellConnectionRecord>();
  private readonly links = new Map<string, string[]>();
  private nextId = 1;

  public async list(): Promise<WebShellConnectionRecord[]> {
    return [...this.connections.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  public async create(fields: WebShellConnectionFields & { url: string }): Promise<WebShellConnectionRecord> {
    const now = new Date();
    const id = `webshell-${this.nextId++}`;
    const record: WebShellConnectionRecord = {
      id,
      projectId: fields.projectId ?? null,
      url: fields.url,
      password: fields.password ?? "",
      type: fields.type ?? "php",
      method: fields.method ?? "post",
      cmdParam: fields.cmdParam ?? "",
      remark: fields.remark ?? "",
      encoding: fields.encoding ?? "auto",
      os: fields.os ?? "auto",
      stateJson: "{}",
      createdAt: now,
      updatedAt: now,
    };
    this.connections.set(id, record);
    return record;
  }

  public async findById(id: string): Promise<WebShellConnectionRecord | null> {
    return this.connections.get(id) ?? null;
  }

  public async update(id: string, fields: WebShellConnectionFields): Promise<WebShellConnectionRecord | null> {
    const existing = this.connections.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)), updatedAt: new Date() };
    this.connections.set(id, updated);
    return updated;
  }

  public async delete(id: string): Promise<boolean> {
    return this.connections.delete(id);
  }

  public async setState(id: string, stateJson: string): Promise<WebShellConnectionRecord | null> {
    const existing = this.connections.get(id);
    if (!existing) return null;
    const updated = { ...existing, stateJson, updatedAt: new Date() };
    this.connections.set(id, updated);
    return updated;
  }

  public async linkedConversationIds(id: string): Promise<string[]> {
    return this.links.get(id) ?? [];
  }

  public setLinkedConversationIds(id: string, ids: string[]): void {
    this.links.set(id, ids);
  }
}
