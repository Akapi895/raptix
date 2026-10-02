import type { AssetSummaryView, AssetsView, GraphView } from '@raptix/web-contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectNotFoundError } from './projects-service.js';

/**
 * W13 engagement-scoped attack-chain graph, served over Neo4j's HTTP
 * transaction endpoint (no driver dependency). The legacy web API leaked raw
 * node properties to the browser; this service applies a public property
 * whitelist and redacts credential-like keys/values BEFORE the response, and
 * bounds every payload. Neo4j failure surfaces as an unavailable state while a
 * scoped empty graph stays a truthful 200-empty.
 */

export interface GraphConfig {
  readonly httpUri: string;
  readonly user: string;
  readonly password: string;
}

export class GraphUnavailableError extends Error {}

const MAX_NODES = 400;
const MAX_EDGES = 1200;
const MAX_ASSETS = 300;
const MAX_PROPS = 24;
const MAX_VALUE_CHARS = 300;
const REQUEST_TIMEOUT_MS = 8000;

/** Keys allowed into a public projection. Everything else is dropped. */
const PROPERTY_ALLOWLIST = new Set([
  'hostname', 'host', 'ip', 'ipv4', 'ipv6', 'name', 'title', 'label', 'os', 'os_family',
  'version', 'product', 'cpe', 'mac', 'domain', 'netbios', 'url', 'uri', 'path', 'port',
  'ports', 'service', 'services', 'protocol', 'banner', 'technique', 'technique_id',
  'status', 'state', 'severity', 'confidence', 'summary', 'description', 'notes',
  'evidence', 'finding_id', 'finding_ids', 'cve_id', 'cve_ids', 'cwe_id', 'mitre_id',
  'username', 'user', 'email', 'asset_tag', 'source', 'origin', 'created_at',
  'updated_at', 'discovered_at', 'first_seen', 'last_seen', 'engagement',
]);
/** Credential-like keys are redacted (never forwarded) even when similar keys are allowed. */
const CREDENTIAL_KEY_RE = /pass(word)?|secret|token|api[_-]?key|credential|ntlm|hash|cookie|authorization|bearer|private[_-]?key|session/i;
const CREDENTIAL_VALUE_RE = /[A-Za-z0-9+/]{48,}={0,2}|eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
const REDACTED = '[REDACTED]';

function publicPropertyValue(key: string, value: unknown): string | number | boolean | null {
  if (CREDENTIAL_KEY_RE.test(key)) return REDACTED;
  if (typeof value === 'string') {
    const sliced = value.slice(0, MAX_VALUE_CHARS);
    return CREDENTIAL_VALUE_RE.test(sliced) ? REDACTED : sliced;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  return null;
}

function publicProperties(properties: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties).slice(0, MAX_PROPS)) {
    const lowered = key.toLowerCase();
    if (!PROPERTY_ALLOWLIST.has(lowered)) continue;
    out[lowered] = publicPropertyValue(lowered, value);
  }
  return out;
}

interface RawNode { id: string; labels: string[]; properties: Record<string, unknown> }
interface RawEdge { id: string; source: string; target: string; type: string; properties: Record<string, unknown> }

interface ScopedRawGraph { nodes: RawNode[]; edges: RawEdge[] }

async function runScopedQuery(config: GraphConfig, engagementName: string): Promise<ScopedRawGraph> {
  const statement = [
    'MATCH (n) WHERE n.engagement = $engagement',
    'OPTIONAL MATCH (n)-[r]->(m) WHERE m.engagement = $engagement',
    'RETURN collect(DISTINCT {id: elementId(n), labels: labels(n), properties: properties(n)}) AS nodes,',
    'collect(DISTINCT CASE WHEN r IS NOT NULL THEN {id: elementId(r), source: elementId(n), target: elementId(m), type: type(r), properties: properties(r)} END) AS edges',
  ].join(' ');
  let response: Response;
  try {
    response = await fetch(`${config.httpUri.replace(/\/$/, '')}/db/neo4j/tx/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}` },
      body: JSON.stringify({ statements: [{ statement, parameters: { engagement: engagementName } }] }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new GraphUnavailableError(`Graph store unreachable: ${cause instanceof Error ? cause.message : 'unknown error'}`);
  }
  if (response.status === 401 || response.status === 403) throw new GraphUnavailableError('Graph store rejected authentication');
  if (!response.ok) throw new GraphUnavailableError(`Graph store responded ${response.status}`);
  const body = (await response.json().catch(() => null)) as { results?: Array<{ data?: Array<{ row?: unknown[] }> }> } | null;
  const row = body?.results?.[0]?.data?.[0]?.row;
  if (!Array.isArray(row) || row.length < 2) throw new GraphUnavailableError('Graph store returned an unreadable result');
  return { nodes: (row[0] ?? []) as RawNode[], edges: ((row[1] ?? []) as Array<RawEdge | null>).filter(edge => edge !== null) as RawEdge[] };
}

const HOSTNAME_KEYS = ['hostname', 'host', 'netbios', 'domain'] as const;
const LABEL_KEYS = ['hostname', 'host', 'ip', 'name', 'title', 'username', 'url'] as const;

function classifyAssetType(labels: string[], properties: Record<string, string | number | boolean | null>): AssetSummaryView['type'] {
  const joined = labels.join(' ').toLowerCase();
  const url = properties.url ?? properties.uri;
  if (/identity|user|account|credential/.test(joined) || properties.username !== undefined) return 'Identity';
  if (/mobile|apk/.test(joined)) return 'Mobile';
  if (/api/.test(joined)) return 'API';
  if (/web|http|endpoint|url/.test(joined) || typeof url === 'string') return 'Web';
  return 'Host';
}

export function toAssetSummaries(view: Omit<GraphView, 'engagementId' | 'truncated' | 'source'>): AssetSummaryView[] {
  const assets = new Map<string, AssetSummaryView>();
  for (const node of view.nodes) {
    const properties = node.properties;
    const stringProp = (keys: readonly string[]): string | undefined => {
      for (const key of keys) {
        const value = properties[key];
        if (typeof value === 'string' && value.length > 0) return value;
      }
      return undefined;
    };
    const hostname = stringProp(HOSTNAME_KEYS);
    const ip = stringProp(['ip', 'ipv4', 'ipv6']);
    const url = stringProp(['url', 'uri']);
    const os = stringProp(['os', 'os_family']);
    const ports = typeof properties.ports === 'string' && properties.ports.length > 0 ? [properties.ports] : typeof properties.port === 'number' ? [String(properties.port)] : [];
    const rawServices = properties.services;
    const services = Array.isArray(rawServices) ? [] : typeof rawServices === 'string' && rawServices.length > 0 ? [rawServices] : typeof properties.service === 'string' && properties.service.length > 0 ? [properties.service] : [];
    const relatedFindingIds = [properties.finding_id, properties.finding_ids, properties.cve_id, properties.cve_ids].filter((value): value is string => typeof value === 'string' && value.length > 0).flatMap(value => value.split(/[,\s]+/)).filter(Boolean).slice(0, 20);
    const label = stringProp(LABEL_KEYS) ?? node.labels[0] ?? node.id;
    const type = classifyAssetType(node.labels, properties);
    const key = `${type}|${hostname ?? ''}|${ip ?? ''}|${url ?? ''}`;
    const existing = assets.get(key);
    if (existing) {
      const merged = new Set([...existing.ports, ...ports]);
      existing.ports = [...merged].slice(0, 50);
      const mergedFindings = new Set([...existing.relatedFindingIds, ...relatedFindingIds]);
      existing.relatedFindingIds = [...mergedFindings].slice(0, 20);
      continue;
    }
    assets.set(key, {
      id: node.id, type, label: String(label).slice(0, 200),
      ...(hostname !== undefined ? { hostname } : {}),
      ...(ip !== undefined ? { ip } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(os !== undefined ? { os } : {}),
      ports, services, relatedFindingIds, source: 'graph',
    });
    if (assets.size >= MAX_ASSETS) break;
  }
  return [...assets.values()];
}

export class GraphService {
  public constructor(private readonly db: PrismaClient, private readonly config: GraphConfig) {}

  private async engagementName(userId: string, engagementId: string): Promise<string> {
    const project = await this.db.engagement.findFirst({ where: { id: engagementId, userId } });
    if (!project) throw new ProjectNotFoundError();
    return project.name;
  }

  public async graph(userId: string, engagementId: string): Promise<GraphView> {
    const engagementName = await this.engagementName(userId, engagementId);
    const raw = await runScopedQuery(this.config, engagementName);
    const truncatedNodes = raw.nodes.length > MAX_NODES;
    const nodes = raw.nodes.slice(0, MAX_NODES).map(node => ({ id: node.id, labels: (node.labels ?? []).slice(0, 8), properties: publicProperties(node.properties ?? {}) }));
    const nodeIds = new Set(nodes.map(node => node.id));
    const seenEdges = new Set<string>();
    const edges: GraphView['edges'] = [];
    let boundedEdges = 0;
    for (const edge of raw.edges) {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
      if (seenEdges.has(edge.id)) continue;
      seenEdges.add(edge.id);
      boundedEdges += 1;
      if (edges.length < MAX_EDGES) {
        edges.push({ id: edge.id, source: edge.source, target: edge.target, type: String(edge.type).slice(0, 100), properties: publicProperties(edge.properties ?? {}) });
      }
    }
    return {
      engagementId,
      nodes,
      edges,
      truncated: truncatedNodes || boundedEdges > MAX_EDGES,
      source: 'graph',
    };
  }

  public async assets(userId: string, engagementId: string): Promise<AssetsView> {
    const view = await this.graph(userId, engagementId);
    const assets = toAssetSummaries(view);
    return { engagementId, assets, truncated: view.truncated, source: 'graph' };
  }
}
