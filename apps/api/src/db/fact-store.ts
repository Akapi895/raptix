import type { PrismaClient, ProjectFact } from "../generated/prisma/client.js";
import { FactConflictError, TRANSITIONS, type VerificationState, type FactEvidenceInput, type FactEvidenceRecord, type FactVerificationRecord, type LinkedFinding } from "./fact-verification.js";

/** Fact-graph render bound: a project graph beyond this would be unusable to lay out anyway. */
const MAX_GRAPH_FACTS = 1000;

export interface FactRecord {
  id: string;
  projectId: string;
  factKey: string;
  category: string;
  summary: string;
  body: string;
  confidence: string;
  pinned: boolean;
  deprecated: boolean;
  relatedVulnerabilityId: string;
  sourceConversationId: string;
  sourceMessageId: string;
  createdAt: Date;
  updatedAt: Date;
  verificationState: string;
  verificationSource: string;
  verifiedAt: Date | null;
  verifiedBy: string;
  revision: number;
}

export interface CreateFactInput {
  factKey: string;
  category?: string;
  summary?: string;
  body?: string;
  confidence?: string;
  pinned?: boolean;
  relatedVulnerabilityId?: string;
  sourceConversationId?: string;
  sourceMessageId?: string;
  verificationSource?: string;
}

export interface UpdateFactInput {
  factKey?: string;
  category?: string;
  summary?: string;
  body?: string;
  confidence?: string;
  pinned?: boolean;
}

export interface ListFactsQuery {
  search?: string;
  category?: string;
  confidence?: string;
  excludeDeprecated?: boolean;
  relatedVulnerabilityId?: string;
  limit: number;
  offset: number;
}

export interface FactEdgeRecord {
  id: string;
  projectId: string;
  sourceFactKey: string;
  targetFactKey: string;
  edgeType: string;
  confidence: string;
  createdAt: Date;
}

export interface CreateFactEdgeInput {
  sourceFactKey: string;
  targetFactKey: string;
  edgeType?: string;
}

export interface FactLink {
  edgeType: string;
  sourceFactKey: string;
}

export interface FactStore {
  linkedFindings(projectId: string, observations: { kind: string; key: string; observationId: string }[]): Promise<LinkedFinding[]>;
  propose(projectId: string, input: CreateFactInput, evidence: FactEvidenceInput[], actor: string, expectedRevision?: number): Promise<FactRecord>;
  transition(projectId: string, factId: string, expectedRevision: number, target: VerificationState, actor: string, note: string): Promise<FactRecord>;
  evidence(projectId: string, factId: string, offset?: number): Promise<{ evidence: FactEvidenceRecord[]; history: FactVerificationRecord[]; hasMore: boolean }>;
  findById(projectId: string, factId: string): Promise<FactRecord | null>;
  list(projectId: string, query: ListFactsQuery): Promise<{ facts: FactRecord[]; total: number }>;
  findByKey(projectId: string, factKey: string): Promise<FactRecord | null>;
  /** Per-fact incoming-link detail for the single-fact read (factWithLinksResponse). */
  incomingLinks(projectId: string, factKey: string): Promise<FactLink[]>;
  linkCounts(projectId: string, factKey: string): Promise<{ incoming: number; outgoing: number }>;
  /** Incoming-edge counts for a set of fact keys, keyed by target fact key. */
  incomingCounts(projectId: string, factKeys: string[]): Promise<Map<string, number>>;
  create(projectId: string, input: CreateFactInput): Promise<FactRecord>;
  update(projectId: string, factId: string, input: UpdateFactInput): Promise<FactRecord | null>;
  delete(projectId: string, factId: string): Promise<boolean>;
  count(projectId: string, excludeDeprecated: boolean): Promise<number>;
  countAll(): Promise<number>;
  /** Most recently updated facts across all projects (the dashboard's recent_facts). */
  listRecent(limit: number): Promise<FactRecord[]>;
  /** Marks facts matching any of the given fact_keys OR ids; returns how many rows changed. */
  setDeprecated(projectId: string, factKeys: string[], ids: string[], deprecated: boolean, confidence?: string): Promise<number>;
  listEdges(projectId: string): Promise<FactEdgeRecord[]>;
  createEdge(projectId: string, input: CreateFactEdgeInput): Promise<FactEdgeRecord>;
  deleteEdge(projectId: string, edgeId: string): Promise<boolean>;
  graphRows(projectId: string, excludeDeprecated: boolean): Promise<{ facts: FactRecord[]; edges: FactEdgeRecord[] }>;
}

function toRecord(row: ProjectFact): FactRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    factKey: row.factKey,
    category: row.category,
    summary: row.summary,
    body: row.body,
    confidence: row.confidence,
    pinned: row.pinned,
    deprecated: row.deprecated,
    relatedVulnerabilityId: row.relatedVulnerabilityId,
    sourceConversationId: row.sourceConversationId,
    sourceMessageId: row.sourceMessageId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    verificationState: row.verificationState,
    verificationSource: row.verificationSource,
    verifiedAt: row.verifiedAt,
    verifiedBy: row.verifiedBy,
    revision: row.revision,
  };
}

function edgeToRecord(row: {
  id: string;
  projectId: string;
  edgeType: string;
  confidence: string;
  createdAt: Date;
  sourceFact: { factKey: string };
  targetFact: { factKey: string };
}): FactEdgeRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    sourceFactKey: row.sourceFact.factKey,
    targetFactKey: row.targetFact.factKey,
    edgeType: row.edgeType,
    confidence: row.confidence,
    createdAt: row.createdAt,
  };
}

export class PrismaFactStore implements FactStore {
  public constructor(private readonly db: PrismaClient) {}

  public async linkedFindings(projectId: string, observations: { kind: string; key: string; observationId: string }[]): Promise<LinkedFinding[]> {
    if (!observations.length) return [];
    const rows = await this.db.projectFactEvidence.findMany({ where: { projectId, OR: observations.slice(0, 20).map(node => ({ akgObservationKind: node.kind, akgObservationKey: node.key, observationId: node.observationId })) }, include: { fact: true }, orderBy: { createdAt: "desc" }, take: 20 });
    return rows.map(row => ({ id: row.fact.id, fact_key: row.fact.factKey, summary: row.fact.summary.slice(0, 512), verification_state: row.fact.verificationState, observation_kind: row.akgObservationKind, observation_key: row.akgObservationKey, snapshot_hash: row.snapshotHash }));
  }

  public async findById(projectId: string, factId: string): Promise<FactRecord | null> {
    const row = await this.db.projectFact.findFirst({ where: { id: factId, projectId } });
    return row ? toRecord(row) : null;
  }

  public async evidence(projectId: string, factId: string, offset = 0): Promise<{ evidence: FactEvidenceRecord[]; history: FactVerificationRecord[]; hasMore: boolean }> {
    const [evidence, history] = await Promise.all([
      this.db.projectFactEvidence.findMany({ where: { projectId, factId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51, skip: offset }),
      this.db.projectFactVerification.findMany({ where: { projectId, factId }, orderBy: { factRevision: "desc" }, take: 51, skip: offset }),
    ]);
    return { evidence: evidence.slice(0, 50), history: history.slice(0, 50), hasMore: evidence.length > 50 || history.length > 50 };
  }

  public async propose(projectId: string, input: CreateFactInput, evidence: FactEvidenceInput[], actor: string, expectedRevision?: number): Promise<FactRecord> {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.projectFact.findUnique({ where: { projectId_factKey: { projectId, factKey: input.factKey } } });
      let row: ProjectFact;
      if (existing) {
        const previous = await tx.projectFactEvidence.findMany({ where: { projectId, factId: existing.id, snapshotHash: { in: evidence.map(snapshot => snapshot.snapshotHash) } }, select: { snapshotHash: true } });
        const addedEvidence = evidence.some(snapshot => !previous.some(row => row.snapshotHash === snapshot.snapshotHash));
        if (existing.verificationState === "proposed" && !addedEvidence && input.summary === existing.summary && input.body === existing.body) return toRecord(existing);
        if (["rejected", "stale"].includes(existing.verificationState) && !addedEvidence) throw new FactConflictError();
        if (expectedRevision !== existing.revision || !["observed", "proposed", "rejected", "stale"].includes(existing.verificationState)) throw new FactConflictError();
        const changed = await tx.projectFact.updateMany({
          where: { id: existing.id, projectId, revision: expectedRevision },
          data: { summary: input.summary, body: input.body, verificationState: "proposed", verificationSource: "akg", verifiedAt: null, verifiedBy: "", revision: { increment: 1 } },
        });
        if (!changed.count) throw new FactConflictError();
        row = await tx.projectFact.findUniqueOrThrow({ where: { id: existing.id } });
      } else {
        row = await tx.projectFact.create({ data: { ...input, projectId, verificationState: "proposed", verificationSource: "akg" } });
      }
      await tx.projectFactEvidence.createMany({ data: evidence.map(snapshot => ({ ...snapshot, factId: row.id, projectId })), skipDuplicates: true });
      await tx.projectFactVerification.create({ data: {
        factId: row.id, projectId, fromState: existing?.verificationState ?? "", toState: "proposed", actor,
        factRevision: row.revision, snapshotJson: JSON.stringify({ summary: row.summary, body: row.body, evidence: evidence.map(snapshot => snapshot.snapshotHash) }),
      } });
      return toRecord(row);
    });
  }

  public async transition(projectId: string, factId: string, expectedRevision: number, target: VerificationState, actor: string, note: string): Promise<FactRecord> {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.projectFact.findFirst({ where: { id: factId, projectId } });
      if (!existing || !TRANSITIONS[existing.verificationState as VerificationState]?.includes(target)) throw new FactConflictError();
      if (target === "proposed" && existing.verificationSource === "akg" && ["rejected", "stale"].includes(existing.verificationState)) throw new FactConflictError();
      const changed = await tx.projectFact.updateMany({ where: { id: factId, projectId, revision: expectedRevision, verificationState: existing.verificationState }, data: {
        verificationState: target, revision: { increment: 1 },
        verifiedAt: target === "verified" ? new Date() : null, verifiedBy: target === "verified" ? actor : "",
      } });
      if (!changed.count) throw new FactConflictError();
      const row = await tx.projectFact.findUniqueOrThrow({ where: { id: factId } });
      const snapshots = await tx.projectFactEvidence.findMany({ where: { projectId, factId }, select: { snapshotHash: true } });
      await tx.projectFactVerification.create({ data: {
        factId, projectId, fromState: existing.verificationState, toState: target, actor, note,
        factRevision: row.revision, snapshotJson: JSON.stringify({ summary: row.summary, body: row.body, evidence: snapshots.map(snapshot => snapshot.snapshotHash) }),
      } });
      return toRecord(row);
    });
  }

  public async list(projectId: string, query: ListFactsQuery): Promise<{ facts: FactRecord[]; total: number }> {
    const where = {
      projectId,
      ...(query.search ? { OR: ["factKey", "summary", "body", "category"].map((field) => ({ [field]: { contains: query.search, mode: "insensitive" as const } })) } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.confidence ? { confidence: query.confidence } : {}),
      ...(query.excludeDeprecated ? { deprecated: false } : {}),
      ...(query.relatedVulnerabilityId ? { relatedVulnerabilityId: query.relatedVulnerabilityId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.projectFact.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: query.limit,
        skip: query.offset,
      }),
      this.db.projectFact.count({ where }),
    ]);
    return { facts: rows.map(toRecord), total };
  }

  public async findByKey(projectId: string, factKey: string): Promise<FactRecord | null> {
    const row = await this.db.projectFact.findUnique({ where: { projectId_factKey: { projectId, factKey } } });
    return row ? toRecord(row) : null;
  }

  public async incomingLinks(projectId: string, factKey: string): Promise<FactLink[]> {
    const rows = await this.db.projectFactEdge.findMany({
      where: { projectId, targetFact: { factKey } },
      include: { sourceFact: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({ edgeType: row.edgeType, sourceFactKey: row.sourceFact.factKey }));
  }

  public async linkCounts(projectId: string, factKey: string): Promise<{ incoming: number; outgoing: number }> {
    const fact = await this.db.projectFact.findUnique({ where: { projectId_factKey: { projectId, factKey } }, select: { id: true } });
    if (!fact) return { incoming: 0, outgoing: 0 };
    const [incoming, outgoing] = await Promise.all([
      this.db.projectFactEdge.count({ where: { targetFactId: fact.id } }),
      this.db.projectFactEdge.count({ where: { sourceFactId: fact.id } }),
    ]);
    return { incoming, outgoing };
  }

  public async incomingCounts(projectId: string, factKeys: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (factKeys.length === 0) return counts;
    const rows = await this.db.projectFactEdge.findMany({
      where: { projectId, targetFact: { factKey: { in: factKeys } } },
      select: { targetFact: { select: { factKey: true } } },
    });
    for (const row of rows) {
      const key = row.targetFact.factKey;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  public async create(projectId: string, input: CreateFactInput): Promise<FactRecord> {
    const row = await this.db.projectFact.create({
      data: {
        projectId,
        factKey: input.factKey,
        category: input.category ?? "note",
        summary: input.summary ?? "",
        body: input.body ?? "",
        confidence: input.confidence ?? "medium",
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        relatedVulnerabilityId: input.relatedVulnerabilityId ?? "",
        sourceConversationId: input.sourceConversationId ?? "",
        sourceMessageId: input.sourceMessageId ?? "",
        verificationSource: input.verificationSource ?? "manual",
      },
    });
    return toRecord(row);
  }

  public async update(projectId: string, factId: string, input: UpdateFactInput): Promise<FactRecord | null> {
    return this.db.$transaction(async (tx) => {
    const exists = await tx.projectFact.findFirst({ where: { id: factId, projectId } });
    if (!exists) return null;
    const changed = await tx.projectFact.updateMany({
      where: { id: factId, projectId, revision: exists.revision },
      data: {
        ...(input.factKey !== undefined ? { factKey: input.factKey } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        revision: { increment: 1 },
        ...(exists.verificationState === "verified" && [input.summary, input.body, input.category].some(value => value !== undefined)
          ? { verificationState: "stale", verifiedAt: null, verifiedBy: "" } : {}),
      },
    });
    if (!changed.count) throw new FactConflictError();
    const row = await tx.projectFact.findUniqueOrThrow({ where: { id: factId } });
    if (row.verificationState !== exists.verificationState) {
      await tx.projectFactVerification.create({ data: {
        factId, projectId, fromState: exists.verificationState, toState: row.verificationState,
        actor: "content-edit", note: "Verified content changed; re-verification required",
        factRevision: row.revision, snapshotJson: JSON.stringify({ summary: row.summary, body: row.body }),
      } });
    }
    return toRecord(row);
    });
  }

  public async delete(projectId: string, factId: string): Promise<boolean> {
    const row = await this.db.projectFact.findFirst({ where: { id: factId, projectId } });
    if (!row) return false;
    await this.db.projectFact.delete({ where: { id: factId } });
    return true;
  }

  public async count(projectId: string, excludeDeprecated: boolean): Promise<number> {
    return this.db.projectFact.count({ where: { projectId, ...(excludeDeprecated ? { deprecated: false } : {}) } });
  }

  public async countAll(): Promise<number> {
    return this.db.projectFact.count();
  }

  public async listRecent(limit: number): Promise<FactRecord[]> {
    const rows = await this.db.projectFact.findMany({ orderBy: { updatedAt: "desc" }, take: limit });
    return rows.map(toRecord);
  }

  public async setDeprecated(projectId: string, factKeys: string[], ids: string[], deprecated: boolean, confidence?: string): Promise<number> {
    if (factKeys.length === 0 && ids.length === 0) return 0;
    const result = await this.db.projectFact.updateMany({
      where: {
        projectId,
        OR: [
          ...(factKeys.length > 0 ? [{ factKey: { in: factKeys } }] : []),
          ...(ids.length > 0 ? [{ id: { in: ids } }] : []),
        ],
      },
      data: { deprecated, revision: { increment: 1 }, ...(confidence !== undefined ? { confidence } : {}) },
    });
    return result.count;
  }

  public async listEdges(projectId: string): Promise<FactEdgeRecord[]> {
    const rows = await this.db.projectFactEdge.findMany({
      where: { projectId },
      include: { sourceFact: true, targetFact: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(edgeToRecord);
  }

  public async createEdge(projectId: string, input: CreateFactEdgeInput): Promise<FactEdgeRecord> {
    const [source, target] = await Promise.all([
      this.db.projectFact.findUnique({ where: { projectId_factKey: { projectId, factKey: input.sourceFactKey } } }),
      this.db.projectFact.findUnique({ where: { projectId_factKey: { projectId, factKey: input.targetFactKey } } }),
    ]);
    if (!source) throw new FactNotFoundError(input.sourceFactKey);
    if (!target) throw new FactNotFoundError(input.targetFactKey);
    const row = await this.db.projectFactEdge.create({
      data: {
        edgeType: input.edgeType ?? "related",
        project: { connect: { id: projectId } },
        sourceFact: { connect: { id: source.id } },
        targetFact: { connect: { id: target.id } },
      },
      include: { sourceFact: true, targetFact: true },
    });
    return edgeToRecord(row);
  }

  public async deleteEdge(projectId: string, edgeId: string): Promise<boolean> {
    const row = await this.db.projectFactEdge.findFirst({ where: { id: edgeId, projectId } });
    if (!row) return false;
    await this.db.projectFactEdge.delete({ where: { id: edgeId } });
    return true;
  }

  public async graphRows(projectId: string, excludeDeprecated: boolean): Promise<{ facts: FactRecord[]; edges: FactEdgeRecord[] }> {
    const [facts, edges] = await Promise.all([
      this.list(projectId, { excludeDeprecated, limit: MAX_GRAPH_FACTS, offset: 0 }),
      this.listEdges(projectId),
    ]);
    return { facts: facts.facts, edges };
  }
}

export class FactNotFoundError extends Error {
  public constructor(factKey: string) {
    super(`Fact not found: ${factKey}`);
    this.name = "FactNotFoundError";
  }
}
