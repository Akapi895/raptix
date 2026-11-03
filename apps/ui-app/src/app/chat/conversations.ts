import { createConversationList } from '@/features/chat/conversations/list';
import { createConversationRow, type RowConversation } from '@/features/chat/conversations/row';
import { createSidebarController } from '@/features/chat/conversations/sidebar';
import { createContextMenu } from '@/features/chat/conversations/context';
import { normalizeSortBy } from '@/features/chat/conversations/pagination';
import { createConversationProjectFilter } from '@/features/chat/project-filter/controller';
import { createCustomSelects } from '@/features/chat/project-filter/select';
import { createBatchManager, BATCH_SELECT_ID } from '@/features/chat/batch/controller';
import { projectIdOf } from '@/features/chat/batch/manage';
import { applyTranslations } from '@/i18n';
import { openAppModal, closeAppModal, isAppModalOpen } from '@/ui/modal';
import { storage } from '@/platform/storage';
import { browser } from '@/platform/browser';
import type { ChatState } from './state';
import { t, type ChatResources } from './runtime';

type FilterPorts = Parameters<typeof createConversationProjectFilter>[0];
export interface ConversationsDependencies {
  request(path: string, init?: RequestInit): Promise<Response>;
  locale(): string;
  allow(permission: string): boolean;
  projects: Pick<FilterPorts, 'projectNames' | 'ensureProjectsLoaded' | 'isProjectsCacheReady' | 'filterActiveProjects' | 'fetchProjectSummary'>;
  initPaginationSelects(root: HTMLElement): void;
  isRunning(id: string): boolean;
  refreshProjectFolders(): Promise<void>;
  updateActiveTaskTitle(id: string, title: string): void;
  deleteConversation(id: string, skipConfirm: boolean): Promise<void>;
  loadConversation(id: string): void;
  showAttackChain(id: string): void;
  updateActiveConversation(): void;
}
export function createChatConversations(doc: Document, state: ChatState, resources: ChatResources, deps: ConversationsDependencies) {
  const byId = (id: string) => doc.getElementById(id);
  const existingRenameModal = byId('conversation-rename-modal');
  const selects = createCustomSelects({
    doc, t, setTimer: resources.later, clearTimer: resources.clearTimer, scheduleFrame: resources.frame,
    loadOptions: id => { void filter.loadOptions(id); }, triggerClass: 'conversation-project-filter-trigger',
    caret: '<svg class="conversation-project-filter-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  });
  const filter = createConversationProjectFilter({
    doc, t, storage, ...deps.projects, selects,
    reloadList() { list.commitPage(1, true); void list.load(list.search()); },
  });
  const context = createContextMenu({
    doc, t, apiFetch: deps.request, locale: deps.locale, alert: browser.alert, confirm: browser.confirm, requirePermission: deps.allow,
    openModal: (id, options) => { openAppModal(id, options as never); }, closeModal: closeAppModal, applyTranslations,
    setTimer: resources.later, clearTimer: handle => resources.clearTimer(handle as number), viewport: () => ({ x: 0, y: 0, ...browser.viewport() }),
    isRunning: deps.isRunning, reloadList: () => list.load(''), refreshProjectFolders: deps.refreshProjectFolders,
    updateActiveTaskTitle: deps.updateActiveTaskTitle, deleteConversation: deps.deleteConversation, showAttackChain: deps.showAttackChain,
    async isPinned(id) { const response = await deps.request(`/api/conversations/${id}`); if (!response.ok) return false; return !!((await response.json()) as { pinned?: boolean }).pinned; },
    notifyPinChanged: (id, pinned) => { doc.dispatchEvent(new CustomEvent('conversation-pinned-changed', { detail: { conversationId: id, pinned } })); },
    download(blob, fileName) {
      const url = URL.createObjectURL(blob); const link = doc.createElement('a');
      link.href = url; link.download = fileName; doc.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    },
    navigateHash: hash => { browser.location.hash = hash; },
    async fetchConversation(id) {
      const response = await deps.request(`/api/conversations/${id}?include_process_details=1`);
      const body = await response.json().catch(() => null) as (import('@/features/chat/conversations/markdown').ExportConversation & { error?: string }) | null;
      if (!response.ok) throw new Error(body?.error || 'unknown error'); return body ?? {};
    },
  });
  const sidebar = createSidebarController({ doc, t, storage, applyTranslations, toggleRecent: () => sidebar.toggleRecent() });
  const createRow = (conversation: RowConversation, pinned: boolean) => createConversationRow(conversation, pinned, {
    doc, activeId: state.conversationId, timeText: item => list.timeText(item.updatedAt ? new Date(item.updatedAt) : new Date()),
    openConversation: id => { closePicker(true); deps.loadConversation(id); }, openMenu: context.open,
  });
  const closeSortMenu = () => { const menu = byId('conversation-sort-menu'); if (menu) menu.hidden = true; byId('conversation-sort-btn')?.setAttribute('aria-expanded', 'false'); };
  const list = createConversationList({
    doc, t, storage, apiFetch: deps.request, locale: deps.locale, projectFilter: filter.get,
    emptyHtml: id => `<div class="conversations-list-empty" data-i18n="${id === '__none__' ? 'chat.noUnboundConversations' : id ? 'chat.noProjectConversations' : 'chat.noHistoryConversations'}"></div>`,
    createItem: createRow, updateSidebarFilterUi: filter.updateSidebarTitle, updateActiveConversation: deps.updateActiveConversation,
    updateRecentCount: sidebar.updateRecentCount, initPaginationSelects: deps.initPaginationSelects, applyTranslations,
    listContainer: () => byId('conversations-list'), sidebarContent: element => element.closest<HTMLElement>('.sidebar-content'),
    scheduleFrame: resources.frame, setSortMenuOpen: open => { if (!open) closeSortMenu(); },
    paginationElement: () => byId('conversations-pagination'), recentExpanded: () => byId('recent-conversations-toggle')?.getAttribute('aria-expanded') === 'true',
    now: () => new Date(), logError: console.error,
  });
  const batch = createBatchManager({
    doc, t, locale: deps.locale, projectNames: deps.projects.projectNames, fetchAllConversations: list.fetchAll,
    async prefetchProjectNames(items) {
      const missing = new Set(items.map(projectIdOf).filter(id => id && !deps.projects.projectNames()[id]));
      await Promise.all([...missing].map(id => deps.projects.fetchProjectSummary(id).catch(() => null)));
    },
    initProjectSelect: selects.initProject, refreshProjectSelect: filter.refreshSelect, sidebarProjectFilter: filter.get,
    closeProjectSelects: selects.closeAll, isModalOpen: isAppModalOpen,
    openModal: (id, options) => { openAppModal(id, options as never); }, closeModal: closeAppModal,
    requirePermission: deps.allow, confirm: browser.confirm, alert: browser.alert, deleteConversation: deps.deleteConversation, logError: console.error,
  });
  let searchTimer: number | null = null;
  const picker = () => byId('chat-conversation-picker') as HTMLDetailsElement | null;
  function closePicker(restoreFocus = false) {
    const element = picker();
    if (!element?.open) return;
    element.open = false;
    if (restoreFocus) element.querySelector('summary')?.focus();
  }
  function search(query: string) {
    list.commitPage(1, true); list.setSearch(query || ''); if (searchTimer) resources.clearTimer(searchTimer);
    const clear = byId('conversation-search-clear'); if (clear) clear.style.display = query.trim() ? 'block' : 'none';
    searchTimer = resources.later(() => { void list.load(query); }, 300);
  }
  const updateSortMenu = () => {
    const menu = byId('conversation-sort-menu');
    menu?.querySelectorAll<HTMLElement>('.conversation-sort-option').forEach(option => {
      const selected = option.dataset.sort === list.sortBy(); option.classList.toggle('is-selected', selected); option.setAttribute('aria-checked', String(selected));
    });
    byId('conversation-sort-btn')?.setAttribute('aria-expanded', String(!menu?.hidden));
  };
  return {
    list, context, sidebar, filter, selects, batch, createRow, closeSortMenu, updateSortMenu,
    search,
    clearSearch() {
      const input = (byId('chat-conversation-search') || byId('conversation-search-input')) as HTMLInputElement | null; if (input) input.value = '';
      const clear = byId('conversation-search-clear'); if (clear) clear.style.display = 'none';
      list.commitPage(1, true); list.setSearch(''); void list.load('');
    },
    toggleSortMenu(event?: Event) {
      event?.preventDefault(); event?.stopPropagation(); const menu = byId('conversation-sort-menu'); if (!menu) return;
      const open = menu.hidden; closeSortMenu(); if (open) { menu.hidden = false; updateSortMenu(); }
    },
    setSort(raw: unknown) { if (normalizeSortBy(raw) !== list.sortBy()) list.setSortBy(raw); updateSortMenu(); closeSortMenu(); },
    refreshBatchFilter: () => filter.refreshSelect(BATCH_SELECT_ID),
    start() {
      sidebar.ensureStructure(); sidebar.restoreRecentState(); updateSortMenu(); filter.initSelect();
      const searchInput = byId('chat-conversation-search') as HTMLInputElement | null;
      if (searchInput) resources.on(searchInput, 'input', () => search(searchInput.value));
      const clear = byId('conversation-search-clear');
      if (clear && searchInput) resources.on(clear, 'click', () => { searchInput.value = ''; search(''); searchInput.focus(); });
      const taskPicker = picker();
      if (taskPicker) {
        resources.on(taskPicker, 'toggle', () => { if (taskPicker.open) { searchInput?.focus(); void list.load(list.search()); } });
        resources.on(doc, 'click', event => { if (!taskPicker.contains(event.target as Node)) closePicker(); });
        resources.on(doc, 'keydown', event => { if ((event as KeyboardEvent).key === 'Escape') closePicker(true); });
        resources.on(doc, 'focusin', event => { if (!taskPicker.contains(event.target as Node)) closePicker(); });
      }
      resources.on(doc, 'click', event => { if (!byId('conversation-sort-dropdown')?.contains(event.target as Node | null)) closeSortMenu(); });
      resources.on(doc, 'keydown', event => { if ((event as KeyboardEvent).key === 'Escape') closeSortMenu(); });
      const pagination = byId('conversations-pagination');
      if (pagination) {
        resources.on(pagination, 'click', event => {
          const el = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-conv-page]');
          if (!el || (el as HTMLButtonElement).disabled) return; event.preventDefault();
          const page = parseInt(el.dataset.convPage || '', 10); if (Number.isFinite(page)) list.goToPage(page);
        });
        resources.on(pagination, 'change', event => {
          const el = event.target as HTMLSelectElement | null;
          if (!list.isRenderingPagination() && el?.id === 'conversations-page-size-pagination') list.setPageSize(el.value);
        });
      }
    },
    dispose() {
      context.close(); context.closeRename(); selects.dispose();
      if (!existingRenameModal) byId('conversation-rename-modal')?.remove();
    },
  };
}
export type ChatConversations = ReturnType<typeof createChatConversations>;
