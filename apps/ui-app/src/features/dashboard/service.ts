import type { KeyValueStorage } from '../../platform/storage';
import type { DashboardClient } from './client';
import type { AccessTab, AlertState, AlertStats, DashboardModel, DashboardResponses, FeedTab, SeverityStatus } from './types';

export const POLL_INTERVAL = 60_000;
export const STALE_THRESHOLD = 300_000;
const FILTER_KEY = 'raptix.dashboard.severityStatusFilter';
const DISMISSED_KEY = 'dashboard.dismissedAlert';
const LAST_REASONS_KEY = 'dashboard.alertLastReasons';
export function normalizeStatus(value: string | null): SeverityStatus {
  switch (value) {
    case 'open': case 'confirmed': case 'fixed': case 'ignored': case 'false_positive': return value;
    default: return '';
  }
}
export interface DashboardRuntime {
  now(): number;
  every(callback: () => void, ms: number): number;
  cancelEvery(id: number): void;
  isActive(): boolean;
  isVisible(): boolean;
}
export interface DashboardObserver {
  loading(): void;
  render(model: DashboardModel): void;
  error(error: unknown): void;
  stale(value: boolean): void;
  filter(status: SeverityStatus): void;
  alertDismissed(): void;
}
export interface DashboardContext { getActiveProjectId(): string; getLocale(): string }

export function createDashboardService(options: {
  client: DashboardClient; runtime: DashboardRuntime; storage: KeyValueStorage; sessionStorage: KeyValueStorage;
  context: DashboardContext; observer: DashboardObserver;
}) {
  const { client, runtime, storage, sessionStorage, context, observer } = options;
  let controller: AbortController | null = null;
  let sequence = 0;
  let pollTimer: number | null = null;
  let staleTimer: number | null = null;
  let lastUpdatedAt = 0;
  let status = normalizeStatus(storage.get(FILTER_KEY));
  let model: DashboardModel | null = null;
  let feedTab: FeedTab = 'vulns';
  let accessTab: AccessTab = 'c2';
  let disposed = false;

  function alertState(stats: AlertStats): AlertState {
    const keys: string[] = [];
    let level: AlertState['level'] = 'info';
    if (stats.criticalCount > 0) { keys.push(`crit:${stats.criticalCount}`); level = 'danger'; }
    if (stats.hitlPending > 0) keys.push(`hitl:${stats.hitlPending}`);
    if (stats.successRate >= 0 && stats.successRate < 80 && stats.failedTools > 0) keys.push(`rate:${Math.round(stats.successRate)}:${stats.failedTools}`);
    if (stats.externalMcpDown > 0) keys.push(`mcp:${stats.externalMcpDown}`);
    if (level === 'info' && keys.length) level = 'warning';
    const joined = keys.join(',');
    const fingerprint = `${level}|${joined}`;
    if (!keys.length) {
      sessionStorage.remove(LAST_REASONS_KEY);
      return { visible: false, level, keys, fingerprint: '' };
    }
    let dismissed = sessionStorage.get(DISMISSED_KEY);
    const last = new Set((sessionStorage.get(LAST_REASONS_KEY) ?? '').split(',').filter(Boolean));
    if (dismissed === fingerprint && keys.length < last.size && keys.every(key => last.has(key))) {
      sessionStorage.remove(DISMISSED_KEY);
      dismissed = null;
    }
    const visible = dismissed !== fingerprint;
    if (visible) sessionStorage.set(LAST_REASONS_KEY, joined);
    return { visible, level, keys, fingerprint };
  }

  function derive(responses: DashboardResponses, updatedAt: number): DashboardModel {
    const r = responses;
    const running = Array.isArray(r.tasks?.tasks) ? r.tasks.tasks.length : null;
    const queues = r.batch?.queues;
    const batch = Array.isArray(queues) ? { pending: 0, running: 0, done: 0, total: 0 } : null;
    if (batch && queues) {
      for (const queue of queues) {
        const s = (queue.status || '').toLowerCase();
        if (s === 'pending' || s === 'paused') batch.pending++;
        else if (s === 'running') batch.running++;
        else if (s === 'completed' || s === 'cancelled') batch.done++;
      }
      batch.total = batch.pending + batch.running + batch.done;
    }
    const stats = r.vulnerabilities;
    const open = {
      critical: stats ? r.openCritical?.total ?? stats.by_severity?.critical ?? 0 : 0,
      high: stats ? r.openHigh?.total ?? stats.by_severity?.high ?? 0 : 0,
      medium: stats ? r.openMedium?.total ?? stats.by_severity?.medium ?? 0 : 0,
      low: stats ? r.openLow?.total ?? stats.by_severity?.low ?? 0 : 0,
    };
    const display = status && r.filteredSeverity ? r.filteredSeverity : stats;
    const summary = r.monitor?.summary;
    const failedTools = summary?.failedCalls ?? 0;
    const success = summary?.successCalls ?? 0;
    const successRate = success + failedTools > 0 ? success / (success + failedTools) * 100 : -1;
    const mcp = r.externalMcp;
    const externalMcpDown = mcp && mcp.total > 0 && mcp.enabled > 0 ? Math.max(0, mcp.enabled - mcp.connected) : 0;
    const hitlPending = Array.isArray(r.hitl) ? r.hitl.length : Array.isArray(r.hitl?.items) ? r.hitl.items.length : r.hitl?.total ?? 0;
    const resources = {
      totalRunning: (running ?? 0) + (batch?.running ?? 0), totalVulns: stats?.total ?? 0,
      totalCalls: summary?.totalCalls ?? 0, toolsConfigured: r.tools?.total ?? 0, batchTotal: queues?.length ?? 0,
    };
    const alertStats = { criticalCount: open.critical, hitlPending, failedTools, successRate, externalMcpDown };
    const levelOrder: Record<string, number> = { p0: 0, p1: 1, p2: 2 };
    const events = (r.notifications?.items ?? []).filter(item => item?.type && item.type !== 'vulnerability_created')
      .sort((a, b) => ((levelOrder[a.level] ?? 9) - (levelOrder[b.level] ?? 9)) || (Date.parse(b.ts) - Date.parse(a.ts))).slice(0, 3);
    const webshell = (Array.isArray(r.webshell) ? r.webshell : r.webshell?.connections ?? []).slice()
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
    const score = open.critical * 10 + open.high * 5 + open.medium * 2 + open.low * 0.5;
    const risk: DashboardModel['risk'] = { score, level: score === 0 ? 'safe' : score <= 3 ? 'low' : score <= 10 ? 'medium' : score <= 30 ? 'high' : 'severe' };
    const byStatus = stats?.by_status;
    const resolution = { open: byStatus?.open ?? 0, confirmed: byStatus?.confirmed ?? 0, fixed: byStatus?.fixed ?? 0,
      fp: byStatus?.false_positive ?? 0, ignored: byStatus?.ignored ?? 0, actionable: 0, rate: 0 };
    resolution.actionable = resolution.open + resolution.confirmed + resolution.fixed;
    resolution.rate = resolution.actionable > 0 ? resolution.fixed / resolution.actionable * 100 : 0;
    return {
      responses, status, updatedAt, running, batch, open, severity: display?.by_severity ?? {}, severityTotal: display?.total ?? 0,
      toolCount: summary?.toolCount ?? 0, totalCalls: summary?.totalCalls ?? 0, successRate, failedTools, externalMcpDown,
      hitlPending, resources, alertStats, alert: alertState(alertStats), events, webshell, risk, resolution,
      recommendation: { openCriticalCount: open.critical, hitlPending, externalMcpDown, successRate, failedTools,
        toolsConfigured: resources.toolsConfigured, totalVulns: resources.totalVulns, totalRunning: resources.totalRunning },
    };
  }
  function checkStale(): void { if (lastUpdatedAt) observer.stale(runtime.now() - lastUpdatedAt > STALE_THRESHOLD); }
  function startAutoRefresh(): void {
    if (disposed || pollTimer !== null) return;
    pollTimer = runtime.every(() => { if (runtime.isActive() && runtime.isVisible()) void refresh(); }, POLL_INTERVAL);
    staleTimer = runtime.every(checkStale, 30_000);
  }
  function stopAutoRefresh(): void {
    if (pollTimer !== null) runtime.cancelEvery(pollTimer);
    if (staleTimer !== null) runtime.cancelEvery(staleTimer);
    pollTimer = staleTimer = null;
  }
  async function refresh(): Promise<void> {
    if (disposed) return;
    controller?.abort();
    const current = new AbortController();
    controller = current;
    const request = ++sequence;
    const projectId = context.getActiveProjectId();
    const locale = context.getLocale();
    const selectedStatus = status;
    observer.filter(status);
    if (!lastUpdatedAt) observer.loading();
    try {
      const responses = await client.load({ projectId, locale, status: selectedStatus, signal: current.signal });
      // Sequence protects even transports that do not honor AbortSignal.
      if (disposed || current.signal.aborted || request !== sequence || projectId !== context.getActiveProjectId() || locale !== context.getLocale()) return;
      lastUpdatedAt = runtime.now();
      model = derive(responses, lastUpdatedAt);
      observer.render(model);
      observer.stale(false);
    } catch (error) {
      if (!current.signal.aborted && request === sequence && !disposed) observer.error(error);
    } finally {
      if (controller === current) controller = null;
      startAutoRefresh();
    }
  }
  return {
    refresh, startAutoRefresh, stopAutoRefresh, checkStale,
    getModel: () => model,
    getStatus: () => status,
    updateStatus(value: string): Promise<void> {
      status = normalizeStatus(value);
      if (status) storage.set(FILTER_KEY, status); else storage.remove(FILTER_KEY);
      observer.filter(status);
      return refresh();
    },
    dismissAlert(): void {
      sessionStorage.set(DISMISSED_KEY, model?.alert.fingerprint ?? '');
      if (model) model.alert = { ...model.alert, visible: false };
      observer.alertDismissed();
    },
    visibilityChanged(): void {
      if (!runtime.isVisible() || !runtime.isActive()) return;
      if (runtime.now() - lastUpdatedAt >= POLL_INTERVAL / 2) void refresh(); else checkStale();
    },
    languageChanged(): void { if (runtime.isActive()) void refresh(); },
    getFeedTab: () => feedTab,
    setFeedTab(value: string): FeedTab { feedTab = value === 'facts' ? 'facts' : 'vulns'; return feedTab; },
    getAccessTab: () => accessTab,
    setAccessTab(value: string): AccessTab { accessTab = value === 'webshell' ? 'webshell' : 'c2'; return accessTab; },
    dispose(): void { disposed = true; sequence++; controller?.abort(); controller = null; stopAutoRefresh(); },
  };
}
export type DashboardService = ReturnType<typeof createDashboardService>;
