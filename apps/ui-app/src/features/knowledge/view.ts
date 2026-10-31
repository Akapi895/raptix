import type { Actions } from '../../ui/actions';
import { capabilityState, capabilityTable, openCapabilityModal } from '../../ui/capabilities';
import { escapeAttr as a, escapeHtml as h } from '../../ui/format';
import { closeAppModal } from '../../ui/modal';
import { formatTime, knowledgeIndexErrorAdvice, preview, retrievedCount, timeAgo, type IndexStatus, type KnowledgeItem, type KnowledgeState, type RetrievalLog } from './model';

export interface KnowledgeViewDeps { doc: Document; t(key: string, params?: Record<string, string | number>): string; afterRender?(root: HTMLElement): void }
export function createKnowledgeView({ doc, t, afterRender }: KnowledgeViewDeps) {
  const byId = <T extends HTMLElement = HTMLElement>(id: string) => doc.getElementById(id) as T | null;
  const html = (id: string, value: string) => { const node = byId(id); if (node) node.innerHTML = value; };
  const button = (label: string, action: string, extra = '') => `<button type="button" class="btn-secondary${action.startsWith('delete') ? ' btn-danger' : ''}" data-action="knowledge.${action}" ${extra}>${h(label)}</button>`;
  const stats = (values: [string, string | number][], prefix: string) => values.map(([label, value]) => `<div class="${prefix}-stat-item"><span class="${prefix}-stat-label">${h(label)}</span><span class="${prefix}-stat-value">${h(String(value))}</span></div>`).join('');

  function categories(state: Readonly<KnowledgeState>): void {
    const select = byId<HTMLSelectElement>('knowledge-category-filter');
    if (!select) return;
    select.innerHTML = `<option value="">All categories</option>${state.categories.map(category => `<option value="${a(category)}">${h(category)}</option>`).join('')}`;
    select.value = state.pagination.currentCategory;
  }
  function row(item: KnowledgeItem): string {
    const date = formatTime(item.updatedAt) || formatTime(item.createdAt);
    return `<tr class="knowledge-item-card" data-id="${a(item.id)}" data-category="${a(item.category)}">
      <td class="cap-primary-cell"><strong>${h(item.title)}</strong>${item.content ? `<p class="cap-row-description">${h(preview(item.content, 150))}</p>` : ''}</td>
      <td><span class="cap-source-label">${item.filePath ? 'File' : 'Knowledge item'}</span>${item.filePath ? `<div class="cap-path" title="${a(item.filePath)}">${h(item.filePath.split(/[/\\]/).slice(-2).join('/'))}</div>` : ''}</td>
      <td class="cap-date">${h(date || 'Not recorded')}</td>
      <td><div class="cap-row-actions">${button('Edit', 'edit', `data-require-permission="knowledge:write" data-id="${a(item.id)}" aria-label="Edit ${a(item.title)}"`)}${button('Delete', 'delete', `data-require-permission="knowledge:delete" data-id="${a(item.id)}" aria-label="Delete ${a(item.title)}"`)}</div></td>
    </tr>`;
  }
  function items(state: Readonly<KnowledgeState>): void {
    if (!state.enabled) html('knowledge-items-list', capabilityState(t('knowledge.notEnabledTitle'), t('knowledge.notEnabledHint'), button(t('knowledge.goToSettings'), 'settings')));
    else if (!state.groups.length) html('knowledge-items-list', capabilityState(state.search ? 'No matching knowledge items' : 'No knowledge items yet', state.search ? 'Try another search or clear the filters.' : 'Add Markdown knowledge or scan the configured source directory.', state.search || state.pagination.currentCategory ? button('Clear filters', 'clearFilters') : ''));
    else html('knowledge-items-list', `<div class="cap-knowledge-table">${capabilityTable('Knowledge library', ['Knowledge item', 'Source', 'Last updated', 'Actions'], state.groups.map(group => `<tbody class="knowledge-category-section" data-category="${a(group.category || 'Uncategorized')}"><tr class="cap-category-row"><th scope="rowgroup" colspan="4"><div class="knowledge-category-header"><strong>${h(group.category || 'Uncategorized')}</strong><span>${group.itemCount ?? group.items.length} ${(group.itemCount ?? group.items.length) === 1 ? 'item' : 'items'}</span></div></th></tr>${group.items.map(row).join('')}</tbody>`).join(''), true)}</div>`);
    html('knowledge-stats', stats([['Total categories', state.pagination.total], ['Categories on page', state.groups.length], ['Items on page', state.groups.reduce((sum, group) => sum + group.items.length, 0)]], 'knowledge'));
    const { currentPage, pageSize, total, currentCategory } = state.pagination;
    const pages = Math.ceil(total / pageSize);
    html('knowledge-pagination', state.search || currentCategory || pages <= 1 ? '' : `<div class="cap-pagination">${button('Previous', 'page', `data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}`)}<span>Category page ${currentPage} of ${pages} (${total} categories)</span>${button('Next', 'page', `data-page="${currentPage + 1}" ${currentPage >= pages ? 'disabled' : ''}`)}</div>`);
    const root = byId('knowledge-items-list'); if (root) afterRender?.(root);
  }
  function editor(state: Readonly<KnowledgeState>, open = false): void {
    const value = state.editor; if (!value) return;
    const title = byId('knowledge-item-modal-title'); if (title) title.textContent = value.id ? 'Edit knowledge item' : 'Add knowledge item';
    for (const field of ['category', 'title', 'content'] as const) { const node = byId<HTMLInputElement>(`knowledge-item-${field}`); if (node) node.value = value[field]; }
    busy(state.saving || value.loading);
    if (open) openCapabilityModal(byId('knowledge-item-modal'), { focus: !value.loading });
  }
  function busy(value: boolean): void {
    for (const node of byId('knowledge-item-modal')?.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, textarea, .modal-footer button') ?? []) {
      node.disabled = value; node.dataset.stateDisabled = String(value); node.setAttribute('aria-disabled', String(value));
    }
    const save = byId('knowledge-item-modal')?.querySelector<HTMLButtonElement>('.modal-footer .btn-primary');
    if (save) save.textContent = value ? 'Saving…' : 'Save';
  }
  function index(status: IndexStatus): void {
    const target = byId('knowledge-index-progress'); if (!target) return;
    if (status.enabled === false || (!status.total_items && !status.last_error)) { target.style.display = 'none'; return; }
    target.style.display = 'block'; target.setAttribute('aria-live', 'polite');
    if (status.last_error) {
      target.innerHTML = capabilityState('Index build failed', `${status.last_error} ${knowledgeIndexErrorAdvice(status.last_error)}`, `<div class="cap-row-actions">${button('Retry missing items', 'build', 'data-require-permission="knowledge:write"')}${button('Full rebuild', 'rebuild', 'data-require-permission="knowledge:write"')}${button('Dismiss', 'stopIndex')}</div>`, true); return;
    }
    const total = status.is_rebuilding ? status.rebuild_total || status.total_items : status.total_items;
    const current = status.is_rebuilding ? status.rebuild_current ?? 0 : status.indexed_items;
    const complete = !status.is_rebuilding && status.is_complete;
    const label = status.is_rebuilding ? 'Rebuilding search index' : complete ? 'Search index ready' : 'Search index incomplete';
    const hint = status.is_rebuilding ? `${status.rebuild_failed ?? 0} failed${status.rebuild_last_item_id ? ` · Processing ${status.rebuild_last_item_id}` : ''}` : complete ? 'Knowledge is available for semantic retrieval.' : 'Build the index to include the remaining knowledge in semantic retrieval.';
    target.innerHTML = `<div class="cap-index-status"><div><strong>${label}</strong><span>${current} / ${total} items indexed</span></div><progress max="${Math.max(total, 1)}" value="${Math.max(0, Math.min(total, current))}" aria-label="Indexed knowledge items"></progress><p>${h(hint)}</p>${!complete && !status.is_rebuilding ? button('Build index', 'build', 'data-require-permission="knowledge:write"') : ''}</div>`;
  }
  function indexPreparing(full: boolean): void {
    const target = byId('knowledge-index-progress'); if (!target) return;
    target.style.display = 'block'; target.innerHTML = capabilityState(full ? 'Preparing full index rebuild…' : 'Preparing index build…', 'Index status will update automatically.');
  }
  function indexError(): void {
    const target = byId('knowledge-index-progress'); if (!target) return;
    target.style.display = 'block'; target.innerHTML = capabilityState('Index status unavailable', 'Check your connection and try again.', button('Retry status', 'indexStatus'), true);
  }
  function copy(value: string): string { return `<button type="button" class="cap-copy" data-action="knowledge.copy" data-copy="${a(value)}" title="${a(t('retrievalLogs.clickToCopy'))}" aria-label="Copy ${a(value)}"><code>${h(value)}</code></button>`; }
  function logs(state: Readonly<KnowledgeState>): void {
    const successful = state.logs.filter(log => retrievedCount(log) !== 0).length;
    const count = state.logs.reduce((sum, log) => sum + Math.max(0, retrievedCount(log)), 0);
    html('retrieval-stats', stats([['Queries in this result', state.logs.length], ['With matches', successful], ['Match rate', state.logs.length ? `${(successful / state.logs.length * 100).toFixed(1)}%` : '—'], ['Known items retrieved', count]], 'retrieval'));
    html('retrieval-logs-list', state.logs.length ? capabilityTable('Knowledge retrieval history', ['Query', 'Category', 'Result', 'Retrieved', 'Actions'], state.logs.map((log, idx) => {
      const count = retrievedCount(log);
      return `<tr class="retrieval-log-card" data-index="${idx}"><td class="cap-primary-cell"><strong>${h(log.query || t('retrievalLogs.noQuery'))}</strong></td><td>${h(log.riskType || '—')}</td><td><span class="cap-status ${count !== 0 ? 'is-success' : ''}">${h(count > 0 ? `${count} ${count === 1 ? 'item' : 'items'}` : t(count < 0 ? 'retrievalLogs.hasResults' : 'retrievalLogs.noResults'))}</span></td><td class="cap-date" title="${a(formatTime(log.createdAt))}">${h(timeAgo(log.createdAt) || 'Not recorded')}</td><td><div class="cap-row-actions">${button(t('retrievalLogs.viewDetails'), 'logDetails', `data-index="${idx}"`)}${button(t('common.delete'), 'deleteLog', `data-id="${a(log.id)}" data-require-permission="knowledge:delete"`)}</div></td></tr>`;
    }).join('')) : capabilityState(t('retrievalLogs.noRecords'), state.logFilter.conversationId || state.logFilter.messageId ? 'No queries match these identifiers. Clear the filters to see other records.' : 'Queries appear here when agents retrieve knowledge.'));
    const root = byId('retrieval-logs-list'); if (root) afterRender?.(root);
  }
  function logDetails(log: RetrievalLog, items: KnowledgeItem[]): void {
    let modal = byId('retrieval-log-details-modal');
    if (!modal) { modal = doc.createElement('div'); modal.id = 'retrieval-log-details-modal'; modal.className = 'modal capabilities-modal'; doc.body.appendChild(modal); }
    modal.innerHTML = `<div class="modal-content"><div class="modal-header"><h2>${h(t('retrievalLogs.detailsTitle'))}</h2><button type="button" class="modal-close" aria-label="Close retrieval details" data-action="knowledge.closeDetails">×</button></div>
      <div class="modal-body"><section class="cap-form-section"><h3>Query</h3><p>${h(log.query || t('retrievalLogs.noQuery'))}</p><dl class="cap-detail-list"><dt>Retrieved</dt><dd>${h(formatTime(log.createdAt) || 'Not recorded')}</dd>${log.riskType ? `<dt>Category</dt><dd>${h(log.riskType)}</dd>` : ''}${log.conversationId ? `<dt>Conversation</dt><dd>${copy(log.conversationId)}</dd>` : ''}${log.messageId ? `<dt>Message</dt><dd>${copy(log.messageId)}</dd>` : ''}</dl></section>
      <section class="cap-form-section"><h3>Retrieved knowledge (${items.length})</h3>${items.length ? items.map(item => `<article class="cap-retrieved-item"><h4>${h(item.title || t('retrievalLogs.untitled'))}</h4><p class="cap-row-description">${h(item.category || t('retrievalLogs.uncategorized'))}${item.filePath ? ` · ${h(item.filePath)}` : ''}</p><p>${h(preview(item.content ?? '', 600) || t('retrievalLogs.noContentPreview'))}</p></article>`).join('') : capabilityState(t('retrievalLogs.noItemDetails'))}</section></div>
      <div class="modal-footer">${button(t('common.close'), 'closeDetails')}</div></div>`;
    openCapabilityModal(modal);
  }
  function deleting(kind: 'item' | 'log', id: string): () => void {
    const target = [...doc.querySelectorAll<HTMLElement>(kind === 'item' ? '.knowledge-item-card' : '.retrieval-log-card')].find(node => kind === 'item' ? node.dataset.id === id : node.querySelector<HTMLElement>('[data-action="knowledge.deleteLog"]')?.dataset.id === id);
    if (!target) return () => {};
    const original = target.style.cssText; target.style.opacity = '0.45';
    const buttons = [...target.querySelectorAll<HTMLButtonElement>('button')];
    const disabled = buttons.map(node => node.disabled); buttons.forEach(node => { node.disabled = true; });
    return () => { target.style.cssText = original; buttons.forEach((node, idx) => { node.disabled = disabled[idx] ?? false; }); };
  }
  function bind(actions: Actions): () => void {
    const restore: (() => void)[] = [];
    for (const field of ['category', 'title', 'content']) { const node = byId(`knowledge-item-${field}`); if (node) { node.dataset.input = 'knowledge.field'; node.dataset.field = field; restore.push(() => { delete node.dataset.input; delete node.dataset.field; }); } }
    const unbind = actions.bind(doc);
    return () => { unbind(); restore.forEach(fn => fn()); closeAppModal(byId('knowledge-item-modal')); closeAppModal(byId('retrieval-log-details-modal')); byId('retrieval-log-details-modal')?.remove(); };
  }
  return { categories, items, editor, busy, index, indexPreparing, indexError, logs, logDetails, deleting, bind,
    value: (id: string) => byId<HTMLInputElement>(id)?.value ?? '',
    resetFilters: () => { const node = byId<HTMLInputElement>('knowledge-search'); if (node) node.value = ''; },
    resetLogFilters: () => { for (const id of ['retrieval-logs-conversation-id', 'retrieval-logs-message-id']) { const node = byId<HTMLInputElement>(id); if (node) node.value = ''; } },
    error: (id: string, message: string, retry: string) => html(id, capabilityState(message, 'Check your connection and retry. Your saved data has not been changed.', button('Retry', retry), true)),
    closeEditor: () => { closeAppModal(byId('knowledge-item-modal')); busy(false); },
    closeDetails: () => { closeAppModal(byId('retrieval-log-details-modal')); },
    hideIndex: () => { const node = byId('knowledge-index-progress'); if (node) node.style.display = 'none'; },
    closeCategory: () => byId('knowledge-category-filter-wrapper')?.classList.remove('open'),
    toggleCategory: () => byId('knowledge-category-filter-wrapper')?.classList.toggle('open'),
    isManagementActive: () => byId('page-knowledge-management')?.classList.contains('active') ?? false,
    loading: () => html('knowledge-items-list', capabilityState('Loading knowledge…')),
  };
}
export type KnowledgeView = ReturnType<typeof createKnowledgeView>;
