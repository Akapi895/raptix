import type { AssetMapAssetRef, AssetMapCompleteness, AssetMapDetail, AssetMapKind, AssetMapMembersPage, AssetMapNeighborhood, AssetMapOverview, AssetMapSearchResult } from '@raptix/web-contracts';
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
  detailDefault: 50,
  detailMax: 100,
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

    const revision = await this.graphRevision(slug);
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

  private async graphRevision(slug: string): Promise<string> {
    const [row] = await neo4jQuery(this.config, GRAPH_REVISION_STATEMENT, { engagement: slug });
    return `g${String(row?.[0] ?? 0)}:${String(row?.[1] ?? 'none')}`;
  }

  /** Inspector and typed domain detail for one asset; kinds without a view say so. */
  public async detail(actorId: string, engagementId: string, assetId: string, cursor: string | null, limit: number = ASSET_MAP_LIMITS.detailDefault): Promise<AssetMapDetail> {
    const slug = await this.access(actorId, engagementId);
    if (!ASSET_ID.test(assetId)) throw new AssetMapInputError('assetId is malformed');
    const row = await this.db.assetIdentity.findFirst({ where: { engagementId, id: assetId } });
    if (row === null) throw new AssetMapNotFoundError('asset not found in this engagement');
    const asset = toRef(row);
    const revision = await this.graphRevision(slug);
    const provenanceRows = await neo4jQuery(this.config, PROVENANCE_STATEMENT, { engagement: slug, assetId });
    const sources = provenanceRows.map(item => ({ source: String(item[0] ?? 'unknown'), count: Number(item[1] ?? 0) }));
    const provenance = { sources, graphNodes: sources.reduce((sum, item) => sum + item.count, 0) };
    const base = { engagementId, asset, provenance, source: { catalog: 'ok' as const, graph: 'ok' as const } };

    if (asset.kind === 'host' || asset.kind === 'dns_name') {
      const skip = pageOffset(cursor, revision);
      const [countRow] = await neo4jQuery(this.config, SERVICE_COUNT_STATEMENT, { engagement: slug, assetId });
      const rows = await neo4jQuery(this.config, SERVICE_PAGE_STATEMENT, { engagement: slug, assetId, skip, limit: limit + 1 });
      const items = rows.filter(item => item[0] !== null).map(item => ({
        id: String(item[0]),
        port: numberOrNull(item[1]),
        protocol: stringOrNull(item[2]),
        service: stringOrNull(item[3]),
        product: stringOrNull(item[4]),
        version: stringOrNull(item[5]),
        source: stringOrNull(item[6]),
      }));
      return pageDetail(base, revision, { kind: 'services', items: items.slice(0, limit) }, skip, limit, items.length > limit, Number(countRow?.[0] ?? 0));
    }

    if (asset.kind === 'web_origin') {
      const skip = pageOffset(cursor, revision);
      const [countRow] = await neo4jQuery(this.config, ENDPOINT_COUNT_STATEMENT, { engagement: slug, assetId });
      const rows = await neo4jQuery(this.config, ENDPOINT_PAGE_STATEMENT, { engagement: slug, assetId, skip, limit: limit + 1 });
      const items = rows.map(item => ({
        id: String(item[0]),
        method: String(item[1] ?? 'GET'),
        path: clip(String(item[2] ?? '/')),
        url: clip(String(item[3] ?? '')),
        statusCode: numberOrNull(item[4]),
        source: stringOrNull(item[5]),
        parameters: Array.isArray(item[6]) ? item[6].filter((name): name is string => typeof name === 'string').slice(0, 20) : [],
      }));
      return pageDetail(base, revision, { kind: 'endpoints', items: items.slice(0, limit) }, skip, limit, items.length > limit, Number(countRow?.[0] ?? 0));
    }

    return {
      engagementId,
      asset,
      provenance,
      detail: { kind: 'unsupported', reason: `no typed detail view for ${asset.kind} yet` },
      nextCursor: null,
      completeness: { loaded: 0, total: null, hasMore: false, truncated: false, source: base.source, revision },
    };
  }
}

function pageOffset(cursor: string | null, revision: string): number {
  if (cursor === null) return 0;
  const offset = Number(decodeCursor(cursor, revision));
  if (!Number.isInteger(offset) || offset < 0) throw new AssetMapInputError('cursor is malformed');
  return offset;
}

function pageDetail(
  base: { engagementId: string; asset: AssetMapAssetRef; provenance: AssetMapDetail['provenance']; source: AssetMapCompleteness['source'] },
  revision: string,
  detail: AssetMapDetail['detail'],
  skip: number,
  limit: number,
  hasMore: boolean,
  total: number,
): AssetMapDetail {
  const loaded = detail.kind === 'unsupported' ? 0 : detail.items.length;
  return {
    engagementId: base.engagementId,
    asset: base.asset,
    provenance: base.provenance,
    detail,
    nextCursor: hasMore ? encodeCursor(revision, String(skip + limit)) : null,
    completeness: { loaded, total, hasMore, truncated: false, source: base.source, revision },
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Keeps one oversized URL from consuming the detail byte budget. */
function clip(value: string): string {
  return value.length > 1024 ? `${value.slice(0, 1024)}…` : value;
}

const PROVENANCE_STATEMENT = "MATCH (n) WHERE n.engagement = $engagement AND n.asset_id = $assetId RETURN coalesce(n.source, 'unknown') AS source, count(n) AS count ORDER BY source LIMIT 50";

const SERVICE_COUNT_STATEMENT = 'MATCH (h) WHERE h.engagement = $engagement AND h.asset_id = $assetId OPTIONAL MATCH (h)-[:HOSTS]->(s) WHERE s.engagement = $engagement RETURN count(s) AS count';
const SERVICE_PAGE_STATEMENT = [
  'MATCH (h) WHERE h.engagement = $engagement AND h.asset_id = $assetId',
  'OPTIONAL MATCH (h)-[:HOSTS]->(s) WHERE s.engagement = $engagement',
  'RETURN elementId(s) AS id, s.port AS port, s.protocol AS protocol, s.service AS service, s.product AS product, s.version AS version, s.source AS source',
  'ORDER BY s.port SKIP $skip LIMIT $limit',
].join(' ');

const ENDPOINT_COUNT_STATEMENT = 'MATCH (e) WHERE e.engagement = $engagement AND e.origin_asset_id = $assetId AND e.method IS NOT NULL RETURN count(e) AS count';
const ENDPOINT_PAGE_STATEMENT = [
  'MATCH (e) WHERE e.engagement = $engagement AND e.origin_asset_id = $assetId AND e.method IS NOT NULL',
  'OPTIONAL MATCH (e)-[:HAS]->(p) WHERE p.engagement = $engagement AND p.name IS NOT NULL',
  'WITH e, collect(p.name) AS parameters',
  'RETURN elementId(e) AS id, e.method AS method, e.path AS path, e.url AS url, e.status_code AS status, e.source AS source, parameters',
  'ORDER BY e.path, e.method SKIP $skip LIMIT $limit',
].join(' ');

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
