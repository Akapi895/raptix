import { createActions } from '../../ui/actions';
import { auditEngineFromItem, errorMessage, escapeHtml as esc, mergeTools, normalizeBackend, object, parsePayload, tools, workflowLabel, workflowPending } from './model';
import { HITL_PAGE_SIZES, type HitlService } from './service';
import type { HitlDecision, HitlDependencies, HitlFilters, HitlItem, HitlList, JsonObject, WorkflowRun } from './types';

// Rendering and DOM input only. Requests, cached data, selection, pagination,
// migration and run-follow lifecycles are owned by the public service.
export function createHitlView(doc: Document, service: HitlService, deps: HitlDependencies) {
  const actions = createActions();
  const cleanup: (() => void)[] = [];
  let active = false;
  let disposed = false;
  let modalSequence = 0;
  let modalItem: HitlItem | null = null;
  let pendingSequence = 0;
  let logsSequence = 0;
  let whitelistSequence = 0;
  let selectedTools: string[] = [];
  let catalog: string[] = [];
  let whitelistReady = false;
  let strategyReady = false;
  let policyLoad: Promise<void> | null = null;
  let whitelistConversationId = '';
  const el = (id: string) => doc.getElementById(id);
  const field = (id: string) => doc.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[id="${id}"]`);
  // IDs from the server are used through getElementById, never CSS selectors.
  const inputValue = (id: string) => { const node = el(id); return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node.value : ''; };
  function t(key: string, fallback: string, params: Record<string, unknown> = {}): string {
    let text = fallback;
    try { const value = deps.translate('hitl.' + key, params); if (value && value !== 'hitl.' + key) text = value; } catch { /* retain fallback */ }
    return text.replace(/\{\{(\w+)\}\}/g, (match: string, name: string) => String(params[name] ?? match));
  }
  function paginationT(key: string, fallback: string, params: Record<string, unknown> = {}): string {
    for (const prefix of key === 'paginationInfo' || key === 'perPageLabel' ? ['mcpMonitor.', 'mcp.'] : ['mcp.']) {
      const value = deps.translate(prefix + key, params);
      if (value && value !== prefix + key) return value;
    }
    return fallback;
  }
  function feedback(id: string, text = '', error = false): void {
    const node = el(id); if (!node || disposed) return;
    node.hidden = !text.trim(); node.textContent = text.trim();
    node.className = 'hitl-apply-feedback' + (error ? ' hitl-apply-feedback--error' : '');
  }
  function busy(id: string, value: boolean): void { const node = el(id); if (!disposed && node instanceof HTMLButtonElement) node.disabled = value; }
  function resize(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto'; textarea.style.height = Math.max(textarea.scrollHeight, textarea.offsetHeight) + 'px';
  }
  function resizeTextareas(root: ParentNode = doc): void { root.querySelectorAll<HTMLTextAreaElement>('.hitl-edit-args').forEach(resize); }
  function contextBlocks(raw: unknown): string {
    const payload = object(raw);
    return ([['fieldUserMessage', 'User message', payload.userMessage], ['fieldThinking', 'Thinking', payload.thinking],
      ['fieldReasoning', 'Reasoning', payload.reasoningChain], ['fieldPlanning', 'Planning', payload.planning]] as const)
      .map(([key, label, value]) => String(value || '').trim() ? `<div class="hitl-context-block"><div class="hitl-context-label">${esc(t(key, label))}</div><pre class="hitl-context-text">${esc(String(value).trim())}</pre></div>` : '').join('');
  }
  function executionBlock(raw: unknown): string {
    const exec = object(object(raw).executionResult);
    const text = String(exec.result || '').trim(); if (!text) return '';
    const label = t('fieldExecutionResult', 'Execution result') + ' (' + (exec.success === true ? t('executionSuccess', 'success') : t('executionFailed', 'failed')) + ')';
    return `<div class="hitl-context-block hitl-context-block--execution"><div class="hitl-context-label">${esc(label)}</div><pre class="hitl-context-text">${esc(text)}</pre></div>`;
  }
  function formatPayload(raw: unknown): string {
    if (!raw) return '';
    if (typeof raw === 'object') { try { return JSON.stringify(raw, null, 2); } catch { return String(raw); } }
    const text = String(raw).trim(); try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
  }
  function engineLabel(backend: unknown, model: string): string {
    const value = normalizeBackend(backend); if (!value) return '';
    const label = value === 'typesafe' ? t('auditEngineJev', 'TypeSafe Jev') : t('auditEngineOpenAI', 'OpenAI protocol');
    return model.trim() ? label + ' · ' + model.trim() : label;
  }
  function reviewerLabel(value = ''): string {
    const labels: Record<string, string> = { human: t('reviewerHuman', 'Human'), audit_agent: t('reviewerAgent', 'Audit Agent'), system: t('reviewerSystem', 'System'), manual: t('reviewerManual', 'Manual') };
    return labels[value] || value || '-';
  }
  function decisionLabel(value = ''): string {
    return value.toLowerCase() === 'approve' ? t('decisionApprove', 'Approve') : value.toLowerCase() === 'reject' ? t('decisionReject', 'Reject') : value || '—';
  }
  function decisionTag(value = ''): string {
    return `<span class="hitl-decision-tag ${value === 'approve' ? 'hitl-decision--approve' : value === 'reject' ? 'hitl-decision--reject' : ''}">${esc(decisionLabel(value))}</span>`;
  }
  function formatTime(value?: string | null): string {
    if (!value) return '-'; const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    try { return date.toLocaleString(deps.getLocale(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
    catch { return value; }
  }
  function renderPendingList(items: HitlItem[]): string {
    return items.map(item => {
      const id = esc(item.id); const cid = esc(item.conversationId || '');
      const payload = parsePayload(item.payload); const mode = (item.mode || '').trim().toLowerCase();
      const args = payload.argumentsObj ?? payload.arguments;
      const modeLabel = mode === 'review_edit' ? t('strategyTabReviewEdit', 'Review & edit mode') : t('strategyTabApproval', 'Approval mode');
      return `<div class="hitl-pending-item"><div class="hitl-pending-item-header"><div class="hitl-pending-item-title">
        <span class="hitl-tool-badge">${esc(item.toolName || '-')}</span><span class="hitl-mode-tag">${esc(modeLabel)}</span></div>
        <button type="button" class="hitl-dismiss-btn" title="${esc(t('dismiss', 'Dismiss'))}" aria-label="${esc(t('dismiss', 'Dismiss'))}" data-action="hitl.dismiss" data-id="${id}">&times;</button></div>
        <div class="hitl-pending-meta">${cid ? `<button type="button" class="btn-link" data-action="hitl.open-conversation" data-conversation="${cid}">${esc(t('conversationLabel', 'Conversation:'))} ${cid}</button>` : esc(t('noConversation', 'No conversation'))}${item.createdAt ? `<time datetime="${esc(item.createdAt)}">${esc(formatTime(item.createdAt))}</time>` : ''}</div>
        ${payload.userMessage ? `<p class="hitl-request-context">${esc(payload.userMessage)}</p>` : ''}
        <span class="hitl-request-label">${esc(t('argumentsLabel', 'Tool arguments'))}</span><pre class="hitl-pending-payload">${esc(args == null ? t('noArguments', 'No arguments provided') : formatPayload(args))}</pre>
        <details class="hitl-request-details"><summary>${esc(t('requestContext', 'Full request context'))}</summary>${contextBlocks(payload)}${executionBlock(payload)}<pre class="hitl-pending-payload">${esc(formatPayload(item.payload))}</pre></details>
        ${mode === 'review_edit' ? `<label class="hitl-request-label" for="hitl-edit-${id}">${esc(t('reviewArgs', 'Review parameters (JSON)'))}</label><div class="hitl-input-help">${esc(t('reviewEditHelp', 'Provide a JSON object to override tool arguments. Leave empty to keep the original arguments.'))}</div><textarea id="hitl-edit-${id}" class="hitl-edit-args" data-input="hitl.resize" placeholder="{&quot;command&quot;:&quot;ls -la&quot;}"></textarea>` : `<div class="hitl-input-help">${esc(t('approvalHelp', 'Approval mode: only approve/reject, argument editing is disabled.'))}</div>`}
        <label class="hitl-request-label" for="hitl-comment-${id}">${esc(t('commentOptional', 'Comment (optional)'))}</label>
        <input id="hitl-comment-${id}" class="hitl-config-input hitl-inline-comment" type="text" placeholder="${esc(t('commentPlaceholder', 'e.g. allow read-only command'))}">
        <div class="hitl-pending-actions">${decisionButtons('hitl.decide', id, cid)}</div></div>`;
    }).join('');
  }
  function decisionButtons(action: string, id: string, cid: string): string {
    return `<button class="btn-secondary" data-action="${action}" data-id="${id}" data-conversation="${cid}" data-decision="reject">${esc(t('reject', 'Reject'))}</button><button class="btn-primary" data-action="${action}" data-id="${id}" data-conversation="${cid}" data-decision="approve">${esc(t('approve', 'Approve'))}</button>`;
  }
  function renderWorkflowPendingList(runs: WorkflowRun[]): string {
    return runs.map(run => {
      const id = esc(run.id.trim()); const cid = esc((run.conversation_id || run.conversationId || '').trim());
      const prompt = String(workflowPending(run).prompt || '').trim();
      return `<div class="hitl-pending-item hitl-pending-item--workflow"><div class="hitl-pending-item-header"><div class="hitl-pending-item-title"><span class="hitl-tool-badge">${esc(t('workflowPendingTitle', 'Workflow approval'))}</span><span class="hitl-mode-tag hitl-mode-tag--approval">${esc(workflowLabel(run))}</span></div></div>
        <div class="hitl-pending-meta">${esc(t('conversationLabel', 'Conversation:'))} ${cid || '-'}</div>${prompt ? `<div class="hitl-input-help">${esc(prompt)}</div>` : ''}
        <label class="hitl-request-label" for="workflow-hitl-comment-${id}">${esc(t('commentOptional', 'Comment (optional)'))}</label>
        <input id="workflow-hitl-comment-${id}" class="hitl-config-input hitl-inline-comment" type="text" placeholder="${esc(t('commentPlaceholder', 'e.g. allow read-only command'))}">
        <div class="hitl-pending-actions">${cid ? `<button class="btn-secondary" data-action="hitl.open-conversation" data-conversation="${cid}">${esc(t('openConversation', 'Open conversation'))}</button>` : ''}${decisionButtons('hitl.workflow-decide', id, cid)}</div></div>`;
    }).join('');
  }
  function renderPagination(list: HitlList): void {
    const container = el(`hitl-${list}-pagination`); if (!container) return;
    const { page, pageSize, total } = service.getState()[list]; const pages = Math.max(1, Math.ceil(total / pageSize));
    container.hidden = total <= pageSize;
    if (container.hidden) { container.innerHTML = ''; return; }
    const start = total ? (page - 1) * pageSize + 1 : 0; const end = Math.min(page * pageSize, total);
    const button = (target: number, label: string, disabled: boolean) => `<button type="button" class="btn-secondary" data-action="hitl.page" data-list="${list}" data-page="${target}"${disabled ? ' disabled' : ''}>${esc(label)}</button>`;
    container.innerHTML = `<div class="monitor-pagination"><div class="pagination-info"><span>${esc(paginationT('paginationInfo', `Showing ${start}-${end} of ${total} records`, { start, end, total }))}</span><label class="pagination-page-size">${esc(paginationT('perPageLabel', 'Per page'))}<select id="hitl-${list}-page-size" data-change="hitl.page-size" data-list="${list}">${HITL_PAGE_SIZES.map(n => `<option value="${n}"${n === pageSize ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div>
      <div class="pagination-controls">${button(page - 1, paginationT('prevPage', 'Previous'), page === 1)}<span class="pagination-page">${esc(paginationT('pageInfo', `Page ${page} / ${pages}`, { page, total: pages }))}</span>${button(page + 1, paginationT('nextPage', 'Next'), page >= pages)}</div></div>`;
    deps.initPaginationSelects?.(container);
  }
  function renderPending(): void {
    const container = el('hitl-pending-list'); if (!container || disposed) return;
    const state = service.getState().pending;
    const workflow = renderWorkflowPendingList(state.runs); const items = renderPendingList(state.items);
    container.innerHTML = workflow + items || `<div class="empty-state"><p><strong>${esc(t(state.q ? 'noMatchingRequests' : 'emptyState', state.q ? 'No matching requests' : 'No requests waiting'))}</strong></p><p>${esc(t(state.q ? 'adjustSearch' : 'requestsEmptyHint', state.q ? 'Try a different search.' : 'Requests that need your approval will appear here.'))}</p></div>`;
    const badge = el('hitl-pending-count'); if (badge) { badge.textContent = String(state.total); badge.hidden = state.total <= 0; }
    resizeTextareas(container); renderPagination('pending');
  }
  async function refreshPending(): Promise<void> {
    const container = el('hitl-pending-list'); if (!container || disposed) return;
    const sequence = ++pendingSequence;
    const q = field('hitl-pending-search')?.value.trim() || '';
    if (q !== service.getState().pending.q) service.filterPending(q);
    container.innerHTML = `<div class="loading-spinner">${esc(t('loading', 'Loading...'))}</div>`;
    try { if (await service.loadPending()) renderPending(); }
    catch { if (!disposed && sequence === pendingSequence) { container.innerHTML = `<div class="empty-state">${esc(t('loadFailed', 'Failed to load'))}</div>`; renderPagination('pending'); } }
  }
  function readLogFilters(): HitlFilters {
    return { q: field('hitl-logs-search')?.value.trim(), decision: field('hitl-logs-decision-filter')?.value, decidedBy: field('hitl-logs-decidedby-filter')?.value };
  }
  function updateBatchActions(): void {
    const { selectedLogs, logs } = service.getState();
    const bar = el('hitl-logs-batch-actions'); if (bar) bar.style.display = selectedLogs.size > 0 && logs.items.length ? 'flex' : 'none';
    const count = el('hitl-logs-selected-count'); if (count) count.textContent = t('selectedCount', '{{count}} selected', { count: selectedLogs.size });
    const boxes = [...doc.querySelectorAll<HTMLInputElement>('.hitl-log-checkbox')];
    boxes.forEach(box => { box.checked = selectedLogs.has(box.value); });
    const all = el('hitl-logs-select-all');
    if (all instanceof HTMLInputElement) { const checked = boxes.filter(box => box.checked).length; all.checked = boxes.length > 0 && checked === boxes.length; all.indeterminate = checked > 0 && checked < boxes.length; }
  }
  function renderLogs(): void {
    const wrap = el('hitl-logs-table-wrap'); if (!wrap || disposed) return;
    const { logs, selectedLogs } = service.getState();
    const hint = el('hitl-logs-retention-hint'); if (hint) { hint.hidden = logs.retentionDays <= 0; hint.textContent = logs.retentionDays > 0 ? t('retentionHint', 'Audit logs are kept for {{days}} days, then purged automatically.', { days: logs.retentionDays }) : ''; }
    const filtered = Object.values(logs.filters).some(value => value && value !== 'all');
    const clearButton = el('hitl-clear-logs'); if (clearButton) {
      clearButton.hidden = !logs.total;
      clearButton.textContent = t(filtered ? 'clearFiltered' : 'clearAll', filtered ? 'Clear matching history' : 'Clear all');
    }
    if (!logs.items.length) wrap.innerHTML = `<div class="empty-state"><p><strong>${esc(t(filtered ? 'noMatchingHistory' : 'logsEmpty', filtered ? 'No matching decisions' : 'No decisions yet'))}</strong></p><p>${esc(t(filtered ? 'adjustFilters' : 'logsEmptyHint', filtered ? 'Try a different search or filter.' : 'Completed approval decisions appear here.'))}</p></div>`;
    else {
      const rows = logs.items.map(item => {
        const engine = auditEngineFromItem(item); const label = engineLabel(engine.backend, engine.model);
        const payload = parsePayload(item.payload);
        const context = item.comment?.trim() || String(payload.userMessage || '').trim();
        return `<tr><td><input type="checkbox" class="hitl-log-checkbox" aria-label="${esc(t('selectLog', 'Select log {{id}}', { id: item.id }))}" value="${esc(item.id)}" data-change="hitl.log-select"${selectedLogs.has(item.id) ? ' checked' : ''}></td><td><span class="hitl-log-tool">${esc(item.toolName || '-')}</span><span class="hitl-log-secondary hitl-logs-cell-mono">${esc(item.id)}</span></td><td class="hitl-logs-cell-mono">${item.conversationId ? `<button type="button" class="btn-link" data-action="hitl.open-conversation" data-conversation="${esc(item.conversationId)}">${esc(item.conversationId)}</button>` : '—'}</td><td>${decisionTag(item.decision)}${item.status && item.status !== 'decided' ? `<span class="hitl-log-secondary">${esc(item.status)}</span>` : ''}</td><td>${esc(reviewerLabel(item.decidedBy))}${label ? `<div class="hitl-log-engine">${esc(label)}</div>` : ''}</td><td class="hitl-logs-summary"><span class="hitl-log-context-preview">${esc(context || t('noDecisionContext', 'No comment recorded'))}</span></td><td class="hitl-log-time">${esc(formatTime(item.decidedAt || item.createdAt))}</td><td class="hitl-logs-actions"><button type="button" class="btn-link" data-action="hitl.log-detail" data-id="${esc(item.id)}">${esc(t('viewDetail', 'Detail'))}</button></td></tr>`;
      }).join('');
      wrap.innerHTML = `<table class="hitl-logs-table" aria-label="${esc(t('tabLogs', 'History'))}"><thead><tr><th scope="col"><input type="checkbox" id="hitl-logs-select-all" data-change="hitl.log-select-page" aria-label="${esc(t('selectPage', 'Select this page'))}"></th>${([['colExecution', 'Execution'], ['colConversation', 'Conversation'], ['colDecision', 'Decision'], ['colDecidedBy', 'Reviewer'], ['colDecisionContext', 'Decision context'], ['colTime', 'Time'], ['colActions', 'Actions']] as const).map(([key, label]) => `<th scope="col">${esc(t(key, label))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    updateBatchActions(); renderPagination('logs');
  }
  async function refreshLogs(): Promise<void> {
    const wrap = el('hitl-logs-table-wrap'); if (!wrap || disposed) return;
    const sequence = ++logsSequence;
    // Globals can be called directly by the router; always capture current filters.
    const current = service.getState().logs; const values = readLogFilters();
    if (JSON.stringify(current.filters) !== JSON.stringify(values)) service.filterLogs(values);
    wrap.innerHTML = `<div class="loading-spinner">${esc(t('loading', 'Loading...'))}</div>`;
    try { if (await service.loadLogs()) renderLogs(); }
    catch { if (!disposed && sequence === logsSequence) { wrap.innerHTML = `<div class="empty-state">${esc(t('loadFailed', 'Failed to load'))}</div>`; renderPagination('logs'); } }
  }
  async function filterPending(): Promise<void> { service.filterPending(field('hitl-pending-search')?.value || ''); await refreshPending(); }
  async function filterLogs(): Promise<void> { service.filterLogs(readLogFilters()); await refreshLogs(); }
  async function goPage(list: HitlList, page: number): Promise<void> { if (service.setPage(list, page)) await (list === 'pending' ? refreshPending() : refreshLogs()); }
  async function pageSizeChange(list: HitlList): Promise<void> {
    const select = field(`hitl-${list}-page-size`);
    if (select && service.setPageSize(list, Number(select.value))) await (list === 'pending' ? refreshPending() : refreshLogs());
  }
  function selectLog(id: string, checked: boolean): void { service.selectLog(id, checked); updateBatchActions(); }
  function selectPage(checked: boolean): void { service.selectPage(checked); updateBatchActions(); }
  function deselectAll(): void { service.deselectLogs(); updateBatchActions(); }
  async function batchDeleteLogs(): Promise<void> {
    const count = service.getState().selectedLogs.size;
    if (!count) { deps.alert(t('selectLogsFirst', 'Select audit logs to delete first')); return; }
    if (!deps.confirm(t('batchDeleteConfirm', 'Delete the selected {{count}} audit log(s)? This cannot be undone.', { count }))) return;
    try { const deleted = await service.deleteSelectedLogs(); await refreshLogs(); if (!disposed) deps.alert(t('batchDeleteSuccess', 'Successfully deleted {{count}} audit log(s)', { count: deleted })); }
    catch (error) { deps.alert(t('batchDeleteFailed', 'Batch delete failed') + ': ' + errorMessage(error)); }
  }
  async function clearLogs(): Promise<void> {
    const count = service.getState().logs.total; if (!count) return;
    const values = readLogFilters(); const filtered = Object.values(values).some(v => v && v !== 'all');
    if (!deps.confirm(t(filtered ? 'clearAllConfirm' : 'clearAllConfirmNoFilter', 'Clear all {{count}} audit log(s)? This cannot be undone.', { count }))) return;
    service.filterLogs(values);
    try { const deleted = await service.clearLogs(); await refreshLogs(); if (!disposed) deps.alert(t('clearAllSuccess', 'Cleared {{count}} audit log(s)', { count: deleted })); }
    catch (error) { deps.alert(t('clearAllFailed', 'Clear failed') + ': ' + errorMessage(error)); }
  }
  async function submitDecisionWithPayload(id: string, decision: HitlDecision, comment = '', edited: JsonObject | null = null, cid = ''): Promise<boolean> {
    try { return await service.decide(id, decision, comment, edited, cid); }
    catch (error) { deps.alert(t('submitFailedPrefix', 'Submit failed:') + ' ' + errorMessage(error)); return false; }
  }
  async function submitDecision(id: string, decision: HitlDecision, cid = ''): Promise<boolean> {
    let edited: JsonObject | null = null;
    const text = inputValue('hitl-edit-' + id).trim();
    if (text) {
      try { const value: unknown = JSON.parse(text); if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(); edited = object(value); }
      catch { deps.alert(t('invalidJson', 'Invalid JSON arguments')); return false; }
    }
    return submitDecisionWithPayload(id, decision, inputValue('hitl-comment-' + id).trim(), edited, cid);
  }
  async function submitWorkflowDecision(id: string, approved: boolean, cid = ''): Promise<void> {
    try { await service.decideWorkflow(id.trim(), approved, inputValue('workflow-hitl-comment-' + id.trim()).trim(), cid); }
    catch (error) { deps.alert(errorMessage(error) || t('submitFailed', 'Submit failed')); }
  }
  function openConversation(cid: string): void { if (cid.trim()) { deps.navigate?.('chat'); void deps.loadConversation?.(cid.trim()); } }
  function renderAuditEngine(): void {
    let node = el('hitl-page-audit-engine'); const bar = el('hitl-page-reviewer-bar');
    if (!node && bar) { node = doc.createElement('p'); node.id = 'hitl-page-audit-engine'; node.className = 'hitl-page-audit-engine'; bar.insertBefore(node, bar.querySelector('.hitl-page-reviewer-hint')); }
    if (!node) return; const info = service.getAuditEngine(); const label = engineLabel(info.backend, info.model);
    node.hidden = !label; node.textContent = label ? t('auditEngineLabel', 'Approval engine') + ': ' + label : '';
  }
  function renderStrategyHint(): void {
    let node = el('hitl-strategy-hint-jev'); const bar = el('hitl-page-strategy-bar');
    if (!node && bar) { node = doc.createElement('p'); node.id = 'hitl-strategy-hint-jev'; node.className = 'hitl-page-strategy-hint'; const review = el('hitl-strategy-hint-review-edit'); bar.insertBefore(node, review?.nextSibling ?? null); }
    if (!node) return; node.hidden = service.getAuditEngine().backend !== 'typesafe';
    if (!node.hidden) node.textContent = t('strategyHintJev', 'TypeSafe Jev evaluates the custom strategy as structured questions. Built-in destructive rules remain a hard floor.');
  }
  function refreshReviewerBar(): void {
    const cid = deps.getCurrentConversationId();
    const config = deps.getConversationConfig?.(cid);
    const scope = el('hitl-reviewer-scope'); if (scope) scope.textContent = cid ? t('conversationReviewer', 'Conversation reviewer') : t('globalReviewer', 'Default reviewer');
    const detail = el('hitl-reviewer-scope-detail'); if (detail) detail.textContent = cid || t('newConversations', 'New conversations');
    const hint = el('hitl-reviewer-scope-hint'); if (hint) hint.textContent = cid ? t('conversationReviewerHint', 'Reviewer changes apply immediately to this conversation only.') : t('defaultReviewerHint', 'Reviewer changes are saved immediately as the global default for new conversations.');
    if (config) deps.setReviewerUI?.(config.reviewer);
    deps.bindReviewerToggleListeners?.(); renderAuditEngine(); renderStrategyHint();
  }
  function switchStrategyMode(mode: string): void {
    service.setStrategyMode(mode); const current = service.getState().strategyMode;
    for (const [value, suffix] of [['approval', 'approval'], ['review_edit', 'review-edit']] as const) {
      const tab = el('hitl-strategy-tab-' + suffix); tab?.classList.toggle('hitl-strategy-subtab--active', value === current); tab?.setAttribute('aria-selected', String(value === current));
      tab?.setAttribute('tabindex', value === current ? '0' : '-1');
      const hint = el('hitl-strategy-hint-' + suffix); if (hint) hint.hidden = value !== current;
      const textarea = el('hitl-audit-agent-prompt' + (value === 'review_edit' ? '-review-edit' : '')); if (textarea) textarea.hidden = value !== current;
    }
    renderStrategyHint();
  }
  async function refreshStrategy(): Promise<void> {
    const approval = field('hitl-audit-agent-prompt'); if (!approval || disposed) return;
    strategyReady = false; busy('hitl-strategy-save-btn', true);
    for (const id of ['hitl-audit-agent-prompt', 'hitl-audit-agent-prompt-review-edit']) {
      const editor = field(id); if (editor instanceof HTMLTextAreaElement) editor.readOnly = true;
    }
    try {
      if (!await service.loadStrategy() || disposed) return; const strategy = service.getState().strategy;
      approval.value = strategy.auditAgentPrompt ?? strategy.defaultAuditAgentPrompt ?? '';
      const review = field('hitl-audit-agent-prompt-review-edit'); if (review) review.value = strategy.auditAgentPromptReviewEdit ?? strategy.defaultAuditAgentPromptReviewEdit ?? '';
      switchStrategyMode(service.getState().strategyMode);
      strategyReady = true; feedback('hitl-strategy-feedback');
    } catch (error) { feedback('hitl-strategy-feedback', t('strategyLoadFailed', 'Could not load audit strategy. Use Refresh to try again.') + ' ' + errorMessage(error), true); }
    finally {
      busy('hitl-strategy-save-btn', !strategyReady);
      for (const id of ['hitl-audit-agent-prompt', 'hitl-audit-agent-prompt-review-edit']) {
        const editor = field(id); if (editor instanceof HTMLTextAreaElement) editor.readOnly = !strategyReady;
      }
    }
  }
  async function saveStrategy(): Promise<void> {
    const approval = field('hitl-audit-agent-prompt'); if (!approval || !strategyReady) return;
    feedback('hitl-strategy-feedback'); busy('hitl-strategy-save-btn', true);
    try {
      const result = await service.saveStrategy(approval.value, field('hitl-audit-agent-prompt-review-edit')?.value || '');
      if (disposed) return;
      if (typeof result.auditAgentPrompt === 'string') approval.value = result.auditAgentPrompt;
      const review = field('hitl-audit-agent-prompt-review-edit'); if (review && typeof result.auditAgentPromptReviewEdit === 'string') review.value = result.auditAgentPromptReviewEdit;
      feedback('hitl-strategy-feedback', t('strategySaved', 'Audit strategy saved.'));
    } catch (error) { feedback('hitl-strategy-feedback', t('strategySaveFailed', 'Failed to save') + ': ' + errorMessage(error), true); }
    finally { busy('hitl-strategy-save-btn', false); }
  }
  function resetStrategy(): void {
    const { strategy, strategyMode } = service.getState();
    const textarea = field('hitl-audit-agent-prompt' + (strategyMode === 'review_edit' ? '-review-edit' : ''));
    if (textarea) textarea.value = (strategyMode === 'review_edit' ? strategy.defaultAuditAgentPromptReviewEdit : strategy.defaultAuditAgentPrompt) || textarea.value;
    feedback('hitl-strategy-feedback');
  }
  async function refreshWhitelist(): Promise<void> {
    if (!el('hitl-selected-tools') || disposed) return;
    whitelistReady = false; busy('hitl-page-whitelist-save-btn', true);
    const sequence = ++whitelistSequence; const cached = service.getWhitelist();
    const cid = deps.getCurrentConversationId();
    selectedTools = cached; renderToolSelector();
    try {
      const global = await service.resolveWhitelist(); if (disposed || sequence !== whitelistSequence) return;
      if (cid !== deps.getCurrentConversationId()) return;
      const config = deps.getConversationConfig?.(cid); selectedTools = tools(mergeTools(global, config?.sensitiveTools));
      whitelistConversationId = cid;
      whitelistReady = true; feedback('hitl-page-whitelist-feedback');
      const hint = el('hitl-whitelist-scope-hint'); if (hint) {
        hint.hidden = !deps.getCurrentConversationId();
        hint.textContent = t('whitelistConversationHint', 'This selection includes the active conversation’s tool list. Saving makes the selection global and clears that conversation’s separate list.');
      }
    } catch (error) { feedback('hitl-page-whitelist-feedback', t('whitelistLoadFailed', 'Could not load the whitelist. Use Refresh to try again.') + ' ' + errorMessage(error), true); }
    finally { if (!disposed && sequence === whitelistSequence) { busy('hitl-page-whitelist-save-btn', !whitelistReady); renderToolSelector(); } }
  }
  function renderToolSelector(): void {
    const selected = el('hitl-selected-tools'); const options = el('hitl-tool-options'); if (!selected || !options || disposed) return;
    selected.innerHTML = selectedTools.length ? selectedTools.map(name => `<span class="hitl-tool-chip"><span>${esc(name)}</span><button type="button" data-action="hitl.remove-tool" data-tool="${esc(name)}" aria-label="${esc(t('removeTool', 'Remove {{tool}}', { tool: name }))}"${whitelistReady ? '' : ' disabled'}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></span>`).join('') : `<span class="hitl-page-whitelist-hint">${esc(t('noToolsSelected', 'No tools selected.'))}</span>`;
    const query = inputValue('hitl-tool-search').trim(); const lower = query.toLowerCase();
    const names = tools(mergeTools(catalog, query ? selectedTools : [])).filter(name => name.toLowerCase().includes(lower));
    options.innerHTML = names.map(name => `<label class="hitl-tool-option"><input type="checkbox" data-change="hitl.toggle-tool" data-tool="${esc(name)}"${selectedTools.some(tool => tool.toLowerCase() === name.toLowerCase()) ? ' checked' : ''}${whitelistReady ? '' : ' disabled'}><span>${esc(name)}</span></label>`).join('');
    if (query && !names.some(name => name.toLowerCase() === lower)) {
      options.innerHTML += `<button type="button" class="btn-link hitl-tool-add" data-action="hitl.add-tool"${whitelistReady ? '' : ' disabled'}>${esc(t('addExactTool', 'Add exact name “{{tool}}”', { tool: query }))}</button>`;
    }
  }
  function updateTool(name: string, checked: boolean): void {
    if (!whitelistReady) return;
    const focused = doc.activeElement instanceof HTMLInputElement && doc.activeElement.dataset.change === 'hitl.toggle-tool';
    const removing = doc.activeElement instanceof HTMLButtonElement && doc.activeElement.dataset.action === 'hitl.remove-tool';
    const key = name.toLowerCase();
    selectedTools = selectedTools.filter(tool => tool.toLowerCase() !== key);
    if (checked && name.trim()) selectedTools.push(name.trim());
    renderToolSelector(); feedback('hitl-page-whitelist-feedback', t('whitelistUnsaved', 'Unsaved changes. Save to apply globally.'));
    if (focused) [...doc.querySelectorAll<HTMLInputElement>('#hitl-tool-options input')].find(input => input.dataset.tool === name)?.focus();
    if (removing) field('hitl-tool-search')?.focus();
  }
  async function refreshToolCatalog(): Promise<void> {
    const status = el('hitl-tool-catalog-status'); if (status) status.textContent = t('toolsLoading', 'Loading available tools…');
    try {
      const names = await service.toolCatalog(); if (disposed) return; catalog = names;
      if (status) status.textContent = t('toolCatalogHint', 'Search registered tools or add an exact name. Existing entries are kept even if a tool is unavailable.');
    } catch {
      if (disposed) return;
      if (status) status.textContent = t('toolCatalogUnavailable', 'Tool catalog unavailable. You can still search selected tools or add an exact tool name.');
    }
    renderToolSelector();
  }
  async function saveWhitelist(): Promise<void> {
    if (!whitelistReady) return;
    const draft = [...selectedTools]; whitelistReady = false; renderToolSelector();
    ++whitelistSequence; feedback('hitl-page-whitelist-feedback'); busy('hitl-page-whitelist-save-btn', true);
    try { const list = await service.savePageWhitelist(draft); if (!disposed) { selectedTools = list; feedback('hitl-page-whitelist-feedback', t('whitelistSaved', 'Whitelist saved.')); } }
    catch (error) { feedback('hitl-page-whitelist-feedback', t('whitelistSaveFailed', 'Failed to save whitelist') + ': ' + errorMessage(error), true); }
    finally { whitelistReady = true; busy('hitl-page-whitelist-save-btn', false); renderToolSelector(); }
  }
  async function refreshActivePanel(reloadPolicy = true): Promise<void> {
    if (disposed) return; refreshReviewerBar();
    switch (service.getState().tab) {
      case 'logs': await refreshLogs(); break;
      case 'policy': {
        // Moving between tabs must not discard unsaved policy edits.
        // Refresh remains an explicit reload of server values.
        if (!policyLoad && (reloadPolicy || !strategyReady || !whitelistReady || whitelistConversationId !== deps.getCurrentConversationId())) {
          policyLoad = Promise.all([
            reloadPolicy || !strategyReady ? refreshStrategy() : Promise.resolve(),
            refreshWhitelist(), refreshToolCatalog(),
          ]).then(() => {}).finally(() => { policyLoad = null; });
        }
        await policyLoad;
        break;
      }
      default: await refreshPending();
    }
  }
  async function switchTab(tab: string): Promise<void> {
    service.setTab(tab); const current = service.getState().tab;
    for (const name of ['pending', 'policy', 'logs']) {
      const button = el('hitl-tab-' + name); button?.classList.toggle('hitl-page-tab--active', current === name); button?.setAttribute('aria-selected', String(current === name));
      button?.setAttribute('tabindex', current === name ? '0' : '-1');
      const panel = el('hitl-panel-' + name); if (panel) panel.hidden = current !== name;
    }
    await refreshActivePanel(false);
  }
  function tabKey(node: HTMLElement, event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    const list = node.parentElement; if (!list) return;
    const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
    const index = tabs.indexOf(node); let next: HTMLElement | undefined;
    if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
    if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
    if (event.key === 'Home') next = tabs[0];
    if (event.key === 'End') next = tabs[tabs.length - 1];
    if (!next) return;
    event.preventDefault(); next.focus(); next.click();
  }
  function renderLogModal(item: HitlItem): void {
    const modal = el('hitl-log-modal'); if (!modal || disposed) return;
    const text = (id: string, value: string) => { const node = el(id); if (node) node.textContent = value; };
    text('hitl-log-detail-id', item.id || '—'); text('hitl-log-detail-tool', item.toolName || '—'); text('hitl-log-detail-conversation', item.conversationId || '—');
    const decision = el('hitl-log-detail-decision'); if (decision) decision.innerHTML = decisionTag(item.decision);
    text('hitl-log-detail-decided-by', reviewerLabel(item.decidedBy)); text('hitl-log-detail-time', formatTime(item.decidedAt || item.createdAt));
    let row = el('hitl-log-detail-engine-row'); let engine = el('hitl-log-detail-engine');
    if (!row || !engine) {
      const decidedRow = el('hitl-log-detail-decided-by')?.closest('.hitl-log-detail-row');
      if (decidedRow?.parentElement) { row = doc.createElement('div'); row.className = 'hitl-log-detail-row'; row.id = 'hitl-log-detail-engine-row'; row.innerHTML = `<dt>${esc(t('colAuditEngine', 'Approval engine'))}</dt><dd id="hitl-log-detail-engine">—</dd>`; decidedRow.parentElement.insertBefore(row, decidedRow.nextSibling); engine = el('hitl-log-detail-engine'); }
    }
    const info = auditEngineFromItem(item); const label = engineLabel(info.backend, info.model); if (row && engine) { row.hidden = !label; engine.textContent = label; }
    const comment = (item.comment || '').trim(); const commentRow = el('hitl-log-detail-comment-row'); if (commentRow) commentRow.hidden = !comment; text('hitl-log-detail-comment', comment);
    const payload = parsePayload(item.payload);
    for (const [id, html] of [['hitl-log-context-readonly', contextBlocks(payload)], ['hitl-log-execution-readonly', executionBlock(payload)]]) { const node = id ? el(id) : null; if (node) { node.innerHTML = html || ''; node.hidden = !html; } }
    const payloadText = formatPayload(item.payload); text('hitl-log-detail-payload', payloadText); const payloadWrap = el('hitl-log-detail-payload-wrap'); if (payloadWrap) payloadWrap.hidden = !payloadText;
    modal.style.display = 'flex';
  }
  async function openLogModal(id: string): Promise<void> {
    if (!id || !el('hitl-log-modal') || disposed) return; const sequence = ++modalSequence;
    try { const item = await service.getLog(id); if (!disposed && sequence === modalSequence) { modalItem = item; renderLogModal(item); } }
    catch { if (!disposed && sequence === modalSequence) deps.alert(t('loadFailed', 'Failed to load')); }
  }
  function closeLogModal(): void { ++modalSequence; modalItem = null; const modal = el('hitl-log-modal'); if (modal) modal.style.display = 'none'; }
  function refreshI18n(): void {
    const state = service.getState(); if (state.logs.loaded) renderLogs(); if (state.pending.loaded) void refreshPending();
    renderPagination('pending'); renderPagination('logs'); refreshReviewerBar(); renderToolSelector();
    if (modalItem) renderLogModal(modalItem);
  }
  function bind(): void {
    if (active || disposed) return; active = true;
    const register = (name: string, fn: (node: HTMLElement, event: Event) => void | Promise<unknown>) => {
      actions.register(name, (node, event) => { void Promise.resolve(fn(node, event)).catch(error => { if (!disposed) deps.alert(errorMessage(error)); }); });
    };
    register('hitl.refresh', () => refreshActivePanel()); register('hitl.tab', node => switchTab(node.dataset.tab || 'pending'));
    register('hitl.tab-key', tabKey);
    register('hitl.strategy-mode', node => switchStrategyMode(node.dataset.mode || 'approval'));
    register('hitl.filter-pending', filterPending); register('hitl.filter-logs', filterLogs);
    register('hitl.search-pending', (_node, event) => { if (event instanceof KeyboardEvent && event.key === 'Enter') { event.preventDefault(); return filterPending(); } });
    register('hitl.search-logs', (_node, event) => { if (event instanceof KeyboardEvent && event.key === 'Enter') { event.preventDefault(); return filterLogs(); } });
    register('hitl.page', node => goPage(node.dataset.list === 'logs' ? 'logs' : 'pending', Number(node.dataset.page)));
    register('hitl.page-size', node => pageSizeChange(node.dataset.list === 'logs' ? 'logs' : 'pending'));
    register('hitl.resize', node => { if (node instanceof HTMLTextAreaElement) resize(node); });
    register('hitl.dismiss', node => service.dismiss(node.dataset.id || ''));
    register('hitl.decide', node => submitDecision(node.dataset.id || '', node.dataset.decision === 'approve' ? 'approve' : 'reject', node.dataset.conversation));
    register('hitl.workflow-decide', node => submitWorkflowDecision(node.dataset.id || '', node.dataset.decision === 'approve', node.dataset.conversation));
    register('hitl.open-conversation', node => openConversation(node.dataset.conversation || ''));
    register('hitl.log-detail', node => openLogModal(node.dataset.id || '')); register('hitl.close-log', closeLogModal);
    register('hitl.log-select', node => { if (node instanceof HTMLInputElement) selectLog(node.value, node.checked); });
    register('hitl.log-select-page', node => { if (node instanceof HTMLInputElement) selectPage(node.checked); });
    register('hitl.select-all', () => selectPage(true)); register('hitl.deselect-all', deselectAll); register('hitl.batch-delete', batchDeleteLogs); register('hitl.clear-logs', clearLogs);
    register('hitl.save-strategy', saveStrategy); register('hitl.reset-strategy', resetStrategy); register('hitl.save-whitelist', saveWhitelist);
    register('hitl.search-tools', renderToolSelector);
    register('hitl.remove-tool', node => updateTool(node.dataset.tool || '', false));
    register('hitl.toggle-tool', node => { if (node instanceof HTMLInputElement) updateTool(node.dataset.tool || '', node.checked); });
    register('hitl.add-tool', () => { for (const name of tools(inputValue('hitl-tool-search'))) updateTool(name, true); const search = field('hitl-tool-search'); if (search) { search.value = ''; search.focus(); } renderToolSelector(); });
    doc.addEventListener('languagechange', refreshI18n);
    cleanup.push(actions.bind(doc), () => doc.removeEventListener('languagechange', refreshI18n), service.subscribe(() => { void refreshPending(); }));
  }
  return {
    bind, refreshPending, refreshLogs, refreshActivePanel, switchTab, switchStrategyMode, refreshReviewerBar,
    renderAuditEngine, renderStrategyHint, refreshStrategy, saveStrategy, resetStrategy, refreshWhitelist, saveWhitelist,
    filterPending, filterLogs, goPage, pageSizeChange, selectLog, selectPage, deselectAll, batchDeleteLogs, clearLogs,
    submitDecision, submitDecisionWithPayload, submitWorkflowDecision, openConversation, openLogModal, closeLogModal,
    renderPendingList, renderWorkflowPendingList, contextBlocks, executionBlock, formatPayload, refreshI18n, resizeTextareas,
    dispose(): void { disposed = true; ++modalSequence; ++pendingSequence; ++logsSequence; ++whitelistSequence; cleanup.reverse().forEach(fn => fn()); },
  };
}
export type HitlView = ReturnType<typeof createHitlView>;
