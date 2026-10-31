import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationRuntime } from '../../platform/notification-browser';
import { createNotificationClient } from './client';
import { createNotificationService, LAST_SEEN_KEY } from './service';
import type { NotificationDependencies, NotificationItem, Request } from './types';

function setup(stored = '123') {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  const data = new Map<string, string>([[LAST_SEEN_KEY, stored]]);
  let hidden = false, locale = 'en-US';
  const timers = new Map<number, ReturnType<typeof setTimeout>>(); let sequence = 0;
  const runtime: NotificationRuntime = {
    now: Date.now,
    after(callback, ms) { const id = ++sequence; timers.set(id, setTimeout(callback, ms)); return id; },
    cancel(id) { clearTimeout(timers.get(id)); timers.delete(id); }, every: () => { throw new Error('Not used'); }, cancelEvery: () => {},
  };
  const items: NotificationItem[] = [
    { id: 'vuln', type: 'vulnerability_created', vulnerabilityId: 'v<&', level: 'p0' },
    { id: 'hitl', type: 'hitl_pending', actionable: true, level: 'p0', count: 5 },
    { id: 'task', type: 'task_completed', conversationId: 'chat/?', level: 'p2' },
  ];
  const request = vi.fn<Request>(async url => new Response(JSON.stringify(url.includes('/read') ? { success: true } : { items })));
  const render = vi.fn(), navigate = vi.fn();
  const deps: NotificationDependencies = { request, translate: key => key, locale: () => locale, runtime, navigate, canMarkAll: () => true,
    storage: { get: key => data.get(key) ?? null, set: (key, value) => { data.set(key, value); return true; }, remove: key => data.delete(key) } };
  const service = createNotificationService(createNotificationClient(request), deps, render, () => hidden);
  return { service, request, deps, data, render, navigate, items, setHidden(value: boolean) { hidden = value; }, setLocale(value: string) { locale = value; } };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('notification service', () => {
  it('uses persisted millisecond cursor, request language, Go links and weighted P0 fallback', async () => {
    const h = setup(); await h.service.refresh();
    expect(h.request).toHaveBeenCalledWith('/api/notifications/summary?since=123&limit=80&lang=en-US', undefined);
    expect(h.service.getModel()).toMatchObject({ unreadCount: 6, lastSeenAt: 123 });
    await h.service.view('vuln'); expect(h.navigate).toHaveBeenCalledWith(h.items[0]);
    expect(h.request.mock.calls.find(([url]) => url.endsWith('/read'))?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ eventIds: ['vuln'] }) });
    h.request.mockClear(); await h.service.view('hitl'); expect(h.navigate).toHaveBeenLastCalledWith(h.items[1]); expect(h.request).not.toHaveBeenCalled();
    await h.service.view('missing'); expect(h.navigate).toHaveBeenCalledTimes(2); h.service.dispose();
  });
  it('marks all non-actionable items and persists the cursor only after a successful read', async () => {
    const h = setup(); await h.service.refresh(); await h.service.markAll();
    expect(h.request.mock.calls.find(([url]) => url.endsWith('/read'))?.[1]?.body).toBe(JSON.stringify({ eventIds: ['vuln', 'task'] }));
    expect(h.data.get(LAST_SEEN_KEY)).toBe('100000'); expect(h.request.mock.lastCall?.[0]).toContain('since=100000');
    vi.setSystemTime(200_000); h.request.mockResolvedValueOnce(new Response('{}', { status: 403 })); await h.service.markAll();
    expect(h.data.get(LAST_SEEN_KEY)).toBe('100000'); h.service.dispose();
  });
  it('uses server unreadCount (including zero), clamps negatives, handles sparse/failing summaries', async () => {
    const h = setup('bad');
    h.request.mockResolvedValueOnce(new Response(JSON.stringify({ unreadCount: '0', items: h.items }))); await h.service.refresh();
    expect(h.service.getModel()).toMatchObject({ unreadCount: 0, lastSeenAt: 0 });
    h.request.mockResolvedValueOnce(new Response('{"unreadCount":-8}')); await h.service.refresh(); expect(h.service.getModel().unreadCount).toBe(0);
    h.request.mockRejectedValueOnce(new Error('offline')); await h.service.refresh(); expect(h.service.getModel().items).toEqual([]); h.service.dispose();
  });
  it('defers outside-menu opening, toggles closed, polls at 15s/60s and reads the latest locale', async () => {
    const h = setup(); h.service.activate(); await vi.advanceTimersByTimeAsync(0);
    h.service.toggle(); expect(h.service.getModel().open).toBe(false); await vi.advanceTimersByTimeAsync(0); expect(h.service.getModel().open).toBe(true);
    h.service.toggle(); expect(h.service.getModel().open).toBe(false);
    h.request.mockClear(); await vi.advanceTimersByTimeAsync(15_000); expect(h.request).toHaveBeenCalledTimes(1);
    h.setHidden(true); h.service.visibilityChanged(); h.setLocale('zh-CN');
    await vi.advanceTimersByTimeAsync(59_999); expect(h.request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(h.request.mock.lastCall?.[0]).toContain('lang=zh-CN');
    h.service.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('suppresses overlapping loads, denies mark-all when guarded and ignores responses after disposal', async () => {
    const h = setup(); let resolve!: (value: Response) => void;
    h.request.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const load = h.service.refresh(); await h.service.refresh(); expect(h.request).toHaveBeenCalledTimes(1);
    h.deps.canMarkAll = () => false; await h.service.markAll(); expect(h.request).toHaveBeenCalledTimes(1);
    h.service.toggle(); h.service.dispose(); resolve(new Response('{"unreadCount":44}')); await load;
    expect(h.render).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
