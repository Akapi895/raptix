import { describe, expect, it, vi } from 'vitest';
import { createHttp, HttpError } from '../../platform/http';
import type { KeyValueStorage } from '../../platform/storage';
import { createAuditClient, createAuditService, buildAuditQuery, auditDatetimeLocalToRFC3339, auditPresetRange, auditResourceDestination, auditResourceUnavailable, buildMonthGrid, parseStorage, partsToStorage, formatAuditTime, type AuditFilters, type AuditLog, type AuditPage } from './index';
import type { AuditObserver } from './service';

const filters: AuditFilters = { category: 'auth', action: 'login', result: 'failure', q: '  <ip> & user  ', since: '2026-10-29T10:15', until: '2026-10-29T11:45' };
const log: AuditLog = { id: 'log/1', createdAt: '2026-10-29T00:00:00Z', level: 'info', category: 'conversation', action: 'create', result: 'success', actor: 'admin', message: 'created', resourceType: 'conversation', resourceId: 'conversation-1' };
const page = (total = 21): AuditPage => ({ logs: [log], total, page: 1, page_size: 20 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
function setup(saved = '20') {
  const list = vi.fn(async (_query: string, _signal?: AbortSignal) => page());
  const summary = vi.fn(async () => ({ total: 21, failures: 2, recent_7d: 5 }));
  const exportBlob = vi.fn(async (_query: string, _format: 'json' | 'csv') => new Blob(['export']));
  const storage: KeyValueStorage = { get: () => saved, set: vi.fn(() => true), remove: () => true };
  const observer: AuditObserver = { loading: vi.fn(), loaded: vi.fn(), summary: vi.fn(), error: vi.fn() };
  const service = createAuditService({ list, summary, export: exportBlob, detail: async () => log, conversationExists: async () => true }, storage, observer);
  return { service, list, summary, exportBlob, storage, observer };
}

describe('audit public service and date contracts', () => {
  it('keeps filter names, trims search, converts local minutes to UTC, omits paging from export', () => {
    const query = new URLSearchParams(buildAuditQuery(filters, { page: 3, pageSize: 50 }));
    expect(Object.fromEntries(query)).toEqual({ page: '3', page_size: '50', category: 'auth', action: 'login', result: 'failure', q: '<ip> & user', since: new Date(2026, 9, 29, 10, 15).toISOString(), until: new Date(2026, 9, 29, 11, 45).toISOString() });
    expect(new URLSearchParams(buildAuditQuery(filters)).has('page_size')).toBe(false);
    expect(auditDatetimeLocalToRFC3339('not a date')).toBe('');
    expect(auditDatetimeLocalToRFC3339('')).toBe('');
  });
  it('persists supported page sizes, retains filters on refresh, and clamps a shrinking last page', async () => {
    const h = setup('50'); expect(h.service.snapshot().pageSize).toBe(50);
    await h.service.filter(filters);
    h.list.mockResolvedValueOnce(page(101)); await h.service.refresh(filters, 3);
    expect(new URLSearchParams(h.list.mock.calls.at(-1)?.[0])).toEqual(new URLSearchParams(buildAuditQuery(filters, { page: 3, pageSize: 50 })));
    h.list.mockResolvedValueOnce(page(1)).mockResolvedValueOnce(page(1)); await h.service.refresh();
    expect(h.service.snapshot().page).toBe(1);
    expect(h.list.mock.calls.at(-1)?.[0]).toContain('category=auth');
    await h.service.pageSize(10); expect(h.storage.set).toHaveBeenCalledWith('raptix_audit_page_size', '10');
    const calls = h.list.mock.calls.length; await h.service.pageSize(15); await h.service.goPage(999);
    expect(h.list).toHaveBeenCalledTimes(calls);
    expect(setup('bad').service.snapshot().pageSize).toBe(20);
  });
  it('does not let stale list or summary responses overwrite newer filters', async () => {
    const h = setup(), old = deferred<AuditPage>(), recentSummary = deferred<{ total: number }>();
    h.list.mockImplementationOnce(() => old.promise);
    const first = h.service.filter(filters), signal = h.list.mock.calls[0]?.[1];
    await h.service.filter({ ...filters, q: 'new' }); old.resolve(page(500)); await first;
    expect(signal?.aborted).toBe(true); expect(h.service.snapshot().total).toBe(21); expect(h.observer.loaded).toHaveBeenCalledTimes(1);
    h.summary.mockImplementationOnce(() => recentSummary.promise.then(value => ({ ...value, failures: 0, recent_7d: 0 })));
    const pending = h.service.refresh(); await Promise.resolve();
    await h.service.filter({ ...filters, q: 'latest' });
    const calls = vi.mocked(h.observer.summary).mock.calls.length; recentSummary.resolve({ total: 999 }); await pending;
    expect(h.observer.summary).toHaveBeenCalledTimes(calls);
  });
  it('reports list errors, tolerates summary errors, and aborts work on disposal', async () => {
    const h = setup(); h.list.mockRejectedValueOnce(new Error('forbidden')); await h.service.load();
    expect(h.observer.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'forbidden' }));
    h.summary.mockRejectedValueOnce(new Error('summary unavailable')); await h.service.load(); expect(h.observer.loaded).toHaveBeenCalledTimes(1);
    const pending = deferred<AuditPage>(); h.list.mockImplementationOnce(() => pending.promise);
    const request = h.service.load(), signal = h.list.mock.calls.at(-1)?.[1]; h.service.dispose(); pending.resolve(page(99)); await request;
    expect(signal?.aborted).toBe(true); expect(h.observer.loaded).toHaveBeenCalledTimes(1);
    const calls = h.list.mock.calls.length; await h.service.load(); expect(h.list).toHaveBeenCalledTimes(calls);
  });
  it('exports the current filters without pagination in either format', async () => {
    const h = setup(); await h.service.filter(filters); await h.service.export('csv');
    expect(h.exportBlob).toHaveBeenCalledWith(buildAuditQuery(filters), 'csv');
    await h.service.export('json', { ...filters, q: 'edited before filtering' });
    expect(h.exportBlob.mock.calls.at(-1)?.[0]).toContain('q=edited+before+filtering');
  });
  it('preserves removed-resource suppression and all destination families', () => {
    expect(auditResourceDestination(log)).toEqual({ page: 'chat', conversationId: 'conversation-1' });
    expect(auditResourceDestination({ ...log, action: 'delete' })).toBeNull();
    expect(auditResourceUnavailable({ ...log, resourceAvailable: false })).toBe(true);
    for (const [type, destination] of Object.entries({ vulnerability: 'vulnerabilities', batch_queue: 'tasks', c2_listener: 'c2-listeners', c2_session: 'c2-sessions', c2_task: 'c2-tasks', webshell_connection: 'webshell', knowledge_item: 'knowledge-management', chat_upload: 'chat-files', tool_execution: 'mcp-monitor' })) expect(auditResourceDestination({ ...log, resourceType: type })?.page).toBe(destination);
    for (const type of ['role', 'skill', 'markdown_agent']) expect(auditResourceDestination({ ...log, resourceType: type })).toEqual({ page: 'settings', section: 'roles' });
    expect(auditResourceDestination({ ...log, resourceType: '', resourceId: 'c2_unknown' })).toBeNull();
  });
  it('uses local midnight for today, exact elapsed durations for rolling presets, and six calendar weeks', () => {
    const now = new Date(2026, 2, 8, 15, 31);
    expect(auditPresetRange('today', now)?.since).toEqual(new Date(2026, 2, 8));
    for (const [preset, duration] of [['15m', 900000], ['1h', 3600000], ['24h', 86400000], ['7d', 604800000]] as const) expect(now.getTime() - (auditPresetRange(preset, now)?.since.getTime() ?? 0)).toBe(duration);
    expect(auditPresetRange('bad', now)).toBeNull();
    const grid = buildMonthGrid(2024, 2); expect(grid).toHaveLength(42); expect(grid.filter(cell => cell.inMonth)).toHaveLength(29);
    expect(new Date(grid[0]?.y ?? 0, (grid[0]?.m ?? 0) - 1, grid[0]?.d).getDay()).toBe(0);
    const stored = '2026-10-29T00:07'; expect(partsToStorage(parseStorage(stored))).toBe(stored); expect(parseStorage('bad')).toBeNull();
    expect(formatAuditTime('invalid', 'en-US')).toBe('invalid'); expect(formatAuditTime(log.createdAt, 'en-US')).toContain('2026');
  });
});

describe('audit public HTTP client compatibility and permission transport', () => {
  it('accepts both Go and demo detail envelopes and encodes IDs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ log })).mockResolvedValueOnce(Response.json(log));
    const client = createAuditClient(createHttp({ fetcher }));
    expect(await client.detail('log/1')).toEqual(log); expect(await client.detail('log/1')).toEqual(log);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/audit/logs/log%2F1');
  });
  it('uses authenticated raw exports, preserves bytes, forwards HTTP permission errors and expiry', async () => {
    const events = { emit: vi.fn() }, sessions = { read: () => ({ token: 'test-token' }), clear: vi.fn() };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('header\r\nvalue', { headers: { 'Content-Type': 'text/csv' } })).mockResolvedValueOnce(Response.json({ error: 'denied' }, { status: 403 })).mockResolvedValueOnce(Response.json({ error: 'expired' }, { status: 401 }));
    const client = createAuditClient(createHttp({ fetcher, session: sessions, events }));
    expect(await (await client.export('category=auth', 'csv')).text()).toBe('header\r\nvalue');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/audit/logs/export?category=auth&format=csv');
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer test-token');
    await expect(client.export('', 'json')).rejects.toMatchObject({ status: 403, message: 'denied' });
    expect(events.emit).toHaveBeenCalledWith('forbidden', { url: '/api/audit/logs/export?' });
    await expect(client.list('page=1')).rejects.toBeInstanceOf(HttpError); expect(sessions.clear).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith('session-expired', { url: '/api/audit/logs?page=1' });
  });
  it('distinguishes missing conversations from network failure before resource navigation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 404 })).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json({ id: 'present' }));
    const client = createAuditClient(createHttp({ fetcher }));
    expect(await client.conversationExists('missing')).toBe(false); expect(await client.conversationExists('offline')).toBeNull(); expect(await client.conversationExists('present')).toBe(true);
  });
});
