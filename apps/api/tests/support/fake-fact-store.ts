import { FactNotFoundError } from "../../src/db/fact-store.js";
import { FactConflictError, TRANSITIONS, type VerificationState, type FactEvidenceInput, type FactEvidenceRecord, type FactVerificationRecord, type LinkedFinding } from "../../src/db/fact-verification.js";
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
  private snapshots: FactEvidenceRecord[] = [];
  private history: (FactVerificationRecord & { factId: string; projectId: string })[] = [];

  public async linkedFindings(projectId: string, observations: { kind: string; key: string; observationId: string }[]): Promise<LinkedFinding[]> {
    return this.snapshots.filter(row => row.projectId === projectId && observations.some(node => node.kind === row.akgObservationKind && node.key === row.akgObservationKey && node.observationId === row.observationId)).slice(0, 20).flatMap(row => {
      const fact = this.facts.get(row.factId);
      return fact ? [{ id: fact.id, fact_key: fact.factKey, summary: fact.summary.slice(0, 512), verification_state: fact.verificationState, observation_kind: row.akgObservationKind, observation_key: row.akgObservationKey, snapshot_hash: row.snapshotHash }] : [];
    });
  }

  public async findById(projectId: string, factId: string): Promise<FactRecord | null> {
    const fact = this.facts.get(factId);
    return fact?.projectId === projectId ? fact : null;
  }

  public async evidence(projectId: string, factId: string, offset = 0): Promise<{ evidence: FactEvidenceRecord[]; history: FactVerificationRecord[]; hasMore: boolean }> {
    const evidence = this.snapshots.filter(snapshot => snapshot.projectId === projectId && snapshot.factId === factId).reverse();
    const history = this.history.filter(entry => entry.projectId === projectId && entry.factId === factId).reverse();
    return { evidence: evidence.slice(offset, offset + 50), history: history.slice(offset, offset + 50), hasMore: evidence.length > offset + 50 || history.length > offset + 50 };
  }

  public async propose(projectId: string, input: CreateFactInput, evidence: FactEvidenceInput[], actor: string, expectedRevision?: number): Promise<FactRecord> {
    const existing = await this.findByKey(projectId, input.factKey);
    const addedEvidence = evidence.some(snapshot => !this.snapshots.some(row => row.factId === existing?.id && row.snapshotHash === snapshot.snapshotHash));
    if (existing?.verificationState === "proposed" && !addedEvidence && input.summary === existing.summary && input.body === existing.body) return existing;
    if (existing && ["rejected", "stale"].includes(existing.verificationState) && !addedEvidence) throw new FactConflictError();
    if (existing && (existing.revision !== expectedRevision || existing.verificationState === "verified")) throw new FactConflictError();
    const created = existing ?? await this.create(projectId, input);
    const fact = { ...created, summary: input.summary ?? created.summary, body: input.body ?? created.body, verificationState: "proposed", verificationSource: "akg", revision: existing ? created.revision + 1 : 1 };
    this.facts.set(fact.id, fact);
    for (const snapshot of evidence) {
      if (!this.snapshots.some(row => row.factId === fact.id && row.snapshotHash === snapshot.snapshotHash)) this.snapshots.push({ ...snapshot, id: `evidence-${this.nextId++}`, factId: fact.id, projectId, createdAt: new Date() });
    }
    this.history.push({ id: `review-${this.nextId++}`, factId: fact.id, projectId, fromState: existing?.verificationState ?? "", toState: "proposed", actor, note: "", factRevision: fact.revision, snapshotJson: JSON.stringify(fact), createdAt: new Date() });
    return fact;
  }

  public async transition(projectId: string, factId: string, expectedRevision: number, target: VerificationState, actor: string, note: string): Promise<FactRecord> {
    const existing = this.facts.get(factId);
    if (!existing || existing.projectId !== projectId || existing.revision !== expectedRevision || !TRANSITIONS[existing.verificationState as VerificationState]?.includes(target)) throw new FactConflictError();
    if (target === "proposed" && existing.verificationSource === "akg" && ["rejected", "stale"].includes(existing.verificationState)) throw new FactConflictError();
    const fact = { ...existing, verificationState: target, revision: existing.revision + 1, verifiedAt: target === "verified" ? new Date() : null, verifiedBy: target === "verified" ? actor : "" };
    this.facts.set(factId, fact);
    this.history.push({ id: `review-${this.nextId++}`, factId, projectId, fromState: existing.verificationState, toState: target, actor, note, factRevision: fact.revision, snapshotJson: JSON.stringify(fact), createdAt: new Date() });
    return fact;
  }

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
      verificationState: "observed",
      verificationSource: input.verificationSource ?? "manual",
      verifiedAt: null,
      verifiedBy: "",
      revision: 1,
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
      revision: existing.revision + 1,
      ...(existing.verificationState === "verified" && [input.summary, input.body, input.category].some(value => value !== undefined) ? { verificationState: "stale", verifiedAt: null, verifiedBy: "" } : {}),
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
