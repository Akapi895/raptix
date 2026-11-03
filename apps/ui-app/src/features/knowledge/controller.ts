import { createActions } from '../../ui/actions';
import { messageOf, type IndexStatus } from './model';
import { BACKEND_KB_NOT_ENABLED } from '@/platform/backend-legacy-strings';
import type { KnowledgeService } from './service';
import type { KnowledgeView } from './view';

export interface KnowledgeControllerDeps {
  doc: Document; service: KnowledgeService; view: KnowledgeView;
  t(key: string, params?: Record<string, string | number>): string;
  can(permission: string): boolean;
  confirm(message: string): boolean;
  notify(message: string, type: 'success' | 'error' | 'info' | 'warning'): void;
  copy(text: string): Promise<void>;
  navigateSettings(): void;
}
export function createKnowledgeController(deps: KnowledgeControllerDeps) {
  const { doc, service, view, t, notify } = deps;
  let disposed = false; let active = false;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let pendingIndexEpoch: number | null = null; let pollEpoch = 0; let detailsEpoch = 0;
  let unbind: (() => void) | undefined;
  let observer: MutationObserver | undefined;
  let graphPending = false;
  let graphRetries = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const deletingItems = new Set<string>(); const deletingLogs = new Set<string>();
  const report = (prefix: string, error: unknown) => { if (!disposed) notify(`${prefix}: ${t(messageOf(error))}`, 'error'); };
  const delay = (fn: () => void, ms: number) => { const timer = setTimeout(() => { timers.delete(timer); if (!disposed) fn(); }, ms); timers.add(timer); };
  function stopPoll(): void { clearInterval(poll); poll = undefined; pollEpoch++; service.invalidateIndex(); }
  function schedule(status: IndexStatus): void {
    clearInterval(poll); poll = undefined;
    if (status.job) {
      if (['scanning', 'indexing'].includes(status.job.state)) poll = setInterval(() => { if (!view.isManagementActive()) { stopPoll(); return; } void api.updateIndex(); }, 1500);
      return;
    }
    if (status.enabled === false || status.last_error || !status.total_items || (!status.is_rebuilding && status.is_complete)) return;
    poll = setInterval(() => { if (!view.isManagementActive()) { stopPoll(); return; } void api.updateIndex(); }, status.is_rebuilding ? 2000 : 3000);
  }
  const api = {
    async initialize(): Promise<void> {
      api.setTab(service.state.tab ?? 'library');
      void api.graph();
      if (service.state.tab === 'logs') await api.filterLogs();
      else await Promise.all([api.categories(), api.load()]);
    },
    get pollingTimer(): ReturnType<typeof setInterval> | undefined { return poll; },
    async categories(): Promise<void> {
      try { if (await service.loadCategories()) { view.categories(service.state); if (!service.state.enabled) view.items(service.state); } }
      catch (error) { if (!messageOf(error).includes(BACKEND_KB_NOT_ENABLED)) report('Failed to load categories', error); }
    },
    async load(category = service.state.pagination.currentCategory, page = 1, size = service.state.pagination.pageSize): Promise<void> {
      clearTimeout(searchTimer);
      service.setSource(view.value('knowledge-source-filter'));
      try { if (await service.loadItems(category, page, size, view.value('knowledge-search'))) { view.items(service.state); view.categories(service.state); void api.updateIndex(); } }
      catch (error) { if (!messageOf(error).includes(BACKEND_KB_NOT_ENABLED)) { report('Failed to load knowledge items', error); view.error('knowledge-items-list', 'Could not load knowledge items', 'reload'); } }
      if (!service.state.graph || service.state.graph.status?.graph_available === false) void api.graph();
    },
    async selectCategory(category: string): Promise<void> { view.closeCategory(); await api.load(category, 1); },
    async page(page: number): Promise<void> {
      if (page < 1 || page > Math.ceil(service.state.pagination.total / service.state.pagination.pageSize)) return;
      const focus = doc.activeElement?.closest('#knowledge-pagination') ? doc.activeElement?.textContent : '';
      await api.load(service.state.pagination.currentCategory, page);
      if (focus) ([...doc.querySelectorAll<HTMLButtonElement>('#knowledge-pagination button:not(:disabled)')].find(node => node.textContent === focus) ?? doc.querySelector<HTMLButtonElement>('#knowledge-pagination button:not(:disabled)'))?.focus();
    },
    async search(): Promise<void> {
      clearTimeout(searchTimer);
      const keyword = view.value('knowledge-search').trim();
      if (!keyword) { await api.load(); return; }
      try { if (await service.loadItems(service.state.pagination.currentCategory, 1, service.state.pagination.pageSize, keyword)) { view.items(service.state); void api.updateIndex(); } }
      catch (error) { report('Search failed', error); view.error('knowledge-items-list', 'Could not search knowledge', 'search'); }
    },
    add(): void { if (service.state.saving || !deps.can('knowledge:write')) return; service.beginCreate(); view.editor(service.state, true); },
    close(): void { if (service.state.saving) return; service.closeEditor(); view.closeEditor(); },
    async edit(id: string): Promise<void> {
      if (service.state.saving || !deps.can('knowledge:write')) return;
      const pending = service.beginEdit(id); view.editor(service.state, true);
      try { if (await pending) view.editor(service.state); }
      catch (error) { if (!disposed && service.state.editor?.id === id) { service.closeEditor(); view.closeEditor(); report('Failed to edit the knowledge item', error); } }
    },
    async save(): Promise<void> {
      if (!deps.can('knowledge:write')) return;
      if (service.state.saving) { notify('Saving; do not click again...', 'warning'); return; }
      try {
        const pending = service.save(); view.busy(service.state.saving);
        const result = await pending; if (disposed || !result) return;
        const selected = service.state.pagination.currentCategory;
        const category = result.created && selected && selected !== result.item.category ? result.item.category : selected;
        service.closeEditor(); view.closeEditor(); view.loading();
        notify(result.created && category !== selected ? `✅ Created! Switched to category "${category}" to show the new knowledge item.` : `✅ ${result.created ? 'Created' : 'Updated'} successfully!`, 'success');
        try {
          await service.loadCategories();
          if (await service.loadItems(category, 1)) { view.categories(service.state); view.items(service.state); void api.updateIndex(); }
        } catch { if (!disposed) { view.items(service.state); notify('⚠️ The knowledge item was saved, but refreshing the list failed. Reload the page to see it.', 'warning'); } }
      } catch (error) { report('❌ Failed to save the knowledge item', error); }
      finally { if (!disposed) view.busy(false); }
    },
    async remove(id: string): Promise<void> {
      if (!deps.can('knowledge:delete') || deletingItems.has(id) || !deps.confirm('Delete this knowledge item?')) return;
      deletingItems.add(id); const rollback = view.deleting('item', id);
      try {
        await service.remove(id); if (disposed) return;
        notify('✅ Deleted! The knowledge item has been removed.', 'success');
        await api.categories(); await api.load(service.state.pagination.currentCategory, service.state.pagination.currentPage);
      } catch (error) { if (!disposed) rollback(); report('❌ Failed to delete the knowledge item', error); }
      finally { deletingItems.delete(id); }
    },
    async refresh(): Promise<void> {
      if (!deps.can('knowledge:write')) return;
      notify('Scanning the knowledge base...', 'info');
      try {
        const data = await service.scan(); if (disposed) return;
        notify(data.message || 'Source scan started. Indexing remains an explicit action.', 'success');
        await api.categories(); await api.load(service.state.pagination.currentCategory, 1);
        stopPoll(); delay(() => { void api.updateIndex(); }, data.items_to_index ? 500 : 0);
      } catch (error) { report('Failed to refresh the knowledge base', error); }
    },
    async startIndex(mode: 'missing' | 'full' = 'missing', allowPartial = false): Promise<void> {
      if (!deps.can('knowledge:write')) return;
      const full = mode === 'full';
      if (!deps.confirm(allowPartial ? 'Index only valid source files? Invalid files remain reported as errors; existing records are preserved.' : full ? 'Re-index the source corpus? Existing records and source files will be preserved.' : 'Index the discovered reference corpus into the existing graph? This runs in the background and preserves source files.')) return;
      const label = full ? 'Full index rebuild' : 'Index build';
      notify(`Starting ${label.toLowerCase()}...`, 'info'); stopPoll(); view.indexPreparing(full);
      const epoch = pollEpoch;
      try {
        const result = await service.startIndex(mode, allowPartial); if (disposed || epoch !== pollEpoch) return;
        notify(result.message, result.conflict ? 'warning' : 'success');
        if (result.conflict) await api.updateIndex(); else delay(() => { if (epoch === pollEpoch) void api.updateIndex(); }, 500);
      } catch (error) { view.indexError(); report(`${label} failed`, error); }
    },
    async updateIndex(): Promise<void> {
      if (disposed || !view.isManagementActive() || pendingIndexEpoch === pollEpoch) return;
      const epoch = pollEpoch; pendingIndexEpoch = epoch;
      const wasRunning = service.state.index?.is_rebuilding;
      try {
        const status = await service.indexStatus(); if (disposed || epoch !== pollEpoch || !status) return;
        view.index(status); schedule(status);
        if (status.job && wasRunning && !status.is_rebuilding) { await api.load(service.state.pagination.currentCategory, service.state.pagination.currentPage); await api.graph(); }
        if (status.last_error) notify(`Index build failed: ${status.last_error.slice(0, 100)}`, 'error');
      } catch { if (!disposed && epoch === pollEpoch) { view.indexError(); stopPoll(); } }
      finally { if (pendingIndexEpoch === epoch) pendingIndexEpoch = null; }
    },
    stopIndex(hide = true): void { stopPoll(); if (hide) view.hideIndex(); },
    async logs(conversationId = '', messageId = ''): Promise<void> {
      try { if (await service.loadLogs(conversationId, messageId, 0, view.value('knowledge-history-search'))) view.logs(service.state); }
      catch (error) { if (disposed) return; view.error('retrieval-logs-list', t('retrievalLogs.loadError'), 'filterLogs'); report(t('retrievalLogs.loadError'), error); }
    },
    filterLogs(): Promise<void> { const value = view.value('retrieval-logs-conversation-id').trim(); const identity = service.state.conversations?.find(c => c.title === value)?.id ?? value; return api.logs(identity, view.value('retrieval-logs-message-id').trim()); },
    async logPage(offset: number): Promise<void> { try { if (await service.loadLogs(service.state.logFilter.conversationId, service.state.logFilter.messageId, offset, view.value('knowledge-history-search'))) { view.logs(service.state); doc.querySelector<HTMLElement>('#knowledge-history-pagination button:not(:disabled)')?.focus(); } } catch (error) { report('Could not load retrieval history', error); } },
    async graph(): Promise<void> {
      if (graphPending) return;
      graphPending = true;
      try {
        await service.graphConfiguration();
        if (!disposed) view.graph(service.state);
        // A cold Neo4j cache or an in-flight index can briefly report the graph
        // unavailable. Retry a few times so a transient read failure clears on
        // its own instead of sticking until the operator refreshes.
        if (service.state.graph?.status?.graph_available === false && graphRetries < 3) {
          graphRetries++;
          delay(() => { void api.graph(); }, 6000);
        } else {
          graphRetries = 0;
        }
      } catch {
        if (!disposed) view.graph(service.state, 'Runtime configuration unavailable');
        if (graphRetries < 3) { graphRetries++; delay(() => { void api.graph(); }, 6000); }
      } finally { graphPending = false; }
    },
    async toggleGraph(): Promise<void> {
      if (!deps.can('knowledge:write') || service.state.graphSaving) return;
      const enabled = (doc.getElementById('knowledge-graph-enabled') as HTMLInputElement | null)?.checked ?? false;
      const pending = service.toggleGraph(enabled); view.graph(service.state);
      try { await pending; notify('Knowledge Graph preference saved for new Web executions.', 'success'); }
      catch (error) { report('Could not save graph preference', error); }
      finally { if (!disposed) view.graph(service.state); }
    },
    async document(id: string): Promise<void> {
      const epoch = ++detailsEpoch;
      try { const item = await service.detail(id); if (!disposed && epoch === detailsEpoch) { service.setDocument(item); await view.document(item); } }
      catch (error) { report('Could not open document', error); }
    },
    async retrieve(): Promise<void> {
      const query = view.value('knowledge-retrieval-query').trim();
      if (!query) { notify('Enter a search term to test reference retrieval.', 'info'); return; }
      const button = doc.querySelector<HTMLButtonElement>('[data-action="knowledge.retrieve"]');
      if (button?.disabled) return;
      if (button) button.disabled = true;
      view.retrievalResults(null);
      try { const result = await service.retrieveReference(query); view.retrievalResults(result); }
      catch (error) { view.retrievalResults(null, messageOf(error)); report('Reference retrieval failed', error); }
      finally { if (button) button.disabled = false; }
    },
    async removeLog(id: string): Promise<void> {
      if (!deps.can('knowledge:delete') || deletingLogs.has(id) || !deps.confirm(t('retrievalLogs.deleteConfirm'))) return;
      deletingLogs.add(id); const rollback = view.deleting('log', id);
      try { await service.removeLog(id); if (disposed) return; notify('✅ Deleted! The retrieval log has been removed.', 'success'); await api.filterLogs(); }
      catch (error) { if (!disposed) rollback(); report(t('retrievalLogs.deleteError'), error); }
      finally { deletingLogs.delete(id); }
    },
    async logDetails(index: number): Promise<void> {
      const epoch = ++detailsEpoch;
      try { const details = await service.logDetails(index); if (!disposed && epoch === detailsEpoch) view.logDetails(details.log, details.items, details.unavailable); }
      catch (error) { report(t('retrievalLogs.detailError'), error); }
    },
    closeDetails(): void { detailsEpoch++; view.closeDetails(); },
    setTab(tab: string): void { const next = tab === 'logs' ? 'logs' : 'library'; service.setTab(next); view.setTab(next); },
    // Switching the Library/Retrieval tabs only changes the query string, which the router
    // treats as the same page (no re-activation) -- react to the hashchange directly instead.
    syncTab(): void {
      const hash = doc.defaultView?.location.hash ?? '';
      if (!/^#\/?(?:knowledge|knowledge-management)(?:\?|$)/.test(hash)) return;
      if (!hash.includes('tab=')) return;
      const tab = new URLSearchParams(hash.split('?')[1] ?? '').get('tab') === 'logs' ? 'logs' : 'library';
      api.setTab(tab);
      if (!view.isManagementActive()) return;
      if (tab === 'logs') void api.filterLogs(); else { void api.categories(); void api.load(); }
    },
    activate(): void {
      if (active || disposed) return; active = true;
      const actions = createActions();
      const on = (name: string, fn: (node: HTMLElement, event: Event) => void) => actions.register(`knowledge.${name}`, (node, event) => {
        if (event.type === 'click') node.closest('.kn-actions')?.removeAttribute('open');
        fn(node, event);
      });
      on('refresh', () => { void api.refresh(); }); on('build', () => { void api.startIndex(); }); on('rebuild', () => { void api.startIndex('full'); }); on('stopIndex', () => api.stopIndex());
      on('partialIndex', () => { void api.startIndex('missing', true); });
      on('graphToggle', () => { void api.toggleGraph(); });
      on('graphRefresh', () => { void api.graph(); });
      on('refreshPage', () => { if (service.state.tab === 'logs') void api.filterLogs(); else void api.load(); void api.graph(); });
      on('source', () => { service.setSource(view.value('knowledge-source-filter')); void api.load(); });
      on('pageSize', () => { void api.load(service.state.pagination.currentCategory, 1, Number(view.value('knowledge-page-size')) || 50); });
      on('retrieve', () => { void api.retrieve(); });
      on('openRetrieve', () => view.retrievalDialog());
      on('closeRetrieve', () => view.closeRetrieve());
      on('retrieveHistory', () => { view.closeRetrieve(); api.setTab('logs'); void api.filterLogs(); });
      on('retrieveKey', (_el, event) => { if ((event as KeyboardEvent).key === 'Enter') { event.preventDefault(); void api.retrieve(); } });
      on('document', el => { void api.document(el.dataset.id ?? ''); });
      on('documentView', el => { if (service.state.document) void view.document(service.state.document, el.dataset.raw === 'true'); });
      on('closeDocument', () => { detailsEpoch++; view.closeDocument(); });
      on('tab', el => { api.setTab(el.dataset.tab ?? 'library'); if (service.state.tab === 'logs') void api.filterLogs(); });
      on('tabKey', (el, event) => {
        const key = (event as KeyboardEvent).key;
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
        event.preventDefault();
        const tab = key === 'Home' ? 'library' : key === 'End' ? 'logs' : el.dataset.tab === 'library' ? 'logs' : 'library';
        const hash = `#knowledge-management?tab=${tab}`;
        if (doc.defaultView) doc.defaultView.location.hash = hash; else api.setTab(tab);
        doc.querySelector<HTMLElement>(`#page-knowledge-management [data-tab="${tab}"]`)?.focus();
      });
      on('logPage', el => { void api.logPage(Number(el.dataset.offset) || 0); });
      on('add', api.add); on('close', api.close); on('save', () => { void api.save(); });
      on('edit', el => { void api.edit(el.dataset.id ?? ''); }); on('delete', el => { void api.remove(el.dataset.id ?? ''); });
      on('category', el => { void api.selectCategory(el.dataset.category ?? ''); }); on('all', () => { void api.selectCategory(''); });
      on('categorySelect', el => { void api.selectCategory((el as HTMLSelectElement).value); });
      on('clearFilters', () => { view.resetFilters(); service.setSource(''); const source = doc.getElementById('knowledge-source-filter') as HTMLSelectElement | null; if (source) source.value = ''; void api.selectCategory(''); });
      on('reload', () => { void api.load(); });
      on('indexStatus', () => { void api.updateIndex(); });
      on('clearLogs', () => { view.resetLogFilters(); void api.filterLogs(); });
      on('logsKey', (_el, event) => { if ((event as KeyboardEvent).key === 'Enter') { event.preventDefault(); void api.filterLogs(); } });
      on('toggleCategory', (_el, event) => { event.stopPropagation(); view.toggleCategory(); });
      on('page', el => { void api.page(Number(el.dataset.page)); });
      on('search', () => { void api.search(); });
      on('searchKey', (_el, event) => { if ((event as KeyboardEvent).key === 'Enter') { event.preventDefault(); void api.search(); } });
      on('searchInput', () => { clearTimeout(searchTimer); if (!view.value('knowledge-search').trim()) { void api.load(); } else searchTimer = setTimeout(() => { void api.search(); }, 500); });
      on('field', el => { const field = el.dataset.field; if (field === 'category' || field === 'title' || field === 'content') service.updateEditor(field, (el as HTMLInputElement).value); });
      on('filterLogs', () => { void api.filterLogs(); }); on('deleteLog', el => { void api.removeLog(el.dataset.id ?? ''); }); on('logDetails', el => { void api.logDetails(Number(el.dataset.index)); }); on('closeDetails', api.closeDetails);
      on('copy', el => { void deps.copy(el.dataset.copy ?? '').then(() => { if (disposed) return; el.title = t('common.copied'); delay(() => { el.title = t('retrievalLogs.clickToCopy'); }, 2000); }).catch(error => report(t('retrievalLogs.clickToCopy'), error)); });
      on('settings', deps.navigateSettings);
      unbind = view.bind(actions);
      doc.addEventListener('languagechange', language); doc.addEventListener('click', outside); doc.defaultView?.addEventListener('hashchange', api.syncTab);
      const page = doc.getElementById('page-knowledge-management');
      if (page && typeof MutationObserver !== 'undefined') { observer = new MutationObserver(() => { if (!view.isManagementActive()) stopPoll(); }); observer.observe(page, { attributes: true, attributeFilter: ['class'] }); }
      view.categories(service.state);
    },
    dispose(): void {
      if (disposed) return; disposed = true; detailsEpoch++; stopPoll(); clearTimeout(searchTimer); timers.forEach(clearTimeout); timers.clear(); observer?.disconnect(); unbind?.();
      doc.removeEventListener('languagechange', language); doc.removeEventListener('click', outside); doc.defaultView?.removeEventListener('hashchange', api.syncTab); service.dispose();
    },
  };
  function language(): void { if (!disposed) { view.categories(service.state); view.items(service.state); view.logs(service.state); } }
  function outside(event: Event): void {
    const target = event.target;
    if (target === doc.getElementById('knowledge-item-modal')) api.close();
    if (target === doc.getElementById('retrieval-log-details-modal')) api.closeDetails();
    if (target === doc.getElementById('knowledge-document-modal')) view.closeDocument();
    if (target instanceof Node && !doc.getElementById('knowledge-category-filter-wrapper')?.contains(target)) view.closeCategory();
  }
  return api;
}
