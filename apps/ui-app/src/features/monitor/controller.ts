import { canonicalMonitorToolName, MONITOR_PAGE_SIZE_KEY, MONITOR_POLL_INTERVAL_MS, MONITOR_TIMELINE_RANGE_KEY, parsePageSize, paginationOf, type MonitorExecution, type MonitorPagination, type MonitorPayload, type MonitorSummary, type MonitorToolStat } from './model';
import type { MonitorService, TimelineResult } from './service';
import { isTimelineRange, renderKey, resolveTimelineRange, type TimelineRange } from './timeline';
import { getToolExecutionDisplayStatus } from '../tools/status';

export interface MonitorStorage {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
}

export interface MonitorFilters { status: string; tool: string }

export interface StatsPayload {
  summary: MonitorSummary | null;
  topTools: MonitorToolStat[];
  lastFetchedAt: Date | null;
  retentionDays: number;
  activeToolFilter: string;
  timeline: unknown;
  timelineError: string | null;
  timelineLoading: boolean;
  timelineRange: TimelineRange;
}

/** What the controller asks the view to paint. The view owns every DOM detail. */
export interface MonitorViewPort {
  stats(payload: StatsPayload): void;
  trend(payload?: StatsPayload): void;
  executions(list: MonitorExecution[], statusFilter: string): void;
  durations(list: MonitorExecution[]): void;
  pagination(pagination: MonitorPagination): void;
  selection(selected?: ReadonlySet<string>): void;
  error(message: string): void;
  toolFilterActive(active: boolean): void;
  /** Writes the tool box value (the filter input). */
  setToolBox(value: string): void;
  /** Only the stats subtitle, when the statistics themselves did not change. */
  subtitle(payload: StatsPayload): void;
  scrollToExecutions(): void;
}

export interface MonitorControllerDeps {
  service: MonitorService;
  storage: MonitorStorage;
  view: MonitorViewPort;
  /** Current status and tool filter as the page shows them. */
  filters(): MonitorFilters;
  isPageActive(): boolean;
  confirm(message: string): boolean;
  alert(message: string): void;
  /** Text for the messages the controller raises. */
  t(key: string, fallback: string, params?: Record<string, unknown>): string;
  /** Opens an execution's detail (owned by the chat page until it is migrated). */
  showDetail(id: string): void;
  /** Stops a running execution (owned by the chat page until it is migrated). */
  cancelExecution(id: string): void;
}

export interface MonitorState {
  executions: MonitorExecution[];
  summary: MonitorSummary | null;
  topTools: MonitorToolStat[];
  retentionDays: number;
  lastFetchedAt: Date | null;
  pagination: MonitorPagination;
  selected: Set<string>;
  timeline: unknown;
  timelineError: string | null;
  timelineLoading: boolean;
  timelineRange: TimelineRange;
  renderKeys: { stats: string; executions: string; pagination: string; timeline: string };
  fetchSeq: number;
  pollGeneration: number;
  pollTimer: ReturnType<typeof setTimeout> | null;
  filterTimer: ReturnType<typeof setTimeout> | null;
}

/** Keeps a tool filter in the form the API expects; `all` means no tool filter. */
export function canonicalFilter(tool: string): string {
  const raw = tool.trim() || 'all';
  return raw === 'all' ? 'all' : canonicalMonitorToolName(raw);
}

/** The tool box shows the namespace as `__`, as the chat does. */
function formatToolBox(tool: string): string {
  return tool.includes('::') ? tool.replace('::', '__') : tool;
}

export function createMonitorController(deps: MonitorControllerDeps) {
  const { service, storage, view, t } = deps;
  const state: MonitorState = {
    executions: [], summary: null, topTools: [], retentionDays: 0, lastFetchedAt: null,
    pagination: paginationOf(0, 1, parsePageSize(storage.get(MONITOR_PAGE_SIZE_KEY))),
    selected: new Set(), timeline: null, timelineError: null, timelineLoading: false,
    timelineRange: resolveTimelineRange(storage.get(MONITOR_TIMELINE_RANGE_KEY)),
    renderKeys: { stats: '', executions: '', pagination: '', timeline: '' },
    fetchSeq: 0, pollGeneration: 0, pollTimer: null, filterTimer: null,
  };

  function statsPayload(activeToolFilter: string): StatsPayload {
    return {
      summary: state.summary, topTools: state.topTools, lastFetchedAt: state.lastFetchedAt,
      retentionDays: state.retentionDays, activeToolFilter, timeline: state.timeline,
      timelineError: state.timelineError, timelineLoading: state.timelineLoading, timelineRange: state.timelineRange,
    };
  }

  /** Stores a trend result and repaints the trend only when it changed or was loading. */
  function applyTimeline(result: TimelineResult, range: TimelineRange): void {
    const wasLoading = state.timelineLoading;
    const key = renderKey([result.timeline, result.timelineError, range]);
    const changed = key !== state.renderKeys.timeline;
    state.timeline = result.timeline;
    state.timelineError = result.timelineError;
    state.timelineLoading = false;
    if (wasLoading || changed) {
      state.renderKeys.timeline = key;
      view.trend(statsPayload(canonicalFilter(deps.filters().tool)));
    }
  }

  /** Stores a page payload and repaints each block whose input changed. */
  function applyPayload(payload: MonitorPayload, status: string, tool: string, page: number, pageSize: number): void {
    state.executions = Array.isArray(payload.executions) ? payload.executions : [];
    state.summary = payload.summary ?? null;
    state.topTools = Array.isArray(payload.topTools) ? payload.topTools : [];
    state.lastFetchedAt = new Date();
    state.retentionDays = typeof payload.retentionDays === 'number' ? payload.retentionDays : 0;
    if (payload.total !== undefined) {
      state.pagination = {
        page: payload.page || page,
        pageSize: payload.pageSize || pageSize,
        total: payload.total || 0,
        totalPages: payload.totalPages || 1,
      };
    }
    const statsKey = renderKey([state.summary, state.topTools, state.retentionDays, tool]);
    if (statsKey !== state.renderKeys.stats) {
      state.renderKeys.stats = statsKey;
      view.stats(statsPayload(tool));
    } else {
      view.subtitle(statsPayload(tool));
    }
    const executionsKey = renderKey([state.executions, status || 'all', tool]);
    const executionsChanged = executionsKey !== state.renderKeys.executions;
    if (executionsChanged) {
      state.renderKeys.executions = executionsKey;
      view.executions(state.executions, status);
    } else {
      view.durations(state.executions);
    }
    const paginationKey = renderKey(state.pagination);
    if (executionsChanged || paginationKey !== state.renderKeys.pagination) {
      state.renderKeys.pagination = paginationKey;
      view.pagination(state.pagination);
    }
  }

  /** One refresh: the page and the trend in parallel. A newer request makes this one stale. */
  async function load(page: number | null, status: string, tool: string): Promise<void> {
    const seq = ++state.fetchSeq;
    const currentPage = page ?? state.pagination.page;
    const pageSize = state.pagination.pageSize;
    state.timelineLoading = state.timeline == null && !state.timelineError;
    const range = state.timelineRange;
    const trendPromise = service.timeline(range, t('mcpMonitor.timelineLoadError', 'Failed to load call trend'));
    try {
      const payload = await service.page(currentPage, pageSize, status, tool, t('mcpMonitor.loadExecutionsError', 'Failed to load execution records'));
      if (seq !== state.fetchSeq) return;
      applyPayload(payload, status, tool, currentPage, pageSize);
      const trend = await trendPromise;
      if (seq !== state.fetchSeq) return;
      applyTimeline(trend, range);
    } catch (error) {
      state.timelineLoading = false;
      view.error(error instanceof Error ? error.message : String(error));
    }
  }

  function refresh(page: number | null = null): Promise<void> {
    const { status, tool } = deps.filters();
    return load(page, status, canonicalFilter(tool));
  }

  /** Reads the filters and applies them. The tool box calls this after its debounce. */
  function applyFilters(): Promise<void> {
    const { status, tool } = deps.filters();
    const raw = tool.trim() || 'all';
    view.toolFilterActive(raw !== 'all');
    return load(1, status, canonicalFilter(raw));
  }

  function filterByTool(tool: string): void {
    view.setToolBox(formatToolBox(tool));
    view.toolFilterActive(true);
    void applyFilters();
    view.scrollToExecutions();
  }

  function clearToolFilter(): void {
    view.setToolBox('');
    view.toolFilterActive(false);
    void applyFilters();
  }

  /** A tool clicked in the statistics filters the list; clicking the active tool again clears it. */
  function toggleToolFilter(tool: string): void {
    if (deps.filters().tool.trim() === formatToolBox(tool)) clearToolFilter();
    else filterByTool(tool);
  }

  /** Checks or unchecks the given rows, used by the select-all control. */
  function setPageSelection(ids: string[], checked: boolean): void {
    ids.forEach(id => { if (checked) state.selected.add(id); else state.selected.delete(id); });
    view.selection(state.selected);
  }

  function schedule(generation: number): void {
    state.pollTimer = setTimeout(async () => {
      state.pollTimer = null;
      if (generation !== state.pollGeneration) return;
      try {
        if (!document.hidden && deps.isPageActive()) await refresh(null);
      } catch {
        // The refresh reports its own error; the loop keeps going.
      } finally {
        if (generation === state.pollGeneration && deps.isPageActive()) schedule(generation);
      }
    }, MONITOR_POLL_INTERVAL_MS);
  }

  function stopPolling(): void {
    state.pollGeneration++;
    if (state.pollTimer) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  return {
    state,
    refresh,
    applyFilters,

    /** The tool box waits for typing to settle before filtering. */
    scheduleToolFilter(): void {
      if (state.filterTimer) clearTimeout(state.filterTimer);
      state.filterTimer = setTimeout(() => { void applyFilters(); }, 500);
    },

    toggleToolFilter,
    filterByTool,
    clearToolFilter,

    setRange(range: string): void {
      if (!isTimelineRange(range)) return;
      storage.set(MONITOR_TIMELINE_RANGE_KEY, range);
      state.timelineRange = range;
      state.timelineError = null;
      state.timelineLoading = true;
      view.trend(statsPayload(canonicalFilter(deps.filters().tool)));
      void service.timeline(range, t('mcpMonitor.timelineLoadError', 'Failed to load call trend')).then(result => applyTimeline(result, range));
    },

    setPageSize(value: string): void {
      const size = parseInt(value, 10);
      if (Number.isNaN(size) || size <= 0) return;
      storage.set(MONITOR_PAGE_SIZE_KEY, String(size));
      state.pagination = { ...state.pagination, pageSize: size, page: 1 };
      void refresh(1);
    },

    goToPage(page: number): void {
      void refresh(page);
    },

    toggleSelect(id: string, checked: boolean): void {
      if (!id) return;
      if (checked) state.selected.add(id);
      else state.selected.delete(id);
      view.selection(state.selected);
    },

    setPageSelection,

    clearSelection(): void {
      state.selected.clear();
      view.selection(state.selected);
    },

    /** Starts the three-second loop; a new start cancels the previous one. */
    startPolling(): void {
      stopPolling();
      schedule(state.pollGeneration);
    },

    stopPolling,

    async deleteExecution(id: string): Promise<void> {
      if (!id) return;
      if (!deps.confirm(t('mcpMonitor.deleteExecConfirmSingle', 'Are you sure you want to delete this execution record? This cannot be undone.'))) return;
      try {
        await service.deleteExecution(id, t('mcpMonitor.deleteExecFailed', 'Failed to delete execution record'));
        state.selected.delete(id);
        await refresh(state.pagination.page);
        deps.alert(t('mcpMonitor.execDeleted', 'Execution record deleted'));
      } catch (error) {
        deps.alert(`${t('mcpMonitor.deleteExecFailed', 'Failed to delete execution record')}: ${(error as Error).message}`);
      }
    },

    async deleteSelected(): Promise<void> {
      const ids = [...state.selected];
      if (ids.length === 0) {
        deps.alert(t('mcpMonitor.selectExecFirst', 'Please select execution record(s) to delete first'));
        return;
      }
      if (!deps.confirm(t('mcpMonitor.batchDeleteConfirm', `Delete the ${ids.length} selected execution records? This cannot be undone.`, { count: ids.length }))) return;
      try {
        const deleted = await service.deleteExecutions(ids, t('mcp.batchDeleteFailed', 'Batch delete failed'));
        ids.forEach(id => state.selected.delete(id));
        await refresh(state.pagination.page);
        deps.alert(t('mcpMonitor.batchDeleteSuccess', `Deleted ${deleted} execution records`, { count: deleted }));
      } catch (error) {
        deps.alert(`${t('mcp.batchDeleteFailed', 'Batch delete failed')}: ${(error as Error).message}`);
      }
    },

    cancelExecution: deps.cancelExecution,
    openDetail: deps.showDetail,

    statusOf(exec: MonitorExecution): string {
      return getToolExecutionDisplayStatus(exec);
    },

    dispose(): void {
      stopPolling();
      if (state.filterTimer) clearTimeout(state.filterTimer);
    },
  };
}

export type MonitorController = ReturnType<typeof createMonitorController>;
