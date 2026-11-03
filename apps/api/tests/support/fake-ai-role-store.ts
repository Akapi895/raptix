import type { AiRoleFields, AiRoleRecord, AiRoleStore } from "../../src/db/ai-role-store.js";

export class FakeAiRoleStore implements AiRoleStore {
  private roles = new Map<string, AiRoleRecord>();

  public async list(): Promise<AiRoleRecord[]> {
    return [...this.roles.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  public async get(name: string): Promise<AiRoleRecord | null> {
    return this.roles.get(name) ?? null;
  }

  public async create(name: string, fields: AiRoleFields): Promise<AiRoleRecord> {
    const now = new Date();
    const role: AiRoleRecord = {
      name,
      description: fields.description ?? "",
      icon: fields.icon ?? "",
      userPrompt: fields.userPrompt ?? "",
      tools: fields.tools ?? [],
      mcps: fields.mcps ?? [],
      enabled: fields.enabled ?? true,
      workflowId: fields.workflowId ?? "",
      workflowPolicy: fields.workflowPolicy ?? "",
      createdAt: now,
      updatedAt: now,
    };
    this.roles.set(name, role);
    return role;
  }

  public async update(name: string, fields: AiRoleFields): Promise<AiRoleRecord | null> {
    const existing = this.roles.get(name);
    if (!existing) return null;
    const updated: AiRoleRecord = { ...existing, ...fields, updatedAt: new Date() };
    this.roles.set(name, updated);
    return updated;
  }

  public async delete(name: string): Promise<boolean> {
    return this.roles.delete(name);
  }
}
