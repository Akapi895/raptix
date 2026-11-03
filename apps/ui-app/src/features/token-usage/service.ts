import type { TokenUsageClient } from './client';
import type { TokenUsageBreakdown, TokenUsageStats, TokenUsageSummary, TrendMetric } from './types';

export function tokenUsageCount(value: unknown): number {
  const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}
export function tokenUsageCacheRate(summary?: TokenUsageSummary | null): string {
  const input = tokenUsageCount(summary?.promptTokens), cached = tokenUsageCount(summary?.cachedTokens);
  return input > 0 ? (Math.min(cached, input) / input * 100).toFixed(1) + '%' : '—';
}
export function tokenUsageMetrics(summary: TokenUsageSummary): [string, number | string | undefined][] {
  return [['usageTotal', summary.totalTokens], ['usageInput', tokenUsageCount(summary.promptTokens)], ['usageOutput', summary.completionTokens], ['usageCacheRead', tokenUsageCount(summary.cachedTokens)], ['usageCacheWrite', summary.cacheWriteTokens], ['usageReasoning', summary.reasoningTokens], ['usageCalls', summary.modelCalls], ['usageCacheRate', tokenUsageCacheRate(summary)]];
}
export function tokenUsageTimeline(rows?: TokenUsageBreakdown[] | null): TokenUsageBreakdown[] {
  const dated = (rows || []).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.key || '')).sort((a, b) => a.key.localeCompare(b.key));
  const first = dated[0], last = dated[dated.length - 1];
  if (!first || !last) return [];
  const byDay = new Map(dated.map(row => [row.key, row]));
  const start = Date.parse(first.key + 'T00:00:00Z'), end = Date.parse(last.key + 'T00:00:00Z');
  if (!Number.isFinite(start) || !Number.isFinite(end)) return dated;
  const days: TokenUsageBreakdown[] = [];
  // Server-local day keys are authoritative: fill only the interior gaps.
  for (let time = start; time <= end && days.length < 365; time += 86400000) {
    const key = new Date(time).toISOString().slice(0, 10);
    days.push(byDay.get(key) || { key, events: 0, totalTokens: 0, modelCalls: 0, promptTokens: 0 });
  }
  return days;
}
export interface TokenUsageState { days: number; loading: boolean; result: TokenUsageStats | null; trendMetric: TrendMetric }
export interface TokenUsageObserver { loading(days: number, projectId: string): void; render(state: Readonly<TokenUsageState>): void; settled(): void }
export function createTokenUsageService(client: TokenUsageClient, getActiveProjectId: () => string, observer: TokenUsageObserver) {
  const state: TokenUsageState = { days: 7, loading: false, result: null, trendMetric: 'totalTokens' };
  let controller: AbortController | null = null, sequence = 0, disposed = false;
  const snapshot = (): TokenUsageState => ({ ...state });
  function stop(): void {
    ++sequence; controller?.abort(); controller = null; state.loading = false; observer.settled();
  }
  async function refresh(): Promise<void> {
    if (disposed) return;
    stop();
    const request = sequence, current = new AbortController(); controller = current;
    state.loading = true;
    let projectId = ''; try { projectId = getActiveProjectId(); } catch { /* No accessible active project. */ }
    observer.loading(state.days, projectId);
    try {
      const result = await client.load(state.days, projectId, current.signal);
      if (disposed || request !== sequence) return;
      state.result = result; observer.render(snapshot());
    } catch {
      if (disposed || request !== sequence) return;
      state.result = null; observer.render(snapshot());
    } finally {
      if (!disposed && request === sequence) { state.loading = false; controller = null; observer.settled(); }
    }
  }
  return {
    snapshot, refresh, stop,
    changePeriod(value: string | number): Promise<void> { const days = Number(value); if (![7, 30, 90].includes(days)) return Promise.resolve(); state.days = days; return refresh(); },
    setTrend(metric: string): void { if (!['totalTokens', 'modelCalls', 'cacheRate'].includes(metric) || disposed) return; state.trendMetric = metric as TrendMetric; observer.render(snapshot()); },
    dispose(): void { if (disposed) return; stop(); disposed = true; },
  };
}
export type TokenUsageService = ReturnType<typeof createTokenUsageService>;
