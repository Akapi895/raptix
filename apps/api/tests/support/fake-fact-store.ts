import { FactNotFoundError } from "../../src/db/fact-store.js";
import type {
  CreateFactEdgeInput,
  CreateFactInput,
  FactEdgeRecord,
  FactLink,
  FactRecord,
  FactStore,
  ListFactsQuery,
  UpdateFactInput,
} from "../../src/db/fact-store.js";

export class FakeFactStore implements FactStore {
  public readonly facts = new Map<string, FactRecord>();
  public readonly edges = new Map<string, FactEdgeRecord>();
  private nextId = 1;

  public async list(projectId: string, query: ListFactsQuery): Promise<{ facts: FactRecord[]; total: number }> {
    let rows = [...this.facts.values()].filter((f) => f.projectId === projectId);
    if (query.search) {
      const needle = query.search.toLowerCase();
      rows = rows.filter((f) => [f.factKey, f.summary, f.body, f.category].some((field) => field.toLowerCase().includes(needle)));
    }
    if (query.category) rows = rows.filter((f) => f.category === query.category);
    if (query.confidence) rows = rows.filter((f) => f.confidence === query.confidence);
    if (query.excludeDeprecated) rows = rows.filter((f) => !f.deprecated);
    if (query.relatedVulnerabilityId) rows = rows.filter((f) => f.relatedVulnerabilityId === query.relatedVulnerabilityId);
    rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return { facts: rows.slice(query.offset, query.offset + query.limit), total: rows.length };
  }

  public async findByKey(projectId: string, factKey: string): Promise<FactRecord | null> {
    return [...this.facts.values()].find((f) => f.projectId === projectId && f.factKey === factKey) ?? null;
  }

  public async incomingLinks(projectId: string, factKey: string): Promise<FactLink[]> {
    return [...this.edges.values()]
      .filter((e) => e.projectId === projectId && e.targetFactKey === factKey)
      .map((e) => ({ edgeType: e.edgeType, sourceFactKey: e.sourceFactKey }));
  }

  public async linkCounts(projectId: string, factKey: string): Promise<{ incoming: number; outgoing: number }> {
    const rows = [...this.edges.values()].filter((e) => e.projectId === projectId);
    return {
      incoming: rows.filter((e) => e.targetFactKey === factKey).length,
      outgoing: rows.filter((e) => e.sourceFactKey === factKey).length,
    };
  }

  public async incomingCounts(projectId: string, factKeys: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const key of factKeys) {
      const count = [...this.edges.values()].filter((e) => e.projectId === projectId && e.targetFactKey === key).length;
      if (count > 0) counts.set(key, count);
    }
    return counts;
  }

  public async create(projectId: string, input: CreateFactInput): Promise<FactRecord> {
    if (await this.findByKey(projectId, input.factKey)) {
      const error = new Error("Unique constraint failed") as Error & { code?: string };
      error.code = "P2002";
      throw error;
    }
    const now = new Date();
    const fact: FactRecord = {
      id: `fact-${this.nextId++}`,
      projectId,
      factKey: input.factKey,
      category: input.category ?? "note",
      summary: input.summary ?? "",
      body: input.body ?? "",
      confidence: input.confidence ?? "medium",
      pinned: input.pinned ?? false,
      deprecated: false,
      relatedVulnerabilityId: input.relatedVulnerabilityId ?? "",
      sourceConversationId: input.sourceConversationId ?? "",
      sourceMessageId: input.sourceMessageId ?? "",
      createdAt: now,
      updatedAt: now,
    };
    this.facts.set(fact.id, fact);
    return fact;
  }

  public async update(projectId: string, factId: string, input: UpdateFactInput): Promise<FactRecord | null> {
    const existing = this.facts.get(factId);
    if (!existing || existing.projectId !== projectId) return null;
    if (input.factKey !== undefined && input.factKey !== existing.factKey) {
      const clash = await this.findByKey(projectId, input.factKey);
      if (clash) {
        const error = new Error("Unique constraint failed") as Error & { code?: string };
        error.code = "P2002";
        throw error;
      }
    }
    const updated: FactRecord = {
      ...existing,
      ...(input.factKey !== undefined ? { factKey: input.factKey } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      updatedAt: new Date(),
    };
    this.facts.set(factId, updated);
    return updated;
  }

  public async delete(projectId: string, factId: string): Promise<boolean> {
    const existing = this.facts.get(factId);
    if (!existing || existing.projectId !== projectId) return false;
    this.facts.delete(factId);
    for (const [id, edge] of this.edges) {
      if (edge.sourceFactKey === existing.factKey || edge.targetFactKey === existing.factKey) this.edges.delete(id);
    }
    return true;
  }

  public async count(projectId: string, excludeDeprecated: boolean): Promise<number> {
    return [...this.facts.values()].filter((f) => f.projectId === projectId && (!excludeDeprecated || !f.deprecated)).length;
  }

  public async countAll(): Promise<number> {
    return this.facts.size;
  }

  public async listRecent(limit: number): Promise<FactRecord[]> {
    return [...this.facts.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, limit);
  }

  public async setDeprecated(projectId: string, factKeys: string[], ids: string[], deprecated: boolean, confidence?: string): Promise<number> {
    let changed = 0;
    for (const fact of this.facts.values()) {
      if (fact.projectId !== projectId) continue;
      if (!factKeys.includes(fact.factKey) && !ids.includes(fact.id)) continue;
      this.facts.set(fact.id, { ...fact, deprecated, ...(confidence !== undefined ? { confidence } : {}), updatedAt: new Date() });
      changed += 1;
    }
    return changed;
  }

  public async listEdges(projectId: string): Promise<FactEdgeRecord[]> {
    return [...this.edges.values()].filter((e) => e.projectId === projectId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  public async createEdge(projectId: string, input: CreateFactEdgeInput): Promise<FactEdgeRecord> {
    const source = await this.findByKey(projectId, input.sourceFactKey);
    const target = await this.findByKey(projectId, input.targetFactKey);
    if (!source || !target) {
      const missing = source ? input.targetFactKey : input.sourceFactKey;
      throw new FactNotFoundError(missing);
    }
    const edge: FactEdgeRecord = {
      id: `edge-${this.nextId++}`,
      projectId,
      sourceFactKey: input.sourceFactKey,
      targetFactKey: input.targetFactKey,
      edgeType: input.edgeType ?? "related",
      confidence: "medium",
      createdAt: new Date(),
    };
    this.edges.set(edge.id, edge);
    return edge;
  }

  public async deleteEdge(projectId: string, edgeId: string): Promise<boolean> {
    const edge = this.edges.get(edgeId);
    if (!edge || edge.projectId !== projectId) return false;
    this.edges.delete(edgeId);
    return true;
  }

  public async graphRows(projectId: string, excludeDeprecated: boolean): Promise<{ facts: FactRecord[]; edges: FactEdgeRecord[] }> {
    return {
      facts: [...this.facts.values()].filter((f) => f.projectId === projectId && (!excludeDeprecated || !f.deprecated)),
      edges: await this.listEdges(projectId),
    };
  }
}
