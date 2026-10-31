import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStorage } from '../../platform/storage';
import { createDashboardService, POLL_INTERVAL, STALE_THRESHOLD, type DashboardObserver } from './service';
import type { DashboardClient } from './client';
import type { DashboardModel, DashboardResponses, VulnerabilityStats } from './types';

function memoryStorage() {
  const data = new Map<string, string>();
  return createStorage(() => ({
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear(), key: (index: number) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  }));
}
function emptyResponses(): DashboardResponses {
  return { tasks: null, vulnerabilities: null, batch: null, monitor: null, knowledge: null, skills: null,
    recentVulnerabilities: null, roles: null, agents: null, openCritical: null, openHigh: null, openMedium: null,
    openLow: null, tools: null, hitl: null, notifications: null, externalMcp: null, webshell: null,
    listeners: null, sessions: null, c2Tasks: null, projects: null, filteredSeverity: null, tokens: null };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function setup(initial: DashboardResponses = emptyResponses()) {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
  let data = initial;
  let project = 'project-a', locale = 'en-US', active = true, visible = true;
  const storage = memoryStorage(), sessionStorage = memoryStorage();
  const load = vi.fn<DashboardClient['load']>(async () => data);
  const renders: DashboardModel[] = [];
  const observer: DashboardObserver = {
    loading: vi.fn(), render: vi.fn(model => { renders.push(model); }), error: vi.fn(), stale: vi.fn(), filter: vi.fn(), alertDismissed: vi.fn(),
  };
  // Runtime IDs intentionally match the browser contract while Vitest owns the real clock handles.
  let nextTimer = 0;
  const timers = new Map<number, ReturnType<typeof setInterval>>();
  const service = createDashboardService({
    client: { load }, storage, sessionStorage, observer,
    context: { getActiveProjectId: () => project, getLocale: () => locale },
    runtime: {
      now: () => Date.now(), isActive: () => active, isVisible: () => visible,
      every(callback, ms) { const id = ++nextTimer; timers.set(id, setInterval(callback, ms)); return id; },
      cancelEvery(id) { const timer = timers.get(id); if (timer) clearInterval(timer); timers.delete(id); },
    },
  });
  return { service, load, observer, renders, storage, sessionStorage,
    setData(value: DashboardResponses) { data = value; },
    setProject(value: string) { project = value; }, setLocale(value: string) { locale = value; },
    setActive(value: boolean) { active = value; }, setVisible(value: boolean) { visible = value; },
  };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
const vulnerabilityStats: VulnerabilityStats = {
  total: 20, by_severity: { critical: 8, high: 6, medium: 4, low: 2 }, by_status: { open: 3, confirmed: 2, fixed: 10, ignored: 4, false_positive: 1 },
};

describe('dashboard service public behavior', () => {
  it('discards an older refresh even when its transport ignores abort', async () => {
    const h = setup(); const old = deferred<DashboardResponses>(), fresh = deferred<DashboardResponses>();
    h.load.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise);
    const first = h.service.refresh(); const signal = h.load.mock.calls[0]?.[0].signal;
    const second = h.service.refresh(); expect(signal?.aborted).toBe(true);
    fresh.resolve({ ...emptyResponses(), tasks: { tasks: ['new'] } }); await second;
    old.resolve({ ...emptyResponses(), tasks: { tasks: ['old', 'old'] } }); await first;
    expect(h.renders).toHaveLength(1); expect(h.service.getModel()?.running).toBe(1);
    h.service.dispose();
  });
  it('captures scope and language per refresh and does not publish results after scope changes', async () => {
    const h = setup(); const pending = deferred<DashboardResponses>(); h.load.mockReturnValueOnce(pending.promise);
    const request = h.service.refresh();
    expect(h.load.mock.calls[0]?.[0]).toMatchObject({ projectId: 'project-a', locale: 'en-US', status: '' });
    h.setProject('project-b'); pending.resolve(emptyResponses()); await request;
    expect(h.renders).toHaveLength(0);
    h.setLocale('zh-CN'); await h.service.refresh();
    expect(h.load.mock.calls[1]?.[0]).toMatchObject({ projectId: 'project-b', locale: 'zh-CN' }); h.service.dispose();
  });
  it('uses open cross-counts for risk and alerting, but filtered counts only for the severity chart', async () => {
    const h = setup({ ...emptyResponses(), vulnerabilities: vulnerabilityStats,
      openCritical: { total: 0 }, openHigh: { total: 0 }, openMedium: { total: 1 }, openLow: { total: 2 },
      filteredSeverity: { total: 10, by_severity: { critical: 7, high: 3 }, by_status: { fixed: 10 } },
    });
    await h.service.updateStatus('fixed');
    expect(h.service.getModel()).toMatchObject({
      status: 'fixed', severity: { critical: 7, high: 3 }, severityTotal: 10,
      risk: { score: 3, level: 'low' }, alert: { visible: false },
      resolution: { actionable: 15, rate: 66.66666666666666 },
    });
    expect(h.storage.get('raptix.dashboard.severityStatusFilter')).toBe('fixed');
    await h.service.updateStatus('unrecognized'); expect(h.service.getStatus()).toBe('');
    expect(h.storage.get('raptix.dashboard.severityStatusFilter')).toBeNull(); h.service.dispose();
  });
  it('falls back conservatively when open-count or filtered-stat endpoints fail', async () => {
    const h = setup({ ...emptyResponses(), vulnerabilities: vulnerabilityStats });
    await h.service.updateStatus('open');
    expect(h.service.getModel()).toMatchObject({ severityTotal: 20, open: { critical: 8, high: 6 }, risk: { level: 'severe' }, alert: { visible: true, level: 'danger' } });
    h.service.dispose();
  });
  it('excludes blocked/in-flight calls from success rate and paused/cancelled queues count in their original groups', async () => {
    const h = setup({ ...emptyResponses(), tasks: { tasks: ['running'] },
      batch: { queues: [{ status: 'running' }, { status: 'paused' }, { status: 'pending' }, { status: 'completed' }, { status: 'cancelled' }, { status: 'failed' }] },
      monitor: { summary: { totalCalls: 100, successCalls: 8, failedCalls: 2, blockedCalls: 90, toolCount: 4 }, topTools: [] },
    });
    await h.service.refresh();
    expect(h.service.getModel()).toMatchObject({ successRate: 80, batch: { pending: 2, running: 1, done: 2, total: 5 }, resources: { totalRunning: 2, batchTotal: 6 } });
    h.service.dispose();
  });
  it('persists alert dismissal across language changes and reopens a changed reason set', async () => {
    const responses = { ...emptyResponses(), vulnerabilities: vulnerabilityStats };
    const h = setup(responses); await h.service.refresh(); h.service.dismissAlert();
    expect(h.observer.alertDismissed).toHaveBeenCalledOnce();
    h.setLocale('zh-CN'); await h.service.refresh(); expect(h.service.getModel()?.alert.visible).toBe(false);
    h.setData({ ...responses, hitl: { items: ['approval'] } }); await h.service.refresh();
    expect(h.service.getModel()?.alert.visible).toBe(true);
    // Once the larger set was shown, resolving HITL must remind about the remaining critical issue,
    // even though precisely that smaller set was dismissed earlier in the session.
    h.setData(responses); await h.service.refresh(); expect(h.service.getModel()?.alert.visible).toBe(true);
    expect(h.sessionStorage.get('dashboard.dismissedAlert')).toBeNull(); h.service.dispose();
  });
  it('counts only enabled but disconnected MCP servers and prioritizes event levels before recency', async () => {
    const h = setup({ ...emptyResponses(), externalMcp: { total: 5, enabled: 3, disabled: 2, connected: 1 },
      notifications: { items: [
        { id: 'new', type: 'task_done', level: 'p2', title: '', desc: '', ts: '2026-10-28T12:00:00Z' },
        { id: 'covered', type: 'vulnerability_created', level: 'p0', title: '', desc: '', ts: '2026-10-28T12:00:00Z' },
        { id: 'approval', type: 'hitl_pending', level: 'p0', title: '', desc: '', ts: '2026-10-28T10:00:00Z' },
      ] },
    });
    await h.service.refresh(); expect(h.service.getModel()?.externalMcpDown).toBe(2);
    expect(h.service.getModel()?.events.map(item => item.id)).toEqual(['approval', 'new']); h.service.dispose();
  });
  it('polls only an active visible dashboard and resumes immediately after half an interval', async () => {
    const h = setup(); await h.service.refresh();
    h.service.startAutoRefresh(); // idempotent
    h.setVisible(false); await vi.advanceTimersByTimeAsync(POLL_INTERVAL); expect(h.load).toHaveBeenCalledTimes(1);
    h.setVisible(true); h.setActive(false); await vi.advanceTimersByTimeAsync(POLL_INTERVAL); expect(h.load).toHaveBeenCalledTimes(1);
    h.setActive(true); h.service.visibilityChanged(); await Promise.resolve(); expect(h.load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000); h.service.visibilityChanged(); expect(h.load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(50_000); expect(h.load).toHaveBeenCalledTimes(3); h.service.dispose();
  });
  it('marks old data stale, retains existing content during refresh, and stops timers on dispose', async () => {
    const h = setup(); await h.service.refresh(); h.setVisible(false);
    await vi.advanceTimersByTimeAsync(STALE_THRESHOLD + 30_000); expect(h.observer.stale).toHaveBeenLastCalledWith(true);
    await h.service.refresh(); expect(h.observer.stale).toHaveBeenLastCalledWith(false); expect(h.observer.loading).toHaveBeenCalledTimes(1);
    const count = h.load.mock.calls.length; h.service.dispose(); h.setVisible(true); await vi.advanceTimersByTimeAsync(POLL_INTERVAL * 2);
    expect(h.load).toHaveBeenCalledTimes(count); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not publish an in-flight refresh after disposal', async () => {
    const h = setup(); const pending = deferred<DashboardResponses>(); h.load.mockReturnValueOnce(pending.promise);
    const request = h.service.refresh(); h.service.dispose(); pending.resolve(emptyResponses()); await request;
    expect(h.renders).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('starts polling after a failed first load and retries without an unhandled rejection', async () => {
    const h = setup(); const failure = new Error('offline'); h.load.mockRejectedValueOnce(failure);
    await h.service.refresh(); expect(h.observer.error).toHaveBeenCalledWith(failure);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL); expect(h.renders).toHaveLength(1); h.service.dispose();
  });
});
