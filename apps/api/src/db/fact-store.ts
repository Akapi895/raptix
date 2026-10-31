import type { PrismaClient, ProjectFact } from "../generated/prisma/client.js";

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
      },
    });
    return toRecord(row);
  }

  public async update(projectId: string, factId: string, input: UpdateFactInput): Promise<FactRecord | null> {
    const exists = await this.db.projectFact.findFirst({ where: { id: factId, projectId } });
    if (!exists) return null;
    const row = await this.db.projectFact.update({
      where: { id: factId },
      data: {
        ...(input.factKey !== undefined ? { factKey: input.factKey } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      },
    });
    return toRecord(row);
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
      data: { deprecated, ...(confidence !== undefined ? { confidence } : {}) },
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
