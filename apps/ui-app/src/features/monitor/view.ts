import { type MonitorExecution, type MonitorPagination } from './model';
import { emptyState, executionRow, formatDuration, paginationHtml, tableHeader } from './executions';
import { renderStats, renderTimelineBody, subtitleText, txt, type StatsInput, type StatsText } from './stats';
import type { MonitorViewPort, StatsPayload } from './controller';
import { resolveTimelineRange } from './timeline';
import { getToolExecutionDisplayStatus } from '../tools/status';

export interface MonitorViewDeps {
  doc: Document;
  ctx(): StatsText;
  /** Gives the freshly rendered pagination select its skin (settings helper). */
  initPaginationSelects?(root: HTMLElement): void;
  onStatsTool(tool: string): void;
  onStatsClearTool(): void;
  onRange(range: string): void;
}

const TOOL_SELECTOR = '.mcp-stats-dist-segment[data-tool-name], .mcp-stats-dist-legend-item[data-tool-name], .mcp-stats-proportion-seg[data-tool-name], .mcp-stats-tool-item[data-tool-name], tr.mcp-stats-tool-row[data-tool-name]';
const BAR_SELECTOR = '.mcp-stats-timeline-dot, .mcp-stats-timeline-bar, .mcp-stats-timeline-bar-fail, .mcp-stats-timeline-bar-blocked';

export interface MonitorView extends MonitorViewPort {
  /** Current status and tool-box values as typed or chosen. */
  readStatus(): string;
  readToolBox(): string;
  /** Ids of the execution rows on the page. */
  pageIds(): string[];
  /** Ids of the rows the user has checked on this page. */
  checkedIds(): string[];
  bindStats(): void;
  bindStatusSelect(): void;
  syncStatus(): void;
  dispose(): void;
}

/** Writes the statistics and executions blocks of the MCP monitor page. */
export function createMonitorView(deps: MonitorViewDeps): MonitorView {
  const { doc } = deps;
  const byId = (id: string) => doc.getElementById(id);
  const ctx = () => deps.ctx();
  const rowKeys = new Map<string, string>();
  let lastStats: StatsPayload | null = null;
  let tooltip: HTMLDivElement | null = null;
  let statsBound = false;
  let statusBound = false;

  const statsInput = (payload: StatsPayload): StatsInput => ({
    summary: payload.summary, topTools: payload.topTools, lastFetchedAt: payload.lastFetchedAt,
    retentionDays: payload.retentionDays, activeToolFilter: payload.activeToolFilter === 'all' ? '' : payload.activeToolFilter,
    timeline: payload.timeline as StatsInput['timeline'], timelineError: payload.timelineError,
    timelineLoading: payload.timelineLoading, timelineRange: resolveTimelineRange(payload.timelineRange),
  });

  function setSubtitle(payload: StatsPayload, hidden: boolean): void {
    const subtitle = byId('monitor-stats-subtitle');
    if (!subtitle) return;
    const count = payload.summary && typeof payload.summary.toolCount === 'number' ? payload.summary.toolCount : payload.topTools.length;
    subtitle.textContent = hidden ? '' : subtitleText(payload.lastFetchedAt, count, payload.retentionDays, ctx());
    subtitle.hidden = hidden;
  }

  function paintStats(payload: StatsPayload): void {
    lastStats = payload;
    const root = byId('monitor-stats');
    if (!root) return;
    const rendered = renderStats(statsInput(payload), ctx());
    root.innerHTML = rendered.html;
    setSubtitle(payload, rendered.empty);
    byId('monitor-tool-filter')?.classList.toggle('is-filter-active', !!payload.activeToolFilter && payload.activeToolFilter !== 'all');
    bindStats();
  }

  function highlight(name: string): void {
    byId('monitor-stats')?.querySelectorAll<HTMLElement>('[data-tool-name]').forEach(el => {
      const same = !!name && el.dataset.toolName === name;
      el.classList.toggle('is-highlighted', same);
      el.classList.toggle('is-dimmed', !!name && !same && !!el.dataset.toolName);
    });
  }

  function showTip(el: HTMLElement, x: number, y: number): void {
    if (!tooltip) return;
    const time = el.dataset.time ?? '';
    const total = el.dataset.total ?? '0';
    const failed = el.dataset.failed ?? '0';
    const blocked = el.dataset.blocked ?? '0';
    tooltip.textContent = txt(ctx(), 'timelineTooltip', `${time}: ${total} calls (${failed} failed, ${blocked} blocked)`, { time, total, failed, blocked });
    tooltip.style.display = 'block';
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  function hideTip(): void {
    if (tooltip) tooltip.style.display = 'none';
  }

  function bindStats(): void {
    if (statsBound) return;
    const root = byId('monitor-stats');
    if (!root) return;
    statsBound = true;
    if (!tooltip) {
      tooltip = doc.createElement('div');
      tooltip.className = 'mcp-stats-timeline-tooltip';
      tooltip.setAttribute('role', 'tooltip');
      doc.body.appendChild(tooltip);
    }
    root.addEventListener('click', event => {
      const target = event.target as Element;
      if (target.closest('.mcp-stats-clear-filter')) {
        event.preventDefault();
        deps.onStatsClearTool();
        return;
      }
      const range = target.closest<HTMLElement>('.mcp-stats-timeline__range');
      if (range?.dataset.range) {
        deps.onRange(range.dataset.range);
        return;
      }
      const el = target.closest<HTMLElement>(TOOL_SELECTOR);
      if (el && el.dataset.isOthers !== '1' && el.dataset.toolName) {
        event.preventDefault();
        deps.onStatsTool(el.dataset.toolName);
      }
    });
    root.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const el = (event.target as Element).closest<HTMLElement>(TOOL_SELECTOR);
      if (!el || el.dataset.isOthers === '1' || !el.dataset.toolName) return;
      event.preventDefault();
      deps.onStatsTool(el.dataset.toolName);
    });
    root.addEventListener('mouseover', event => {
      const el = (event.target as Element).closest<HTMLElement>(TOOL_SELECTOR);
      if (el && el.dataset.isOthers !== '1' && el.dataset.toolName) highlight(el.dataset.toolName);
    });
    root.addEventListener('mouseout', event => {
      const next = (event.relatedTarget as Element | null)?.closest?.(TOOL_SELECTOR);
      if (!next && (event.target as Element).closest(TOOL_SELECTOR)) highlight('');
    });
    root.addEventListener('mousemove', event => {
      const el = (event.target as Element).closest<HTMLElement>(BAR_SELECTOR);
      if (!el) { hideTip(); return; }
      showTip(el, event.clientX, event.clientY);
    });
    root.addEventListener('mouseleave', hideTip);
  }

  function renderSelection(): void {
    const selected = new Set(checkedIds());
    const batch = byId('monitor-batch-actions');
    if (batch) batch.style.display = selected.size > 0 ? 'flex' : 'none';
    const count = byId('monitor-selected-count');
    if (count) count.textContent = txt(ctx(), 'selectedCount', `${selected.size} selected`, { count: selected.size });
    const all = byId('monitor-select-all') as HTMLInputElement | null;
    if (!all) return;
    const boxes = [...doc.querySelectorAll<HTMLInputElement>('.monitor-execution-checkbox')];
    if (boxes.length === 0) {
      all.checked = false;
      all.indeterminate = false;
      return;
    }
    const checked = boxes.filter(box => box.checked).length;
    all.checked = checked === boxes.length;
    all.indeterminate = checked > 0 && checked < boxes.length;
  }

  function checkedIds(): string[] {
    return [...doc.querySelectorAll<HTMLInputElement>('.monitor-execution-checkbox')].filter(box => box.checked).map(box => box.value);
  }

  /** Keeps unchanged rows as they are; only new, removed, reordered or changed rows are touched. */
  function reconcile(tbody: HTMLTableSectionElement, rows: ReturnType<typeof executionRow>[]): void {
    const existing = new Map<string, HTMLTableRowElement>();
    Array.from(tbody.children).forEach(child => {
      const row = child as HTMLTableRowElement;
      existing.set(row.dataset.executionId ?? '', row);
    });
    const wanted = new Set(rows.map(row => row.id));
    existing.forEach((row, id) => { if (!wanted.has(id)) { row.remove(); rowKeys.delete(id); } });
    let cursor = tbody.firstElementChild as HTMLTableRowElement | null;
    for (const entry of rows) {
      let row = existing.get(entry.id);
      if (!row || rowKeys.get(entry.id) !== entry.key) {
        const template = doc.createElement('template');
        template.innerHTML = entry.html.trim();
        const next = template.content.firstElementChild as HTMLTableRowElement | null;
        if (!next) continue;
        if (row && row.parentNode === tbody) {
          if (row === cursor) cursor = next;
          row.replaceWith(next);
        }
        row = next;
        existing.set(entry.id, row);
        rowKeys.set(entry.id, entry.key);
      }
      if (row !== cursor) tbody.insertBefore(row, cursor);
      cursor = row.nextElementSibling as HTMLTableRowElement | null;
    }
  }

  // ---- status select skin ----

  function statusSelect(): HTMLSelectElement | null {
    return byId('monitor-status-filter') as HTMLSelectElement | null;
  }

  function syncStatusSkin(): void {
    const select = statusSelect();
    const wrapper = select?.closest('.monitor-filter-select-ui');
    if (!select || !wrapper) return;
    const dropdown = wrapper.querySelector('.monitor-filter-select-dropdown');
    const value = wrapper.querySelector('.monitor-filter-select-value');
    if (dropdown) {
      dropdown.innerHTML = Array.from(select.options).map(option => {
        const chosen = option.value === select.value;
        return `<button type="button" class="monitor-filter-select-option${chosen ? ' is-selected' : ''}" role="option" aria-selected="${chosen}" data-value="${option.value}" data-action="monitor.statusPick">
          <span class="monitor-filter-select-check" aria-hidden="true">✓</span><span class="monitor-filter-select-label">${option.textContent ?? ''}</span></button>`;
      }).join('');
    }
    if (value) value.textContent = select.options[select.selectedIndex]?.textContent ?? '';
  }

  function skinStatusSelect(): void {
    const select = statusSelect();
    if (!select || select.closest('.monitor-filter-select-ui')) {
      syncStatusSkin();
      return;
    }
    select.classList.add('monitor-filter-native-select');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    const wrapper = doc.createElement('div');
    wrapper.className = 'monitor-filter-select-ui';
    wrapper.innerHTML = `<button type="button" class="monitor-filter-select-trigger" aria-haspopup="listbox" aria-expanded="false" data-action="monitor.statusToggle">
        <span class="monitor-filter-select-value"></span>
        <svg class="monitor-filter-select-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button><div class="monitor-filter-select-dropdown" role="listbox"></div>`;
    select.parentNode?.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    syncStatusSkin();
  }

  return {
    stats: paintStats,

    trend(payload?: StatsPayload): void {
      if (payload) lastStats = payload;
      const inner = doc.querySelector('#monitor-stats .mcp-stats-combined__timeline-inner');
      if (!inner || !lastStats) {
        if (lastStats) paintStats(lastStats);
        return;
      }
      const input = statsInput(lastStats);
      const combined = inner.closest('.mcp-stats-combined');
      const compact = !!combined && !!combined.querySelector('.mcp-stats-combined__main');
      inner.innerHTML = renderTimelineBody(input, compact, ctx());
      doc.querySelectorAll<HTMLElement>('#monitor-stats .mcp-stats-timeline__range').forEach(btn => {
        const on = btn.dataset.range === input.timelineRange;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    },

    subtitle(payload: StatsPayload): void {
      setSubtitle(payload, false);
    },

    executions(list: MonitorExecution[], statusFilter: string): void {
      const container = byId('monitor-executions');
      if (!container) return;
      if (!Array.isArray(list) || list.length === 0) {
        const tool = (byId('monitor-tool-filter') as HTMLInputElement | null)?.value.trim() ?? '';
        const hasFilter = (!!statusFilter && statusFilter !== 'all') || (!!tool && tool !== 'all');
        container.innerHTML = emptyState(hasFilter, ctx());
        rowKeys.clear();
        renderSelection();
        return;
      }
      const header = tableHeader(ctx());
      let table = container.querySelector<HTMLTableElement>('.monitor-table');
      if (!table) {
        container.innerHTML = '<div class="monitor-table-container"><table class="monitor-table"><thead></thead><tbody></tbody></table></div>';
        table = container.querySelector<HTMLTableElement>('.monitor-table')!;
        rowKeys.clear();
      }
      const thead = table.querySelector('thead')!;
      if (thead.dataset.key !== header.key) {
        thead.innerHTML = header.html;
        thead.dataset.key = header.key;
      }
      const selected = new Set(checkedIds());
      const now = Date.now();
      const rows = list.map(exec => executionRow(exec, getToolExecutionDisplayStatus(exec), { selected: selected.has(exec.id ?? ''), canTerminate: true }, ctx(), now));
      reconcile(table.querySelector('tbody')!, rows);
      renderSelection();
    },

    durations(list: MonitorExecution[]): void {
      const container = byId('monitor-executions');
      if (!container) return;
      const map = new Map(list.map(exec => [String(exec.id ?? ''), exec]));
      container.querySelectorAll<HTMLTableRowElement>('tr[data-execution-id]').forEach(row => {
        const exec = map.get(row.dataset.executionId ?? '');
        if (!exec || String(exec.status ?? '').toLowerCase() !== 'running') return;
        const cell = row.querySelector('.monitor-execution-duration');
        if (cell) cell.textContent = formatDuration(exec.startTime, exec.endTime, ctx());
      });
    },

    pagination(pagination: MonitorPagination): void {
      const container = byId('monitor-executions');
      if (!container) return;
      container.querySelector('.monitor-pagination')?.remove();
      const wrapper = doc.createElement('div');
      wrapper.innerHTML = paginationHtml(pagination, ctx()).trim();
      const node = wrapper.firstElementChild as HTMLElement;
      container.appendChild(node);
      deps.initPaginationSelects?.(node);
    },

    selection(selected?: ReadonlySet<string>): void {
      if (selected) doc.querySelectorAll<HTMLInputElement>('.monitor-execution-checkbox').forEach(node => { node.checked = selected.has(node.value); });
      renderSelection();
    },

    error(message: string): void {
      const html = `<div class="monitor-error">${message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
      const stats = byId('monitor-stats');
      if (stats) stats.innerHTML = html;
      const executions = byId('monitor-executions');
      if (executions) executions.innerHTML = html;
    },

    toolFilterActive(active: boolean): void {
      byId('monitor-tool-filter')?.classList.toggle('is-filter-active', active);
    },

    setToolBox(value: string): void {
      const input = byId('monitor-tool-filter') as HTMLInputElement | null;
      if (input) input.value = value;
    },

    scrollToExecutions(): void {
      const section = doc.querySelector<HTMLElement>('.monitor-executions');
      if (section && typeof section.scrollIntoView === 'function') section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },

    syncStatus: syncStatusSkin,

    readStatus(): string {
      return statusSelect()?.value ?? 'all';
    },

    readToolBox(): string {
      return (byId('monitor-tool-filter') as HTMLInputElement | null)?.value ?? '';
    },

    pageIds(): string[] {
      return [...doc.querySelectorAll<HTMLInputElement>('.monitor-execution-checkbox')].map(box => box.value);
    },

    checkedIds,
    bindStats,
    bindStatusSelect(): void {
      if (statusBound) return;
      statusBound = true;
      skinStatusSelect();
    },

    dispose(): void {
      hideTip();
      tooltip?.remove();
      tooltip = null;
      statsBound = false;
      statusBound = false;
    },
  };
}
