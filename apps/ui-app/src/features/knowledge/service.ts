import type { IndexStatus, KnowledgeCategory, KnowledgeItem, KnowledgePayload, KnowledgeState, RetrievalLog } from './model';
export type RequestFn = (path: string, init?: RequestInit) => Promise<Response>;
export class KnowledgeError extends Error {}
type ItemWire = KnowledgeItem & { updated_at?: string; created_at?: string };
type LogWire = Omit<RetrievalLog, 'retrievedItems'> & { retrievedItems?: string[] | string | null; created_at?: string };
interface ItemsWire { enabled?: boolean; categories?: KnowledgeCategory[] | null; items?: ItemWire[]; total?: number; page?: number; page_size?: number; document_page?: boolean; reference_error?: string; reference_status?: IndexStatus }
const noCache = { 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache', Expires: '0' };
const normalizeItem = (item: ItemWire): KnowledgeItem => ({ ...item, updatedAt: item.updatedAt ?? item.updated_at, createdAt: item.createdAt ?? item.created_at });
function normalizeLog(log: LogWire): RetrievalLog {
  let items: unknown = log.retrievedItems;
  if (typeof items === 'string') { try { items = JSON.parse(items) as unknown; } catch { items = []; } }
  return { ...log, retrievedItems: Array.isArray(items) ? items.filter((id): id is string => typeof id === 'string') : [], createdAt: log.createdAt ?? log.created_at };
}
export function createKnowledgeService(deps: { request: RequestFn; now?: () => number }) {
  const { request, now = Date.now } = deps;
  const state: KnowledgeState = { enabled: true, categories: [], groups: [], pagination: { currentPage: 1, pageSize: 10, total: 0, currentCategory: '' }, search: '', editor: null, saving: false, logs: [], logFilter: { conversationId: '', messageId: '' }, index: null, tab: 'library', source: '', logOffset: 0, logTotal: 0 };
  let disposed = false; let listVersion = 0; let categoriesVersion = 0; let editVersion = 0; let logsVersion = 0; let indexVersion = 0;
  const itemPath = (id: string) => `/api/knowledge/items/${encodeURIComponent(id)}`;
  const write = (method: string, payload?: object): RequestInit => ({ method, ...(payload ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}) });
  async function json<T>(path: string, init?: RequestInit, fallback = 'Request failed'): Promise<T> {
    if (disposed) throw new KnowledgeError('Knowledge service disposed');
    const response = await request(path, init);
    if (!response.ok) { const body = await response.json().catch(() => null) as { error?: string } | null; throw new KnowledgeError(body?.error || fallback); }
    return await response.json() as T;
  }
  const get = <T>(path: string, fallback: string) => json<T>(path, { method: 'GET', headers: noCache }, fallback);
  const api = {
    get state(): Readonly<KnowledgeState> { return state; },
    setTab(tab: 'library' | 'logs'): void { state.tab = tab; },
    setDocument(item: KnowledgeItem): void { state.document = item; },
    async loadCategories(): Promise<boolean> {
      const version = ++categoriesVersion;
      const data = await get<{ enabled?: boolean; categories?: (string | { name: string; count?: number })[] | null }>(`/api/knowledge/categories?_t=${now()}`, 'Failed to load categories').catch(error => { if (disposed || version !== categoriesVersion) return null; throw error; });
      if (!data || disposed || version !== categoriesVersion) return false;
      state.enabled = data.enabled !== false;
      state.categories = (data.categories ?? []).map(category => typeof category === 'string' ? category : category.name);
      return true;
    },
    /** Go pages by category and searches all items. Demo pages flat items: gather its pages before grouping. */
    async loadItems(category = state.pagination.currentCategory, page = 1, pageSize = state.pagination.pageSize, search = ''): Promise<boolean> {
      const version = ++listVersion;
      state.pagination.currentCategory = category; state.pagination.currentPage = page; state.pagination.pageSize = pageSize; state.search = search.trim();
      const query = new URLSearchParams({ view: 'documents', categoryPage: 'true', limit: String(pageSize), offset: String((page - 1) * pageSize), _t: String(now()) });
      if (search.trim()) { query.delete('categoryPage'); query.set('search', search.trim()); }
      if (state.source) query.set('source', state.source);
      if (category) query.set('category', category);
      const data = await get<ItemsWire>(`/api/knowledge/items?${query}`, search ? 'Search failed' : 'Failed to load knowledge items').catch(error => { if (disposed || version !== listVersion) return null; throw error; });
      if (!data || disposed || version !== listVersion) return false;
      let groups = data.categories ?? [];
      let total = data.total ?? 0;
      if (!data.categories && data.items) {
        const all = [...data.items];
        const size = data.page_size ?? 50;
        for (let next = (data.page ?? 1) + 1; !data.document_page && (next - 1) * size < (data.total ?? all.length); next++) {
          const more = new URLSearchParams(query); more.set('page', String(next)); more.set('page_size', String(size));
          const result = await get<ItemsWire>(`/api/knowledge/items?${more}`, 'Failed to load knowledge items').catch(error => { if (disposed || version !== listVersion) return null; throw error; });
          if (!result || disposed || version !== listVersion) return false;
          if (!result.items?.length) break;
          all.push(...result.items);
        }
        const grouped = new Map<string, KnowledgeItem[]>();
        for (const item of all) { const name = item.category || 'Uncategorized'; const items = grouped.get(name) ?? []; items.push(normalizeItem(item)); grouped.set(name, items); }
        const entries = [...grouped];
        if (!data.document_page) entries.sort(([x], [y]) => x.localeCompare(y));
        groups = entries.map(([name, items]) => ({ category: name, itemCount: items.length, items }));
        if (!data.document_page) {
          total = groups.length;
          if (!category && !search.trim()) groups = groups.slice((page - 1) * pageSize, page * pageSize);
        }
      }
      if (disposed || version !== listVersion) return false;
      state.enabled = data.enabled !== false; state.groups = state.enabled ? groups : []; state.pagination.total = state.enabled ? total : 0;
      state.documentPagination = !!data.document_page; state.referenceError = data.reference_error;
      if (data.reference_status) state.index = data.reference_status;
      return true;
    },
    setSource(source: string): void { state.source = source; },
    async graphConfiguration(): Promise<void> { state.graph = await json<NonNullable<KnowledgeState['graph']>>('/api/knowledge/graph-configuration'); },
    async toggleGraph(enabled: boolean): Promise<void> {
      if (!state.graph || state.graphSaving) return;
      state.graphSaving = true;
      try {
        const saved = await json<{ enabled: boolean; revision: number }>('/api/knowledge/graph-configuration', write('PUT', { enabled, revision: state.graph.revision }));
        state.graph = { ...state.graph, ...saved };
      } catch (error) { try { await api.graphConfiguration(); } catch { state.graph = undefined; } throw error; }
      finally { state.graphSaving = false; }
    },
    async retrieveReference(query: string): Promise<{ nodes: { id: string; name: string }[]; truncated?: boolean }> {
      const kind = 'KrgReference';
      return json('/api/knowledge/retrieve', write('POST', { query: { graph: 'reference', query_type: 'search_by_name', params: { kind, q: query, limit: 10 } } }));
    },
    async detail(id: string): Promise<KnowledgeItem> { return normalizeItem(await json<ItemWire>(itemPath(id), undefined, 'Failed to load the knowledge item')); },
    beginCreate(): void { editVersion++; state.editor = { id: null, category: '', title: '', content: '', loading: false }; },
    closeEditor(): void { editVersion++; state.editor = null; },
    updateEditor(field: keyof KnowledgePayload, value: string): void { if (state.editor) state.editor[field] = value; },
    async beginEdit(id: string): Promise<boolean> {
      const version = ++editVersion; state.editor = { id, category: '', title: '', content: '', loading: true };
      const item = await api.detail(id).catch(error => { if (disposed || version !== editVersion) return null; throw error; });
      if (!item || disposed || version !== editVersion) return false;
      state.editor = { id, category: item.category, title: item.title, content: item.content ?? '', loading: false }; return true;
    },
    async save(): Promise<{ item: KnowledgeItem; created: boolean } | null> {
      if (state.saving) return null;
      const editor = state.editor; if (!editor || editor.loading) throw new KnowledgeError('Wait for the knowledge item to finish loading');
      const payload = { category: editor.category.trim(), title: editor.title.trim(), content: editor.content.trim() };
      if (!payload.category || !payload.title || !payload.content) throw new KnowledgeError('Fill in all required fields');
      state.saving = true;
      try { const item = normalizeItem(await json<ItemWire>(editor.id ? itemPath(editor.id) : '/api/knowledge/items', write(editor.id ? 'PUT' : 'POST', payload), 'Failed to save the knowledge item')); return { item, created: !editor.id }; }
      finally { state.saving = false; }
    },
    async remove(id: string): Promise<void> { await json(itemPath(id), write('DELETE'), 'Failed to delete the knowledge item'); },
    async scan(): Promise<{ items_to_index?: number; message?: string }> { return json('/api/knowledge/scan', write('POST'), 'Failed to scan the knowledge base'); },
    async startIndex(mode: 'missing' | 'full', allowPartial = false): Promise<{ conflict: boolean; message: string }> {
      if (disposed) throw new KnowledgeError('Knowledge service disposed');
      const response = await request(`/api/knowledge/index${mode === 'full' ? '?mode=full' : ''}`, write('POST', allowPartial ? { allow_partial: true } : undefined));
      const data = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (response.status === 409) return { conflict: true, message: data.error || 'An indexing task is already running; wait for it to finish' };
      if (!response.ok) throw new KnowledgeError(data.error || `${mode === 'full' ? 'Full index rebuild' : 'Index build'} failed`);
      return { conflict: false, message: data.message || `${mode === 'full' ? 'Full index rebuild' : 'Index build'} started; it runs in the background` };
    },
    async indexStatus(): Promise<IndexStatus | null> {
      if (disposed) return null;
      const version = ++indexVersion;
      const response = await request('/api/knowledge/index-status', { method: 'GET', headers: noCache });
      if (!response.ok) throw new KnowledgeError('Knowledge index status unavailable. Check the runtime connection.');
      const data = await response.json() as Partial<IndexStatus> & { total?: number; pending?: number; status?: string };
      const total = data.total_items ?? data.total ?? 0;
      const indexed = data.indexed_items ?? Math.max(0, total - (data.pending ?? 0));
      const status: IndexStatus = { ...data, total_items: total, indexed_items: indexed, progress_percent: data.progress_percent ?? (total ? indexed / total * 100 : 0), is_complete: data.is_complete ?? data.status === 'ready' };
      if (disposed || version !== indexVersion) return null;
      state.index = status; return status;
    },
    invalidateIndex(): void { indexVersion++; },
    async loadLogs(conversationId = '', messageId = '', offset = 0, search = ''): Promise<boolean> {
      const version = ++logsVersion; state.logFilter = { conversationId, messageId };
      const query = new URLSearchParams({ view: 'events', limit: '50', offset: String(offset), search }); if (conversationId) query.set('conversationId', conversationId); if (messageId) query.set('messageId', messageId);
      const data = await json<{ logs?: LogWire[] | null; total?: number; conversations?: { id: string; title: string }[]; history_error?: string }>(`/api/knowledge/retrieval-logs?${query}`, undefined, 'Failed to load retrieval logs').catch(error => { if (disposed || version !== logsVersion) return null; throw error; });
      if (!data || disposed || version !== logsVersion) return false;
      state.logs = (data.logs ?? []).map(normalizeLog); state.logOffset = offset; state.logTotal = data.total ?? state.logs.length; state.logSearch = search; state.conversations = data.conversations ?? []; state.historyError = data.history_error; return true;
    },
    clearLogs(): void { state.logs = []; },
    async removeLog(id: string): Promise<void> { await json(`/api/knowledge/retrieval-logs/${encodeURIComponent(id)}`, write('DELETE'), 'Failed to delete the retrieval log'); },
    async logDetails(index: number): Promise<{ log: RetrievalLog; items: KnowledgeItem[]; unavailable: number }> {
      const log = state.logs[index]; if (!log) throw new KnowledgeError('retrievalLogs.detailError');
      const items = await Promise.all(log.retrievedItems.filter(id => id !== '_has_results').map(id => api.detail(id).catch(() => null)));
      return { log, items: items.filter((item): item is KnowledgeItem => item !== null), unavailable: items.filter(item => item === null).length };
    },
    dispose(): void { disposed = true; listVersion++; categoriesVersion++; editVersion++; logsVersion++; indexVersion++; },
  };
  return api;
}
export type KnowledgeService = ReturnType<typeof createKnowledgeService>;
