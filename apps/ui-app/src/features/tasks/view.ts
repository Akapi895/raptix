import { createDom, escapeHtml as esc, type Translate } from '../workflows';
import { canMutate, canRunSingle, hitlPolicies, queuePresentation, type ActiveTask, type BatchQueue } from './model';
import type { TasksService } from './service';

export type InlineField = 'title' | 'role' | 'hitl' | 'schedule' | 'concurrency';
export function createTasksView(doc: Document, t: Translate, report: (error: unknown) => void, applyPermissions?: (root: HTMLElement) => void) {
  const dom = createDom(doc, 'tasks', report, { applyPermissions, permissions: { deleteQueue: 'tasks:delete', deleteTask: 'tasks:delete', editTask: 'tasks:write', runTask: 'tasks:write', cancelTask: 'tasks:write', scheduleEnabled: 'tasks:write' } }), a = dom.attr;
  const queueIcons: Record<string, string> = {
    vulnerabilities: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    deleteQueue: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  };
  const button = (action: string, label: string, attrs = '', classes = 'btn-secondary btn-small') => {
    const icon = classes.includes('batch-queue-icon-btn') ? queueIcons[action] : undefined;
    const caption = esc(t(icon && action === 'vulnerabilities' ? 'tasks.viewVulnerabilitiesQueueTitle' : label));
    return `<button type="button" class="${classes}" ${a(action)} ${attrs} ${icon ? `title="${caption}" aria-label="${caption}"` : ''}>${icon ? `<svg class="batch-queue-icon-btn__svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>` : caption}</button>`;
  };
  const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : '';
  const hitlLabel = (policy: string) => t('batchImportModal.' + (hitlPolicies[policy] ?? 'hitlInherit'));
  const options = (values: { value: string; label: string }[], value: string) => values.map(option => `<option value="${esc(option.value)}" ${option.value === value ? 'selected' : ''}>${esc(option.label)}</option>`).join('');
  const roleIcon = (role: string, roles: { name: string; icon?: string }[]) => {
    if (!role) return '🔵';
    const icon = roles.find(item => item.name === role)?.icon ?? '👤'; const match = icon.match(/^"?\\U([0-9A-F]{8})"?$/i);
    try { return match?.[1] ? String.fromCodePoint(parseInt(match[1], 16)) : icon; } catch { return '👤'; }
  };
  function duration(start: string | null | undefined): string {
    if (!start) return t('tasks.unknown'); const seconds = Math.floor((Date.now() - new Date(start).getTime()) / 1000);
    if (seconds < 60) return seconds + t('tasks.durationSeconds');
    if (seconds < 3600) return Math.floor(seconds / 60) + t('tasks.durationMinutes') + ' ' + seconds % 60 + t('tasks.durationSeconds');
    return Math.floor(seconds / 3600) + t('tasks.durationHours') + ' ' + Math.floor(seconds % 3600 / 60) + t('tasks.durationMinutes');
  }
  function renderPagination(service: TasksService): void {
    const { page, pageSize, total, totalPages } = service.pagination;
    dom.show('batch-queues-pagination', total > 0);
    if (!total) { dom.html('batch-queues-pagination', ''); return; }
    dom.html('batch-queues-pagination', `<div class="monitor-pagination"><div class="pagination-info"><span>${esc(t('tasks.paginationShow', { start: (page - 1) * pageSize + 1, end: Math.min(page * pageSize, total), total }))}</span><label class="pagination-page-size">${esc(t('tasks.paginationPerPage'))}<select id="batch-queues-page-size-pagination" ${a('pageSize', 'change')}>${options([10, 20, 50, 100].map(n => ({ value: String(n), label: String(n) })), String(pageSize))}</select></label></div><div class="pagination-controls">${button('page', 'tasks.paginationFirst', `data-page="1" ${page === 1 ? 'disabled' : ''}`)}${button('page', 'tasks.paginationPrev', `data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}`)}<span class="pagination-page">${esc(t('tasks.paginationPage', { current: page, total: totalPages }))}</span>${button('page', 'tasks.paginationNext', `data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}`)}${button('page', 'tasks.paginationLast', `data-page="${totalPages}" ${page >= totalPages ? 'disabled' : ''}`)}</div></div>`);
  }
  function renderQueues(service: TasksService, roles: { name: string; icon?: string }[]): void {
    dom.show('batch-queues-section', true, 'block');
    if (dom.el('workflow-schedule')?.contains(dom.el('batch-queues-list'))) {
      dom.html('batch-queues-list', service.queues.length ? `<div class="workflow-table-scroll"><table class="workflow-table"><thead><tr><th scope="col">Queue / execution type</th><th scope="col">Schedule</th><th scope="col">State</th><th scope="col">Progress</th><th scope="col">Parallel</th><th scope="col">Next run</th></tr></thead><tbody>${service.queues.map(queue => {
        const pres = queuePresentation(queue, t), done = queue.tasks.filter(task => ['completed', 'failed', 'cancelled'].includes(task.status)).length;
        return `<tr><td><button type="button" class="workflow-text-button" ${a('detail')} data-queue-id="${esc(queue.id)}">${esc(queue.title || queue.id)}</button><small>${esc(queue.workflowId ? 'Workflow · ' + queue.workflowId : 'Independent batch')} · ${esc(queue.role || 'Default role')}</small>${queue.lastScheduleError || queue.lastRunError ? '<small class="workflow-operation-error">Needs attention — open queue for details</small>' : ''}</td><td><code>${esc(queue.scheduleMode === 'cron' ? queue.cronExpr : 'Manual')}</code>${queue.scheduleMode === 'cron' && !queue.scheduleEnabled ? '<small>Automatic schedule disabled</small>' : ''}</td><td><span class="workflow-run-state" data-status="${esc(queue.status)}">${esc(pres.text)}</span></td><td>${done} / ${queue.tasks.length}</td><td>${queue.concurrency}</td><td>${esc(queue.nextRunAt ? date(queue.nextRunAt) : '—')}</td></tr>`;
      }).join('')}</tbody></table></div>` : '<div class="workflow-operation-empty"><h3>No queues yet</h3><p>Create a queue to run independent tasks or repeat a workflow for multiple inputs. Choose Manual or a recurring cron schedule.</p></div>');
      renderPagination(service); return;
    }
    dom.html('batch-queues-list', service.queues.length ? service.queues.map(queue => {
      const pres = queuePresentation(queue, t), done = queue.tasks.filter(task => ['completed', 'failed', 'cancelled'].includes(task.status)).length;
      const progress = queue.tasks.length ? Math.round(done / queue.tasks.length * 100) : 0;
      const cronIdle = queue.scheduleMode === 'cron' && queue.scheduleEnabled && queue.status === 'completed';
      const role = queue.role || t('batchQueueDetailModal.defaultRole');
      const schedule = t(queue.scheduleMode === 'cron' ? 'batchImportModal.scheduleModeCron' : 'batchImportModal.scheduleModeManual') + (queue.scheduleMode === 'cron' && queue.cronExpr ? ` (${queue.cronExpr})` : '');
      return `<div class="batch-queue-item batch-queue-item--compact ${cronIdle ? 'batch-queue-item--cron-wait' : ''}" data-queue-id="${esc(queue.id)}" ${a('detail')}><div class="batch-queue-item__inner batch-queue-item__inner--grid"><div class="batch-queue-item__lead"><div class="batch-queue-item__title-row"><span class="batch-queue-item__role-icon">${esc(roleIcon(queue.role, roles))}</span><div class="batch-queue-item__titles"><h4 class="batch-queue-card-title ${queue.title ? '' : 'batch-queue-card-title--muted'}">${esc(queue.title || t('tasks.batchQueueUntitled'))}</h4></div></div><p class="batch-queue-item__config">${esc([role, schedule].join(' · '))}${queue.scheduleMode === 'cron' && !queue.scheduleEnabled ? ` <span class="batch-queue-inline-warn" title="${esc(t('batchQueueDetailModal.scheduleCronAutoHint'))}">(${esc(t('batchQueueDetailModal.cronSchedulePausedBadge'))})</span>` : ''}</p><p class="batch-queue-item__idline batch-queue-item__idline--lead"><code title="${esc(queue.id)}">${esc(queue.id.length > 14 ? queue.id.slice(0, 12) + '…' : queue.id)}</code><span class="batch-queue-item__idsep">·</span><span>${esc(t('tasks.createdTimeLabel'))} ${esc(date(queue.createdAt))}</span></p></div><div class="batch-queue-item__cluster"><div class="batch-queue-item__status-inline"><span class="batch-queue-status ${pres.class}">${esc(pres.text)}</span><span class="batch-queue-item__pct">${progress}% <span class="batch-queue-item__pct-frac">(${done}/${queue.tasks.length})</span></span></div>${pres.sublabel ? `<span class="batch-queue-item__sublabel">${esc(pres.sublabel)}</span>` : ''}</div><div class="batch-queue-item__progress-col"><div class="batch-queue-progress-bar batch-queue-progress-bar--card batch-queue-progress-bar--list batch-queue-progress-bar--card-row"><div class="batch-queue-progress-fill ${cronIdle ? 'batch-queue-progress-fill--cron-wait' : ''}" style="width:${progress}%"></div></div></div><div class="batch-queue-item__actions-col" ${a('stop')}>${button('vulnerabilities', 'tasks.viewVulnerabilities', `data-kind="queue" data-id="${esc(queue.id)}"`, 'batch-queue-icon-btn')}${['pending', 'completed', 'cancelled'].includes(queue.status) ? button('deleteQueue', 'tasks.deleteQueue', `data-id="${esc(queue.id)}"`, 'batch-queue-icon-btn batch-queue-icon-btn--danger') : ''}</div></div></div>`;
    }).join('') : `<div class="tasks-empty"><p>${esc(t('tasks.noBatchQueues'))}</p></div>`);
    renderPagination(service);
  }
  function renderDetail(queue: BatchQueue, roles: { name: string; icon?: string }[]): void {
    const content = dom.el('batch-queue-detail-content'); if (!content) return;
    const body = content.closest('.modal-body'), scroll = body?.scrollTop ?? 0;
    const oldList = content.querySelector('.batch-queue-tasks-list'), listScroll = oldList?.scrollTop ?? 0;
    const oldTech = content.querySelector<HTMLDetailsElement>('details.batch-queue-detail-tech');
    const same = content.querySelector('[data-bq-detail-for]')?.getAttribute('data-bq-detail-for') === queue.id;
    const open = same && !!oldTech?.open, allow = canMutate(queue), pres = queuePresentation(queue, t);
    dom.text('batch-queue-detail-title', t('tasks.batchQueueTitle') + (queue.title ? ' - ' + queue.title : ''));
    for (const [name, visible] of [['add-task', allow], ['start', ['pending', 'paused'].includes(queue.status)], ['rerun', ['completed', 'cancelled'].includes(queue.status)], ['pause', queue.status === 'running'], ['delete', ['pending', 'paused', 'completed', 'cancelled'].includes(queue.status)]] as const) dom.show(`batch-queue-${name}-btn`, visible, 'inline-block');
    dom.text('batch-queue-start-btn', t(queue.status === 'paused' ? 'tasks.resumeExecute' : queue.scheduleMode === 'cron' && queue.scheduleEnabled ? 'batchQueueDetailModal.startExecuteNow' : 'batchQueueDetailModal.startExecute'));
    const kv = (key: string, value: string, id = '', edit?: InlineField) => `<div class="bq-kv"><span class="bq-kv__k">${esc(t(key))}</span><span class="bq-kv__v" ${id ? `id="${id}"` : ''}>${allow && edit ? `<span class="bq-inline-editable" ${a('editMeta')} data-field="${edit}" title="${esc(t('common.edit'))}">${value}</span>` : value}</span></div>`;
    const schedule = t(queue.scheduleMode === 'cron' ? 'batchImportModal.scheduleModeCron' : 'batchImportModal.scheduleModeManual') + (queue.scheduleMode === 'cron' && queue.cronExpr ? ` (${queue.cronExpr})` : '');
    const alert = (key: string, value: string | undefined) => value ? `<div class="bq-alert bq-alert--err"><strong>${esc(t(key))}</strong><p>${esc(value)}</p></div>` : '';
    content.innerHTML = `<div class="batch-queue-detail-layout" data-bq-detail-for="${esc(queue.id)}"><section class="batch-queue-detail-hero"><span class="batch-queue-status ${pres.class}">${esc(pres.text)}</span>${pres.sublabel ? `<p class="batch-queue-detail-hero__sub">${esc(pres.sublabel)}</p>` : ''}${pres.progressNote && !pres.callout ? `<p class="batch-queue-detail-hero__note">${esc(pres.progressNote)}</p>` : ''}</section><section class="batch-queue-detail-kv">${kv('batchQueueDetailModal.queueTitle', esc(queue.title || t('tasks.batchQueueUntitled')), 'bq-title-val', 'title')}${kv('batchQueueDetailModal.role', esc(roleIcon(queue.role, roles) + ' ' + (queue.role || t('batchQueueDetailModal.defaultRole'))), 'bq-role-val', 'role')}${kv('batchImportModal.hitlPolicy', esc(hitlLabel(queue.hitlPolicy)), 'bq-hitl-val', 'hitl')}${kv('batchImportModal.scheduleMode', esc(schedule), 'bq-schedule-val', 'schedule')}${kv('batchQueueDetailModal.concurrency', String(queue.concurrency || 1), 'bq-concurrency-val', 'concurrency')}${kv('batchQueueDetailModal.taskTotal', String(queue.tasks.length))}${queue.scheduleMode === 'cron' ? `<div class="bq-kv bq-kv--block"><span class="bq-kv__k">${esc(t('batchQueueDetailModal.scheduleCronAuto'))}</span><span class="bq-kv__v bq-kv__v--control"><label class="bq-cron-toggle"><input type="checkbox" ${queue.scheduleEnabled ? 'checked' : ''} ${a('scheduleEnabled', 'change')}><span class="bq-cron-toggle__hint">${esc(t('batchQueueDetailModal.scheduleCronAutoHint'))}</span></label></span></div>` : ''}</section>${alert('batchQueueDetailModal.lastScheduleError', queue.lastScheduleError)}${alert('batchQueueDetailModal.lastRunError', queue.lastRunError)}${pres.callout ? `<div class="batch-queue-cron-callout batch-queue-cron-callout--compact"><span class="batch-queue-cron-callout-icon">↻</span><p>${esc(pres.callout)}</p></div>` : ''}<details class="batch-queue-detail-tech" ${open ? 'open' : ''}><summary class="batch-queue-detail-tech__sum">${esc(t('batchQueueDetailModal.technicalDetails'))}</summary><div class="batch-queue-detail-tech__body">${kv('batchQueueDetailModal.queueId', `<code>${esc(queue.id)}</code>`)}${(['createdAt', 'startedAt', 'completedAt', 'nextRunAt', 'lastScheduleTriggerAt'] as const).filter(key => queue[key]).map(key => kv('batchQueueDetailModal.' + key, esc(date(queue[key])))).join('')}</div></details></div><div class="batch-queue-tasks-list"><h4>${esc(t('batchQueueDetailModal.taskList'))}</h4>${queue.tasks.map((task, i) => {
      const canEdit = allow && task.status !== 'running', run = canRunSingle(queue, task);
      const statusKey: Record<string, string> = { pending: 'statusPending', running: 'statusRunning', completed: 'statusCompleted', failed: 'failedLabel', cancelled: 'statusCancelled' };
      return `<div class="batch-task-item ${task.status === 'running' ? 'batch-task-item-active' : ''}" data-queue-id="${esc(queue.id)}" data-task-id="${esc(task.id)}" data-task-message="${esc(task.message)}"><div class="batch-task-header"><span class="batch-task-index">#${i + 1}</span><span class="batch-task-status batch-task-status-${esc(task.status)}">${esc(statusKey[task.status] ? t('tasks.' + statusKey[task.status]) : task.status)}</span><span class="batch-task-message" title="${esc(task.message)}">${esc(task.message)}</span>${button('runTask', 'tasks.runSingleTask', run ? '' : `disabled title="${esc(t(task.status === 'running' ? 'tasks.runSingleTaskUnavailableSelf' : queue.status === 'running' ? 'tasks.runSingleTaskUnavailableQueue' : 'tasks.runSingleTaskUnavailable'))}"`, 'btn-secondary btn-small batch-task-run-btn')}${task.conversationId ? button('conversation', 'tasks.viewConversation', `data-id="${esc(task.conversationId)}"`) : ''}${canEdit ? button('editTask', 'common.edit', '', 'btn-secondary btn-small batch-task-edit-btn') + button('deleteTask', 'common.delete', '', 'btn-secondary btn-small btn-danger batch-task-delete-btn') : ''}</div>${task.startedAt ? `<div class="batch-task-time">${esc(t('batchQueueDetailModal.startLabel'))}: ${esc(date(task.startedAt))}</div>` : ''}${task.completedAt ? `<div class="batch-task-time">${esc(t('batchQueueDetailModal.completeLabel'))}: ${esc(date(task.completedAt))}</div>` : ''}${task.error ? `<div class="batch-task-error">${esc(t('batchQueueDetailModal.errorLabel'))}: ${esc(task.error)}</div>` : ''}${task.result ? `<div class="batch-task-result">${esc(t('batchQueueDetailModal.resultLabel'))}: ${esc(task.result.slice(0, 200))}${task.result.length > 200 ? '...' : ''}</div>` : ''}</div>`;
    }).join('')}</div>`;
    const execution = doc.createElement('p'); execution.className = 'workflow-queue-type'; execution.textContent = queue.workflowId ? `Workflow: ${queue.workflowId} · Each task is a separate graph execution.` : 'Independent batch tasks · No graph dependencies.'; content.prepend(execution);
    content.querySelectorAll('.batch-task-item').forEach((item, index) => {
      const task = queue.tasks[index]; if (!task?.result) return;
      const details = doc.createElement('details'), summary = doc.createElement('summary'), output = doc.createElement('pre');
      summary.textContent = 'Output'; output.textContent = task.result; details.append(summary, output); item.querySelector('.batch-task-result')?.replaceWith(details);
    });
    dom.applyPermissions(content);
    if (body) body.scrollTop = scroll; const nextList = content.querySelector('.batch-queue-tasks-list'); if (nextList) nextList.scrollTop = listScroll;
  }
  function renderActive(service: TasksService): void {
    const tasks = service.filtered(dom.value('tasks-status-filter') || 'all', dom.value('tasks-sort-by') || 'time-desc');
    const statusKeys: Record<string, string> = { running: 'Running', cleaning: 'Cleaning', cleanup_unconfirmed: 'CleanupUnconfirmed', cleanup_failed: 'CleanupFailed', cancelling: 'Cancelling', failed: 'Failed', timeout: 'Timeout', cancelled: 'Cancelled', completed: 'Completed' };
    const item = (task: ActiveTask): string => {
      const canCancel = !task.isHistory && !['completed', 'failed', 'timeout', 'cancelled', 'cleanup_unconfirmed', 'cancelling', 'cleaning'].includes(task.status);
      const live = ['running', 'cancelling', 'cleaning', 'cleanup_failed'].includes(task.status);
      const id = esc(task.conversationId), message = esc(task.title || task.message || t('tasks.unnamedTask'));
      return `<div class="task-item ${task.isHistory ? 'task-item-history' : ''}" data-task-id="${id}" data-started-at="${esc(task.startedAt)}" data-status="${esc(task.status)}"><div class="task-header"><div class="task-info">${canCancel ? `<label class="task-checkbox"><input type="checkbox" ${service.selected.has(task.conversationId) ? 'checked' : ''} ${a('selectTask', 'change')} data-id="${id}"></label>` : '<div class="task-checkbox-placeholder"></div>'}<span class="task-status task-status-${esc(task.status)}">${esc(statusKeys[task.status] ? t('tasks.status' + statusKeys[task.status]) : task.status)}</span>${task.isHistory ? '<span class="task-history-badge">📜</span>' : ''}<span class="task-message" title="${message}">${message}</span></div><div class="task-actions">${live ? `<span class="task-duration">⏱ ${esc(duration(task.startedAt))}</span>` : ''}<span class="task-time">${esc(date(task.isHistory ? task.completedAt || task.startedAt : task.startedAt))}</span>${canCancel ? button('cancelTask', 'tasks.cancelTask', `data-id="${id}"`) : ''}${button('vulnerabilities', 'tasks.viewVulnerabilities', `data-kind="conversation" data-id="${id}"`)}${button('conversation', 'tasks.viewConversation', `data-id="${id}"`)}</div></div>${task.cleanupError ? `<div class="task-details">${esc(task.cleanupError)}</div>` : ''}<div class="task-details"><span class="task-id-label">${esc(t('tasks.conversationIdLabel'))}:</span><span class="task-id-value" ${a('copy')} data-id="${id}" title="${esc(t('tasks.clickToCopy'))}">${id}</span></div></div>`;
    };
    const active = tasks.filter(task => !task.isHistory), history = tasks.filter(task => task.isHistory);
    dom.html('tasks-list', tasks.length ? active.map(item).join('') + (history.length ? `<div class="tasks-history-section"><div class="tasks-history-header"><span class="tasks-history-title">📜 ${esc(t('tasks.recentCompletedTasks'))}</span>${button('clearHistory', 'tasks.clearHistory')}</div>${history.map(item).join('')}</div>` : '') : `<div class="tasks-empty"><p>${esc(t('tasks.noMatchingTasks'))}</p>${!service.active.length && service.history.length ? `<p>${esc(t('tasks.historyHint'))}</p>` : ''}</div>`);
    for (const [id, count] of [['running', service.active.filter(task => task.status === 'running').length], ['cancelling', service.active.filter(task => ['cancelling', 'cleaning', 'cleanup_failed'].includes(task.status)).length], ['completed', service.active.filter(task => task.status === 'completed').length], ['total', service.active.length]] as const) dom.text('stat-' + id, count);
    selection(service);
  }
  function selection(service: TasksService): void { dom.show('tasks-batch-actions', service.selected.size > 0, 'flex'); dom.text('tasks-selected-count', t('mcp.selectedCount', { count: service.selected.size })); }
  function updateDurations(): void {
    doc.querySelectorAll<HTMLElement>('.task-item[data-task-id]').forEach(item => {
      const node = item.querySelector('.task-duration'); if (node && ['running', 'cancelling', 'cleaning', 'cleanup_failed'].includes(item.dataset.status ?? '')) node.textContent = duration(item.dataset.startedAt);
    });
  }
  return { dom, renderQueues, renderDetail, renderPagination, renderActive, selection, updateDurations, options, hitlLabel,
    initSelects(): void {
      const filter = dom.field('batch-queues-status-filter'); if (filter instanceof HTMLSelectElement) dom.enhanceSelect(filter, 'tasks-filter-select');
      dom.enhance('batch-import-modal', 'batch-form-select');
    },
    importStats(): void { const count = dom.value('batch-tasks-input').split('\n').filter(line => line.trim()).length; dom.show('batch-import-stats', count > 0, 'block'); dom.html('batch-import-stats', `<div class="batch-import-stat">${esc(t('tasks.taskCount', { count }))}</div>`); },
    scheduleMode(): void { const cron = dom.value('batch-queue-schedule-mode') === 'cron'; dom.show('batch-queue-cron-group', cron, 'block'); const input = dom.field('batch-queue-cron-expr'); if (input) { input.toggleAttribute('required', cron); if (!cron) input.value = ''; } },
  };
}
export type TasksView = ReturnType<typeof createTasksView>;
