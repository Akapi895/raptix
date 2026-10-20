import type { AssetMapAssetRef, AssetMapCompleteness, AssetMapDetail, AssetMapEvidenceRef, AssetMapKind, AssetMapMembersPage, AssetMapNeighborhood, AssetMapNeighborNode, AssetMapOverview, AssetMapSearchResult } from '@raptix/web-contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import { requireEngagementAccess } from '../auth/membership-policy.js';
import { neo4jQuery, type GraphConfig } from './graph-service.js';
import { ProjectNotFoundError } from './projects-service.js';

/**
 * Plan phase 3–4 read models for large graphs. Every read is bounded in the store
 * (SKIP/LIMIT inside the query) and then by a byte budget. Responses report
 * total/loaded/hasMore/truncated, per-source state and a revision. Paging cursors
 * carry the revision they were issued under; when it changes, paging restarts with
 * an explicit error instead of silently skipping or repeating rows.
 *
 * Graph revisions reuse the runtime's KG revision (the same expression as
 * KGStore.revision), not a Web-side counter.
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
  detailBytes: 512 * 1024,
  evidenceMax: 20,
} as const;

const ASSET_ID = /^asset_[0-9a-f]{32}$/;
const REDACTED = 'REDACTED';
const SENSITIVE_NAME = /pass|pwd|secret|token|key|auth|session|sid|cookie|sig|credential|access/i;

/** A caller-supplied value failed validation; mapped to 400. */
export class AssetMapInputError extends Error {}
/** The asset does not belong to this engagement; mapped to 404. */
export class AssetMapNotFoundError extends Error {}
/** The catalog or graph changed since the cursor was issued; mapped to 409 (restart paging). */
export class AssetMapRevisionError extends Error {}

/**
 * Removes credentials and fragments and masks sensitive query values. Stored endpoint URLs
 * are already redacted at ingest; this covers observations written before that change.
 */
export function redactUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return '[unparseable url]';
  }
  parsed.username = '';
  parsed.password = '';
  parsed.hash = '';
  const pairs = [...parsed.searchParams.entries()].map(([name, value]) => [name, SENSITIVE_NAME.test(name) ? REDACTED : value] as const);
  parsed.search = '';
  for (const [name, value] of pairs) parsed.searchParams.append(name, value);
  return parsed.toString();
}

interface CatalogRow {
  id: string;
  kind: string;
  namespace: string;
  canonicalKey: string;
}

function toRef(row: CatalogRow): AssetMapAssetRef {
  return { assetId: row.id, kind: row.kind as AssetMapKind, namespace: row.namespace, canonicalKey: row.canonicalKey };
}

function encodeCursor(revision: string, offset: number): string {
  return Buffer.from(JSON.stringify({ r: revision, k: String(offset) }), 'utf8').toString('base64url');
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
  if (r !== revision) throw new AssetMapRevisionError('the graph or catalog changed; restart paging from the first page');
  return k;
}

function pageOffset(cursor: string | null, revision: string): number {
  if (cursor === null) return 0;
  const offset = Number(decodeCursor(cursor, revision));
  if (!Number.isInteger(offset) || offset < 0) throw new AssetMapInputError('cursor is malformed');
  return offset;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function isoOrNull(epochSeconds: unknown): string | null {
  return typeof epochSeconds === 'number' && epochSeconds > 0 ? new Date(epochSeconds * 1000).toISOString() : null;
}

/** Keeps one oversized label from consuming the byte budget. */
function clip(value: string, max = 1024): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Largest prefix of `items` whose serialized form, with `wrap`, fits the byte budget. */
export function fitPrefix<T>(items: T[], limit: number, wrap: (kept: T[]) => unknown): T[] {
  const size = (kept: T[]) => Buffer.byteLength(JSON.stringify(wrap(kept)), 'utf8');
  let kept = items;
  while (kept.length > 0 && size(kept) > limit) kept = kept.slice(0, -1);
  return kept;
}

/**
 * KG revision for one engagement, computed exactly as KGStore.revision (raptix runtime):
 * the per-engagement write counter plus node and edge timestamps.
 */
const KG_REVISION_STATEMENT = [
  'CALL () { MATCH (v:KGRevision {scope: $engagement}) RETURN coalesce(max(v.counter), 0) AS seq }',
  'CALL () { MATCH (n) WHERE n.engagement = $engagement RETURN coalesce(max(n.lastupdated), 0) AS node_rev }',
  'CALL () { MATCH (src)-[r]->(dst) WHERE src.engagement = $engagement AND dst.engagement = $engagement AND r.engagement = $engagement RETURN coalesce(max(r.lastupdated), 0) AS edge_rev }',
  'RETURN seq, node_rev, edge_rev',
].join(' ');

const CENTER_STATEMENT = [
  'MATCH (c) WHERE c.engagement = $engagement AND c.asset_id = $assetId',
  "RETURN elementId(c) AS id, labels(c) AS labels, coalesce(c.asset_canonical, c.label, c.hostname, c.ip, '') AS label",
  'ORDER BY elementId(c) LIMIT 20',
].join(' ');

/** Every edge of every node sharing the asset identity, paged over a stable order. */
const NEIGHBOR_STATEMENT = [
  'MATCH (c) WHERE c.engagement = $engagement AND c.asset_id = $assetId',
  'MATCH (c)-[r]-(m) WHERE m.engagement = $engagement AND r.engagement = $engagement',
  'WITH r, m, startNode(r) AS sn, endNode(r) AS en',
  'ORDER BY elementId(r)',
  'SKIP $skip LIMIT $limit',
  "RETURN elementId(r) AS rid, elementId(sn) AS src, elementId(en) AS dst, type(r) AS type,",
  "elementId(m) AS mid, labels(m) AS mLabels, m.asset_id AS mAsset, coalesce(m.asset_canonical, m.label, m.hostname, m.ip, '') AS mLabel",
].join(' ');

const PROVENANCE_STATEMENT = "MATCH (n) WHERE n.engagement = $engagement AND n.asset_id = $assetId RETURN coalesce(n.source, 'unknown') AS source, count(n) AS count ORDER BY source LIMIT 50";
const EVIDENCE_STATEMENT = "MATCH (n) WHERE n.engagement = $engagement AND n.asset_id = $assetId RETURN coalesce(n.source, 'unknown') AS source, n.source_episode_id AS episode, n.lastupdated AS observed ORDER BY observed DESC LIMIT 20";

const SERVICE_COUNT_STATEMENT = 'MATCH (h) WHERE h.engagement = $engagement AND h.asset_id = $assetId OPTIONAL MATCH (h)-[:HOSTS]->(s) WHERE s.engagement = $engagement RETURN count(s) AS count';
const SERVICE_PAGE_STATEMENT = [
  'MATCH (h) WHERE h.engagement = $engagement AND h.asset_id = $assetId',
  'OPTIONAL MATCH (h)-[:HOSTS]->(s) WHERE s.engagement = $engagement',
  'RETURN elementId(s) AS id, s.port AS port, s.protocol AS protocol, s.service AS service, s.product AS product, s.version AS version, s.source AS source, s.source_episode_id AS episode',
  'ORDER BY s.port SKIP $skip LIMIT $limit',
].join(' ');

const ENDPOINT_COUNT_STATEMENT = 'MATCH (e) WHERE e.engagement = $engagement AND e.origin_asset_id = $assetId AND e.method IS NOT NULL RETURN count(e) AS count';
const ENDPOINT_PAGE_STATEMENT = [
  'MATCH (e) WHERE e.engagement = $engagement AND e.origin_asset_id = $assetId AND e.method IS NOT NULL',
  'OPTIONAL MATCH (e)-[:HAS]->(p) WHERE p.engagement = $engagement AND p.name IS NOT NULL',
  'WITH e, collect(p.name) AS parameters',
  'RETURN elementId(e) AS id, e.method AS method, e.path AS path, e.url AS url, e.status_code AS status, e.source AS source, e.source_episode_id AS episode, parameters',
  'ORDER BY e.path, e.method SKIP $skip LIMIT $limit',
].join(' ');

export class AssetMapService {
  public constructor(private readonly db: PrismaClient, private readonly config: GraphConfig) {}

  private async access(actorId: string, engagementId: string, minRole: 'viewer' | 'operator' = 'viewer'): Promise<string> {
    await requireEngagementAccess({ db: this.db, actorId, multiUser: true }, engagementId, minRole);
    const project = await this.db.engagement.findUnique({ where: { id: engagementId }, select: { workspaceSlug: true } });
    if (!project) throw new ProjectNotFoundError();
    return project.workspaceSlug;
  }

  /** Catalog revision: the catalog is a Postgres table, so its own row count and newest row describe it. */
  private async catalogRevision(engagementId: string): Promise<string> {
    const agg = await this.db.assetIdentity.aggregate({ where: { engagementId }, _count: { _all: true }, _max: { createdAt: true } });
    return `c${agg._count._all}:${agg._max.createdAt?.toISOString() ?? 'none'}`;
  }

  /** KG revision, identical to KGStore.revision so the runtime and the Web agree on one token. */
  private async graphRevision(slug: string): Promise<string> {
    const [row] = await neo4jQuery(this.config, KG_REVISION_STATEMENT, { engagement: slug });
    const seq = Number(row?.[0] ?? 0);
    const node = Number(row?.[1] ?? 0);
    const edge = Number(row?.[2] ?? 0);
    if (!seq && !edge) return `rev-${slug}-${node}`;
    return `rev-${slug}-${seq}:${node}:${edge}`;
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
      nextCursor: hasMore && last !== undefined ? encodeMembersCursor(revision, last.id) : null,
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

  /**
   * Every graph node that carries the asset identity, with its incident edges paged in a stable
   * order. A cursor resumes after the last edge that fit the byte budget.
   */
  public async neighborhood(actorId: string, engagementId: string, assetId: string, cursor: string | null = null): Promise<AssetMapNeighborhood> {
    const slug = await this.access(actorId, engagementId);
    if (!ASSET_ID.test(assetId)) throw new AssetMapInputError('assetId is malformed');
    const known = await this.db.assetIdentity.findFirst({ where: { engagementId, id: assetId }, select: { id: true } });
    if (known === null) throw new AssetMapNotFoundError('asset not found in this engagement');

    const revision = await this.graphRevision(slug);
    const skip = pageOffset(cursor, revision);
    const centerRows = await neo4jQuery(this.config, CENTER_STATEMENT, { engagement: slug, assetId });
    const centers: AssetMapNeighborNode[] = centerRows.map(row => neighborNode(row[0], row[1], row[2], assetId));

    const rows = await neo4jQuery(this.config, NEIGHBOR_STATEMENT, { engagement: slug, assetId, skip, limit: ASSET_MAP_LIMITS.neighborEdges + 1 });
    const hasMoreEdges = rows.length > ASSET_MAP_LIMITS.neighborEdges;
    const fetched = rows.slice(0, ASSET_MAP_LIMITS.neighborEdges);
    const nodes = new Map<string, AssetMapNeighborNode>();
    const edges: AssetMapNeighborhood['edges'] = [];
    for (const row of fetched) {
      const [rid, src, dst, type, mid, mLabels, mAsset, mLabel] = row as [string, string, string, string, string, string[], string | null, string];
      nodes.set(mid, { id: mid, assetId: stringOrNull(mAsset), labels: (mLabels ?? []).slice(0, 8), label: clip(String(mLabel)) });
      edges.push({ id: rid, source: src, target: dst, type: clip(String(type), 100) });
    }
    // Edges are the unit of paging, so a byte-budget cut only drops trailing edges (and the nodes they alone reached).
    const kept = fitPrefix(edges, ASSET_MAP_LIMITS.neighborhoodBytes, list => ({ centers, nodes: [...nodes.values()], edges: list }));
    const keptNodeIds = new Set(kept.flatMap(edge => [edge.source, edge.target]));
    const keptNodes = [...nodes.values()].filter(node => keptNodeIds.has(node.id) || centers.some(center => center.id === node.id));
    const cutByBudget = kept.length < edges.length;
    const hasMore = hasMoreEdges || cutByBudget;
    return {
      engagementId,
      assetId,
      centers,
      nodes: keptNodes.filter(node => !centers.some(center => center.id === node.id)),
      edges: kept,
      nextCursor: hasMore ? encodeCursor(revision, skip + kept.length) : null,
      completeness: { loaded: kept.length, total: null, hasMore, truncated: cutByBudget, source: { catalog: 'ok', graph: 'ok' }, revision },
    };
  }

  /** Inspector plus typed domain detail for one asset; kinds without a view say so. */
  public async detail(actorId: string, engagementId: string, assetId: string, cursor: string | null, limit: number = ASSET_MAP_LIMITS.detailDefault): Promise<AssetMapDetail> {
    const slug = await this.access(actorId, engagementId);
    if (!ASSET_ID.test(assetId)) throw new AssetMapInputError('assetId is malformed');
    const row = await this.db.assetIdentity.findFirst({ where: { engagementId, id: assetId } });
    if (row === null) throw new AssetMapNotFoundError('asset not found in this engagement');
    const asset = toRef(row);
    const revision = await this.graphRevision(slug);
    const provenanceRows = await neo4jQuery(this.config, PROVENANCE_STATEMENT, { engagement: slug, assetId });
    const sources = provenanceRows.map(item => ({ source: String(item[0] ?? 'unknown'), count: Number(item[1] ?? 0) }));
    const evidenceRows = await neo4jQuery(this.config, EVIDENCE_STATEMENT, { engagement: slug, assetId });
    const evidence: AssetMapEvidenceRef[] = evidenceRows.map(item => ({ source: String(item[0] ?? 'unknown'), sourceEpisodeId: stringOrNull(item[1]), observedAt: isoOrNull(item[2]) }));
    const provenance = { sources, graphNodes: sources.reduce((sum, item) => sum + item.count, 0), evidence };
    const source = { catalog: 'ok' as const, graph: 'ok' as const };

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
        sourceEpisodeId: stringOrNull(item[7]),
      }));
      return pageDetail({ engagementId, asset, provenance, source }, revision, skip, limit, items.length > limit, Number(countRow?.[0] ?? 0), items.slice(0, limit), 'services');
    }

    if (asset.kind === 'web_origin') {
      const skip = pageOffset(cursor, revision);
      const [countRow] = await neo4jQuery(this.config, ENDPOINT_COUNT_STATEMENT, { engagement: slug, assetId });
      const rows = await neo4jQuery(this.config, ENDPOINT_PAGE_STATEMENT, { engagement: slug, assetId, skip, limit: limit + 1 });
      const items = rows.map(item => ({
        id: String(item[0]),
        method: String(item[1] ?? 'GET'),
        path: clip(String(item[2] ?? '/')),
        url: redactUrl(clip(String(item[3] ?? ''), 2048)),
        statusCode: numberOrNull(item[4]),
        source: stringOrNull(item[5]),
        sourceEpisodeId: stringOrNull(item[6]),
        parameters: Array.isArray(item[7]) ? item[7].filter((name): name is string => typeof name === 'string').slice(0, 20) : [],
      }));
      return pageDetail({ engagementId, asset, provenance, source }, revision, skip, limit, items.length > limit, Number(countRow?.[0] ?? 0), items.slice(0, limit), 'endpoints');
    }

    return {
      engagementId,
      asset,
      provenance,
      detail: { kind: 'unsupported', reason: `no typed detail view for ${asset.kind} yet` },
      nextCursor: null,
      completeness: { loaded: 0, total: null, hasMore: false, truncated: false, source, revision },
    };
  }
}

function neighborNode(id: unknown, labels: unknown, label: unknown, assetId: string): AssetMapNeighborNode {
  return { id: String(id), assetId, labels: Array.isArray(labels) ? labels.map(String).slice(0, 8) : [], label: clip(String(label ?? '')) };
}

/** Cursor for the members page: the last returned identity, bound to the catalog revision. */
function encodeMembersCursor(revision: string, lastId: string): string {
  return Buffer.from(JSON.stringify({ r: revision, k: lastId }), 'utf8').toString('base64url');
}

function pageDetail(
  base: { engagementId: string; asset: AssetMapAssetRef; provenance: AssetMapDetail['provenance']; source: AssetMapCompleteness['source'] },
  revision: string,
  skip: number,
  limit: number,
  hasMore: boolean,
  total: number,
  page: Array<AssetMapDetailItems>,
  kind: 'services' | 'endpoints',
): AssetMapDetail {
  const fitted = fitPrefix(page, ASSET_MAP_LIMITS.detailBytes, list => ({ kind, items: list }));
  const cutByBudget = fitted.length < page.length;
  const more = hasMore || cutByBudget;
  const detail = kind === 'services' ? { kind: 'services' as const, items: fitted as AssetMapServiceItemLike[] } : { kind: 'endpoints' as const, items: fitted as AssetMapEndpointItemLike[] };
  return {
    engagementId: base.engagementId,
    asset: base.asset,
    provenance: base.provenance,
    detail,
    nextCursor: more ? encodeCursor(revision, skip + fitted.length) : null,
    completeness: { loaded: fitted.length, total, hasMore: more, truncated: cutByBudget, source: base.source, revision },
  };
}

type AssetMapDetailItems = AssetMapServiceItemLike | AssetMapEndpointItemLike;
type AssetMapServiceItemLike = Extract<AssetMapDetail['detail'], { kind: 'services' }>['items'][number];
type AssetMapEndpointItemLike = Extract<AssetMapDetail['detail'], { kind: 'endpoints' }>['items'][number];
