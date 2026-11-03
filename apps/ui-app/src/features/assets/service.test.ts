import { describe, expect, it } from 'vitest';
import { createAssetsService } from './service';
import { buildFilterParams, parseTarget, type Asset } from './model';
import type { Request } from './contracts';

function setup(handler: (url: URL, init?: RequestInit) => unknown = () => ({})) {
  const calls: { url: URL; init?: RequestInit }[] = [], values = new Map<string, string>();
  const request: Request = async (path, init) => { const url = new URL(path, 'http://test'); calls.push({ url, init }); return Response.json(handler(url, init)); };
  const service = createAssetsService({ request, storage: { get: key => values.get(key) ?? null, set: (key, value) => { values.set(key, value); return true; }, remove: key => values.delete(key) }, t: (key, values) => key + (values ? JSON.stringify(values) : '') });
  return { service, calls, values };
}
const asset = (id: string): Asset => ({ id, host: id + '.test', ip: '', domain: '', port: 443, protocol: 'https', title: '', server: '', country: '', province: '', city: '', responsible_person: '', department: '', business_system: '', environment: '', criticality: '', source: 'manual', source_query: '', status: 'active', tags: [], first_seen_at: '', last_seen_at: '', created_at: '', updated_at: '', risk_level: 'unassessed', vulnerability_count: 0 });
describe('asset service contracts and import validation', () => {
  it('collects every filtered inventory page for metrics, preserving project context', async () => {
    const { service, calls } = setup(url => ({ assets: [asset(url.searchParams.get('page') || '1')], total: 2, total_pages: 2 }));
    const result = await service.inventory(new URLSearchParams('project_id=p1&risk_level=high'));
    expect(result.map(a => a.id)).toEqual(['1', '2']);
    expect(calls.map(c => Object.fromEntries(c.url.searchParams))).toEqual([1, 2].map(page => ({ project_id: 'p1', risk_level: 'high', page: String(page), page_size: '100' })));
  });
  it('ignores a stale page response after the scope changes', async () => {
    let resolve: ((value: Response) => void) | undefined;
    const staleService = createAssetsService({ request: path => path.includes('project_id=old') ? new Promise<Response>(done => { resolve = done; }) : Promise.resolve(Response.json({ assets: [asset('new')], total: 1, page: 1 })), storage: { get: () => null, set: () => true, remove: () => true }, t: key => key });
    staleService.state.filters = { 'asset-project-filter': 'old' }; const old = staleService.load(1);
    staleService.state.filters = { 'asset-project-filter': 'new' }; await staleService.load(1);
    resolve?.(Response.json({ assets: [asset('old')], total: 1, page: 1 })); await old;
    expect(staleService.state.items.map(a => a.id)).toEqual(['new']);
  });
  it('preserves all advanced filter names, inclusive dates, scan mode and sort', () => {
    const p = buildFilterParams({ 'asset-search': ' apache ', 'asset-project-filter': 'p', 'asset-vuln-min-filter': '2', 'asset-first-seen-before-filter': '2026-10-31', 'asset-last-seen-before-filter': '2026-12-31', 'asset-scan-filter': '30', 'asset-sort-filter': 'risk_level:asc' });
    expect(Object.fromEntries(p)).toEqual({ q: 'apache', project_id: 'p', min_vulnerabilities: '2', first_seen_before: '2026-11-01', last_seen_before: '2027-01-01', scan_overdue_days: '30', sort_by: 'risk_level', sort_order: 'asc' });
  });
  it('uses page_size, clamps pages and invalidates cross-page selection only on query change', async () => {
    const { service, calls } = setup(url => ({ assets: [asset('a')], total: 21, page: Number(url.searchParams.get('page')), total_pages: 2 }));
    service.state.filters = { 'asset-search': 'a' }; await service.load(1); service.select(0, true); await service.load(2); expect(service.state.selected.size).toBe(1); await service.load(9); expect(service.state.page).toBe(2);
    service.state.filters['asset-search'] = 'b'; await service.load(1); expect(service.state.selected.size).toBe(0); expect(calls[0]?.url.searchParams.get('page_size')).toBe('20'); expect(calls[0]?.url.searchParams.has('limit')).toBe(false);
  });
  it('selects all matching records through selection endpoint and persists page size/views', async () => {
    const { service, calls, values } = setup(() => ({ assets: [asset('a'), asset('b')] })); service.state.filters = { 'asset-risk-filter': 'high' }; await service.selectAll(); expect([...service.state.selected.keys()]).toEqual(['a', 'b']); expect(service.state.allMatchingSelected).toBe(true); expect(calls[0]?.url.pathname).toBe('/api/assets/selection'); service.setPageSize(50); expect(values.get('raptix.asset_page_size')).toBe('50'); service.saveViews([{ name: 'x', values: service.state.filters }]); expect(service.savedViews()[0]?.name).toBe('x');
  });
  it('parses URLs, IPv6 and default protocols while retaining opaque backend targets', () => {
    expect(parseTarget('https://Example.com/a')).toEqual({ host: 'https://Example.com/a', domain: 'example.com', ip: '', protocol: 'https', port: 443 }); expect(parseTarget('[2001:db8::1]:22')).toMatchObject({ ip: '2001:db8::1', port: 22, protocol: 'ssh' }); expect(parseTarget('opaque target')).toMatchObject({ host: 'opaque target', port: 0 }); expect(() => parseTarget('host:65536')).toThrow();
  });
  it('handles translated/bilingual headers, enum aliases, projects, duplicate identities and row errors', () => {
    const { service } = setup(); service.state.projects = [{ id: 'p1', name: 'Production' }];
    service.parseImport([['\u76ee\u6807', '\u9879\u76ee', '\u7aef\u53e3', '\u72b6\u6001', '\u73af\u5883', '\u91cd\u8981\u6027'], ['EXAMPLE.COM', 'production', '443', '\u6d3b\u8dc3', '\u751f\u4ea7', '\u6838\u5fc3'], ['example.com', '', '443', '', '', ''], ['other.test', 'missing', '', '', '', ''], ['third.test', '', '65536', '', '', '']], 'assets.xlsx');
    expect(service.state.importRows[0]?.asset).toMatchObject({ domain: 'example.com', project_id: 'p1', environment: 'production', criticality: 'critical', status: 'active' }); expect(service.state.importRows[1]?.error).toContain('duplicateFileRow'); expect(service.state.importRows[2]?.error).toContain('importProjectNotFound'); expect(service.state.importRows[3]?.error).toContain('portInvalid');
  });
  it('validates tags and Unicode field lengths and only submits valid rows', async () => {
    const { service, calls } = setup(() => ({ imported: 1, skipped: 0 })); service.parseImport([['target', 'tags', 'title'], ['a.test', 'x,y', 'fine'], ['b.test', 'x'.repeat(65), ''], ['c.test', '', '\u4e2d'.repeat(501)]], 'file.csv'); const result = await service.submitImport(); expect(result).toEqual({ created: 1, updated: 0, skipped: 0 }); const body: unknown = JSON.parse(String(calls[0]?.init?.body)); expect(body).toMatchObject({ source: 'manual-import', source_query: 'file.csv', assets: [{ domain: 'a.test', tags: ['x', 'y'] }] });
  });
  it('maps backend valid-asset ordinal back to spreadsheet row and surfaces text errors', async () => {
    const service = createAssetsService({ request: async () => Response.json({ error: '\u7b2c 1 \u4e2a\u8d44\u4ea7\u65e0\u6548: \u62d2\u7edd' }, { status: 400 }), storage: { get: () => null, set: () => true, remove: () => true }, t: (key, values) => key + JSON.stringify(values || {}) }); service.parseImport([['target'], ['a.test']], 'file.csv'); await expect(service.submitImport()).rejects.toThrow('"row":2');
  });
  it('uses replacement PUT for edits and import for creation, including skipped-creation errors', async () => {
    const { service, calls } = setup(() => ({ created: 0, updated: 0, skipped: 1 })); await service.save('a/b', { host: 'x', tags: [] }); expect(calls[0]?.url.pathname).toBe('/api/assets/a%2Fb'); expect(calls[0]?.init?.method).toBe('PUT'); await expect(service.save('', { host: 'x' })).rejects.toThrow('assetSkipped'); expect(calls[1]?.url.pathname).toBe('/api/assets/import');
  });
  it('preserves bulk/project/delete/merge contracts', async () => { const { service, calls } = setup(); service.state.selected.set('a', asset('a')); service.state.selected.set('b', asset('b')); await service.bindProject('p'); await service.bulk({ environment: 'production', add_tags: ['new'], remove_tags: [] }); await service.deleteSelected(); await service.merge(); expect(calls.map(c => [c.url.pathname, c.init?.method])).toEqual([['/api/assets/project-binding', 'PUT'], ['/api/assets/bulk', 'PUT'], ['/api/assets/batch-delete', 'POST'], ['/api/assets/merge', 'POST']]); expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({ asset_ids: ['a', 'b'], primary_id: 'a' }); });
  it('links conversation/task scans and preserves the common project and completion instruction', async () => {
    const { service, calls } = setup(url => url.pathname === '/api/conversations' ? { id: 'c' } : url.pathname === '/api/batch-tasks' ? { queueId: 'q', queue: { tasks: [{ id: 't' }] } } : {}); const a = { ...asset('a'), project_id: 'p' }; expect(await service.createScanConversation([a])).toBe('c'); expect(await service.createScanTasks([a], 'Check {{target}}', true)).toBe('q'); expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ scans: [{ asset_id: 'a', conversation_id: 'c' }] }); expect(JSON.parse(String(calls[2]?.init?.body))).toMatchObject({ projectId: 'p', executeNow: true, concurrency: 1, scheduleMode: 'manual' }); expect(JSON.parse(String(calls[2]?.init?.body))).not.toHaveProperty('agentMode'); expect(service.scanPrompt('Check {{target}}', a)).toContain('scanCompletionInstruction'); expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({ scans: [{ asset_id: 'a', queue_id: 'q', task_id: 't' }] });
  });
});
