import { describe, expect, it, vi } from 'vitest';
import { createHttp } from '../../platform/http';
import { createTokenUsageClient, createTokenUsageService, tokenUsageCacheRate, tokenUsageCount, tokenUsageMetrics, tokenUsageTimeline, type TokenUsageStats } from './index';
import type { TokenUsageObserver } from './service';

const stats: TokenUsageStats = { summary: { events: 1, promptTokens: 100, cachedTokens: 25, totalTokens: 125, completionTokens: 25, modelCalls: 2 } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function setup() {
  let project = 'project / 1';
  const load = vi.fn(async (_days: number, _projectId: string, _signal: AbortSignal) => stats);
  const observer: TokenUsageObserver = { loading: vi.fn(), render: vi.fn(), settled: vi.fn() };
  const service = createTokenUsageService({ load }, () => project, observer);
  return { service, load, observer, project(value: string) { project = value; } };
}
describe('token usage public service', () => {
  it('keeps a separate seven-day default, supports only 7/30/90, captures the active project each refresh', async () => {
    const h = setup(); await h.service.refresh(); expect(h.load).toHaveBeenLastCalledWith(7, 'project / 1', expect.any(AbortSignal));
    h.project(''); await h.service.changePeriod('30'); expect(h.load).toHaveBeenLastCalledWith(30, '', expect.any(AbortSignal));
    await h.service.changePeriod(90); const count = h.load.mock.calls.length; await h.service.changePeriod('31'); expect(h.load).toHaveBeenCalledTimes(count); expect(h.service.snapshot().days).toBe(90);
  });
  it('aborts superseded requests and ignores stale responses even if the transport ignores abort', async () => {
    const h = setup(), old = deferred<TokenUsageStats>(); h.load.mockImplementationOnce(() => old.promise);
    const first = h.service.refresh(), signal = h.load.mock.calls[0]?.[2];
    await h.service.changePeriod(30); old.resolve({ summary: { totalTokens: 999 } }); await first;
    expect(signal?.aborted).toBe(true); expect(h.service.snapshot().result).toEqual(stats); expect(h.observer.render).toHaveBeenCalledTimes(1); expect(h.service.snapshot().loading).toBe(false);
  });
  it('stopping on navigation and disposal suppress late UI updates and release busy state', async () => {
    const h = setup(), pending = deferred<TokenUsageStats>(); h.load.mockImplementationOnce(() => pending.promise);
    const request = h.service.refresh(); h.service.stop(); pending.resolve(stats); await request;
    expect(h.observer.render).not.toHaveBeenCalled(); expect(h.service.snapshot().loading).toBe(false);
    const second = deferred<TokenUsageStats>(); h.load.mockImplementationOnce(() => second.promise);
    const request2 = h.service.refresh(); h.service.dispose(); second.resolve(stats); await request2; await h.service.refresh();
    expect(h.load).toHaveBeenCalledTimes(2); expect(h.load.mock.calls[1]?.[2].aborted).toBe(true); expect(h.observer.render).not.toHaveBeenCalled();
  });
  it('renders unavailable on API failure, retains cached data while switching valid trend metrics', async () => {
    const h = setup(); await h.service.refresh(); h.service.setTrend('cacheRate'); expect(h.service.snapshot()).toMatchObject({ result: stats, trendMetric: 'cacheRate' });
    const renders = vi.mocked(h.observer.render).mock.calls.length; h.service.setTrend('unsupported'); expect(h.observer.render).toHaveBeenCalledTimes(renders);
    h.load.mockRejectedValueOnce(new Error('forbidden')); await h.service.refresh(); expect(h.service.snapshot().result).toBeNull(); expect(h.service.snapshot().loading).toBe(false);
  });
  it('clamps counts and cache rates without double-counting cache/reasoning counters', () => {
    expect(tokenUsageCount(-1)).toBe(0); expect(tokenUsageCount('12.9')).toBe(12); expect(tokenUsageCount(Infinity)).toBe(0);
    expect(tokenUsageCacheRate(null)).toBe('—'); expect(tokenUsageCacheRate({ promptTokens: 10, cachedTokens: 20 })).toBe('100.0%'); expect(tokenUsageCacheRate(stats.summary)).toBe('25.0%');
    const metrics = new Map(tokenUsageMetrics({ ...stats.summary, cacheWriteTokens: 50, reasoningTokens: 20 })); expect(metrics.get('usageTotal')).toBe(125); expect(metrics.get('usageCacheWrite')).toBe(50); expect(metrics.get('usageReasoning')).toBe(20);
  });
  it('fills only interior server-day gaps, sorts without mutating the input, caps plots to 365 days', () => {
    const rows = [{ key: '2026-10-29', totalTokens: 20 }, { key: 'bad', totalTokens: 90 }, { key: '2026-10-27', totalTokens: 10 }];
    expect(tokenUsageTimeline(rows).map(row => [row.key, row.totalTokens])).toEqual([['2026-10-27', 10], ['2026-10-28', 0], ['2026-10-29', 20]]); expect(rows[0]?.key).toBe('2026-10-29');
    expect(tokenUsageTimeline([])).toEqual([]); expect(tokenUsageTimeline([{ key: '2024-01-01' }, { key: '2026-01-01' }])).toHaveLength(365);
  });
  it('uses the Go/mock query contract, URL-encodes project scope and passes cancellation and permission events', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(stats)).mockResolvedValueOnce(Response.json({ error: 'denied' }, { status: 403 }));
    const events = { emit: vi.fn() }, client = createTokenUsageClient(createHttp({ fetcher, events })), controller = new AbortController();
    expect(await client.load(30, 'project / 1', controller.signal)).toEqual(stats);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/usage/tokens?days=30&limit=20&project_id=project+%2F+1'); expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    await expect(client.load(7, '', controller.signal)).rejects.toMatchObject({ status: 403 });
    expect(events.emit).toHaveBeenCalledWith('forbidden', { url: '/api/usage/tokens?days=7&limit=20' });
  });
});
