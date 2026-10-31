import { errorMessage, jsonBody, requestJSON, type Request, type Translate } from './contracts';
import { buildFilterParams, IMPORT_ALIASES, IMPORT_COLUMNS, IMPORT_MAX_ROWS, EXPORT_LABELS, isIPv4, isIPv6, normalizeDomain, parseTarget, targetLabel, type Asset, type AssetInput, type AssetStats, type ImportResult, type ImportRow, type ProjectOption, type SavedView, type ScanLink } from './model';
import type { KeyValueStorage } from '../../platform/storage';
import type { Vulnerability } from '../../api/types/vulnerability';

export function createAssetsService(options: { request: Request; storage: KeyValueStorage; t: Translate; activeProject?: () => string }) {
  const { request, storage, t } = options;
  const state = {
    page: 1, pageSize: [10, 20, 50, 100].includes(Number(storage.get('raptix.asset_page_size'))) ? Number(storage.get('raptix.asset_page_size')) : 20,
    total: 0, totalPages: 1, items: [] as Asset[], projects: [] as ProjectOption[], projectsLoaded: false,
    selected: new Map<string, Asset>(), selectionQuery: '', allMatchingSelected: false, overviewDays: 30,
    detailAsset: null as Asset | null, editAsset: null as Asset | null, editorTags: [] as string[], editorDirty: false, editorBusy: false, editorParsedTarget: '',
    importRows: [] as ImportRow[], importFileName: '', importBusy: false, scanMode: 'chat' as 'chat' | 'task', scanAssets: [] as Asset[],
    filters: {} as Record<string, string>,
  };
  let revision = 0;
  const api = async <T>(path: string, init?: RequestInit) => { const value = await requestJSON<T>(request, path, init); if (init?.method && init.method !== 'GET') revision++; return value; };
  let loadSequence = 0;
  const exportHeader = (key: string) => { const id = 'assets.' + (EXPORT_LABELS[key] ?? key); const text = t(id); return text === id ? key : text; };
  const normalizeHeader = (value: unknown) => String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_\-/.\uff08\uff09()]+/g, '');
  const enumMap = (values: Record<string, string>, prefix: string) => {
    const result = { ...values };
    for (const code of new Set(Object.values(values))) if (code) result[t('assets.' + prefix + code.charAt(0).toUpperCase() + code.slice(1)).toLowerCase()] = code;
    return result;
  };
  function importRecord(values: Record<string, string>, rowNumber: number): ImportRow {
    const fail = (error: string): ImportRow => ({ rowNumber, values, asset: null, error });
    const target = values.target || values.host || values.domain || values.ip || ''; if (!target) return fail(t('assets.importTargetRequired'));
    let parsed; try { parsed = parseTarget(target, t); } catch (error) { return fail(errorMessage(error)); }
    const port = values.port ? Number(values.port) : parsed.port;
    if (!Number.isInteger(port) || port < 0 || port > 65535) return fail(t('assets.portInvalid'));
    const ip = (values.ip || parsed.ip).toLowerCase(); if (ip && !isIPv4(ip) && !isIPv6(ip)) return fail(t('assets.ipInvalid'));
    const rawDomain = values.domain || parsed.domain, domain = rawDomain ? normalizeDomain(rawDomain) : ''; if (rawDomain && !domain) return fail(t('assets.domainInvalid'));
    const protocol = (values.protocol || parsed.protocol).toLowerCase(); if (protocol && !/^[a-z][a-z0-9+.-]{0,31}$/.test(protocol)) return fail(t('assets.protocolInvalid'));
    const status = enumMap({ active: 'active', inactive: 'inactive', '\u6d3b\u8dc3': 'active', '\u505c\u7528': 'inactive' }, 'status')[(values.status || 'active').toLowerCase()]; if (!status) return fail(t('assets.importStatusInvalid'));
    const environment = enumMap({ '': '', production: 'production', staging: 'staging', testing: 'testing', development: 'development', other: 'other', '\u751f\u4ea7': 'production', '\u9884\u53d1\u5e03': 'staging', '\u6d4b\u8bd5': 'testing', '\u5f00\u53d1': 'development', '\u5176\u4ed6': 'other' }, 'environment')[(values.environment || '').toLowerCase()]; if (environment == null) return fail('Invalid environment value');
    const criticality = enumMap({ '': '', critical: 'critical', high: 'high', medium: 'medium', low: 'low', '\u6838\u5fc3': 'critical', '\u91cd\u8981': 'high', '\u4e00\u822c': 'medium', '\u4f4e': 'low' }, 'criticality')[(values.criticality || '').toLowerCase()]; if (criticality == null) return fail('Invalid criticality value');
    const project = values.project ? state.projects.find(p => p.id.toLowerCase() === values.project?.toLowerCase() || p.name.trim().toLowerCase() === values.project?.toLowerCase()) : undefined;
    if (values.project && !project) return fail(t('assets.importProjectNotFound', { project: values.project }));
    const tags = (values.tags || '').split(/[,\uff0c;\uff1b|]/).map(tag => tag.trim()).filter(Boolean); if (tags.length > 30 || tags.some(tag => Array.from(tag).length > 64)) return fail(t('assets.importTagsInvalid'));
    const strings = ['title', 'server', 'country', 'province', 'city', 'responsible_person', 'department', 'business_system'] as const;
    const projectId = project?.id || options.activeProject?.() || '';
    const asset: AssetInput = { host: values.host || parsed.host, ip, domain, port, protocol, environment, criticality, status, tags, project_id: projectId, source: 'manual-import' };
    for (const key of strings) asset[key] = values[key] || '';
    const limits: Partial<Record<keyof AssetInput, number>> = { host: 500, title: 500, domain: 255, protocol: 255, server: 255, country: 255, province: 255, city: 255, responsible_person: 255, department: 255, business_system: 255 };
    for (const key of Object.keys(limits) as (keyof AssetInput)[]) if (Array.from(String(asset[key] || '')).length > (limits[key] ?? 0)) return fail(t('assets.importFieldTooLong', { field: key }));
    return { rowNumber, values, asset, projectName: project?.name || state.projects.find(p => p.id === projectId)?.name || '', error: '' };
  }
  function clearSelection() { state.selected.clear(); state.allMatchingSelected = false; }
  return {
    state, exportHeader, importRecord, get revision() { return revision; },
    params: () => buildFilterParams(state.filters),
    async load(page?: number): Promise<void> {
      const sequence = ++loadSequence;
      state.page = page ?? state.page;
      const params = buildFilterParams(state.filters), query = params.toString();
      if (state.selectionQuery && state.selectionQuery !== query) clearSelection(); state.selectionQuery = query;
      params.set('page', String(state.page)); params.set('page_size', String(state.pageSize));
      const data = await api<{ assets?: Asset[]; total?: number; page?: number; total_pages?: number }>('/api/assets?' + params);
      if (sequence !== loadSequence) return;
      state.items = data.assets ?? []; state.total = data.total ?? 0; state.totalPages = data.total_pages || Math.max(1, Math.ceil(state.total / state.pageSize)); state.page = data.page || 1;
      if (state.page > state.totalPages) return this.load(state.totalPages);
    },
    async projects(force = false): Promise<void> {
      if (state.projectsLoaded && !force) return;
      const data = await api<{ projects?: ProjectOption[] } | ProjectOption[]>('/api/projects?limit=500');
      state.projects = Array.isArray(data) ? data : data.projects ?? []; state.projectsLoaded = true;
    },
    overview: () => api<AssetStats>('/api/assets/stats?days=' + state.overviewDays),
    /** Read every matching page: KPI and graph totals must never describe only the visible page. */
    async inventory(params = buildFilterParams(state.filters), signal?: AbortSignal): Promise<Asset[]> {
      const items = new Map<string, Asset>();
      for (let page = 1; ; page++) {
        const query = new URLSearchParams(params); query.set('page', String(page)); query.set('page_size', '100');
        const data = await api<{ assets?: Asset[]; total?: number; total_pages?: number }>('/api/assets?' + query, { signal });
        const rows = data.assets ?? [], before = items.size;
        rows.forEach(a => items.set(a.id, a));
        if (!rows.length || (data.total != null && items.size >= data.total) || (data.total_pages != null && page >= data.total_pages)) break;
        if (items.size === before) throw new Error('Asset pagination did not advance. Refresh to retry.');
      }
      return [...items.values()];
    },
    async findings(params: URLSearchParams, signal?: AbortSignal): Promise<Vulnerability[]> {
      const items = new Map<string, Vulnerability>();
      for (let page = 1; ; page++) {
        const query = new URLSearchParams(params); query.set('page', String(page)); query.set('limit', '100');
        const data = await api<{ vulnerabilities?: Vulnerability[]; total?: number; total_pages?: number }>('/api/vulnerabilities?' + query, { signal });
        const rows = data.vulnerabilities ?? [], before = items.size;
        rows.forEach(v => items.set(v.id, v));
        if (!rows.length || (data.total != null && items.size >= data.total) || (data.total_pages != null && page >= data.total_pages)) break;
        if (items.size === before) throw new Error('Finding pagination did not advance. Refresh to retry.');
      }
      return [...items.values()];
    },
    clearSelection,
    select(index: number, checked: boolean) { const asset = state.items[index]; if (!asset) return; if (checked) state.selected.set(asset.id, asset); else { state.selected.delete(asset.id); state.allMatchingSelected = false; } },
    selectPage(checked: boolean) { state.items.forEach((_, index) => this.select(index, checked)); },
    async selectAll() { const data = await api<{ assets?: Asset[] }>('/api/assets/selection?' + buildFilterParams(state.filters)); clearSelection(); for (const asset of data.assets ?? []) state.selected.set(asset.id, asset); state.allMatchingSelected = true; },
    setPageSize(size: number) { if (![10, 20, 50, 100].includes(size)) return; state.pageSize = size; storage.set('raptix.asset_page_size', String(size)); },
    savedViews(): SavedView[] {
      try { const value: unknown = JSON.parse(storage.get('raptix.asset_saved_views') || '[]'); return Array.isArray(value) ? value.filter((v): v is SavedView => !!v && typeof v === 'object' && 'name' in v && typeof v.name === 'string' && 'values' in v && !!v.values && typeof v.values === 'object') : []; } catch { return []; }
    },
    saveViews(views: SavedView[]) { return storage.set('raptix.asset_saved_views', JSON.stringify(views)); },
    parseImport(matrix: unknown[][], fileName: string) {
      if (matrix.length < 2) throw new Error(t('assets.fileHasNoData'));
      const headers = (matrix[0] ?? []).map(value => IMPORT_COLUMNS.find(key => IMPORT_ALIASES[key]?.includes(normalizeHeader(value)) || normalizeHeader(exportHeader(key)) === normalizeHeader(value)) || '');
      if (!headers.some(Boolean)) throw new Error(t('assets.headerInvalid'));
      const rows = matrix.slice(1).filter(row => row.some(value => String(value ?? '').trim())); if (!rows.length) throw new Error(t('assets.fileHasNoData')); if (rows.length > IMPORT_MAX_ROWS) throw new Error(t('assets.tooManyRows', { count: IMPORT_MAX_ROWS }));
      const seen = new Map<string, number>();
      state.importRows = rows.map((row, index) => {
        const values: Record<string, string> = {}; headers.forEach((key, at) => { if (key && values[key] == null) values[key] = String(row[at] ?? '').trim(); });
        const result = importRecord(values, index + 2), asset = result.asset;
        if (!result.error && asset) { const key = `${(asset.domain || asset.ip || asset.host || '').toLowerCase()}|${asset.port || 0}|${asset.protocol || ''}`; const duplicate = seen.get(key); if (duplicate) result.error = t('assets.duplicateFileRow', { row: duplicate }); else seen.set(key, result.rowNumber); }
        return result;
      }); state.importFileName = fileName;
    },
    async import(assets: AssetInput[], source: string, query = ''): Promise<ImportResult> {
      const data = await api<Partial<ImportResult> & { imported?: number }>('/api/assets/import', jsonBody('POST', { assets, source, source_query: query }));
      return { created: data.created ?? data.imported ?? 0, updated: data.updated ?? 0, skipped: data.skipped ?? 0 };
    },
    async submitImport() {
      const rows = state.importRows.filter(row => !row.error && row.asset);
      try { return await this.import(rows.flatMap(row => row.asset ? [row.asset] : []), 'manual-import', state.importFileName); }
      catch (error) { const message = errorMessage(error), match = message.match(/^\u7b2c\s*(\d+)\s*\u4e2a\u8d44\u4ea7\u65e0\u6548[:\uff1a]\s*(.+)$/), row = match ? rows[Number(match[1]) - 1] : undefined; throw new Error(match && row ? t('assets.importBackendRowError', { row: row.rowNumber, index: Number(match[1]), message: match[2] ?? '' }) : message); }
    },
    async save(id: string, asset: AssetInput): Promise<ImportResult | null> {
      if (id) { await api<unknown>('/api/assets/' + encodeURIComponent(id), jsonBody('PUT', asset)); return null; }
      const result = await this.import([asset], 'manual');
      if (result.skipped > 0 && result.created === 0 && result.updated === 0) throw new Error(t('assets.assetSkipped')); return result;
    },
    delete: (id: string) => api<unknown>('/api/assets/' + encodeURIComponent(id), { method: 'DELETE' }),
    bindProject: (projectId: string) => api<unknown>('/api/assets/project-binding', jsonBody('PUT', { asset_ids: [...state.selected.keys()], project_id: projectId })),
    bulk: (fields: Record<string, string | string[]>) => api<unknown>('/api/assets/bulk', jsonBody('PUT', { ...fields, asset_ids: [...state.selected.keys()] })),
    deleteSelected: () => api<unknown>('/api/assets/batch-delete', jsonBody('POST', { asset_ids: [...state.selected.keys()] })),
    merge: () => api<unknown>('/api/assets/merge', jsonBody('POST', { asset_ids: [...state.selected.keys()], primary_id: [...state.selected.keys()][0] })),
    scanPrompt(template: string, asset: Asset): string {
      const values: Record<string, string | number> = { asset_id: asset.id, target: targetLabel(asset), host: asset.host || '', ip: asset.ip || '', domain: asset.domain || '', port: asset.port || '' };
      const prompt = Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)), template);
      return !asset.id || prompt.includes('complete_asset_scan') ? prompt : prompt + '\n\n' + t('assets.scanCompletionInstruction', { asset_id: asset.id });
    },
    async createScanConversation(assets: Asset[]) {
      const ids = [...new Set(assets.map(a => a.project_id || ''))];
      const conversation = await api<{ id: string }>('/api/conversations', jsonBody('POST', { title: t('assets.scanConversationTitle', { targets: assets.map(targetLabel).join(', ') }), projectId: ids.length === 1 ? ids[0] : '' }));
      await this.scanLinks(assets.map(a => ({ asset_id: a.id, conversation_id: conversation.id }))); return conversation.id;
    },
    scanLinks: (scans: ScanLink[]) => api<unknown>('/api/assets/scan-links', jsonBody('POST', { scans })),
    async createScanTasks(assets: Asset[], template: string, executeNow: boolean) {
      const ids = [...new Set(assets.map(a => a.project_id || ''))];
      const result = await api<{ queueId: string; queue?: { tasks?: { id: string }[] } }>('/api/batch-tasks', jsonBody('POST', { title: t('assets.scanQueueTitle'), tasks: assets.map(asset => this.scanPrompt(template, asset)), executeNow, projectId: ids.length === 1 ? ids[0] : '', concurrency: 1, scheduleMode: 'manual' }));
      const tasks = result.queue?.tasks ?? []; if (tasks.length !== assets.length) throw new Error(t('assets.scanTaskLinkFailed'));
      await this.scanLinks(assets.map((a, index) => ({ asset_id: a.id, queue_id: result.queueId, task_id: tasks[index]?.id }))); return result.queueId;
    },
  };
}
export type AssetsService = ReturnType<typeof createAssetsService>;
