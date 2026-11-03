// The conversation list of the sidebar: it loads one page at a time, keeps the page, the sort and the page size, drops
// responses that were overtaken, and draws the pinned conversations first, then the groups by day.

import { escapeHtml } from '../../../ui/format';
import {
  clampPage, dayBoundaries, groupConversations, isStaleLoad, normalizePageSize, normalizeSortBy, parseListResponse, reconcileTotal, sortTime,
  totalPagesOf, uniqueById, validDate, type ConversationLike, type LoadCounters, type ParsedList, type SortBy,
} from './pagination';

export const SORT_STORAGE_KEY = 'raptix.conversations_sort_by';
export const PAGE_SIZE_STORAGE_KEY = 'raptix.conversations_page_size';

export interface Translator {
  (key: string, fallback: string, values?: Record<string, unknown>): string;
}

export interface ListDependencies {
  doc: Document;
  t: Translator;
  storage: { get(key: string): string | null; set(key: string, value: string): boolean };
  apiFetch(path: string, init?: RequestInit): Promise<Response>;
  locale(): string;
  /** The project the list is narrowed to; empty for all, and a sentinel for the unbound conversations. */
  projectFilter(): string;
  /** The empty-state markup for the active filter. */
  emptyHtml(filter: string): string;
  /** Draws one row: pinned or not, with the time text it shows. */
  createItem(conversation: ConversationLike & { _timeText: string }, pinned: boolean): HTMLElement;
  updateSidebarFilterUi(): void;
  updateActiveConversation(): void;
  updateRecentCount(total: number): void;
  initPaginationSelects(root: HTMLElement): void;
  applyTranslations(root: HTMLElement): void;
  listContainer(): HTMLElement | null;
  /** The scrolling box of the sidebar, when the page has one. */
  sidebarContent(list: HTMLElement): HTMLElement | null;
  scheduleFrame(callback: () => void): void;
  setSortMenuOpen(open: boolean): void;
  paginationElement(): HTMLElement | null;
  recentExpanded(): boolean;
  now(): Date;
  logError(message: string, error: unknown): void;
}

export interface LoadOptions {
  refreshMeta?: boolean;
  scrollToTop?: boolean;
  intentPage?: number | null;
}

export interface ConversationListController {
  sortBy(): SortBy;
  setSortBy(sortBy: unknown): void;
  pageSize(): number;
  page(): number;
  total(): number;
  search(): string;
  setSearch(query: string): void;
  setPageSize(size: unknown): void;
  goToPage(page: unknown): void;
  load(search?: string, options?: LoadOptions): Promise<void>;
  /** The conversations of every page, for the callers that need the whole list. */
  fetchAll(search?: string): Promise<ConversationLike[]>;
  renderPagination(visibleCount?: number): void;
  /** The time text of a conversation, as the list shows it. */
  timeText(date: Date, todayStart?: Date, yesterdayStart?: Date): string;
  /** The page is moved back into range when the conversations shrink. */
  clampToTotal(): boolean;
  /** Sets the page the list shows, without loading. */
  commitPage(page: number, bumpNavigateGen?: boolean): number;
  /** True while the pagination is being redrawn; its change events from the redraw are ignored. */
  isRenderingPagination(): boolean;
}

export function createConversationList(deps: ListDependencies): ConversationListController {
  const { doc, t, storage } = deps;
  let sort: SortBy = normalizeSortBy(storage.get(SORT_STORAGE_KEY));
  let pageSize = normalizePageSize(storage.get(PAGE_SIZE_STORAGE_KEY));
  let page = 1;
  let total = 0;
  let searchQuery = '';
  let visibleCount = 0;
  let paginationRenderLock = false;
  const counters: LoadCounters = { loadSeq: 0, navigateGen: 0 };

  function commitPage(next: number, bumpNavigateGen = false): number {
    const value = Math.max(1, Math.floor(next) || 1);
    if (bumpNavigateGen) counters.navigateGen += 1;
    page = value;
    return value;
  }

  function timeText(date: Date, todayStart?: Date, yesterdayStart?: Date): string {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const now = deps.now();
    const referenceToday = todayStart ?? new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const referenceYesterday = yesterdayStart ?? new Date(referenceToday.getTime() - 24 * 60 * 60 * 1000);
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const locale = deps.locale();
    const hour12 = locale === 'ru-RU' ? false : undefined;
    const timeOnly: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12 };
    const dateTime: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12 };
    const fullDate: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12 };
    if (day.getTime() === referenceToday.getTime()) return date.toLocaleTimeString(locale, timeOnly);
    if (day.getTime() === referenceYesterday.getTime()) {
      return t('chat.yesterday', 'Yesterday') + ' ' + date.toLocaleTimeString(locale, timeOnly);
    }
    if (date.getFullYear() === referenceToday.getFullYear()) return date.toLocaleString(locale, dateTime);
    return date.toLocaleString(locale, fullDate);
  }

  function renderPagination(count?: number): void {
    if (typeof count === 'number') visibleCount = count;
    const el = deps.paginationElement();
    if (!el) return;
    if (!total || totalPagesOf(total, pageSize) <= 1) {
      el.innerHTML = '';
      el.hidden = true;
      deps.initPaginationSelects(el);
      return;
    }
    const pages = totalPagesOf(total, pageSize);
    const navDisabled = pages <= 1;
    el.hidden = !deps.recentExpanded();
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    const info = t('chat.paginationRange', `${start}-${end}/${total}`, { start, end, total });
    const pageText = t('chat.paginationPage', `${page}/${pages}`, { page, total: pages });
    const perPage = t('chat.paginationPerPage', 'Per page');
    const prev = t('chat.paginationPrev', 'Prev');
    const next = t('chat.paginationNext', 'Next');
    paginationRenderLock = true;
    try {
      el.innerHTML = `
        <div class="sidebar-list-pagination-inner sidebar-list-pagination-inner--compact">
            <span class="pagination-info">${escapeHtml(info)}</span>
            <div class="pagination-controls">
                <button type="button" class="btn-icon-pagination" data-conv-page="${page - 1}" ${page <= 1 || navDisabled ? 'disabled' : ''} title="${escapeHtml(prev)}" aria-label="${escapeHtml(prev)}">‹</button>
                <span class="pagination-page">${escapeHtml(pageText)}</span>
                <button type="button" class="btn-icon-pagination" data-conv-page="${page + 1}" ${page >= pages || navDisabled ? 'disabled' : ''} title="${escapeHtml(next)}" aria-label="${escapeHtml(next)}">›</button>
            </div>
            <label class="pagination-page-size">
                ${escapeHtml(perPage)}
                <select id="conversations-page-size-pagination">
                    <option value="20" ${pageSize === 20 ? 'selected' : ''}>20</option>
                    <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
                    <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
                </select>
            </label>
        </div>`;
      deps.initPaginationSelects(el);
    } finally {
      paginationRenderLock = false;
    }
  }

  /** The total of the list: the server's, or one probe past the page when the server does not report it. */
  async function resolveTotal(params: URLSearchParams, parsed: ParsedList, offset: number): Promise<number> {
    const serverTotal = parsed.total;
    if (!parsed.isLegacyArray && Number.isFinite(serverTotal) && serverTotal >= 0) return serverTotal;
    if (!parsed.isLegacyArray && serverTotal > offset + parsed.items.length) return serverTotal;
    if (parsed.items.length < pageSize) return Math.max(serverTotal, offset + parsed.items.length);
    const probe = new URLSearchParams(params);
    probe.set('offset', String(offset + pageSize));
    probe.set('limit', '1');
    try {
      const response = await deps.apiFetch(`/api/conversations?${probe}`);
      if (!response.ok) return Math.max(serverTotal, offset + parsed.items.length);
      const probed = parseListResponse(await response.json());
      if (probed.total > serverTotal) return probed.total;
      if (probed.items.length > 0) return Math.max(serverTotal, offset + pageSize + 1);
    } catch { /* the page's own total stands */ }
    return Math.max(serverTotal, offset + parsed.items.length);
  }

  async function fetchAll(search = ''): Promise<ConversationLike[]> {
    const all: ConversationLike[] = [];
    const size = 200;
    let offset = 0;
    let known = Infinity;
    const term = search.trim();
    while (all.length < known) {
      const params = new URLSearchParams({ limit: String(size), offset: String(offset) });
      if (term) params.set('search', term);
      const response = await deps.apiFetch(`/api/conversations?${params}`);
      if (!response.ok) throw new Error('load conversations failed');
      const parsed = parseListResponse(await response.json());
      all.push(...parsed.items);
      known = parsed.total;
      if (!parsed.items.length) break;
      offset += parsed.items.length;
    }
    return all;
  }

  function emptyFor(): string {
    return deps.emptyHtml(deps.projectFilter());
  }

  function showEmpty(list: HTMLElement, count: number): void {
    list.innerHTML = emptyFor();
    deps.applyTranslations(list);
    deps.updateRecentCount(0);
    renderPagination(count);
  }

  async function load(search = '', options: LoadOptions = {}): Promise<void> {
    const scrollToTop = options.scrollToTop === true;
    const intentPage = Number.isFinite(options.intentPage) ? (options.intentPage as number) : null;
    const navAtStart = counters.navigateGen;
    const seq = ++counters.loadSeq;
    const isStale = (active: number) => isStaleLoad({ loadSeq: seq, intentPage, navigateGenAtStart: navAtStart, activePage: active }, counters, page);
    try {
      searchQuery = search || '';
      const active = intentPage != null ? intentPage : page;
      const offset = (active - 1) * pageSize;
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
      if (sort === 'created_at') params.set('sort_by', 'created_at');
      const projectFilter = deps.projectFilter();
      if (projectFilter) params.set('project_id', projectFilter);
      if (search && search.trim()) params.set('search', search.trim());
      deps.updateSidebarFilterUi();
      const response = await deps.apiFetch(`/api/conversations?${params}`);
      if (isStale(active)) return;

      const list = deps.listContainer();
      if (!list) return;
      const sidebar = deps.sidebarContent(list);
      const savedScrollTop = sidebar ? sidebar.scrollTop : 0;
      const emptyHtml = emptyFor();
      list.innerHTML = '';

      if (!response.ok) {
        list.innerHTML = emptyHtml;
        deps.applyTranslations(list);
        deps.updateRecentCount(0);
        renderPagination(0);
        return;
      }

      const parsed = parseListResponse(await response.json());
      if (isStale(active)) return;
      const resolved = await resolveTotal(params, parsed, offset);
      if (isStale(active)) return;
      total = resolved;
      deps.updateRecentCount(resolved);

      const check = reconcileTotal(active, intentPage != null, parsed, pageSize, offset, resolved, total);
      total = check.total;
      if (check.clampedPage != null) {
        if (isStale(active)) return;
        if (intentPage != null) commitPage(check.clampedPage, true);
        else commitPage(check.clampedPage);
        void load(search, { ...options, intentPage: check.clampedPage, scrollToTop: options.scrollToTop === true || active !== check.clampedPage });
        return;
      }
      if (intentPage == null) {
        const clamped = clampPage(page, total, pageSize);
        if (clamped != null || page < 1) {
          commitPage(clamped ?? 1);
          if (isStale(active)) return;
          void load(search, options);
          return;
        }
      }

      const unique = uniqueById(parsed.items);
      if (unique.length === 0) {
        list.innerHTML = emptyHtml;
        deps.applyTranslations(list);
        renderPagination(0);
        return;
      }

      const groups = groupConversations(unique, sort);
      const bounds = dayBoundaries(deps.now());
      const fragment = doc.createDocumentFragment();
      groups.pinned.forEach(item => {
        fragment.appendChild(deps.createItem({ ...item, _timeText: timeText(validDate(sortTime(item, sort)), bounds.todayStart, bounds.yesterdayStart) }, true));
      });
      const labelled: [keyof typeof groups, string][] = [
        ['today', t('chat.historyGroupToday', 'Today')],
        ['yesterday', t('chat.yesterday', 'Yesterday')],
        ['last7Days', t('chat.historyGroupLast7Days', 'Past 7 days')],
        ['earlier', t('chat.historyGroupEarlier', 'Older')],
      ];
      labelled.forEach(([key, label]) => {
        const items = groups[key];
        if (!items.length) return;
        const section = doc.createElement('div');
        section.className = 'conversation-group';
        const title = doc.createElement('div');
        title.className = 'conversation-group-title';
        title.textContent = label;
        section.appendChild(title);
        items.forEach(item => {
          const moment = validDate(sortTime(item, sort));
          section.appendChild(deps.createItem({ ...item, _timeText: timeText(moment, bounds.todayStart, bounds.yesterdayStart) }, false));
        });
        fragment.appendChild(section);
      });
      visibleCount = unique.length;

      if (fragment.children.length === 0) {
        list.innerHTML = emptyHtml;
        deps.applyTranslations(list);
        renderPagination(0);
        return;
      }
      if (isStale(active)) return;
      list.appendChild(fragment);
      deps.updateActiveConversation();
      renderPagination(visibleCount);
      if (sidebar) {
        deps.scheduleFrame(() => {
          if (!isStale(active)) sidebar.scrollTop = scrollToTop ? 0 : savedScrollTop;
        });
      }
    } catch (error) {
      if (isStale(intentPage ?? page)) return;
      deps.logError('Failed to load conversation list:', error);
      const list = deps.listContainer();
      if (list) showEmpty(list, 0);
    }
  }

  function setSortBy(raw: unknown): void {
    const next = normalizeSortBy(raw);
    if (next === sort) {
      deps.setSortMenuOpen(false);
      return;
    }
    sort = next;
    storage.set(SORT_STORAGE_KEY, next);
    deps.setSortMenuOpen(false);
    commitPage(1, true);
    void load(searchQuery);
  }

  function setPageSize(raw: unknown): void {
    const size = normalizePageSize(raw);
    if (size === pageSize) return;
    storage.set(PAGE_SIZE_STORAGE_KEY, String(size));
    pageSize = size;
    commitPage(1, true);
    void load(searchQuery);
  }

  function goToPage(raw: unknown): void {
    const requested = Math.max(1, parseInt(String(raw), 10) || 1);
    const scrollToTop = requested !== page;
    commitPage(requested, true);
    void load(searchQuery, { refreshMeta: false, scrollToTop, intentPage: requested });
  }

  return {
    sortBy: () => sort,
    setSortBy,
    pageSize: () => pageSize,
    page: () => page,
    total: () => total,
    search: () => searchQuery,
    setSearch: query => { searchQuery = query || ''; },
    setPageSize,
    goToPage,
    load,
    fetchAll,
    renderPagination,
    timeText,
    clampToTotal() {
      const pages = totalPagesOf(total, pageSize);
      if (page > pages) {
        commitPage(pages);
        return true;
      }
      if (page < 1) {
        commitPage(1);
        return true;
      }
      return false;
    },
    commitPage,
    isRenderingPagination: () => paginationRenderLock,
  };
}
