import type { AuditDependencies, AuditFilters, AuditLog, AuditSummary } from './types';
import { auditActionsByCategory, createAuditLabels, escapeAuditHtml as esc } from './labels';
import { auditPageSizes, auditPresetRange, auditResourceDestination, auditResourceUnavailable, type AuditObserver, type AuditService, type AuditState } from './service';
import type { AuditDatetimePicker } from './datetime-picker';
import { createAuditSelects } from './selects';

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
export function createAuditView(document: Document, dependencies: AuditDependencies, picker: AuditDatetimePicker) {
  const labels = createAuditLabels(dependencies), { t } = labels;
  const selects = createAuditSelects(document);
  const events = new AbortController();
  let service: AuditService;
  let mounted = false, disposed = false, detailSequence = 0;
  let detailController: AbortController | null = null;
  const element = (id: string) => document.getElementById(id);
  const select = (id: string) => document.querySelector<HTMLSelectElement>('#' + id);
  const text = (id: string, value: string) => { const node = element(id); if (node) node.textContent = value; };
  const toastError = (error: unknown) => dependencies.toast(errorMessage(error), 'error');
  function readFilters(): AuditFilters {
    const action = select('audit-filter-action');
    return { category: select('audit-filter-category')?.value || '', action: action?.disabled ? '' : action?.value || '', result: select('audit-filter-result')?.value || '', q: document.querySelector<HTMLInputElement>('#audit-filter-q')?.value || '', since: picker.getValue('audit-filter-since'), until: picker.getValue('audit-filter-until') };
  }
  function rebuildActions(): void {
    const action = select('audit-filter-action'); if (!action) return;
    const category = select('audit-filter-category')?.value || '', previous = action.value;
    action.replaceChildren();
    const all = document.createElement('option'); all.value = ''; all.textContent = t('settingsAudit.filterAllActions', null, 'All actions'); action.append(all);
    action.disabled = !category; action.title = category ? '' : t('settingsAudit.filterCascadeHint', null, 'Select a category to filter by action');
    for (const value of auditActionsByCategory[category] || []) {
      const option = document.createElement('option'); option.value = value; option.textContent = labels.action(value); action.append(option);
    }
    if ([...action.options].some(option => option.value === previous)) action.value = previous;
    selects.sync('audit-filter-action');
  }
  function timezoneHint(): void {
    const hint = element('audit-filter-timezone-hint'); if (!hint) return;
    let zone = '';
    try { zone = new Intl.DateTimeFormat(dependencies.getLocale(), { timeZoneName: 'short' }).formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value || ''; } catch { /* Unavailable locale/timezone. */ }
    hint.hidden = !zone; hint.textContent = zone ? t('settingsAudit.filterTimeZone', { tz: zone }, `Time zone: ${zone} (filters use browser local time; the API uses UTC)`) : '';
  }
  function renderLogs(logs: AuditLog[]): void {
    const list = element('audit-log-list'); if (!list) return;
    if (!logs.length) { list.innerHTML = `<div class="audit-log-empty">${esc(t('settingsAudit.empty', null, 'No audit records'))}</div>`; return; }
    const dash = '<span class="audit-log-cell-muted">—</span>';
    const headings = [['colTime', 'Time'], ['colMessage', 'Description'], ['colCategory', 'Category'], ['colAction', 'Action'], ['colResult', 'Result'], ['colIp', 'IP'], ['colResource', 'Resource ID']];
    list.innerHTML = '<div class="audit-log-table-wrap"><table class="audit-log-table"><thead><tr>' + headings.map(([key, fallback]) => `<th data-i18n="settingsAudit.${key}">${fallback}</th>`).join('') + '</tr></thead><tbody>' + logs.map(log => {
      const category = esc(labels.category(log.category || '')), action = esc(labels.action(log.action || '')), message = esc(labels.message(log)), result = esc(labels.result(log.result || '')), id = esc(log.resourceId || '');
      return `<tr class="audit-log-row" role="button" tabindex="0" data-action="audit.detail" data-id="${esc(log.id || '')}"><td class="audit-log-col-time">${esc(labels.time(log.createdAt))}</td><td class="audit-log-col-msg" title="${message}">${message || dash}</td><td>${category ? `<span class="audit-tag audit-tag--cat">${category}</span>` : dash}</td><td>${action ? `<span class="audit-tag audit-tag--act">${action}</span>` : dash}</td><td>${result ? `<span class="audit-tag ${log.result === 'failure' ? 'audit-tag--fail' : 'audit-tag--ok'}">${result}</span>` : dash}</td><td class="audit-log-col-ip">${esc(log.clientIp || '') || dash}</td><td class="audit-log-col-resource" title="${id}">${id || dash}</td></tr>`;
    }).join('') + '</tbody></table></div>';
    dependencies.applyTranslations(list);
  }
  function renderPagination(state: Readonly<AuditState>): void {
    const container = element('audit-logs-pagination'); if (!container) return;
    const { total, page, pageSize } = state, pages = Math.max(1, Math.ceil(total / pageSize));
    const start = total ? (page - 1) * pageSize + 1 : 0, end = total ? Math.min(page * pageSize, total) : 0;
    const button = (destination: number, key: string, fallback: string, disabled: boolean) => `<button type="button" class="btn-secondary" data-action="audit.page" data-page="${destination}"${disabled ? ' disabled' : ''}>${esc(t(key, null, fallback))}</button>`;
    container.innerHTML = '<div class="monitor-pagination"><div class="pagination-info"><span>' + esc(t('mcpMonitor.paginationInfo', { start, end, total }, `Showing ${start}-${end} of ${total} records`)) + '</span><label class="pagination-page-size">' + esc(t('mcpMonitor.perPageLabel', null, 'Per page')) + '<select id="audit-page-size" data-action="audit.page-size">' + auditPageSizes.map(size => `<option value="${size}"${size === pageSize ? ' selected' : ''}>${size}</option>`).join('') + '</select></label></div><div class="pagination-controls">' + button(1, 'mcp.firstPage', 'First', page === 1 || !total) + button(page - 1, 'mcp.prevPage', 'Previous', page === 1 || !total) + '<span class="pagination-page">' + esc(t('mcp.pageInfo', { page, total: pages }, `Page ${page} / ${pages}`)) + '</span>' + button(page + 1, 'mcp.nextPage', 'Next', page >= pages || !total) + button(pages, 'mcp.lastPage', 'Last', page >= pages || !total) + '</div></div>';
    dependencies.initPaginationSelects(container);
  }
  function closeExportMenu(): void { const menu = element('audit-export-menu'); if (menu) menu.hidden = true; element('audit-export-trigger')?.setAttribute('aria-expanded', 'false'); }
  function toggleExportMenu(): void {
    const menu = element('audit-export-menu'); if (!menu) return;
    const opening = menu.hidden; menu.hidden = !opening; element('audit-export-trigger')?.setAttribute('aria-expanded', String(opening));
  }
  function closeDetail(): void {
    ++detailSequence; detailController?.abort(); detailController = null;
    dependencies.closeModal('audit-detail-modal'); element('audit-detail-modal')?.remove(); dependencies.syncModalBodyLock();
  }
  function resourceMeta(log: AuditLog): string {
    if (!log.resourceId) return '';
    const id = esc(log.resourceId);
    if (auditResourceUnavailable(log)) return `<p class="audit-resource-meta"><strong>${esc(t('settingsAudit.resourceIdLabel', null, 'Resource ID'))}:</strong> <code>${id}</code> <span class="audit-resource-removed">${esc(t('settingsAudit.resourceRemoved', null, '(resource no longer exists)'))}</span></p>`;
    const destination = auditResourceDestination(log);
    if (!destination) return `<p><strong>ID:</strong> ${id}</p>`;
    if (destination.conversationId) return `<p><button type="button" class="btn-secondary btn-small audit-open-chat-btn" data-action="audit.open-chat" data-conversation-id="${id}">${esc(t('settingsAudit.openResourceChat', null, 'Open linked resource (chat)'))}</button></p>`;
    return `<p><button type="button" class="btn-secondary btn-small" data-action="audit.open-resource" data-page="${esc(destination.page)}" data-section="${esc(destination.section || '')}">${esc(t('settingsAudit.openResource', null, 'Open linked resource'))}</button></p>`;
  }
  async function openConversation(id: string): Promise<void> {
    id = id.trim(); if (!id || disposed) return;
    const exists = await service.conversationExists(id);
    if (exists === null) return;
    if (!exists) { if (!disposed) dependencies.toast(t('settingsAudit.resourceRemoved', null, '(resource no longer exists)'), 'warning'); return; }
    if (disposed) return;
    closeDetail(); dependencies.navigate('chat'); void dependencies.loadConversation(id);
  }
  async function showDetail(id: string): Promise<void> {
    if (!id || disposed) return;
    closeDetail();
    const sequence = detailSequence;
    const overlay = document.createElement('div'); overlay.id = 'audit-detail-modal'; overlay.className = 'modal'; document.body.append(overlay); dependencies.openModal(overlay);
    detailController = new AbortController();
    try {
      const log = await service.detail(id, detailController.signal);
      if (disposed || sequence !== detailSequence) return;
      const paragraph = (key: string, fallback: string, value: string) => `<p><strong>${esc(t(key, null, fallback))}:</strong> ${esc(value)}</p>`;
      dependencies.deferModalContent(() => {
        if (disposed || sequence !== detailSequence || !overlay.isConnected) return;
        overlay.innerHTML = '<div class="modal-content" style="max-width: 720px;"><div class="modal-header"><h2>' + esc(t('settingsAudit.detailTitle', null, 'Audit detail')) + '</h2><span class="modal-close" data-action="audit.close-detail">&times;</span></div><div class="modal-body audit-detail-body">' +
          paragraph('settingsAudit.detailTime', 'Time', labels.time(log.createdAt)) + paragraph('settingsAudit.detailCategory', 'Category', labels.category(log.category || '') + ' / ' + labels.action(log.action || '')) + paragraph('settingsAudit.detailResult', 'Result', labels.result(log.result || '')) + paragraph('settingsAudit.detailMessage', 'Message', labels.message(log)) +
          (log.clientIp ? `<p><strong>IP:</strong> ${esc(log.clientIp)}</p>` : '') + (log.sessionHint ? paragraph('settingsAudit.detailSession', 'Session', log.sessionHint) : '') + (log.userAgent ? `<p><strong>UA:</strong> ${esc(log.userAgent)}</p>` : '') + resourceMeta(log) + (log.detail ? `<pre class="audit-detail-pre">${esc(JSON.stringify(log.detail, null, 2))}</pre>` : '') + '</div><div class="modal-footer"><button type="button" class="btn-secondary" data-action="audit.close-detail">' + esc(t('common.close', null, 'Close')) + '</button></div></div>';
      });
    } catch (error) { if (!disposed && sequence === detailSequence) { closeDetail(); toastError(error); } }
  }
  async function runExport(format: 'json' | 'csv'): Promise<void> {
    closeExportMenu(); if (disposed || !dependencies.requirePermission('audit:read')) return;
    try {
      const blob = await service.export(format, readFilters());
      if (disposed) return;
      dependencies.download(blob, `audit-logs-${new Date().toISOString().slice(0, 10)}.${format}`);
      dependencies.toast(t('settingsAudit.exportDone', null, 'Export complete'), 'success');
    } catch (error) { if (!disposed) toastError(error); }
  }
  const filter = (): Promise<void> => service.filter(readFilters());
  const load = (page = service.snapshot().page): Promise<void> => service.refresh(readFilters(), page);
  function goPage(page: number): Promise<void> {
    const state = service.snapshot();
    return page >= 1 && page <= Math.max(1, Math.ceil(state.total / state.pageSize)) ? load(page) : Promise.resolve();
  }
  function reset(): void {
    for (const id of ['audit-filter-category', 'audit-filter-result']) { const node = select(id); if (node) node.value = ''; }
    const query = document.querySelector<HTMLInputElement>('#audit-filter-q'); if (query) query.value = '';
    picker.clearAll(); rebuildActions(); selects.sync('audit-filter-category'); selects.sync('audit-filter-result'); void filter();
  }
  function preset(value: string): void { const range = auditPresetRange(value); if (!range) return; picker.setValue('audit-filter-since', range.since); picker.setValue('audit-filter-until', range.until); void filter(); }
  function refreshI18n(): void {
    const section = element('settings-section-audit'); if (section) dependencies.applyTranslations(section);
    rebuildActions(); ['audit-filter-category', 'audit-filter-action', 'audit-filter-result'].forEach(selects.sync); timezoneHint();
    const state = service.snapshot(); if (state.logs.length) { renderLogs(state.logs); renderPagination(state); }
  }
  function mount(): void {
    if (mounted || disposed) return; mounted = true;
    const section = element('settings-section-audit');
    section?.querySelectorAll<HTMLElement>('[data-preset]').forEach(node => { node.dataset.action = 'audit.preset'; });
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      const node = target?.closest<HTMLElement>('[data-action]');
      if (node instanceof HTMLButtonElement && node.disabled) return;
      if (node?.dataset.action?.startsWith('audit.')) {
        switch (node.dataset.action) {
          case 'audit.filter': void filter(); break;
          case 'audit.reset': reset(); break;
          case 'audit.refresh': void service.refresh(readFilters()); break;
          case 'audit.export-toggle': event.stopPropagation(); toggleExportMenu(); return;
          case 'audit.export-json': void runExport('json'); break;
          case 'audit.export-csv': void runExport('csv'); break;
          case 'audit.detail': void showDetail(node.dataset.id || ''); break;
          case 'audit.page': void goPage(Number(node.dataset.page)); break;
          case 'audit.preset': preset(node.dataset.preset || ''); break;
          case 'audit.close-detail': closeDetail(); break;
          case 'audit.open-chat': void openConversation(node.dataset.conversationId || ''); break;
          case 'audit.open-resource': closeDetail(); dependencies.navigate(node.dataset.page || ''); if (node.dataset.section) dependencies.settingsSection(node.dataset.section); break;
        }
      }
      if (target?.id === 'audit-detail-modal') closeDetail();
      closeExportMenu();
    }, { signal: events.signal });
    document.addEventListener('change', event => {
      const node = event.target;
      if (!(node instanceof HTMLSelectElement)) return;
      if (node.id === 'audit-filter-category') rebuildActions();
      if (node.id === 'audit-page-size') void service.pageSize(Number(node.value), readFilters());
    }, { signal: events.signal });
    document.addEventListener('keydown', event => {
      const node = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action="audit.detail"]') : null;
      if (node && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); void showDetail(node.dataset.id || ''); }
    }, { signal: events.signal });
    document.addEventListener('languagechange', refreshI18n, { signal: events.signal });
  }
  const observer: AuditObserver = {
    loading(): void { const list = element('audit-log-list'); if (list) list.innerHTML = `<div class="loading-spinner">${esc(t('settingsAudit.loading', null, 'Loading...'))}</div>`; },
    loaded(state): void { renderLogs(state.logs); renderPagination(state); },
    summary(summary: AuditSummary): void {
      const wrap = element('audit-summary-stats'); if (wrap) wrap.hidden = false;
      const total = summary.total ?? 0, failures = summary.failures ?? 0;
      text('audit-stat-total', String(total)); text('audit-stat-success', String(Math.max(0, total - failures))); text('audit-stat-failures', String(failures)); text('audit-stat-recent', String(summary.recent_7d ?? 0));
    },
    error(error): void { const list = element('audit-log-list'); if (list) list.innerHTML = `<div class="monitor-empty">${esc(errorMessage(error))}</div>`; toastError(error); },
  };
  return {
    observer, bind(value: AuditService): void { service = value; }, mount,
    init(): void { if (disposed || !element('audit-log-list')) return; mount(); selects.init(); rebuildActions(); picker.init(); timezoneHint(); void service.filter(readFilters()); },
    filter, load, goPage, reset, preset, rebuildActions, refreshI18n, showDetail, closeDetail, openConversation, runExport, toggleExportMenu, closeExportMenu,
    refresh: (): Promise<void> => service.refresh(readFilters()),
    pageSizeChange: (): Promise<void> => service.pageSize(Number(select('audit-page-size')?.value), readFilters()),
    dispose(): void { if (disposed) return; disposed = true; events.abort(); closeDetail(); closeExportMenu(); selects.dispose(); },
  };
}
