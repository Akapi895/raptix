import type { Asset, AssetInput } from '../../api/types/asset';
import type { Translate } from './contracts';
export type { Asset, AssetInput };
export interface ProjectOption { id: string; name: string; status?: string }
export interface ImportResult { created: number; updated: number; skipped: number }
export interface ImportRow { rowNumber: number; values: Record<string, string>; asset: AssetInput | null; projectName?: string; error: string }
export interface SavedView { name: string; values: Record<string, string> }
export interface ScanLink { asset_id: string; conversation_id?: string; queue_id?: string; task_id?: string }
export interface TrendPoint { date: string; added?: number; inactive?: number; discovered?: number; high_risk?: number }
export interface AssetStats {
  total?: number; ips?: number; domains?: number; ports?: number; recent?: number;
  asset_trend?: TrendPoint[]; risk_trend?: TrendPoint[];
  coverage?: { rate?: number; recent_rate?: number; scanned?: number; scanned_30d?: number; never_scanned?: number; stale?: number };
  protocols?: { name: string; count: number }[];
}
export const FILTER_FIELDS = {
  'asset-search': 'q', 'asset-status-filter': 'status', 'asset-project-filter': 'project_id',
  'asset-risk-filter': 'risk_level', 'asset-vuln-min-filter': 'min_vulnerabilities', 'asset-protocol-filter': 'protocol',
  'asset-port-filter': 'port', 'asset-source-filter': 'source', 'asset-tag-filter': 'tag', 'asset-country-filter': 'country',
  'asset-province-filter': 'province', 'asset-city-filter': 'city', 'asset-responsible-filter': 'responsible_person',
  'asset-department-filter': 'department', 'asset-business-filter': 'business_system', 'asset-environment-filter': 'environment',
  'asset-criticality-filter': 'criticality', 'asset-first-seen-after-filter': 'first_seen_after', 'asset-last-seen-after-filter': 'last_seen_after',
} as const;
export const FILTER_IDS = [...Object.keys(FILTER_FIELDS), 'asset-first-seen-before-filter', 'asset-last-seen-before-filter', 'asset-scan-filter', 'asset-sort-filter'];
export const IMPORT_COLUMNS = ['target', 'project', 'tags', 'host', 'ip', 'domain', 'port', 'protocol', 'title', 'server', 'country', 'province', 'city', 'responsible_person', 'department', 'business_system', 'environment', 'criticality', 'status'] as const;
export const IMPORT_MAX_ROWS = 100000;
export const IMPORT_MAX_BYTES = 100 * 1024 * 1024;
export const IMPORT_ALIASES: Record<string, string[]> = {
  target: ['target', 'asset', 'assetaddress', '\u76ee\u6807', '\u8d44\u4ea7', '\u8d44\u4ea7\u5730\u5740'], project: ['project', 'projectname', 'projectid', '\u9879\u76ee', '\u9879\u76ee\u540d\u79f0', '\u9879\u76eeid', '\u6240\u5c5e\u9879\u76ee'], tags: ['tags', 'tag', '\u6807\u7b7e'],
  host: ['host', 'url', '\u5b8c\u6574url', '\u4e3b\u673a'], ip: ['ip', 'ipaddress', 'ip\u5730\u5740'], domain: ['domain', '\u57df\u540d'], port: ['port', '\u7aef\u53e3'], protocol: ['protocol', 'scheme', '\u534f\u8bae'],
  title: ['title', 'pagetitle', '\u6807\u9898', '\u9875\u9762\u6807\u9898'], server: ['server', 'service', 'product', '\u670d\u52a1', '\u4ea7\u54c1', '\u670d\u52a1\u6307\u7eb9'], country: ['country', 'countryregion', '\u56fd\u5bb6', '\u56fd\u5bb6\u5730\u533a'],
  province: ['province', 'state', '\u7701\u4efd', '\u5dde'], city: ['city', '\u57ce\u5e02'], responsible_person: ['responsibleperson', 'owner', '\u8d1f\u8d23\u4eba', '\u8d23\u4efb\u4eba'], department: ['department', '\u90e8\u95e8'],
  business_system: ['businesssystem', 'system', '\u4e1a\u52a1\u7cfb\u7edf', '\u7cfb\u7edf'], environment: ['environment', 'env', '\u73af\u5883'], criticality: ['criticality', 'importance', '\u91cd\u8981\u6027', '\u91cd\u8981\u7b49\u7ea7'], status: ['status', '\u72b6\u6001'],
};
export const EXPORT_LABELS: Record<string, string> = {
  target: 'target', host: 'hostUrl', ip: 'exportIP', domain: 'domain', port: 'port', protocol: 'protocol', title: 'pageTitle', server: 'server', project: 'project',
  responsible_person: 'responsiblePerson', department: 'department', business_system: 'businessSystem', environment: 'environment', criticality: 'criticality', country: 'country', province: 'province', city: 'city', source: 'source', status: 'status', tags: 'tagsLabel',
  risk_level: 'riskLevel', vulnerability_count: 'exportVulnerabilityCount', first_seen_at: 'firstSeen', last_seen_at: 'lastSeen', last_scan_at: 'lastScan',
};
export const isIPv4 = (value: string) => { const parts = value.split('.'); return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255); };
export function isIPv6(value: string): boolean {
  const candidate = value.replace(/^\[|\]$/g, '');
  if (!candidate.includes(':') || !/^[0-9a-f:.]+$/i.test(candidate)) return false;
  try { return new URL(`http://[${candidate}]/`).hostname.length > 2; } catch { return false; }
}
export function normalizeDomain(value: string): string {
  const raw = value.trim().replace(/\.$/, '');
  if (!raw || raw.length > 253 || raw.includes('_') || /[/?#@]/.test(raw)) return '';
  try {
    const hostname = new URL(`http://${raw}/`).hostname.toLowerCase().replace(/\.$/, '');
    return !hostname || hostname.length > 253 || hostname.split('.').some(label => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)) ? '' : hostname;
  } catch { return ''; }
}
export interface ParsedTarget { host: string; ip: string; domain: string; port: number; protocol: string }
export function parseTarget(value: string, t: Translate = key => key): ParsedTarget {
  const raw = value.trim(); if (!raw) throw new Error(t('assets.targetRequired'));
  const opaque = () => ({ host: raw, ip: '', domain: '', port: 0, protocol: '' });
  const ports: Record<string, number> = { http: 80, https: 443, ssh: 22, ftp: 21, smtp: 25, rdp: 3389, mysql: 3306, postgresql: 5432, redis: 6379, mongodb: 27017 };
  let hostname = '', port = 0, protocol = '', host = '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let url: URL; try { url = new URL(raw); } catch { return opaque(); }
    if (!url.hostname || url.username || url.password) return opaque();
    protocol = url.protocol.replace(':', '').toLowerCase(); hostname = url.hostname.replace(/^\[|\]$/g, ''); port = url.port ? Number(url.port) : ports[protocol] ?? 0; host = raw;
  } else {
    const authority = raw.replace(/\/$/, ''), bracketed = authority.match(/^\[([^\]]+)](?::(\d+))?$/);
    if (bracketed) { hostname = bracketed[1] ?? ''; port = Number(bracketed[2] || 0); }
    else if ((authority.match(/:/g) ?? []).length === 1 && /:\d+$/.test(authority)) { const at = authority.lastIndexOf(':'); hostname = authority.slice(0, at); port = Number(authority.slice(at + 1)); }
    else hostname = authority;
    protocol = Object.keys(ports).find(key => ports[key] === port) ?? '';
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(t('assets.portInvalid'));
  const ip = isIPv4(hostname) || isIPv6(hostname), domain = ip ? '' : normalizeDomain(hostname);
  if (!ip && (!domain || isIPv4(domain) || isIPv6(domain))) return opaque();
  return { host, ip: ip ? hostname.toLowerCase() : '', domain, port, protocol };
}
export const targetLabel = (asset: AssetInput) => asset.host || asset.domain || asset.ip || '-';
export function editorTarget(asset: AssetInput | null): string {
  if (!asset) return ''; if (asset.host) return asset.host;
  const target = asset.domain || asset.ip || ''; if (!target) return '';
  return `${target.includes(':') && !target.startsWith('[') ? `[${target}]` : target}${Number(asset.port) > 0 ? ':' + asset.port : ''}`;
}
export function buildFilterParams(values: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [id, key] of Object.entries(FILTER_FIELDS)) { const value = values[id]?.trim(); if (value) params.set(key, value); }
  for (const [id, key] of [['asset-first-seen-before-filter', 'first_seen_before'], ['asset-last-seen-before-filter', 'last_seen_before']] as const) {
    const value = values[id]; if (!value) continue; const date = new Date(value + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() + 1); params.set(key, date.toISOString().slice(0, 10));
  }
  const scan = values['asset-scan-filter'] ?? '';
  if (scan === 'never' || scan === 'scanned') params.set('scan_state', scan); else if (/^\d+$/.test(scan)) params.set('scan_overdue_days', scan);
  const [sortBy, order] = (values['asset-sort-filter'] || 'last_seen_at:desc').split(':'); if (sortBy) params.set('sort_by', sortBy); if (order) params.set('sort_order', order);
  return params;
}
