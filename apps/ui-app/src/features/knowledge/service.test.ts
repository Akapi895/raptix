import { describe, expect, it, vi } from 'vitest';
import { createKnowledgeService, retrievedCount } from './index';
import type { RequestFn } from './service';
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function setup(handler: RequestFn) { const request = vi.fn(handler); return { request, service: createKnowledgeService({ request, now: () => 123 }) }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const item = { id: 'one', category: 'SQL', title: 'Title', content: 'body' };

describe('knowledge public service', () => {
  it('retrieves cache-busted category names from Go and demo objects', async () => {
    const { service, request } = setup(async () => response({ categories: ['SQL', { name: 'Auth', count: 2 }] }));
    await service.loadCategories(); expect(service.state.categories).toEqual(['SQL', 'Auth']);
    expect(request.mock.lastCall).toEqual(['/api/knowledge/categories?_t=123', expect.objectContaining({ headers: expect.objectContaining({ 'Cache-Control': 'no-cache, no-store, must-revalidate' }) })]);
  });
  it('retains category pagination and full category/search responses from Go', async () => {
    const { service, request } = setup(async () => response({ categories: [{ category: 'SQL', items: [item], itemCount: 15 }], total: 25 }));
    await service.loadItems('', 2, 10); expect(request.mock.lastCall?.[0]).toContain('categoryPage=true&limit=10&offset=10'); expect(service.state.pagination.total).toBe(25);
    await service.loadItems('SQL & Auth', 1, 10, 'token?');
    const query = new URL(request.mock.lastCall?.[0] ?? '', 'http://test').searchParams;
    expect(query.get('categoryPage')).toBeNull(); expect(query.get('search')).toBe('token?'); expect(query.get('category')).toBe('SQL & Auth'); expect(service.state.groups[0]?.itemCount).toBe(15);
  });
  it('gathers all demo item pages before grouping and paginating categories', async () => {
    const { service, request } = setup(async path => new URL(path, 'http://test').searchParams.get('page') === '2' ? response({ items: [{ ...item, id: 'two', category: 'Auth' }], total: 2, page: 2, page_size: 1 }) : response({ items: [item], total: 2, page: 1, page_size: 1 }));
    await service.loadItems('', 2, 1);
    expect(request).toHaveBeenCalledTimes(2); expect(service.state.pagination.total).toBe(2); expect(service.state.groups.map(group => group.category)).toEqual(['SQL']);
  });
  it('handles disabled and empty knowledge responses without keeping stale groups', async () => {
    let enabled = true; const { service } = setup(async () => response(enabled ? { categories: [{ category: 'SQL', items: [item], itemCount: 1 }], total: 1 } : { enabled: false }));
    await service.loadItems(); enabled = false; await service.loadItems(); expect(service.state).toMatchObject({ enabled: false, groups: [], pagination: { total: 0 } });
  });
  it('ignores stale search responses', async () => {
    const pending = deferred<Response>(); const { service } = setup(async path => path.includes('search=') ? response({ categories: [], total: 0 }) : pending.promise);
    const load = service.loadItems(); await service.loadItems('', 1, 10, 'fresh'); pending.resolve(response({ categories: [{ category: 'SQL', items: [item], itemCount: 1 }], total: 1 }));
    expect(await load).toBe(false); expect(service.state.groups).toEqual([]);
  });
  it('ignores late edit data after a close or newer edit', async () => {
    const pending = deferred<Response>(); const { service } = setup(async () => pending.promise);
    const load = service.beginEdit('one'); service.beginCreate(); pending.resolve(response(item)); expect(await load).toBe(false); expect(service.state.editor?.id).toBeNull();
  });
  it('validates all required fields, suppresses duplicate saves and trims create payloads', async () => {
    const pending = deferred<Response>(); const { service, request } = setup(async () => pending.promise);
    service.beginCreate(); await expect(service.save()).rejects.toThrow('Fill in all required fields');
    for (const field of ['category', 'title', 'content'] as const) service.updateEditor(field, ` ${field} `);
    const save = service.save(); expect(await service.save()).toBeNull(); expect(service.state.saving).toBe(true);
    expect(request.mock.lastCall).toEqual(['/api/knowledge/items', expect.objectContaining({ method: 'POST', body: JSON.stringify({ category: 'category', title: 'title', content: 'content' }) })]);
    pending.resolve(response(item)); expect(await save).toMatchObject({ created: true, item }); expect(service.state.saving).toBe(false);
  });
  it('encodes identifiers for detail/update/delete and restores saving after server errors', async () => {
    const { service, request } = setup(async (_path, init) => init?.method === 'PUT' ? response({ error: 'disk full' }, 500) : response(item));
    await service.beginEdit('a / b'); await expect(service.save()).rejects.toThrow('disk full');
    expect(service.state.saving).toBe(false); expect(service.state.editor?.content).toBe('body');
    await service.remove('a / b'); expect(request.mock.lastCall?.[0]).toBe('/api/knowledge/items/a%20%2F%20b'); expect(request.mock.lastCall?.[1]?.method).toBe('DELETE');
  });
  it('tolerates non-JSON failures with the operation fallback', async () => {
    const { service } = setup(async () => new Response('gateway timeout', { status: 504 }));
    await expect(service.remove('one')).rejects.toThrow('Failed to delete the knowledge item');
  });
  it('normalizes demo timestamp fields', async () => {
    const { service } = setup(async () => response({ ...item, updated_at: '2026-01-01T00:00:00Z' }));
    expect(await service.detail('one')).toMatchObject({ updatedAt: '2026-01-01T00:00:00Z' });
  });
  it('starts missing/full jobs, handles 409 as a conflict, and preserves actionable errors', async () => {
    const { service, request } = setup(async () => response({ message: 'started' }));
    expect(await service.startIndex('missing')).toEqual({ conflict: false, message: 'started' }); expect(request.mock.lastCall?.[0]).toBe('/api/knowledge/index');
    await service.startIndex('full'); expect(request.mock.lastCall?.[0]).toBe('/api/knowledge/index?mode=full');
    const conflict = setup(async () => response({ error: 'busy' }, 409)); expect(await conflict.service.startIndex('full')).toEqual({ conflict: true, message: 'busy' });
    const error = setup(async () => response({ error: '401 invalid api key' }, 500)); await expect(error.service.startIndex('missing')).rejects.toThrow('401 invalid api key');
  });
  it('keeps Go rebuild counters and errors, and translates demo pending/ready state', async () => {
    const go = setup(async () => response({ total_items: 5, indexed_items: 2, progress_percent: 40, is_rebuilding: true, rebuild_failed: 1, last_error: '401 Unauthorized' }));
    expect(await go.service.indexStatus()).toMatchObject({ total_items: 5, indexed_items: 2, is_rebuilding: true, rebuild_failed: 1, last_error: '401 Unauthorized' });
    const demo = setup(async () => response({ total: 4, pending: 1, status: 'pending' })); expect(await demo.service.indexStatus()).toMatchObject({ total_items: 4, indexed_items: 3, progress_percent: 75, is_complete: false });
    const ready = setup(async () => response({ total: 4, pending: 0, status: 'ready' })); expect((await ready.service.indexStatus())?.is_complete).toBe(true);
  });
  it('invalidates an in-flight index read when polling is stopped; HTTP failure stays silent', async () => {
    const pending = deferred<Response>(); const { service } = setup(async () => pending.promise);
    const load = service.indexStatus(); service.invalidateIndex(); pending.resolve(response({ total_items: 5 })); expect(await load).toBeNull(); expect(service.state.index).toBeNull();
    expect(await setup(async () => response({}, 500)).service.indexStatus()).toBeNull();
  });
  it('loads filtered logs, normalizes JSON-string IDs and unknown-result sentinel, and skips unavailable item details', async () => {
    const { service, request } = setup(async path => path.includes('retrieval-logs?') ? response({ logs: [{ id: 'log', retrievedItems: '["_has_results","one","gone"]', query: 'q' }] }) : path.endsWith('/gone') ? response({}, 404) : response(item));
    await service.loadLogs('a & b', 'msg?');
    expect(request.mock.calls[0]?.[0]).toContain('conversationId=a+%26+b&messageId=msg%3F');
    const details = await service.logDetails(0); expect(details.items).toEqual([item]); expect(retrievedCount(details.log)).toBe(2);
    expect(request.mock.calls.some(([path]) => path.includes('/_has_results'))).toBe(false);
    await service.removeLog('log / 1'); expect(request.mock.lastCall?.[0]).toBe('/api/knowledge/retrieval-logs/log%20%2F%201');
  });
  it('handles malformed retrievedItems, unknown results and demo hit counts without throwing', async () => {
    const { service } = setup(async () => response({ logs: [{ id: 'bad', retrievedItems: 'bad json' }, { id: 'unknown', retrievedItems: ['_has_results'] }, { id: 'demo', hits: 2, created_at: '2026-01-01' }] }));
    await service.loadLogs(); expect(service.state.logs.map(retrievedCount)).toEqual([0, -1, 2]); expect(service.state.logs[2]?.createdAt).toBe('2026-01-01');
    await expect(service.logDetails(99)).rejects.toThrow('retrievalLogs.detailError');
  });
  it('a late failed log request cannot clear a newer successful filter result', async () => {
    const pending = deferred<Response>(); const { service } = setup(async path => path.includes('conversationId=new') ? response({ logs: [{ id: 'fresh', retrievedItems: [] }] }) : pending.promise);
    const old = service.loadLogs(); await service.loadLogs('new'); pending.resolve(response({ error: 'old failure' }, 500));
    expect(await old).toBe(false); expect(service.state.logs[0]?.id).toBe('fresh');
  });
  it('scans and ignores late list/category/log reads after disposal', async () => {
    const scan = setup(async () => response({ items_to_index: 3 })); expect(await scan.service.scan()).toEqual({ items_to_index: 3 }); expect(scan.request.mock.lastCall?.[1]?.method).toBe('POST');
    const pending = deferred<Response>(); const { service } = setup(async () => pending.promise); const load = service.loadCategories(); service.dispose(); pending.resolve(response({ categories: ['late'] })); expect(await load).toBe(false); expect(service.state.categories).toEqual([]);
  });
});
