import { createActions, type Actions } from '../../ui/actions';
import type { KeyValueStorage } from '../../platform/storage';
import type { RequestFn } from '../roles/service';
import { createMonitorController, type MonitorController } from './controller';
import { createMonitorService } from './service';
import { createMonitorView, type MonitorView } from './view';
import type { StatsText } from './stats';

export { createMonitorService, MonitorError } from './service';
export { createMonitorController } from './controller';
export { createMonitorView } from './view';
export * from './model';
export * from './timeline';

export interface MonitorFeatureDeps {
  doc: Document;
  storage: KeyValueStorage;
  request: RequestFn;
  actions?: Actions;
  /** Translation of a full key; a missing key returns the key itself. */
  translate(key: string, params?: Record<string, unknown>): string;
  locale(): string;
  confirm(message: string): boolean;
  alert(message: string): void;
  showDetail(id: string): void;
  cancelExecution(id: string): void;
  isPageActive(): boolean;
  initPaginationSelects?(root: HTMLElement): void;
}

export interface MonitorFeature {
  controller: MonitorController;
  view: MonitorView;
  /** Binds the page's actions and skins the status filter. */
  activate(): void;
  /** Re-renders the statistics and executions from the state; used after a language change. */
  repaint(): void;
  dispose(): void;
}

/** Composition root for the MCP monitor page. */
export function initMonitor(deps: MonitorFeatureDeps): MonitorFeature {
  const { doc } = deps;
  const service = createMonitorService(deps.request);
  const ctx = (): StatsText => ({
    locale: deps.locale(),
    t: (key, params) => {
      const full = `mcpMonitor.${key}`;
      const value = deps.translate(full, { ...params, interpolation: { escapeValue: false } });
      return value && value !== full ? value : '';
    },
    formatTime: value => value.toLocaleString(deps.locale()),
  });
  const translate = (key: string, fallback: string, params?: Record<string, unknown>) => {
    const value = deps.translate(key, params);
    return value && value !== key ? value : fallback;
  };
  // The view and the controller refer to each other; both are only called after both exist.
  const hooks: { controller?: MonitorController } = {};
  const view: MonitorView = createMonitorView({
    doc,
    ctx,
    initPaginationSelects: root => deps.initPaginationSelects?.(root),
    onStatsTool: tool => hooks.controller?.toggleToolFilter(tool),
    onStatsClearTool: () => hooks.controller?.clearToolFilter(),
    onRange: range => hooks.controller?.setRange(range),
  });
  const controller = createMonitorController({
    service,
    storage: deps.storage,
    view,
    filters: () => ({ status: view.readStatus(), tool: view.readToolBox() }),
    isPageActive: deps.isPageActive,
    confirm: deps.confirm,
    alert: deps.alert,
    t: translate,
    showDetail: deps.showDetail,
    cancelExecution: deps.cancelExecution,
  });
  hooks.controller = controller;

  const actions = deps.actions ?? createActions();
  const unregister = [
    actions.register('monitor.refresh', () => { void controller.refresh(null); }),
    actions.register('monitor.selectAll', () => controller.setPageSelection(view.pageIds(), true)),
    actions.register('monitor.deselectAll', () => controller.clearSelection()),
    actions.register('monitor.batchDelete', () => { void controller.deleteSelected(); }),
    actions.register('monitor.detail', element => controller.openDetail(element.dataset.id ?? '')),
    actions.register('monitor.delete', element => { void controller.deleteExecution(element.dataset.id ?? ''); }),
    actions.register('monitor.terminate', element => controller.cancelExecution(element.dataset.id ?? '')),
    actions.register('monitor.page', element => controller.goToPage(Number(element.dataset.page))),
    actions.register('monitor.clearTool', () => controller.clearToolFilter()),
    actions.register('monitor.toolInput', () => controller.scheduleToolFilter()),
    actions.register('monitor.toolEnter', (_element, event) => { if ((event as KeyboardEvent).key === 'Enter') void controller.applyFilters(); }),
    actions.register('monitor.selectRow', element => controller.toggleSelect(element.dataset.id ?? '', (element as HTMLInputElement).checked)),
    actions.register('monitor.selectAllToggle', element => controller.setPageSelection(view.pageIds(), (element as HTMLInputElement).checked)),
    actions.register('monitor.pageSize', element => controller.setPageSize((element as HTMLSelectElement).value)),
    actions.register('monitor.statusToggle', element => {
      const wrapper = element.closest('.monitor-filter-select-ui');
      const open = wrapper?.classList.contains('open') ?? false;
      doc.querySelectorAll('.monitor-filter-select-ui.open').forEach(node => node.classList.remove('open'));
      if (!open) wrapper?.classList.add('open');
      element.setAttribute('aria-expanded', String(!open));
    }),
    actions.register('monitor.statusPick', element => {
      const select = doc.getElementById('monitor-status-filter') as HTMLSelectElement | null;
      const value = element.dataset.value ?? 'all';
      if (select && select.value !== value) {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      element.closest('.monitor-filter-select-ui')?.classList.remove('open');
      view.syncStatus();
      void controller.applyFilters();
    }),
  ];

  let unbind: (() => void) | undefined;
  const closeOnOutside = (event: Event) => {
    if (!(event.target instanceof Element) || !event.target.closest('.monitor-filter-select-ui')) {
      doc.querySelectorAll('.monitor-filter-select-ui.open').forEach(node => node.classList.remove('open'));
    }
  };

  return {
    controller,
    view,
    activate(): void {
      if (unbind) return;
      unbind = actions.bind(doc);
      view.bindStatusSelect();
      view.bindStats();
      doc.addEventListener('click', closeOnOutside);
    },
    repaint(): void {
      const { state } = controller;
      if (!state.lastFetchedAt) return;
      view.stats({
        summary: state.summary, topTools: state.topTools, lastFetchedAt: state.lastFetchedAt, retentionDays: state.retentionDays,
        activeToolFilter: view.readToolBox().trim(), timeline: state.timeline, timelineError: state.timelineError,
        timelineLoading: state.timelineLoading, timelineRange: state.timelineRange,
      });
      view.executions(state.executions, view.readStatus());
      view.pagination(state.pagination);
    },
    dispose(): void {
      controller.dispose();
      unregister.forEach(dispose => dispose());
      unbind?.();
      unbind = undefined;
      doc.removeEventListener('click', closeOnOutside);
      view.dispose();
    },
  };
}
