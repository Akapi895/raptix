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
  const sourceLabel = (source: string) => ({ attack: 'MITRE ATT&CK', atlas: 'MITRE ATLAS', capec: 'CAPEC', cwe: 'CWE', cisa: 'CISA KEV', owasp: 'OWASP', manual: 'Manual notes' } as Record<string, string>)[source] ?? source.toUpperCase();
  type Dict = Record<string, unknown>;
  const isDict = (value: unknown): value is Dict => !!value && typeof value === 'object' && !Array.isArray(value);
  const humanKey = (key: string) => key.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  const isIdentifier = (key: string) => /(^|_)(id|ids)$/i.test(key);
  const safeUrl = (value: unknown) => { const url = typeof value === 'string' ? value : ''; return /^https?:\/\//i.test(url) ? url : ''; };
  const scalar = (value: unknown, key = ''): string => {
    if (value === null || value === undefined || value === '') return '<span class="kn-muted">—</span>';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    const text = String(value);
    const url = /(url|href|link)$/i.test(key) ? safeUrl(value) : '';
    if (url) return `<a href="${a(url)}" target="_blank" rel="noopener noreferrer">${h(text)}</a>`;
    return isIdentifier(key) ? `<code>${h(text)}</code>` : h(text);
  };
  const fieldValue = (value: unknown, key = ''): string => {
    if (Array.isArray(value)) {
      if (!value.length) return '<span class="kn-muted">—</span>';
      const flat = value.every(entry => !isDict(entry) && !Array.isArray(entry));
      if (flat) {
        const labels = value.map(entry => scalar(entry, key));
        return value.every(entry => String(entry).length <= 72)
          ? `<div class="kn-chip-row">${labels.map(label => `<span class="kn-chip">${label}</span>`).join('')}</div>`
          : `<ul class="kn-plain-list">${labels.map(label => `<li>${label}</li>`).join('')}</ul>`;
      }
      return `<div class="kn-record-list">${value.map(entry => isDict(entry) ? recordCard(entry) : `<p>${fieldValue(entry, key)}</p>`).join('')}</div>`;
    }
    if (isDict(value)) return `<dl class="kn-detail-grid kn-detail-grid--nested">${Object.entries(value).map(([name, entry]) => `<dt>${h(humanKey(name))}</dt><dd>${fieldValue(entry, name)}</dd>`).join('')}</dl>`;
    return scalar(value, key);
  };
  const recordCard = (record: Dict): string => {
    const title = record.source_name ?? record.title ?? record.name ?? record.target_id ?? record.id ?? '';
    const entries = Object.entries(record).filter(([key]) => !['source_name', 'title', 'name'].includes(key));
    return `<article class="kn-record">${title ? `<h4>${h(String(title))}</h4>` : ''}<dl class="kn-detail-grid kn-detail-grid--nested">${entries.map(([key, value]) => `<dt>${h(humanKey(key))}</dt><dd>${fieldValue(value, key)}</dd>`).join('')}</dl></article>`;
  };
  function relationships(value: unknown): string {
    if (!Array.isArray(value) || !value.length) return '<span class="kn-muted">No relationships recorded.</span>';
    return value.map(entry => {
      if (!isDict(entry)) return `<p>${scalar(entry)}</p>`;
      const heading = humanKey(String(entry.type ?? 'relationship'));
      const target = entry.target_id ? `<code>${h(String(entry.target_id))}</code>` : '';
      const detail = Object.entries(entry).filter(([key]) => !['type', 'target_id', 'description'].includes(key));
      return `<article class="kn-record"><div class="kn-record-heading"><strong>${h(heading)}</strong>${target}</div>${typeof entry.description === 'string' ? `<p class="kn-record-description">${h(entry.description)}</p>` : ''}${detail.length ? `<details class="kn-record-more"><summary>Details</summary><dl class="kn-detail-grid kn-detail-grid--nested">${detail.map(([key, value]) => `<dt>${h(humanKey(key))}</dt><dd>${fieldValue(value, key)}</dd>`).join('')}</dl></details>` : ''}</article>`;
    }).join('');
  }
  function references(value: unknown): string {
    if (!Array.isArray(value) || !value.length) return '<span class="kn-muted">No references recorded.</span>';
    return `<ul class="kn-reference-list">${value.map(entry => {
      if (!isDict(entry)) return `<li>${scalar(entry)}</li>`;
      const url = safeUrl(entry.url);
      const label = String(entry.title ?? entry.source_name ?? entry.url ?? entry.id ?? 'Reference');
      const meta = [entry.source_name, entry.description].filter(item => typeof item === 'string' && item).map(item => h(String(item))).join(' · ');
      return `<li>${url ? `<a href="${a(url)}" target="_blank" rel="noopener noreferrer">${h(label)}</a>` : `<strong>${h(label)}</strong>`}${meta ? `<p>${meta}</p>` : ''}</li>`;
    }).join('')}</ul>`;
  }
  function documentDetails(record: Dict, description: string): string {
    const overview = ['source', 'source_id', 'type', 'status', 'deprecated', 'revoked', 'source_url', 'id'].filter(key => key in record);
    const classification = ['domains', 'platforms', 'tactics', 'subtechniques'].filter(key => key in record);
    const primary = new Set([...overview, ...classification, 'name', 'description', 'relationships', 'references', 'procedure_examples']);
    const sections = (['relationships', 'references', 'procedure_examples'] as const).map(key => {
      if (!(key in record)) return '';
      const count = Array.isArray(record[key]) ? (record[key] as unknown[]).length : 0;
      return `<details class="kn-doc-section"${count > 0 && count <= 6 ? ' open' : ''}><summary><span>${h(humanKey(key))}</span><span class="kn-section-count">${count}</span></summary><div class="kn-section-body">${key === 'relationships' ? relationships(record[key]) : key === 'references' ? references(record[key]) : fieldValue(record[key], key)}</div></details>`;
    }).join('');
    const extra = Object.entries(record).filter(([key]) => !primary.has(key));
    return `<article class="kn-document-details">
      ${description ? `<section class="kn-doc-summary"><h3>Description</h3><div class="kn-prose">${description}</div></section>` : ''}
      ${overview.length || classification.length ? `<section class="kn-doc-section kn-doc-overview"><h3>Overview</h3><dl class="kn-detail-grid">${[...overview, ...classification].map(key => `<dt>${h(humanKey(key))}</dt><dd>${fieldValue(record[key], key)}</dd>`).join('')}</dl></section>` : ''}
      ${sections}
      ${extra.length ? `<details class="kn-doc-section"><summary><span>Technical metadata</span><span class="kn-section-count">${extra.length} fields</span></summary><div class="kn-section-body kn-doc-extra">${extra.map(([key, value]) => `<section class="kn-doc-field"><h4>${h(humanKey(key))}</h4>${fieldValue(value, key)}</section>`).join('')}</div></details>` : ''}
    </article>`;
  }

  function categories(state: Readonly<KnowledgeState>): void {
    const select = byId<HTMLSelectElement>('knowledge-category-filter');
    if (!select) return;
    const values = [...new Set([...state.categories, ...(state.index?.categories ?? [])])].sort();
    select.innerHTML = `<option value="">All categories</option>${values.map(category => `<option value="${a(category)}">${h(category)}</option>`).join('')}`;
    select.value = state.pagination.currentCategory;
    const source = byId<HTMLSelectElement>('knowledge-source-filter');
    if (source) {
      source.innerHTML = `<option value="">All sources</option><option value="reference">Security reference corpus</option><option value="manual">Manual notes</option>${(state.index?.sources ?? []).map(value => `<option value="${a(value)}">${h(sourceLabel(value))}</option>`).join('')}`;
      source.value = state.source ?? '';
    }
  }
  function row(item: KnowledgeItem): string {
    const date = formatTime(item.updatedAt) || formatTime(item.createdAt);
    const status = ({ indexed: 'Indexed', discovered: 'Not indexed', changed: 'Update available', library: 'Library only', unknown: 'Status unavailable' } as Record<string, string>)[item.index_status ?? 'library'] ?? item.index_status ?? 'Library only';
    return `<tr class="knowledge-item-card" data-id="${a(item.id)}" data-category="${a(item.category)}">
      <td class="cap-primary-cell"><button type="button" class="kn-document-link" data-action="knowledge.document" data-id="${a(item.id)}"><strong>${h(item.title)}</strong></button>${item.content ? `<p class="cap-row-description" title="${a(preview(item.content, 320))}">${h(preview(item.content, 180))}</p>` : ''}</td>
      <td class="kn-source-cell"><div class="kn-source-line"><span class="kn-source-name">${h(item.source ? sourceLabel(item.source) : item.filePath ? 'File' : 'Manual note')}</span><span class="kn-meta-sep" aria-hidden="true">·</span><span class="kn-source-type">${h(item.type || 'Markdown')}</span></div>${item.filePath ? `<div class="cap-path" title="${a(item.filePath)}">${h(item.filePath.split(/[/\\]/).slice(-2).join('/'))}</div>` : ''}</td>
      <td class="kn-index-cell"><span class="kn-status" data-state="${a(item.index_status ?? 'library')}">${h(status)}</span><div class="cap-date" title="${a(item.indexed_at ? formatTime(item.indexed_at) : date)}">${h(item.indexed_at ? formatTime(item.indexed_at) : date || (item.index_status === 'unknown' ? 'Last index time unavailable' : 'Not indexed'))}</div></td>
      <td><div class="cap-row-actions">${button('Details', 'document', `data-id="${a(item.id)}" aria-label="Open ${a(item.title)}"`)}${!item.read_only ? button('Edit', 'edit', `data-require-permission="knowledge:write" data-id="${a(item.id)}" aria-label="Edit ${a(item.title)}"`) + button('Delete', 'delete', `data-require-permission="knowledge:delete" data-id="${a(item.id)}" aria-label="Delete ${a(item.title)}"`) : ''}</div></td>
    </tr>`;
  }
  function items(state: Readonly<KnowledgeState>): void {
    const unavailable = state.referenceError || (state.source !== 'manual' && state.index?.graph_available === false ? state.index.graph_error || 'Reference index unavailable; check Neo4j connectivity.' : '');
    if (!state.enabled) html('knowledge-items-list', capabilityState(t('knowledge.notEnabledTitle'), t('knowledge.notEnabledHint'), button(t('knowledge.goToSettings'), 'settings')));
    else if (!state.groups.length) html('knowledge-items-list', capabilityState(state.index?.is_rebuilding ? 'Discovering knowledge sources' : state.search ? 'No matching knowledge items' : unavailable ? 'Reference library unavailable' : state.source === 'manual' ? 'No manual notes yet' : 'No sources discovered', state.index?.is_rebuilding ? 'Discovery runs in the background. You can continue using the page.' : state.search ? 'Try another search or clear the filters.' : unavailable || (state.index?.directory_available === false ? 'The runtime has no configured source directory. Configure RAPTIX_KNOWLEDGE_CORPUS_DIR and its read-only mount, then refresh.' : 'Scan the configured corpus or add a Markdown note to the library.'), state.search || state.pagination.currentCategory || state.source ? button('Clear filters', 'clearFilters') : unavailable || state.index?.directory_available === false ? button('Refresh', 'reload') : button('Scan sources', 'refresh', 'data-require-permission="knowledge:write"'), !!unavailable));
    else html('knowledge-items-list', `<div class="cap-knowledge-table">${capabilityTable('Knowledge library', ['Knowledge document', 'Source / type', 'Index status', 'Actions'], state.groups.map(group => `<tbody class="knowledge-category-section" data-category="${a(group.category || 'Uncategorized')}"><tr class="cap-category-row"><th scope="rowgroup" colspan="4"><div class="knowledge-category-header"><strong>${h(group.category || 'Uncategorized')}</strong><span>${group.itemCount ?? group.items.length} ${(group.itemCount ?? group.items.length) === 1 ? 'item' : 'items'}</span></div></th></tr>${group.items.map(row).join('')}</tbody>`).join(''), true)}</div>`);
    const indexed = state.index?.indexed_items;
    html('knowledge-stats', `<span><strong>${state.pagination.total.toLocaleString()}</strong> ${state.documentPagination ? 'matching documents' : 'categories'}</span>${state.index?.graph_available === false ? '<span class="kn-stats-warning">Reference index status unavailable</span>' : indexed === undefined ? '' : `<span><strong>${indexed.toLocaleString()}</strong> indexed</span>`}${state.index?.last_indexed_at ? `<span>Last indexed ${h(formatTime(state.index.last_indexed_at))}</span>` : ''}`);
    html('knowledge-library-notice', state.groups.length && state.referenceError ? capabilityState('Reference source unavailable', state.referenceError, button('Refresh', 'reload'), true) : '');
    const announcement = byId('knowledge-result-announcement'); if (announcement) announcement.textContent = `${state.pagination.total} matching ${state.documentPagination ? 'documents' : 'categories'}.`;
    const { currentPage, pageSize, total, currentCategory } = state.pagination;
    const pages = Math.ceil(total / pageSize);
    html('knowledge-pagination', (!state.documentPagination && (state.search || currentCategory)) || pages <= 1 ? '' : `<div class="cap-pagination">${button('Previous', 'page', `data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}`)}<span>${state.documentPagination ? 'Page' : 'Category page'} ${currentPage} of ${pages} (${total.toLocaleString()} ${state.documentPagination ? 'documents' : 'categories'})</span>${button('Next', 'page', `data-page="${currentPage + 1}" ${currentPage >= pages ? 'disabled' : ''}`)}</div>`);
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
    if (status.job) {
      target.style.display = 'block'; target.setAttribute('aria-live', 'polite');
      const job = status.job, running = ['scanning', 'indexing'].includes(job.state);
      for (const node of doc.querySelectorAll<HTMLButtonElement>('[data-action="knowledge.build"], [data-action="knowledge.rebuild"], [data-action="knowledge.refresh"]')) node.disabled = running;
      if (!running && status.is_complete && !status.last_error && !(job.errors?.length) && status.graph_available === true && status.directory_available) { target.style.display = 'none'; return; }
      const title = job.state === 'scanning' ? 'Discovering source files' : job.state === 'indexing' ? 'Indexing reference documents and relationships' : status.graph_available === false ? 'Reference graph unavailable' : job.state === 'failed' ? 'Indexing failed' : status.is_complete ? 'Reference index ready' : 'Sources ready to index';
      const errors = job.errors ?? [];
      target.innerHTML = `<div class="kn-index-state"><div><strong>${h(title)}</strong><span>${(status.discovered_items ?? 0).toLocaleString()} discovered · ${status.indexed_items.toLocaleString()} indexed</span></div>${running ? `<progress max="${Math.max(1, job.total ?? status.total_items)}" value="${job.processed ?? 0}" aria-label="Source indexing progress"></progress>` : ''}<p>${h(job.error || status.graph_error || (status.last_indexed_at ? `Last successful publication: ${formatTime(status.last_indexed_at)}` : 'Indexing is explicit. Source files and existing indexes are preserved.'))}</p>${!status.directory_available ? '<p>The configured corpus directory is not available to the runtime. Indexed reference data, if present, remains readable.</p>' : ''}${errors.length ? `<details><summary>${errors.length} source validation errors</summary><ul>${errors.slice(0, 20).map(error => `<li><code>${h(error.path)}</code>: ${h(error.error)}</li>`).join('')}</ul></details>` : ''}</div>`;
      for (const node of doc.querySelectorAll<HTMLButtonElement>('[data-action="knowledge.build"], [data-action="knowledge.rebuild"], [data-action="knowledge.refresh"]')) node.disabled = running;
      if (!running && status.directory_available && !status.is_complete) target.querySelector('.kn-index-state')?.insertAdjacentHTML('beforeend', button('Index sources', 'build', 'data-require-permission="knowledge:write"'));
      if (!running && status.directory_available && errors.length && status.discovered_items) target.querySelector('.kn-index-state')?.insertAdjacentHTML('beforeend', button('Index valid sources only', 'partialIndex', 'data-require-permission="knowledge:write"'));
      return;
    }
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
    html('retrieval-stats', `<span><strong>${(state.logTotal ?? state.logs.length).toLocaleString()}</strong> recorded events</span><span>This page: <strong>${successful}</strong> with matches · <strong>${count}</strong> documents returned</span>`);
    html('knowledge-history-notice', state.historyError ? capabilityState('History partially unavailable', state.historyError, button('Refresh', 'filterLogs'), true) : '');
    html('knowledge-conversation-options', (state.conversations ?? []).map(c => `<option value="${a(c.title)}">${h(c.id)}</option>`).join(''));
    html('retrieval-logs-list', state.logs.length ? capabilityTable('Knowledge retrieval history', ['Query / context', 'Method / source', 'Result', 'Retrieved', 'Actions'], state.logs.map((log, idx) => {
      const count = retrievedCount(log);
      return `<tr class="retrieval-log-card" data-index="${idx}"><td class="cap-primary-cell"><strong>${h(log.query || t('retrievalLogs.noQuery'))}</strong><p class="cap-row-description">${h(log.conversationTitle || (log.origin === 'operator' ? 'Operator retrieval test' : log.conversationId || 'Context not recorded'))}</p></td><td>${h(log.method || log.riskType || 'Not recorded')}<p class="cap-row-description">${h(log.source || 'Library history')}</p></td><td><span class="cap-status ${count > 0 ? 'is-success' : ''}">${h(log.status === 'error' ? 'Failed' : count > 0 ? `${count} ${count === 1 ? 'item' : 'items'}` : t(count < 0 ? 'retrievalLogs.hasResults' : 'retrievalLogs.noResults'))}</span></td><td class="cap-date" title="${a(formatTime(log.createdAt))}">${h(timeAgo(log.createdAt) || 'Not recorded')}</td><td><div class="cap-row-actions">${button(t('retrievalLogs.viewDetails'), 'logDetails', `data-index="${idx}"`)}${button(t('common.delete'), 'deleteLog', `data-id="${a(log.id)}" data-require-permission="knowledge:delete"`)}</div></td></tr>`;
    }).join('')) : capabilityState(t('retrievalLogs.noRecords'), state.logFilter.conversationId || state.logFilter.messageId ? 'No queries match these identifiers. Clear the filters to see other records.' : 'Queries appear here when agents retrieve knowledge. Run a retrieval test or start a chat that uses knowledge.', state.logFilter.conversationId || state.logFilter.messageId ? button('Clear filters', 'clearLogs') : ''));
    const root = byId('retrieval-logs-list'); if (root) afterRender?.(root);
    html('knowledge-history-pagination', (state.logTotal ?? 0) > 50 ? `<div class="cap-pagination">${button('Previous', 'logPage', `data-offset="${Math.max(0, (state.logOffset ?? 0) - 50)}" ${!state.logOffset ? 'disabled' : ''}`)}<span>${(state.logOffset ?? 0) + 1}–${(state.logOffset ?? 0) + state.logs.length} of ${state.logTotal}</span>${button('Next', 'logPage', `data-offset="${(state.logOffset ?? 0) + 50}" ${(state.logOffset ?? 0) + 50 >= (state.logTotal ?? 0) ? 'disabled' : ''}`)}</div>` : '');
  }
  function logDetails(log: RetrievalLog, items: KnowledgeItem[], unavailable = 0): void {
    let modal = byId('retrieval-log-details-modal');
    if (!modal) { modal = doc.createElement('div'); modal.id = 'retrieval-log-details-modal'; modal.className = 'modal capabilities-modal'; doc.body.appendChild(modal); }
    modal.innerHTML = `<div class="modal-content"><div class="modal-header"><h2>${h(t('retrievalLogs.detailsTitle'))}</h2><button type="button" class="modal-close" aria-label="Close retrieval details" data-action="knowledge.closeDetails">×</button></div>
      <div class="modal-body"><section class="cap-form-section"><h3>Query</h3><p>${h(log.query || t('retrievalLogs.noQuery'))}</p><dl class="cap-detail-list"><dt>Retrieved</dt><dd>${h(formatTime(log.createdAt) || 'Not recorded')}</dd>${log.riskType ? `<dt>Category</dt><dd>${h(log.riskType)}</dd>` : ''}${log.conversationId ? `<dt>Conversation</dt><dd>${copy(log.conversationId)}</dd>` : ''}${log.messageId ? `<dt>Message</dt><dd>${copy(log.messageId)}</dd>` : ''}</dl></section>
      <section class="cap-form-section"><h3>Retrieved knowledge (${items.length})</h3>${items.length ? items.map(item => `<article class="cap-retrieved-item"><h4>${h(item.title || t('retrievalLogs.untitled'))}</h4><p class="cap-row-description">${h(item.category || t('retrievalLogs.uncategorized'))}${item.filePath ? ` · ${h(item.filePath)}` : ''}</p><p>${h(preview(item.content ?? '', 600) || t('retrievalLogs.noContentPreview'))}</p></article>`).join('') : capabilityState(t('retrievalLogs.noItemDetails'))}</section><details><summary>Technical identifiers</summary><pre>${h(JSON.stringify({ thread: log.threadId, execution: log.runId, event: log.id, result_ids: log.retrievedItems }, null, 2))}</pre></details></div>
      <div class="modal-footer">${button(t('common.close'), 'closeDetails')}</div></div>`;
    if (unavailable) modal.querySelector('.modal-body')?.insertAdjacentHTML('beforeend', `<p role="status">${unavailable} referenced documents are currently unavailable. Their identifiers remain in the event details.</p>`);
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
    return () => { unbind(); restore.forEach(fn => fn()); closeAppModal(byId('knowledge-item-modal')); for (const id of ['retrieval-log-details-modal', 'knowledge-document-modal', 'knowledge-retrieval-modal']) { closeAppModal(byId(id)); byId(id)?.remove(); } };
  }
  function graph(state: Readonly<KnowledgeState>, error = ''): void {
    const toggle = byId<HTMLInputElement>('knowledge-graph-enabled'), label = byId('knowledge-graph-status');
    if (toggle) {
      if (!state.graphSaving) toggle.checked = state.graph?.enabled ?? false;
      toggle.disabled = !state.graph || !!state.graphSaving;
      toggle.dataset.stateDisabled = String(toggle.disabled);
      toggle.setAttribute('aria-checked', String(toggle.checked));
      if (toggle.parentElement) afterRender?.(toggle.parentElement);
    }
    const status = state.graph?.status;
    if (label) {
      label.textContent = error || (state.graphSaving ? 'Saving preference…' : !state.graph ? 'Checking runtime…' : status?.graph_available === false ? 'Unavailable' : !state.graph.enabled ? 'Disabled for new runs' : status?.graph_available !== true ? 'Availability unknown' : !status?.initialized ? 'Requires initialization' : 'Available · enabled for new runs');
      label.title = status?.graph_error || state.graph?.applies_to || '';
      label.dataset.state = status?.graph_available === false ? 'error' : state.graph?.enabled && status?.initialized ? 'ready' : 'idle';
    }
    const help = byId('knowledge-graph-error'); if (help) help.textContent = status?.graph_error || error;
  }
  async function document(item: KnowledgeItem, raw = false): Promise<void> {
    closeAppModal(byId('knowledge-retrieval-modal'));
    let modal = byId('knowledge-document-modal');
    const reopen = !!modal;
    if (!modal) { modal = doc.createElement('div'); modal.id = 'knowledge-document-modal'; modal.className = 'modal capabilities-modal'; doc.body.appendChild(modal); }
    const content = item.content ?? '';
    const { formatMarkdown } = await import('../../ui/markdown');
    let body: string;
    if (raw) body = `<pre class="kn-source-content" tabindex="0" aria-label="Raw document source">${h(content)}</pre>`;
    else if (item.format === 'yaml') {
      let parsed: unknown;
      try { const { parse } = await import('yaml'); parsed = parse(content); } catch { parsed = null; }
      body = isDict(parsed)
        ? documentDetails(parsed, typeof parsed.description === 'string' ? formatMarkdown(parsed.description, { profile: 'timeline' }) : '')
        : `<div class="kn-doc-fallback"><p class="kn-muted">A structured view is not available for this document. The raw source is shown below.</p><pre class="kn-source-content" tabindex="0" aria-label="Raw document source">${h(content)}</pre></div>`;
    } else body = `<div class="kn-prose">${formatMarkdown(content, { profile: 'timeline' })}</div>`;
    const meta = [item.source ? sourceLabel(item.source) : item.filePath ? 'File' : 'Manual note', item.category, item.type, item.filePath].filter(Boolean).map(value => h(String(value))).join('<span aria-hidden="true"> · </span>');
    modal.innerHTML = `<div class="modal-content kn-document-modal"><div class="modal-header kn-doc-header"><div class="kn-doc-heading"><h2>${h(item.title)}</h2><p class="kn-doc-subtitle">${meta}</p></div><button type="button" class="modal-close" data-action="knowledge.closeDocument" aria-label="Close document">×</button></div><div class="kn-doc-toolbar"><div class="kn-view-tabs" role="group" aria-label="Document view">${button('Details', 'documentView', 'data-raw="false"')}${button('Raw source', 'documentView', 'data-raw="true"')}</div>${raw ? `<button type="button" class="btn-secondary kn-copy-source" data-action="knowledge.copy" data-copy="${a(content)}" title="Copy the exact source">Copy source</button>` : ''}</div><div class="modal-body kn-doc-body">${body}</div><div class="modal-footer"><span class="kn-doc-footnote">${item.read_only ? 'Read-only reference source' : 'Manual note'}</span>${button('Close', 'closeDocument')}</div></div>`;
    for (const node of modal.querySelectorAll<HTMLButtonElement>('[data-action="knowledge.documentView"]')) node.setAttribute('aria-pressed', String((node.dataset.raw === 'true') === raw));
    openCapabilityModal(modal);
    if (reopen) modal.querySelector<HTMLButtonElement>(`[data-action="knowledge.documentView"][data-raw="${raw}"]`)?.focus();
  }
  function retrievalDialog(): void {
    let modal = byId('knowledge-retrieval-modal');
    if (!modal) { modal = doc.createElement('div'); modal.id = 'knowledge-retrieval-modal'; modal.className = 'modal capabilities-modal'; doc.body.appendChild(modal); }
    modal.innerHTML = `<div class="modal-content kn-document-modal"><div class="modal-header"><h2>Test reference retrieval</h2><button type="button" class="modal-close" data-action="knowledge.closeRetrieve" aria-label="Close retrieval test">×</button></div><div class="modal-body"><p>Search indexed reference names using the same bounded query template as <code>kg_query_reference</code>. This explicit operator query is recorded in Retrieval History.</p><label for="knowledge-retrieval-query">Reference name or phrase</label><div class="kn-view-tabs"><input type="search" id="knowledge-retrieval-query" placeholder="e.g. command or injection" data-keydown="knowledge.retrieveKey"><button type="button" class="btn-primary" data-action="knowledge.retrieve">Run retrieval</button></div><div id="knowledge-retrieval-results" role="status"></div></div><div class="modal-footer">${button('View retrieval history', 'retrieveHistory')}${button('Close', 'closeRetrieve')}</div></div>`;
    openCapabilityModal(modal);
  }
  function retrievalResults(result: { nodes: { id: string; name: string }[]; truncated?: boolean } | null, error = ''): void {
    html('knowledge-retrieval-results', error ? capabilityState('Retrieval unavailable', error, '', true) : result ? `<p>${result.nodes.length} matches${result.truncated ? ' (limited result)' : ''}</p><ul>${result.nodes.map(node => `<li><button type="button" class="kn-document-link" data-action="knowledge.document" data-id="${a('ref::' + node.id)}">${h(node.name || node.id)}</button> <code>${h(node.id)}</code></li>`).join('')}</ul>` : '<p>Retrieving references…</p>');
  }
  return { categories, items, editor, busy, index, indexPreparing, indexError, logs, logDetails, deleting, bind, graph, document, retrievalDialog, retrievalResults,
    closeRetrieve: () => closeAppModal(byId('knowledge-retrieval-modal')),
    closeDocument: () => closeAppModal(byId('knowledge-document-modal')),
    value: (id: string) => byId<HTMLInputElement>(id)?.value ?? '',
    resetFilters: () => { const node = byId<HTMLInputElement>('knowledge-search'); if (node) node.value = ''; },
    resetLogFilters: () => { for (const id of ['retrieval-logs-conversation-id', 'retrieval-logs-message-id', 'knowledge-history-search']) { const node = byId<HTMLInputElement>(id); if (node) node.value = ''; } },
    error: (id: string, message: string, retry: string) => html(id, capabilityState(message, 'Check your connection and retry. Your saved data has not been changed.', button('Retry', retry), true)),
    closeEditor: () => { closeAppModal(byId('knowledge-item-modal')); busy(false); },
    closeDetails: () => { closeAppModal(byId('retrieval-log-details-modal')); },
    hideIndex: () => { const node = byId('knowledge-index-progress'); if (node) node.style.display = 'none'; },
    closeCategory: () => byId('knowledge-category-filter-wrapper')?.classList.remove('open'),
    toggleCategory: () => byId('knowledge-category-filter-wrapper')?.classList.toggle('open'),
    isManagementActive: () => byId('page-knowledge-management')?.classList.contains('active') ?? false,
    setTab: (tab: 'library' | 'logs') => {
      const page = byId('page-knowledge-management'); if (page) page.dataset.knowledgeTab = tab;
      doc.querySelectorAll<HTMLElement>('#page-knowledge-management .cap-local-nav [data-tab]').forEach(link => { const selected = link.dataset.tab === tab; link.setAttribute('aria-selected', String(selected)); link.tabIndex = selected ? 0 : -1; if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
      doc.querySelectorAll<HTMLElement>('[data-knowledge-tab-panel]').forEach(panel => { panel.hidden = panel.dataset.knowledgeTabPanel !== tab; });
    },
    loading: () => html('knowledge-items-list', capabilityState('Loading knowledge…')),
  };
}
export type KnowledgeView = ReturnType<typeof createKnowledgeView>;
