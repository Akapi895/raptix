// MCP monitor execution table: rows, header, empty state and pagination markup.
import { formatMonitorToolName, durationParts, STATUS_KEYS, PAGE_SIZES, type MonitorExecution, type MonitorPagination } from './model';
import { esc, txt, type StatsText } from './stats';

export interface ExecutionRowOptions {
  selected: boolean;
  /** Whether the delete and terminate controls are shown (the monitor page's permission gate is applied later). */
  canTerminate: boolean;
}

export function statusLabel(status: string, ctx: StatsText): string {
  const key = STATUS_KEYS[status === 'success' ? 'completed' : status];
  if (key) {
    const translated = ctx.t(key);
    if (translated) return translated;
  }
  return status;
}

export function formatDuration(start: string | null | undefined, end: string | null | undefined, ctx: StatsText, now = Date.now()): string {
  const parts = durationParts(start, end, now);
  switch (parts.kind) {
    case 'unknown': return txt(ctx, 'unknown', 'Unknown');
    case 'seconds': return txt(ctx, 'durationSeconds', `${parts.n}s`, { n: parts.n });
    case 'minutesSeconds': return txt(ctx, 'durationMinutes', `${parts.minutes}m ${parts.seconds}s`, { minutes: parts.minutes, seconds: parts.seconds });
    case 'minutes': return txt(ctx, 'durationMinutesOnly', `${parts.minutes}m`, { minutes: parts.minutes });
    case 'hoursMinutes': return txt(ctx, 'durationHours', `${parts.hours}h ${parts.minutes}m`, { hours: parts.hours, minutes: parts.minutes });
    case 'hours': return txt(ctx, 'durationHoursOnly', `${parts.hours}h`, { hours: parts.hours });
  }
}

export function emptyState(hasFilter: boolean, ctx: StatsText): string {
  if (hasFilter) {
    return `<div class="monitor-empty">${esc(txt(ctx, 'noRecordsWithFilter', 'No records with current filter'))}</div>`;
  }
  const title = txt(ctx, 'noExecutions', 'No execution records');
  const hint = txt(ctx, 'emptyHint', 'Execution records will appear here after you invoke MCP tools in chat or tasks');
  return `<div class="monitor-empty">
    <p class="monitor-empty__title">${esc(title)}</p>
    <p class="monitor-empty__hint">${esc(hint)}</p>
  </div>`;
}

export function tableHeader(ctx: StatsText): { key: string; html: string } {
  const labels = {
    tool: txt(ctx, 'columnTool', 'Tool'),
    status: txt(ctx, 'columnStatus', 'Status'),
    start: txt(ctx, 'columnStartTime', 'Started'),
    duration: txt(ctx, 'columnDuration', 'Duration'),
    actions: txt(ctx, 'columnActions', 'Actions'),
  };
  const html = `<tr>
    <th style="width: 40px;"><input type="checkbox" id="monitor-select-all" class="theme-checkbox" aria-label="Select all executions on this page" data-change="monitor.selectAllToggle" /></th>
    <th>${esc(labels.tool)}</th><th>${esc(labels.status)}</th><th>${esc(labels.start)}</th><th>${esc(labels.duration)}</th><th>${esc(labels.actions)}</th>
  </tr>`;
  return { key: JSON.stringify([labels, ctx.locale]), html };
}

/** One execution row. Its key is the content it was built from, so the view can skip unchanged rows. */
export function executionRow(exec: MonitorExecution, status: string, options: ExecutionRowOptions, ctx: StatsText, now: number) {
  const id = exec.id ?? '';
  const statusClass = `monitor-status-chip ${status}`;
  const startTime = exec.startTime ? ctx.formatTime(new Date(exec.startTime)) : txt(ctx, 'unknown', 'Unknown');
  const duration = formatDuration(exec.startTime, exec.endTime, ctx, now);
  const toolName = esc(formatMonitorToolName(exec.toolName ?? '') || txt(ctx, 'unknownTool', 'Unknown tool'));
  const terminate = status === 'running' && options.canTerminate
    ? `<button type="button" class="btn-secondary btn-monitor-abort" data-require-permission="monitor:write" data-action="monitor.terminate" data-id="${esc(id)}">${esc(txt(ctx, 'terminateExecution', 'Terminate'))}</button>`
    : '';
  const html = `<tr data-execution-id="${esc(id)}">
    <td><input type="checkbox" class="monitor-execution-checkbox theme-checkbox" aria-label="Select execution ${toolName}" value="${esc(id)}" ${options.selected ? 'checked' : ''} data-change="monitor.selectRow" data-id="${esc(id)}" /></td>
    <td>${toolName}</td>
    <td><span class="${statusClass}">${esc(statusLabel(status, ctx))}</span></td>
    <td>${esc(startTime)}</td>
    <td class="monitor-execution-duration">${esc(duration)}</td>
    <td>
      <div class="monitor-execution-actions">
        <button type="button" class="btn-secondary" data-action="monitor.detail" data-id="${esc(id)}">${esc(txt(ctx, 'viewDetail', 'View details'))}</button>
        ${terminate}
        <button type="button" class="btn-secondary btn-delete" data-require-permission="monitor:delete" data-action="monitor.delete" data-id="${esc(id)}" title="${esc(txt(ctx, 'deleteExecTitle', 'Delete this execution record'))}">${esc(txt(ctx, 'delete', 'Delete'))}</button>
      </div>
    </td>
  </tr>`;
  return { id, key: JSON.stringify([exec, options.selected, ctx.locale]), html, status };
}

export function paginationHtml(pagination: MonitorPagination, ctx: StatsText): string {
  const { page, totalPages, total, pageSize } = pagination;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = total === 0 ? 0 : Math.min(page * pageSize, total);
  const idle = total === 0;
  const pages = totalPages || 1;
  const info = txt(ctx, 'paginationInfo', `Show ${start}-${end} of ${total} records`, { start, end, total });
  const pageInfo = txt(ctx, 'pageInfo', `Page ${page} / ${pages}`, { page, total: pages });
  const option = (size: number) => `<option value="${size}" ${pageSize === size ? 'selected' : ''}>${size}</option>`;
  return `<div class="monitor-pagination">
    <div class="pagination-info">
      <span>${esc(info)}</span>
      <label class="pagination-page-size">
        ${esc(txt(ctx, 'perPageLabel', 'Per page'))}
        <select id="monitor-page-size" data-change="monitor.pageSize">${PAGE_SIZES.map(option).join('')}</select>
      </label>
    </div>
    <div class="pagination-controls">
      <button type="button" class="btn-secondary" data-action="monitor.page" data-page="1" ${page === 1 || idle ? 'disabled' : ''}>${esc(txt(ctx, 'firstPage', 'First'))}</button>
      <button type="button" class="btn-secondary" data-action="monitor.page" data-page="${page - 1}" ${page === 1 || idle ? 'disabled' : ''}>${esc(txt(ctx, 'prevPage', 'Previous'))}</button>
      <span class="pagination-page">${esc(pageInfo)}</span>
      <button type="button" class="btn-secondary" data-action="monitor.page" data-page="${page + 1}" ${page >= totalPages || idle ? 'disabled' : ''}>${esc(txt(ctx, 'nextPage', 'Next'))}</button>
      <button type="button" class="btn-secondary" data-action="monitor.page" data-page="${pages}" ${page >= totalPages || idle ? 'disabled' : ''}>${esc(txt(ctx, 'lastPage', 'Last'))}</button>
    </div>
  </div>`;
}
