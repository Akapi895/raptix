import { closeAppModal, isAppModalOpen, openAppModal } from '../../ui/modal';
import { errorMessage, escapeHtml as esc, type Translate } from '../workflows';
import { canMutate, hitlPolicies } from './model';
import { BACKEND_DEFAULT_ROLE } from '@/platform/backend-legacy-strings';
import type { TasksService } from './service';
import type { InlineField, TasksView } from './view';

export interface TasksDependencies {
  doc: Document; t: Translate; can(permission: string): boolean; confirm(message: string): boolean;
  alert(message: string): void; copy(text: string): Promise<void>; navigate(hash: string): void;
  activeProjectId(): string; initPaginationSelects(root: HTMLElement): void;
  loadProjects?(): Promise<{ id: string; name: string }[] | undefined>;
  applyPermissions?(root: HTMLElement): void;
  enterWorkspace?(): void;
  workflowOptions?(): Promise<{ id: string; name: string; enabled: boolean }[]>;
}
export function createTasksController(service: TasksService, view: TasksView, deps: TasksDependencies) {
  const { dom } = view, { t } = deps;
  let listTimer: ReturnType<typeof setInterval> | undefined, detailTimer: ReturnType<typeof setInterval> | undefined, durationTimer: ReturnType<typeof setInterval> | undefined;
  let roles: Awaited<ReturnType<TasksService['roles']>> = [];
  let currentId = '', detailGeneration = 0, listBusy = false, detailBusy = false, saving = false, mounted = false;
  const failures = (error: unknown) => { if (!dom.disposed) deps.alert(t(errorMessage(error))); };
  const permitted = (permission = 'tasks:write') => !dom.disposed && deps.can(permission);
  const isOpen = (id: string) => dom.el(id)?.hasAttribute('data-workflow-inline') ? !dom.el(id)?.hidden : isAppModalOpen(id);
  const open = (id: string) => { const node = dom.el(id); if (node?.hasAttribute('data-workflow-inline')) { node.hidden = false; node.scrollIntoView({ block: 'start' }); } else openAppModal(id, { focus: false }); };
  const close = (id: string) => { const node = dom.el(id); if (node?.hasAttribute('data-workflow-inline')) node.hidden = true; else closeAppModal(id); };
  const editing = () => !!dom.el('batch-queue-detail-content')?.querySelector('.bq-inline-edit-controls,.batch-task-inline-edit') || isOpen('add-batch-task-modal');
  async function loadRoles(): Promise<void> { try { roles = await service.roles(); } catch { roles = []; } }
  async function list(page?: number): Promise<void> {
    if (dom.disposed) return;
    try { await loadRoles(); await service.list(page); if (dom.disposed) return; view.renderQueues(service, roles); const pagination = dom.el('batch-queues-pagination'); if (pagination) deps.initPaginationSelects(pagination); }
    catch (error) { if (!dom.disposed) dom.html('batch-queues-list', `<div class="tasks-empty"><p>${esc(t('tasks.loadFailedRetry'))}: ${esc(errorMessage(error))}</p><button class="btn-secondary" ${dom.attr('refresh')}>${esc(t('tasks.retry'))}</button></div>`); }
  }
  function stopDetail(): void { if (detailTimer) clearInterval(detailTimer); detailTimer = undefined; }
  function cleanupPage(): void {
    if (listTimer) clearInterval(listTimer); if (durationTimer) clearInterval(durationTimer);
    listTimer = durationTimer = undefined; stopDetail(); service.clearSelection(); detailGeneration++;
  }
  function autoRefresh(enabled: boolean): void {
    service.setAutoRefresh(enabled); if (listTimer) clearInterval(listTimer); listTimer = undefined;
    if (enabled && !dom.disposed) listTimer = setInterval(() => {
      if (listBusy) return; listBusy = true; void list().finally(() => { listBusy = false; });
    }, 5000);
  }
  async function detail(id: string): Promise<void> {
    if (dom.disposed || !id) return;
    deps.enterWorkspace?.();
    const generation = ++detailGeneration; currentId = id;
    if (!isOpen('batch-queue-detail-modal')) { dom.html('batch-queue-detail-content', '<p>Loading queue…</p>'); open('batch-queue-detail-modal'); }
    try {
      await loadRoles(); const queue = await service.detail(id);
      if (dom.disposed || generation !== detailGeneration || currentId !== id) return;
      service.setCurrentQueue(queue); view.renderDetail(queue, roles); stopDetail();
      if (queue.status === 'running') detailTimer = setInterval(() => {
        if (editing() || detailBusy || currentId !== id || dom.disposed) return;
        detailBusy = true; void detail(id).then(() => list()).finally(() => { detailBusy = false; });
      }, 3000);
    } catch (error) { if (generation === detailGeneration && !dom.disposed) { closeDetail(); failures(error); } }
  }
  function closeDetail(): void { currentId = ''; detailGeneration++; stopDetail(); service.closeQueue(); close('batch-queue-detail-modal'); }
  async function refreshCurrent(): Promise<void> { if (currentId) await detail(currentId); await list(); }
  async function openImport(): Promise<void> {
    if (!permitted()) return;
    deps.enterWorkspace?.();
    for (const [id, value] of [['batch-tasks-input', ''], ['batch-queue-title', ''], ['batch-queue-role', ''], ['batch-queue-project-id', ''], ['batch-queue-hitl-policy', ''], ['batch-queue-schedule-mode', 'manual'], ['batch-queue-cron-expr', '']] as const) dom.setValue(id, value);
    dom.setChecked('batch-queue-execute-now', false); view.scheduleMode(); view.importStats();
    await loadRoles();
    const workflows = deps.can('workflow:read') ? await deps.workflowOptions?.() ?? [] : [];
    dom.html('batch-queue-workflow', view.options([{ value: '', label: 'Independent batch tasks' }, ...workflows.filter(w => w.enabled && deps.can('workflow:execute')).map(w => ({ value: w.id, label: w.name }))], ''));
    const roleSelect = dom.field('batch-queue-role');
    if (roleSelect instanceof HTMLSelectElement) roleSelect.innerHTML = view.options([{ value: '', label: t('batchImportModal.defaultRole') }, ...roles.filter(role => role.name !== BACKEND_DEFAULT_ROLE && role.enabled !== false).sort((a, b) => a.name.localeCompare(b.name, 'en-US')).map(role => ({ value: role.name, label: role.name }))], '');
    try {
      const projects = await service.projects();
      dom.html('batch-queue-project-id', view.options([{ value: '', label: t('batchImportModal.projectNone') }, ...projects.map(project => ({ value: project.id, label: project.name || project.id }))], deps.activeProjectId()));
    } catch { /* Project binding remains optional. */ }
    if (dom.disposed) return; view.initSelects();
    // Focus before returning control to the user. A deferred modal focus can
    // otherwise steal the first title keystrokes on a busy browser frame.
    open('batch-import-modal'); dom.field('batch-tasks-input')?.focus();
  }
  async function create(): Promise<void> {
    if (!permitted() || saving) return; saving = true;
    try {
      const id = await service.create({ workflowId: dom.value('batch-queue-workflow'), title: dom.value('batch-queue-title'), role: dom.value('batch-queue-role'), projectId: dom.value('batch-queue-project-id').trim(), hitlPolicy: dom.value('batch-queue-hitl-policy'), concurrency: Number.parseInt(dom.value('batch-queue-concurrency'), 10), scheduleMode: dom.value('batch-queue-schedule-mode') === 'cron' ? 'cron' : 'manual', cronExpr: dom.value('batch-queue-cron-expr'), executeNow: dom.checked('batch-queue-execute-now'), tasks: dom.value('batch-tasks-input').split('\n') });
      if (!dom.disposed) { close('batch-import-modal'); await detail(id); await list(); }
    } catch (error) { failures(error); } finally { saving = false; }
  }
  async function command(action: 'start' | 'pause' | 'rerun'): Promise<void> {
    if (!currentId || !permitted()) return; const id = currentId;
    if (action !== 'start' && !deps.confirm(t(action === 'pause' ? 'tasks.pauseQueueConfirm' : 'tasks.rerunQueueConfirm'))) return;
    dom.disable(`batch-queue-${action}-btn`, true);
    try {
      if (action === 'start') { const queue = await service.detail(id); if (queue.status === 'pending' && queue.scheduleMode === 'cron' && queue.scheduleEnabled && !deps.confirm(t('batchQueueDetailModal.startExecuteNowConfirm'))) return; }
      await service.command(id, action); await refreshCurrent();
    } catch (error) { failures(error); } finally { dom.disable(`batch-queue-${action}-btn`, false); }
  }
  async function remove(id = currentId): Promise<void> {
    if (!id || !permitted('tasks:delete') || !deps.confirm(t('tasks.deleteQueueConfirm'))) return;
    dom.disable('batch-queue-delete-btn', true);
    try { await service.remove(id); if (currentId === id) closeDetail(); await list(); } catch (error) { failures(error); } finally { dom.disable('batch-queue-delete-btn', false); }
  }
  async function loadActive(): Promise<void> {
    if (dom.disposed || !dom.el('tasks-list')) return;
    dom.html('tasks-list', `<div class="loading-spinner">${esc(t('tasks.loadingTasks'))}</div>`);
    try { await service.loadActive(); if (dom.disposed) return; view.renderActive(service); if (!durationTimer) durationTimer = setInterval(view.updateDurations, 1000); }
    catch (error) { dom.html('tasks-list', `<div class="tasks-empty"><p>${esc(t('tasks.loadFailedRetry'))}: ${esc(errorMessage(error))}</p><button ${dom.attr('loadActive')}>${esc(t('tasks.retry'))}</button></div>`); }
  }
  async function cancel(id: string, button?: HTMLElement): Promise<void> {
    if (!id || !permitted()) return;
    if (button instanceof HTMLButtonElement) { button.disabled = true; button.textContent = t('tasks.cancelling'); }
    try { await service.cancel(id); await loadActive(); } catch (error) { failures(error); if (button instanceof HTMLButtonElement) { button.disabled = false; button.textContent = t('tasks.cancelTask'); } }
  }
  function navigateConversation(id: string): void { if (id) { closeDetail(); deps.navigate('chat?conversation=' + encodeURIComponent(id)); } }
  function vulnerabilities(kind: string, id: string): void { if (id && ['queue', 'conversation'].includes(kind)) deps.navigate('vulnerabilities?' + (kind === 'queue' ? 'task_id' : 'conversation_id') + '=' + encodeURIComponent(id)); }
  function openAdd(): void {
    if (!currentId || !permitted()) return; dom.setValue('add-task-message', ''); open('add-batch-task-modal'); dom.field('add-task-message')?.focus();
  }
  function closeAdd(): void { close('add-batch-task-modal'); dom.setValue('add-task-message', ''); }
  async function saveAdd(): Promise<void> {
    if (!currentId || !permitted() || saving) return; saving = true;
    try { await service.saveTask(currentId, dom.value('add-task-message')); closeAdd(); await refreshCurrent(); } catch (error) { failures(error); } finally { saving = false; }
  }
  function cancelEdits(): void { if (currentId) void detail(currentId); }
  async function saveTask(queueId: string, taskId: string): Promise<void> {
    if (saving || !permitted()) return; const input = dom.field('bq-task-edit-' + taskId); if (!input) return;
    saving = true; try { await service.saveTask(queueId, input.value, taskId); await refreshCurrent(); } catch (error) { failures(error); } finally { saving = false; }
  }
  function editTask(button: HTMLElement): void {
    if (!permitted()) return;
    const item = button.closest<HTMLElement>('.batch-task-item'); if (!item || item.querySelector('.batch-task-inline-edit')) return;
    const queueId = item.dataset.queueId, taskId = item.dataset.taskId, message = item.dataset.taskMessage ?? ''; if (!queueId || !taskId) return;
    const span = item.querySelector<HTMLElement>('.batch-task-message'); if (!span) return;
    item.querySelectorAll<HTMLElement>('.batch-task-edit-btn,.batch-task-delete-btn').forEach(node => { node.style.display = 'none'; });
    span.style.display = 'none'; const wrap = deps.doc.createElement('div'); wrap.className = 'batch-task-inline-edit';
    const input = deps.doc.createElement('textarea'); input.id = 'bq-task-edit-' + taskId; input.value = message; wrap.append(input); span.after(wrap);
    let cancelled = false; input.focus(); input.setSelectionRange(input.value.length, input.value.length);
    dom.on(input, 'keydown', event => { if (event instanceof KeyboardEvent && event.key === 'Escape') { cancelled = true; cancelEdits(); } });
    dom.on(input, 'blur', () => { if (!cancelled) void saveTask(queueId, taskId); });
  }
  async function deleteTask(queueId: string, taskId: string): Promise<void> {
    if (!permitted('tasks:delete')) return; try { await service.deleteTask(queueId, taskId); await refreshCurrent(); } catch (error) { failures(error); }
  }
  function deleteTaskElement(button: HTMLElement): void {
    if (!permitted('tasks:delete')) return;
    const item = button.closest<HTMLElement>('.batch-task-item'); if (!item?.dataset.queueId || !item.dataset.taskId) return;
    const message = item.dataset.taskMessage ?? '';
    if (deps.confirm(t('tasks.confirmDeleteTask', { message: message.length > 50 ? message.slice(0, 50) + '...' : message }))) void deleteTask(item.dataset.queueId, item.dataset.taskId);
  }
  async function runTask(queueId: string, taskId: string): Promise<void> {
    if (!permitted() || !deps.confirm(t('tasks.confirmRunSingleTask'))) return;
    try { const result = await service.runTask(queueId, taskId); if (result.autoStarted === false && result.message) deps.alert(result.message); await refreshCurrent(); } catch (error) { failures(error); }
  }
  async function saveMeta(field: InlineField): Promise<void> {
    if (!currentId || saving || !permitted()) return; const input = dom.field(field === 'schedule' ? 'bq-edit-schedule-mode' : 'bq-edit-' + field); if (!input) return;
    saving = true;
    try {
      const value = input.value.trim();
      if (field === 'schedule') await service.schedule(currentId, value, dom.value('bq-edit-cron-expr'));
      else if (field === 'hitl') await service.metadata(currentId, { hitlPolicy: value });
      else if (field === 'concurrency') await service.metadata(currentId, { concurrency: value ? Number(value) : NaN });
      else await service.metadata(currentId, { [field]: value });
      await refreshCurrent();
    } catch (error) { failures(error); } finally { saving = false; }
  }
  function inlineSchedule(): void { const cron = dom.value('bq-edit-schedule-mode') === 'cron'; dom.show('bq-edit-cron-expr', cron); if (cron) dom.field('bq-edit-cron-expr')?.focus(); }
  async function editMeta(field: InlineField): Promise<void> {
    if (!currentId || !permitted()) return;
    const id = currentId, queue = await service.detail(id); if (currentId !== id || !canMutate(queue) || dom.disposed) return;
    const container = dom.el('bq-' + field + '-val'); if (!container || container.querySelector('.bq-inline-edit-controls')) return;
    const editId = field === 'schedule' ? 'bq-edit-schedule-mode' : 'bq-edit-' + field;
    const choose = (values: { value: string; label: string }[], value: string) => `<select id="${editId}">${view.options(values, value)}</select>`;
    let html: string;
    if (field === 'role') {
      const available = roles.filter(role => role.name !== BACKEND_DEFAULT_ROLE && role.enabled !== false).map(role => ({ value: role.name, label: role.name }));
      if (queue.role && !available.some(role => role.value === queue.role)) available.unshift({ value: queue.role, label: queue.role + ' (' + t('batchQueueDetailModal.roleNotFound') + ')' });
      html = choose([{ value: '', label: t('batchImportModal.defaultRole') }, ...available], queue.role);
    } else if (field === 'hitl') html = choose(Object.keys(hitlPolicies).map(policy => ({ value: policy, label: view.hitlLabel(policy) })), queue.hitlPolicy);
    else if (field === 'schedule') html = choose(['manual', 'cron'].map(mode => ({ value: mode, label: t(mode === 'cron' ? 'batchImportModal.scheduleModeCron' : 'batchImportModal.scheduleModeManual') })), queue.scheduleMode) + `<input id="bq-edit-cron-expr" class="bq-edit-cron-expr" value="${esc(queue.cronExpr)}" placeholder="${esc(t('batchImportModal.cronExprPlaceholder'))}" ${queue.scheduleMode === 'cron' ? '' : 'style="display:none"'}>`;
    else html = `<input id="bq-edit-${field}" type="${field === 'concurrency' ? 'number' : 'text'}" ${field === 'concurrency' ? 'min="1" max="8"' : ''} value="${esc(field === 'title' ? queue.title : queue.concurrency || 1)}">`;
    container.innerHTML = `<span class="bq-inline-edit-controls">${html}</span>`;
    const input = dom.field(editId); if (!input) return; let cancelled = false;
    if (input instanceof HTMLSelectElement && field !== 'hitl') { dom.enhanceSelect(input, 'batch-form-select'); container.querySelector<HTMLButtonElement>('.batch-form-select-trigger')?.focus(); } else input.focus();
    if (input instanceof HTMLInputElement) input.select();
    dom.on(container, 'keydown', event => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.key === 'Escape') { cancelled = true; cancelEdits(); }
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); event.target.blur(); }
    });
    dom.on(input, 'change', () => { if (field === 'schedule') inlineSchedule(); if (!cancelled && (field !== 'schedule' || input.value !== 'cron')) void saveMeta(field); });
    dom.on(container, 'focusout', () => { setTimeout(() => { if (!cancelled && !dom.disposed && container.isConnected && !container.contains(deps.doc.activeElement)) void saveMeta(field); }, 100); });
  }
  async function scheduleEnabled(enabled: boolean): Promise<void> {
    if (!currentId || !permitted()) return;
    try { await service.scheduleEnabled(currentId, enabled); await refreshCurrent(); } catch (error) { failures(error); if (currentId) await detail(currentId); }
  }
  async function batchCancel(): Promise<void> {
    if (!permitted() || !service.selected.size || !deps.confirm(t('tasks.confirmCancelTasks', { n: service.selected.size }))) return;
    const result = await service.batchCancel(); await loadActive(); deps.alert(t(result.fail ? 'tasks.batchCancelResultPartial' : 'tasks.batchCancelResultSuccess', { ...result, n: result.success }));
  }
  function filter(): void { service.setFilters(dom.value('batch-queues-status-filter') || 'all', dom.value('batch-queues-search')); void list(1); }
  function page(next: number): void { if (next < 1 || next > service.pagination.totalPages) return; void list(next); dom.el('batch-queues-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function pageSize(): void { service.setPageSize(Number(dom.value('batch-queues-page-size-pagination'))); void list(1); }
  const hooks = {
    loadTasks: loadActive, refreshTasks: loadActive, cancelTask: cancel, viewConversation: navigateConversation,
    initTasksPage: () => { view.initSelects(); dom.setChecked('tasks-auto-refresh', service.autoRefresh); autoRefresh(service.autoRefresh); void list(); if (currentId && isOpen('batch-queue-detail-modal') && !editing()) void detail(currentId); }, cleanupTasksPage: cleanupPage,
    filterTasks: () => view.renderActive(service), sortTasks: () => view.renderActive(service),
    toggleTaskSelection: (id: string, checked: boolean) => { service.select(id, checked); view.selection(service); },
    clearTaskSelection: () => { service.clearSelection(); view.renderActive(service); }, batchCancelTasks: batchCancel,
    copyTaskId: async (id: string) => { try { await deps.copy(id); const toast = deps.doc.createElement('div'); toast.className = 'task-copy-toast'; toast.textContent = t('tasks.copiedToast'); toast.style.cssText = 'position:fixed;top:50%;left:50%;z-index:10000'; deps.doc.body.append(toast); setTimeout(() => toast.remove(), 1000); } catch (error) { failures(error); } },
    toggleTasksAutoRefresh: autoRefresh, toggleShowHistory: (show: boolean) => { service.setShowHistory(show); view.renderActive(service); },
    clearTasksHistory: () => { if (deps.confirm(t('tasks.clearHistoryConfirm'))) { service.clearHistory(); view.renderActive(service); } },
    showBatchImportModal: openImport, closeBatchImportModal: () => close('batch-import-modal'), createBatchQueue: create,
    loadBatchQueues: list, showBatchQueueDetail: detail, refreshBatchQueues: list,
    startBatchQueue: () => command('start'), pauseBatchQueue: () => command('pause'), rerunBatchQueue: () => command('rerun'),
    deleteBatchQueue: () => remove(), deleteBatchQueueFromList: remove, closeBatchQueueDetailModal: closeDetail,
    viewBatchTaskConversation: navigateConversation, navigateToVulnerabilitiesFromTasksPage: vulnerabilities,
    editBatchTaskFromElement: editTask, deleteBatchTaskFromElement: deleteTaskElement, deleteBatchTask: deleteTask, runSingleBatchTask: runTask,
    cancelInlineTask: cancelEdits, saveInlineTask: saveTask, filterBatchQueues: filter, goBatchQueuesPage: page, changeBatchQueuesPageSize: pageSize,
    showAddBatchTaskModal: openAdd, closeAddBatchTaskModal: closeAdd, saveAddBatchTask: saveAdd,
    handleBatchScheduleModeChange: view.scheduleMode, updateBatchImportStats: view.importStats, updateBatchQueueScheduleEnabled: scheduleEnabled,
    cancelAllInlineEdits: cancelEdits, startInlineEditTitle: () => editMeta('title'), saveInlineTitle: () => saveMeta('title'),
    startInlineEditRole: () => editMeta('role'), saveInlineRole: () => saveMeta('role'),
    startInlineEditConcurrency: () => editMeta('concurrency'), saveInlineConcurrency: () => saveMeta('concurrency'), startInlineEditHITLPolicy: () => editMeta('hitl'),
    startInlineEditSchedule: () => editMeta('schedule'), toggleInlineScheduleCron: inlineSchedule, saveInlineSchedule: () => saveMeta('schedule'),
  };
  return { hooks,
    activate(): void {
      if (mounted || dom.disposed) return; mounted = true;
      const simple = { showBatchImportModal: openImport, closeBatchImportModal: hooks.closeBatchImportModal, createBatchQueue: create, refreshBatchQueues: () => list(), showAddBatchTaskModal: openAdd, startBatchQueue: hooks.startBatchQueue, rerunBatchQueue: hooks.rerunBatchQueue, pauseBatchQueue: hooks.pauseBatchQueue, deleteBatchQueue: hooks.deleteBatchQueue, closeBatchQueueDetailModal: closeDetail, closeAddBatchTaskModal: closeAdd, saveAddBatchTask: saveAdd };
      for (const [name, fn] of Object.entries(simple)) dom.action(name, () => fn());
      dom.action('refresh', () => list()); dom.action('loadActive', loadActive); dom.action('detail', node => detail(node.dataset.queueId ?? ''));
      dom.action('stop', (_node, event) => event.stopPropagation());
      dom.action('filter', filter); dom.action('autoRefresh', node => autoRefresh(node instanceof HTMLInputElement && node.checked));
      dom.action('scheduleMode', view.scheduleMode); dom.action('importStats', view.importStats);
      dom.action('page', node => page(Number(node.dataset.page))); dom.action('pageSize', pageSize);
      dom.action('deleteQueue', (node, event) => { event.stopPropagation(); return remove(node.dataset.id); });
      dom.action('vulnerabilities', (node, event) => { event.stopPropagation(); vulnerabilities(node.dataset.kind ?? '', node.dataset.id ?? ''); });
      dom.action('conversation', (node, event) => { event.stopPropagation(); navigateConversation(node.dataset.id ?? ''); });
      dom.action('editMeta', node => { const field = node.dataset.field; if (field === 'title' || field === 'role' || field === 'hitl' || field === 'schedule' || field === 'concurrency') return editMeta(field); });
      dom.action('scheduleEnabled', node => scheduleEnabled(node instanceof HTMLInputElement && node.checked));
      dom.action('editTask', (node, event) => { event.stopPropagation(); editTask(node); }); dom.action('deleteTask', (node, event) => { event.stopPropagation(); deleteTaskElement(node); });
      dom.action('runTask', (node, event) => { event.stopPropagation(); const item = node.closest<HTMLElement>('.batch-task-item'); if (item?.dataset.queueId && item.dataset.taskId) return runTask(item.dataset.queueId, item.dataset.taskId); });
      dom.action('selectTask', node => { service.select(node.dataset.id ?? '', node instanceof HTMLInputElement && node.checked); view.selection(service); });
      dom.action('cancelTask', node => cancel(node.dataset.id ?? '', node)); dom.action('clearHistory', hooks.clearTasksHistory); dom.action('copy', node => hooks.copyTaskId(node.dataset.id ?? ''));
      dom.mount();
      const search = dom.el('batch-queues-status-filter'); if (search) dom.on(search, 'change', filter);
      const input = dom.el('batch-tasks-input'); if (input) dom.on(input, 'input', view.importStats);
      dom.on(deps.doc, 'keydown', event => {
        if (!(event instanceof KeyboardEvent)) return;
        if (isOpen('add-batch-task-modal')) { if (event.key === 'Escape') closeAdd(); if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void saveAdd(); } }
      });
      dom.on(deps.doc, 'languagechange', () => {
        view.initSelects(); if (dom.el('page-tasks')?.classList.contains('active') || dom.el('page-workflows')?.dataset.workflowTab === 'schedule') { view.renderQueues(service, roles); if (currentId && !editing()) void detail(currentId); }
      });
      view.initSelects();
    },
    dispose(): void { cleanupPage(); closeDetail(); closeAdd(); closeAppModal('batch-import-modal'); dom.dispose(); },
  };
}
