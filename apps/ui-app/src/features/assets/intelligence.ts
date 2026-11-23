import type { Vulnerability } from '../../api/types/vulnerability';
import { isIPv4, isIPv6, targetLabel, type Asset } from './model';

const DAY = 86_400_000;
/** Groups assets that look like the same real target recorded twice (same project + host identity +
 *  port + protocol, but a different record id) -- evidence for the user to review and merge, never
 *  auto-merged or hidden. A group with no identity at all (no host/ip/domain) is too ambiguous to flag. */
function findDuplicateGroups(assets: Asset[]): { groups: number; assets: number } {
  const groups = new Map<string, Asset[]>();
  for (const a of assets) {
    const identity = (a.host || a.domain || a.ip || '').toLowerCase().trim();
    if (!identity) continue;
    const key = [a.project_id || '', identity, a.port || 0, (a.protocol || '').toLowerCase()].join('|');
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
  }
  const duplicated = [...groups.values()].filter(members => members.length > 1);
  return { groups: duplicated.length, assets: duplicated.reduce((sum, members) => sum + members.length, 0) };
}
export function summarizeAssets(assets: Asset[], now = Date.now()) {
  // A row can record several names or addresses ("a.test, b.test"), so count each one.
  const distinct = (key: 'ip' | 'domain') => new Set(assets.flatMap(a => (a[key] || '').split(/[\s,;|]+/)).map(value => value.toLowerCase()).filter(Boolean)).size;
  const scanned = assets.filter(a => a.last_scan_at).length;
  const recent = assets.filter(a => { const date = Date.parse(a.first_seen_at); return date >= now - 7 * DAY && date <= now; });
  const protocols = new Map<string, number>();
  const endpoints = new Set<string>();
  for (const a of assets) {
    if (a.port > 0) endpoints.add(`${a.project_id || ''}|${a.ip || a.domain || a.host}|${a.port}|${a.protocol}`);
    if (a.protocol) protocols.set(a.protocol, (protocols.get(a.protocol) || 0) + 1);
  }
  return { total: assets.length, ips: distinct('ip'), domains: distinct('domain'), services: endpoints.size, scanned,
    coverage: assets.length ? Math.round(scanned / assets.length * 100) : 0,
    highRisk: assets.filter(a => ['critical', 'high'].includes(a.risk_level)).length,
    never: assets.length - scanned,
    stale: assets.filter(a => a.last_scan_at && Date.parse(a.last_scan_at) < now - 30 * DAY).length,
    recent: recent.length, discoveries: recent.sort((a, b) => Date.parse(b.first_seen_at) - Date.parse(a.first_seen_at)).slice(0, 4),
    protocols: [...protocols].sort((a, b) => b[1] - a[1]),
    duplicates: findDuplicateGroups(assets),
  };
}

export type NodeKind = 'domain' | 'ip' | 'port' | 'service' | 'vulnerability' | 'asset';
export interface AssetNode { id: string; label: string; kind: NodeKind; assetIds: string[]; findingId?: string; severity?: string }
export interface AssetEdge { id: string; source: string; target: string; label: string; assetIds: string[] }
export interface AssetGraph { nodes: AssetNode[]; edges: AssetEdge[] }

/** An endpoint identity comes only from an explicit host/target, never DNS guesses. */
function endpoint(raw: string): string {
  try {
    const url = new URL(raw);
    if (!url.hostname || url.username || url.password) return '';
    return `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}:${url.port || ({ 'https:': '443', 'http:': '80' }[url.protocol] || '')}`;
  } catch { return raw.trim().toLowerCase().replace(/\/$/, ''); }
}

const DEFAULT_PORT: Record<string, number> = { 'http:': 80, 'https:': 443 };
/** scheme://, optional bracketed IPv6 or name, optional :port. A regex rather than the URL parser: browsers
 *  disagree on non-web schemes such as tcp:// or x://, and the URL parser turned those into empty hosts. */
const TARGET_PATTERN = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\[[^\]]+\]|[^/:?#\s]+)(?::(\d{1,5}))?/;
/** Host and port a finding target names. Targets are stored as "<kind>:<url or host:port>" (e.g. "http:https://x/y",
 *  "net:tcp://10.0.0.1:3306"); a bare host is accepted too. Port is 0 when the target names none. */
export function targetHost(raw: string): { host: string; port: number } | null {
  const value = raw.trim().toLowerCase().replace(/^(?:net|http|https):(?!\/\/)/, '');
  const match = TARGET_PATTERN.exec(value);
  if (!match) return null;
  const [, scheme, name, explicitPort] = match;
  const host = (name ?? '').replace(/^\[|\]$/g, '');
  if (!host) return null;
  return { host, port: Number(explicitPort) || (scheme ? DEFAULT_PORT[`${scheme}:`] ?? 0 : 0) };
}
/** Hostnames an asset records, from its host (which may be a URL or a comma list), ip and domain. */
function assetHosts(asset: Asset): string[] {
  const names = [asset.host, asset.ip, asset.domain].flatMap(value => (value || '').split(/[\s,;|]+/)).map(value => targetHost(value)?.host);
  return [...new Set(names.filter((name): name is string => !!name))];
}

export function buildAssetGraph(assets: Asset[], findings: Vulnerability[] = []): AssetGraph {
  const nodes = new Map<string, AssetNode>(), edges = new Map<string, AssetEdge>();
  const node = (id: string, label: string, kind: NodeKind, asset: Asset) => {
    const existing = nodes.get(id);
    if (existing) { if (!existing.assetIds.includes(asset.id)) existing.assetIds.push(asset.id); }
    else nodes.set(id, { id, label, kind, assetIds: [asset.id] });
    return id;
  };
  const edge = (source: string, target: string, label: string, asset: Asset) => {
    if (source === target) return;
    const id = JSON.stringify([source, target, label]), existing = edges.get(id);
    if (existing) { if (!existing.assetIds.includes(asset.id)) existing.assetIds.push(asset.id); }
    else edges.set(id, { id, source, target, label, assetIds: [asset.id] });
  };
  for (const asset of assets) {
    const scope = asset.project_id || '', id = (kind: string, value: string) => JSON.stringify([scope, kind, value]);
    const domain = asset.domain ? node(id('domain', asset.domain.toLowerCase()), asset.domain, 'domain', asset) : '';
    const ip = asset.ip ? node(id('ip', asset.ip.toLowerCase()), asset.ip, 'ip', asset) : '';
    // Co-occurrence is recorded evidence; it does not assert a live DNS resolution.
    if (domain && ip) edge(domain, ip, 'recorded address', asset);
    let root = ip || domain;
    if (!root) {
      let hostname = '';
      try { hostname = new URL(asset.host).hostname.replace(/^\[|\]$/g, ''); } catch { /* opaque target */ }
      root = hostname ? node(id('host', hostname), hostname, isIPv4(hostname) || isIPv6(hostname) ? 'ip' : 'domain', asset)
        : node(id('asset', asset.id), targetLabel(asset), 'asset', asset);
    }
    let serviceNode = root;
    if (asset.port > 0) {
      serviceNode = node(id('port', `${root}|${asset.port}|${asset.protocol}`), String(asset.port), 'port', asset);
      edge(root, serviceNode, 'recorded port', asset);
    }
    if (asset.protocol || asset.server) {
      const service = node(id('service', `${serviceNode}|${asset.protocol}|${asset.server}`), [asset.protocol, asset.server].filter(Boolean).join(' · '), 'service', asset);
      edge(serviceNode, service, 'identified service', asset); serviceNode = service;
    }
    const hosts = assetHosts(asset);
    for (const finding of findings) {
      if ((finding.project_id || '') !== scope || !finding.target?.trim()) continue;
      const target = endpoint(finding.target), named = targetHost(finding.target);
      const exactHost = asset.host && target === endpoint(asset.host);
      const structuredEndpoint = asset.protocol && asset.port > 0 && [asset.domain, asset.ip].filter(Boolean).some(value =>
        target === endpoint(`${asset.protocol}://${value.includes(':') ? `[${value}]` : value}:${asset.port}`));
      const address = [asset.domain, asset.ip].filter(Boolean).find(value => target === value.toLowerCase());
      const explicitPort = [asset.domain, asset.ip].filter(Boolean).some(value => target === `${value.toLowerCase()}:${asset.port}` || target === `[${value.toLowerCase()}]:${asset.port}`);
      // Same host. A manual endpoint row's port must agree with the finding's. A KG host row aggregates every
      // service on the host and records only its primary port, so its port cannot rule a finding out.
      const aggregateRow = asset.source === 'neo4j-kg';
      const hostMatch = !!named && hosts.includes(named.host) && (aggregateRow || !asset.port || !named.port || named.port === asset.port);
      if (!exactHost && !structuredEndpoint && !address && !explicitPort && !hostMatch) continue;
      const destination = address ? (address === asset.domain ? domain : ip) || root : serviceNode;
      const findingNode = node(id('vulnerability', finding.id), finding.title, 'vulnerability', asset);
      Object.assign(nodes.get(findingNode)!, { findingId: finding.id, severity: finding.severity });
      edge(destination, findingNode, 'finding target', asset);
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** Findings tied to one asset: recorded target matches, plus findings from its latest linked scan.
 *  The inventory table's Related findings count and the detail panel both use this rule. */
export function relatedFindings(asset: Asset, findings: Vulnerability[]): { findings: Vulnerability[]; matched: Set<string> } {
  const matched = new Set(buildAssetGraph([asset], findings).nodes.flatMap(node => node.findingId ? [node.findingId] : []));
  const related = findings.filter(f => matched.has(f.id) || ((f.project_id || '') === (asset.project_id || '') && (asset.last_scan_task_id ? f.task_id === asset.last_scan_task_id : !!asset.last_scan_conversation_id && f.conversation_id === asset.last_scan_conversation_id)));
  return { findings: related, matched };
}
