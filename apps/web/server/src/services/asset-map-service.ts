import type { AssetMapAssetRef, AssetMapCompleteness, AssetMapKind, AssetMapMembersPage, AssetMapNeighborhood, AssetMapOverview, AssetMapSearchResult } from '@raptix/web-contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import { requireEngagementAccess } from '../auth/membership-policy.js';
import { neo4jQuery, type GraphConfig } from './graph-service.js';
import { ProjectNotFoundError } from './projects-service.js';

/**
 * Plan phase 3 read models for large graphs. Every read is bounded at the store
 * (LIMIT in the query, not a JS slice after reading everything) and reports
 * total/loaded/hasMore/truncated, source state and a revision. A paging cursor
 * carries the revision it was issued under; when the catalog changes, paging
 * restarts with an explicit error instead of silently skipping or repeating rows.
 */
export const ASSET_MAP_LIMITS = {
  membersDefault: 50,
  membersMax: 200,
  searchDefault: 25,
  searchMax: 50,
  neighborEdges: 250,
  neighborhoodBytes: 512 * 1024,
} as const;

const ASSET_ID = /^asset_[0-9a-f]{32}$/;

/** A caller-supplied value failed validation; mapped to 400. */
export class AssetMapInputError extends Error {}
/** The asset does not belong to this engagement; mapped to 404. */
export class AssetMapNotFoundError extends Error {}
/** The catalog or graph changed since the cursor was issued; mapped to 409 (restart paging). */
export class AssetMapRevisionError extends Error {}

interface CatalogRow {
  id: string;
  kind: string;
  namespace: string;
  canonicalKey: string;
}

function toRef(row: CatalogRow): AssetMapAssetRef {
  return { assetId: row.id, kind: row.kind as AssetMapKind, namespace: row.namespace, canonicalKey: row.canonicalKey };
}

function encodeCursor(revision: string, lastId: string): string {
  return Buffer.from(JSON.stringify({ r: revision, k: lastId }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string, revision: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new AssetMapInputError('cursor is malformed');
  }
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { r?: unknown }).r !== 'string' || typeof (parsed as { k?: unknown }).k !== 'string') {
    throw new AssetMapInputError('cursor is malformed');
  }
  const { r, k } = parsed as { r: string; k: string };
  if (r !== revision) throw new AssetMapRevisionError('the asset catalog changed; restart paging from the first page');
  return k;
}

const NEIGHBOR_STATEMENT = [
  'MATCH (c) WHERE c.engagement = $engagement AND c.asset_id = $assetId',
  'WITH c LIMIT 1',
  'MATCH (c)-[r]-(m) WHERE m.engagement = $engagement',
  'RETURN elementId(r) AS rid, elementId(startNode(r)) AS src, elementId(endNode(r)) AS dst, type(r) AS type,',
  'elementId(m) AS mid, labels(m) AS mLabels, m.asset_id AS mAsset, coalesce(m.asset_canonical, m.label, m.hostname, m.ip, \'\') AS mLabel,',
  'elementId(c) AS cid, labels(c) AS cLabels, coalesce(c.asset_canonical, c.label, c.hostname, c.ip, \'\') AS cLabel',
  'LIMIT $limit',
].join(' ');

const GRAPH_REVISION_STATEMENT = 'MATCH (n) WHERE n.engagement = $engagement RETURN count(n) AS nodes, max(n.lastupdated) AS updated';

export class AssetMapService {
  public constructor(private readonly db: PrismaClient, private readonly config: GraphConfig) {}

  private async access(actorId: string, engagementId: string): Promise<string> {
    await requireEngagementAccess({ db: this.db, actorId, multiUser: true }, engagementId, 'viewer');
    const project = await this.db.engagement.findUnique({ where: { id: engagementId }, select: { workspaceSlug: true } });
    if (!project) throw new ProjectNotFoundError();
    return project.workspaceSlug;
  }

  private async catalogRevision(engagementId: string): Promise<string> {
    const agg = await this.db.assetIdentity.aggregate({ where: { engagementId }, _count: { _all: true }, _max: { createdAt: true } });
    return `c${agg._count._all}:${agg._max.createdAt?.toISOString() ?? 'none'}`;
  }

  public async overview(actorId: string, engagementId: string): Promise<AssetMapOverview> {
    await this.access(actorId, engagementId);
    const groups = await this.db.assetIdentity.groupBy({ by: ['kind'], where: { engagementId }, _count: { _all: true }, orderBy: { kind: 'asc' } });
    const total = groups.reduce((sum, group) => sum + group._count._all, 0);
    const revision = await this.catalogRevision(engagementId);
    return {
      engagementId,
      groups: groups.map(group => ({ kind: group.kind as AssetMapKind, total: group._count._all })),
      completeness: { loaded: total, total, hasMore: false, truncated: false, source: { catalog: 'ok', graph: 'not_queried' }, revision },
    };
  }

  public async members(actorId: string, engagementId: string, kind: AssetMapKind, cursor: string | null, limit: number = ASSET_MAP_LIMITS.membersDefault): Promise<AssetMapMembersPage> {
    await this.access(actorId, engagementId);
    const revision = await this.catalogRevision(engagementId);
    const after = cursor === null ? null : decodeCursor(cursor, revision);
    const rows = await this.db.assetIdentity.findMany({
      where: { engagementId, kind, ...(after === null ? {} : { id: { gt: after } }) },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const total = await this.db.assetIdentity.count({ where: { engagementId, kind } });
    const last = page[page.length - 1];
    return {
      engagementId,
      kind,
      items: page.map(toRef),
      nextCursor: hasMore && last !== undefined ? encodeCursor(revision, last.id) : null,
      completeness: { loaded: page.length, total, hasMore, truncated: false, source: { catalog: 'ok', graph: 'not_queried' }, revision },
    };
  }

  public async search(actorId: string, engagementId: string, query: string, limit: number = ASSET_MAP_LIMITS.searchDefault): Promise<AssetMapSearchResult> {
    await this.access(actorId, engagementId);
    const q = query.trim();
    if (q.length < 2 || q.length > 200) throw new AssetMapInputError('query must be 2 to 200 characters');
    const where = { engagementId, canonicalKey: { contains: q, mode: 'insensitive' as const } };
    const rows = await this.db.assetIdentity.findMany({ where, orderBy: { canonicalKey: 'asc' }, take: limit + 1 });
    const total = await this.db.assetIdentity.count({ where });
    const revision = await this.catalogRevision(engagementId);
    const page = rows.slice(0, limit);
    return {
      engagementId,
      query: q,
      items: page.map(toRef),
      completeness: { loaded: page.length, total, hasMore: rows.length > limit, truncated: false, source: { catalog: 'ok', graph: 'not_queried' }, revision },
    };
  }

  public async neighborhood(actorId: string, engagementId: string, assetId: string): Promise<AssetMapNeighborhood> {
    const slug = await this.access(actorId, engagementId);
    if (!ASSET_ID.test(assetId)) throw new AssetMapInputError('assetId is malformed');
    const known = await this.db.assetIdentity.findFirst({ where: { engagementId, id: assetId }, select: { id: true } });
    if (known === null) throw new AssetMapNotFoundError('asset not found in this engagement');

    const [revisionRow] = await neo4jQuery(this.config, GRAPH_REVISION_STATEMENT, { engagement: slug });
    const revision = `g${String(revisionRow?.[0] ?? 0)}:${String(revisionRow?.[1] ?? 'none')}`;
    const rows = await neo4jQuery(this.config, NEIGHBOR_STATEMENT, { engagement: slug, assetId, limit: ASSET_MAP_LIMITS.neighborEdges + 1 });

    const nodes = new Map<string, AssetMapNeighborhood['nodes'][number]>();
    const edges: AssetMapNeighborhood['edges'] = [];
    for (const row of rows) {
      const [rid, src, dst, type, mid, mLabels, mAsset, mLabel, cid, cLabels, cLabel] = row as [string, string, string, string, string, string[], string | null, string, string, string[], string];
      nodes.set(cid, { id: cid, assetId, labels: (cLabels ?? []).slice(0, 8), label: String(cLabel) });
      nodes.set(mid, { id: mid, assetId: typeof mAsset === 'string' ? mAsset : null, labels: (mLabels ?? []).slice(0, 8), label: String(mLabel) });
      edges.push({ id: rid, source: src, target: dst, type: String(type).slice(0, 100) });
    }

    // The store already bounded the traversal; this trims only when the response would exceed its byte budget.
    const hasMore = edges.length > ASSET_MAP_LIMITS.neighborEdges;
    const bounded = edges.slice(0, ASSET_MAP_LIMITS.neighborEdges);
    const result: AssetMapNeighborhood = {
      engagementId,
      assetId,
      nodes: [...nodes.values()],
      edges: bounded,
      completeness: { loaded: bounded.length, total: null, hasMore, truncated: hasMore, source: { catalog: 'ok', graph: 'ok' }, revision },
    };
    return withinBudget(result);
  }
}

/**
 * Drops trailing edges, and the nodes only they reached, until the serialized
 * response fits the neighborhood byte budget. The center node always stays.
 */
function withinBudget(result: AssetMapNeighborhood): AssetMapNeighborhood {
  const size = (value: AssetMapNeighborhood) => Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (size(result) <= ASSET_MAP_LIMITS.neighborhoodBytes) return result;
  let edges = result.edges;
  let nodes = result.nodes;
  while (edges.length > 0) {
    edges = edges.slice(0, -1);
    const referenced = new Set(edges.flatMap(edge => [edge.source, edge.target]));
    nodes = result.nodes.filter(node => node.assetId === result.assetId || referenced.has(node.id));
    if (size({ ...result, nodes, edges }) <= ASSET_MAP_LIMITS.neighborhoodBytes) break;
  }
  const completeness: AssetMapCompleteness = { ...result.completeness, loaded: edges.length, hasMore: true, truncated: true };
  return { ...result, nodes, edges, completeness };
}
