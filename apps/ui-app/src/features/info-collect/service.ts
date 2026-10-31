import { isIPv4, isIPv6, normalizeDomain, jsonBody, requestJSON, type AssetInput, type AssetsDependencies, type Request, type Translate } from '../assets';
import type { KeyValueStorage } from '../../platform/storage';
import { BACKEND_DEFAULT_ROLE } from '@/platform/backend-legacy-strings';
import { inferTarget, PROVIDERS, provider, type ParseResult, type ResultRow, type SearchForm, type SearchPayload } from './model';

export function resultToAsset(row: ResultRow | unknown[], fields: string[], source: string): AssetInput {
  const value = (name: string) => String(Array.isArray(row) ? row[fields.indexOf(name)] ?? '' : row[name] ?? '').trim();
  const first = (keys: string[]) => keys.map(value).find(Boolean) || '';
  const port = parseInt(value('port'), 10), rawIP = first(['ip', 'ip_str']), rawDomain = first(['domain', 'hostname', 'hostnames', 'domains']), rawProtocol = first(['protocol', 'service.name', 'transport']).toLowerCase();
  return { host: first(['host', 'hostname']), ip: isIPv4(rawIP) || isIPv6(rawIP) ? rawIP.toLowerCase() : '', port: Number.isFinite(port) ? port : 0,
    domain: rawDomain && !isIPv4(rawDomain) && !isIPv6(rawDomain) ? normalizeDomain((rawDomain.split(',')[0] || '').replace(/^\[|\]$/g, '').replace(/^"|"$/g, '')) : '',
    protocol: /^[a-z][a-z0-9+.-]{0,31}$/.test(rawProtocol) ? rawProtocol : '', title: first(['title', 'service.http.title']), server: first(['server', 'product']), country: first(['country', 'location.country_cn', 'location.country_name']), province: first(['region', 'province', 'location.province_cn']), city: first(['city', 'location.city_cn', 'location.city']), source, status: 'active' };
}
export function createInfoCollectService(options: { request: Request; storage: KeyValueStorage; t: Translate; currentRole: AssetsDependencies['currentRole']; activeProject: AssetsDependencies['activeProject'] }) {
  const { request, storage, t } = options;
  const read = (key: string): unknown => { try { return JSON.parse(storage.get(key) || 'null'); } catch { return null; } };
  const hidden = read('info-collect-fofa-hidden-fields');
  const state = { currentPayload: null as SearchPayload | null, hiddenFields: new Set<string>(Array.isArray(hidden) ? hidden.filter((v): v is string => typeof v === 'string') : []), selectedRowIndexes: new Set<number>(), syntaxGuideExpanded: false, parsing: false };
  let parseController: AbortController | null = null, disposed = false;
  const api = <T>(path: string, init?: RequestInit) => requestJSON<T>(request, path, init);
  function saveHidden() { storage.set('info-collect-fofa-hidden-fields', JSON.stringify([...state.hiddenFields])); }
  function accept(payload: SearchPayload) {
    state.currentPayload = { ...payload, provider: payload.provider || 'fofa', query: payload.query || '', total: payload.total || 0, page: payload.page || 1, size: payload.size || 0, fields: Array.isArray(payload.fields) ? payload.fields : [], results: Array.isArray(payload.results) ? payload.results : [] };
    state.selectedRowIndexes.clear(); for (const field of state.hiddenFields) if (!state.currentPayload.fields.includes(field)) state.hiddenFields.delete(field); saveHidden();
  }
  function summary(row: ResultRow, fields: string[]) {
    const keys = [...new Set([...fields, ...Object.keys(row).sort()])].filter(Boolean);
    return keys.map(key => { const value = row[key]; let text = value === null ? 'null' : value === undefined ? '' : typeof value === 'string' ? value || '""' : typeof value === 'object' ? JSON.stringify(value) : String(value); if (text.length > 800) text = text.slice(0, 800) + '...(' + t('infoCollect.truncated') + ')'; return `- ${key}: ${text}`; }).join('\n') || '-';
  }
  function scanMessage(target: string, row: ResultRow, fields: string[]): string {
    const label = PROVIDERS[provider(state.currentPayload?.provider || '')].label;
    return `Perform information gathering and basic scanning on the following target:\n${target}\n\nRequirements:\n1) Identify services/frameworks and key fingerprints\n2) Enumerate open ports and common admin entry points\n3) Quickly confirm the reachable surface via httpx / fingerprinting / directory probing\n4) Output reproducible commands and conclusions\n\nKnown information (all fields of this row from ${label}):\n${summary(row, fields)}`.trim();
  }
  return {
    state, accept, scanMessage, saveHidden,
    savedForm(): Partial<SearchForm> | null { const saved = read('info-collect-fofa-form'); return saved && typeof saved === 'object' ? saved as Partial<SearchForm> : null; },
    saveForm(form: SearchForm) { storage.set('info-collect-fofa-form', JSON.stringify(form)); },
    async search(form: SearchForm) { const next = { ...form, size: Math.min(form.size, PROVIDERS[form.provider].maxSize), full: !!PROVIDERS[form.provider].fullOption && form.full }; this.saveForm(next); const result = await api<SearchPayload>('/api/fofa/search', jsonBody('POST', next)); if (!disposed) accept({ ...result, provider: result.provider || next.provider }); return result; },
    async parse(code: string, text: string): Promise<ParseResult | null> {
      if (parseController) { parseController.abort(); return null; }
      const controller = new AbortController(); parseController = controller; state.parsing = true;
      try { return await api<ParseResult>('/api/fofa/parse', { ...jsonBody('POST', { provider: provider(code), text }), signal: controller.signal }); }
      finally { if (parseController === controller) { parseController = null; state.parsing = false; } }
    },
    cancelParse() { parseController?.abort(); },
    select(index: number, checked: boolean) { if (checked) state.selectedRowIndexes.add(index); else state.selectedRowIndexes.delete(index); },
    selectAll(checked: boolean) { state.selectedRowIndexes.clear(); if (checked) state.currentPayload?.results.forEach((_, index) => state.selectedRowIndexes.add(index)); },
    toggleColumn(field: string, visible: boolean) { if (visible) state.hiddenFields.delete(field); else state.hiddenFields.add(field); saveHidden(); if (state.currentPayload) accept(state.currentPayload); },
    allColumns(visible: boolean) { const p = state.currentPayload; if (!p) return; const keep = ['host', 'ip', 'domain'].find(key => p.fields.includes(key)); state.hiddenFields = new Set(visible ? [] : p.fields.filter(key => key !== keep)); saveHidden(); accept(p); },
    async importRows(indexes: number[]) {
      const payload = state.currentPayload; if (!payload || !indexes.length) throw new Error(t('assets.selectFirst'));
      const converted = indexes.flatMap(index => { const row = payload.results[index]; return row ? [resultToAsset(row, payload.fields, payload.provider || 'fofa')] : []; });
      const assets = converted.filter(a => a.host || a.ip || a.domain).map(a => ({ ...a, project_id: options.activeProject() || '' })), invalid = converted.length - assets.length; if (!assets.length) throw new Error(t('assets.noValidImportTarget'));
      const result = await api<{ created?: number; imported?: number; updated?: number }>('/api/assets/import', jsonBody('POST', { assets, source: payload.provider || 'fofa', source_query: payload.query || '' }));
      return { created: result.created ?? result.imported ?? 0, updated: result.updated ?? 0, invalid };
    },
    async batchScan() {
      const p = state.currentPayload; if (!p?.results.length) throw new Error(t('infoCollect.noResults')); const indexes = [...state.selectedRowIndexes].sort((a, b) => a - b); if (!indexes.length) throw new Error(t('infoCollect.selectRowsFirst'));
      const tasks: string[] = [], skipped: number[] = []; for (const index of indexes) { const row = p.results[index] || {}, target = inferTarget(row); if (!target) skipped.push(index + 1); else tasks.push(scanMessage(target, row, p.fields)); }
      if (!tasks.length) throw new Error(t('infoCollect.noScanTarget'));
      const role = options.currentRole(), result = await api<{ queueId?: string }>('/api/batch-tasks', jsonBody('POST', { title: (t('infoCollect.batchScanTitle') + (p.query ? ': ' + p.query : '')).slice(0, 80), tasks, role: role === BACKEND_DEFAULT_ROLE ? '' : role, projectId: options.activeProject() || '' })); if (!result.queueId) throw new Error('Task created but the backend returned no queueId'); return { queueId: result.queueId, skipped };
    },
    dispose() { disposed = true; parseController?.abort(); },
  };
}
export type InfoCollectService = ReturnType<typeof createInfoCollectService>;
