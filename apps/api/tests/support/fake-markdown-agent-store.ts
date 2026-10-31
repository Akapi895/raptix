import type { MarkdownAgentFields, MarkdownAgentRecord, MarkdownAgentStore } from "../../src/db/markdown-agent-store.js";

export class FakeMarkdownAgentStore implements MarkdownAgentStore {
  private agents = new Map<string, MarkdownAgentRecord>();

  public async list(): Promise<MarkdownAgentRecord[]> {
    return [...this.agents.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  public async get(id: string): Promise<MarkdownAgentRecord | null> {
    return this.agents.get(id) ?? null;
  }

  public async create(id: string, fields: MarkdownAgentFields): Promise<MarkdownAgentRecord> {
    const now = new Date();
    const agent: MarkdownAgentRecord = {
      id,
      name: fields.name,
      description: fields.description ?? "",
      isOrchestrator: fields.isOrchestrator ?? false,
      tools: fields.tools ?? [],
      instruction: fields.instruction ?? "",
      bindRole: fields.bindRole ?? "",
      maxIterations: fields.maxIterations ?? 0,
      kind: fields.kind ?? "",
      createdAt: now,
      updatedAt: now,
    };
    this.agents.set(id, agent);
    return agent;
  }

  public async update(id: string, fields: MarkdownAgentFields): Promise<MarkdownAgentRecord | null> {
    const existing = this.agents.get(id);
    if (!existing) return null;
    const updated: MarkdownAgentRecord = {
      ...existing,
      name: fields.name,
      description: fields.description ?? "",
      isOrchestrator: fields.isOrchestrator ?? false,
      tools: fields.tools ?? [],
      instruction: fields.instruction ?? "",
      bindRole: fields.bindRole ?? "",
      maxIterations: fields.maxIterations ?? 0,
      kind: fields.kind ?? "",
      updatedAt: new Date(),
    };
    this.agents.set(id, updated);
    return updated;
  }

  public async delete(id: string): Promise<boolean> {
    return this.agents.delete(id);
  }
}
