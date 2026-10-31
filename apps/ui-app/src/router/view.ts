import { storage } from '@/platform/storage';
import type { Navigation, PageId, Route, Router } from './service';
import { bindRouterActions } from './actions';

export interface RouterDependencies {
  ready(): Promise<unknown>;
  initPage(route: Route, sectionHandled: boolean): void;
  invalidatePage(): void;
  applyPermissions(root: HTMLElement): void;
  permissionAllowed(element: HTMLElement): boolean;
  abandonConversation(): void;
  loadConversation(id: string): unknown;
  setActiveProject(id: string): void;
  refreshChatProjectSelector(): void;
  switchSettingsSection(section: string): void;
  syncC2Nav(): unknown;
  onNavigation(page: PageId): void;
  onError(error: unknown): void;
}
export function createRouterView(router: Router, deps: RouterDependencies, root: Document = document) {
  let restoreSequence = 0;
  let restoreTimer: ReturnType<typeof setTimeout> | undefined;
  let pageSequence = 0;
  let popupCleanup: (() => void) | undefined;
  let stopActions: (() => void) | undefined;
  let started = false;
  function safely(callback: () => unknown): void {
    try { void Promise.resolve(callback()).catch(deps.onError); } catch (error) { deps.onError(error); }
  }
  function setChatConversationRestorePending(id: string, pending: boolean): void {
    const container = root.querySelector<HTMLElement>('.chat-container');
    if (!container) return;
    id = id.trim();
    container.classList.toggle('is-conversation-restoring', pending && !!id);
    if (pending && id) { container.dataset.restoringConversationId = id; container.setAttribute('aria-busy', 'true'); }
    else { delete container.dataset.restoringConversationId; container.removeAttribute('aria-busy'); }
  }
  function cancelScheduledChatConversationFromHash(): void {
    restoreSequence++; clearTimeout(restoreTimer); setChatConversationRestorePending('', false);
  }
  function scheduleChatConversationFromHash(delay = 0): void {
    const route = router.current();
    if (route?.page !== 'chat') return;
    const id = route.query.get('conversation');
    const project = route.query.get('project');
    cancelScheduledChatConversationFromHash();
    if (project) { deps.setActiveProject(project); deps.refreshChatProjectSelector(); }
    if (!id) return;
    setChatConversationRestorePending(id, true);
    const sequence = restoreSequence;
    restoreTimer = setTimeout(() => {
      if (sequence !== restoreSequence || router.page() !== 'chat') return;
      safely(() => Promise.resolve(deps.loadConversation(id)).finally(() => {
        if (sequence === restoreSequence) setChatConversationRestorePending('', false);
      }));
    }, delay);
  }
  function initConversationSidebarState(): void {
    root.getElementById('conversation-sidebar')?.classList.toggle('collapsed', storage.get('conversationSidebarCollapsed') === 'true');
  }
  function initSidebarState(): void {
    root.getElementById('main-sidebar')?.classList.toggle('collapsed', storage.get('sidebarCollapsed') === 'true');
    initConversationSidebarState();
  }
  function updateNavState(page: PageId): void {
    root.querySelectorAll('.nav-item').forEach(element => element.classList.remove('active', 'expanded'));
    root.querySelectorAll('.nav-submenu-item').forEach(element => element.classList.remove('active'));
    const groups: Partial<Record<PageId, string>> = { hitl: 'security', 'tool-guard': 'security', 'asset-overview': 'assets', 'asset-library': 'assets', 'info-collect': 'assets', 'mcp-monitor': 'mcp', 'mcp-management': 'mcp', 'knowledge-management': 'knowledge', 'knowledge-retrieval-logs': 'knowledge', 'skills-monitor': 'skills', 'skills-management': 'skills' };
    const group = page.startsWith('c2-') ? 'c2' : groups[page];
    const item = root.querySelector(`.nav-item[data-page="${group || page}"]`);
    item?.classList.add('active');
    if (group && item?.querySelector('.nav-submenu')) item.classList.add('expanded');
    if (group) root.querySelector(`.nav-submenu-item[data-page="${page}"]`)?.classList.add('active');
    root.querySelectorAll<HTMLElement>('#m-tabbar .m-tab').forEach(tab => {
      const active = tab.dataset.tab === page;
      tab.classList.toggle('m-active', active);
      if (active) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
    });
  }
  function applyNavigation(event: Navigation): void {
    const target = root.getElementById('page-' + event.route.page);
    if (!target) return;
    if (event.route.page !== 'chat') {
      cancelScheduledChatConversationFromHash();
      if (event.previous?.page === 'chat') deps.abandonConversation();
    }
    const activate = event.pageChanged || !target.classList.contains('active');
    const section = event.route.page === 'settings' && event.restore ? event.route.query.get('section') : null;
    const sectionHandled = !!section && !!root.getElementById('settings-section-' + section);
    if (activate) {
      popupCleanup?.();
      deps.invalidatePage();
      safely(deps.syncC2Nav);
      root.querySelectorAll('.page').forEach(element => element.classList.remove('active'));
      target.classList.add('active');
      if (event.route.page === 'chat') initConversationSidebarState();
      const sequence = ++pageSequence;
      safely(async () => {
        await deps.ready();
        if (sequence === pageSequence) deps.initPage(event.route, sectionHandled);
      });
      deps.applyPermissions(target);
    }
    updateNavState(event.route.page);
    if (sectionHandled) deps.switchSettingsSection(section!);
    if (event.route.page === 'chat' && event.restore && (activate || event.previous?.query.get('conversation') !== event.route.query.get('conversation') || event.previous?.query.get('project') !== event.route.query.get('project'))) scheduleChatConversationFromHash();
    deps.onNavigation(event.route.page);
    root.documentElement.classList.remove('initial-route-pending');
  }
  const unsubscribe = router.subscribe(applyNavigation);
  function toggleStoredSidebar(id: string, key: string): void {
    const sidebar = root.getElementById(id);
    if (sidebar) storage.set(key, String(sidebar.classList.toggle('collapsed')));
  }
  function showSubmenuPopup(item: HTMLElement, menu: string): void {
    const same = root.querySelector<HTMLElement>('.submenu-popup')?.dataset.menuId === menu;
    popupCleanup?.();
    if (same) return;
    const submenu = item.querySelector('.nav-submenu');
    if (!submenu) return;
    const popup = root.createElement('div'); popup.className = 'submenu-popup'; popup.dataset.menuId = menu;
    const rect = (item.querySelector('.nav-item-content') ?? item).getBoundingClientRect();
    Object.assign(popup.style, { position: 'fixed', left: rect.right + 8 + 'px', top: rect.top + 'px', zIndex: '1000' });
    submenu.querySelectorAll<HTMLElement>('.nav-submenu-item').forEach(child => {
      if (child.hidden || !deps.permissionAllowed(child)) return;
      const button = root.createElement('div'); button.className = 'submenu-popup-item'; button.textContent = child.textContent?.trim() ?? '';
      button.classList.toggle('active', child.classList.contains('active'));
      button.addEventListener('click', event => {
        event.stopPropagation(); event.preventDefault();
        if (child.dataset.page) router.go(child.dataset.page);
        popupCleanup?.();
      });
      popup.append(button);
    });
    const close = (event: Event) => { if (event.target instanceof Node && !popup.contains(event.target) && !item.contains(event.target)) popupCleanup?.(); };
    const timer = setTimeout(() => { if (popup.isConnected) root.addEventListener('click', close); }, 0);
    popupCleanup = () => { clearTimeout(timer); popup.remove(); root.removeEventListener('click', close); popupCleanup = undefined; };
    root.body.append(popup);
  }
  function toggleSubmenu(menu: string): void {
    const item = [...root.querySelectorAll<HTMLElement>('.nav-item[data-page]')].find(element => element.dataset.page === menu);
    if (!item) return;
    if (root.getElementById('main-sidebar')?.classList.contains('collapsed')) { showSubmenuPopup(item, menu); return; }
    if (item.classList.toggle('expanded')) requestAnimationFrame(() => {
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const items = item.querySelector('.nav-submenu')?.querySelectorAll('.nav-submenu-item');
      items?.[items.length - 1]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }
  const view = {
    start(): void {
      if (started) return; started = true;
      stopActions = bindRouterActions(root, { navigate: page => router.go(page), toggleSubmenu, toggleSidebar: view.toggleSidebar, toggleConversationSidebar: view.toggleConversationSidebar });
      router.start(); initSidebarState();
      root.documentElement.classList.remove('initial-route-pending');
    },
    toggleSubmenu, showSubmenuPopup, updateNavState, initSidebarState, initConversationSidebarState,
    toggleSidebar: () => toggleStoredSidebar('main-sidebar', 'sidebarCollapsed'),
    toggleConversationSidebar: () => toggleStoredSidebar('conversation-sidebar', 'conversationSidebarCollapsed'),
    setChatConversationRestorePending, scheduleChatConversationFromHash, cancelScheduledChatConversationFromHash,
    finishChatConversationRestore(id: string): void {
      const pending = root.querySelector<HTMLElement>('.chat-container')?.dataset.restoringConversationId;
      if (!pending || pending === id.trim()) setChatConversationRestorePending('', false);
    },
    navigateToConversation(value: string): unknown {
      const id = value.trim(); if (!id) return;
      cancelScheduledChatConversationFromHash();
      router.navigate('chat?conversation=' + encodeURIComponent(id), false);
      if (router.page() !== 'chat') return;
      return deps.loadConversation(id);
    },
    dispose(): void { pageSequence++; deps.invalidatePage(); unsubscribe(); stopActions?.(); popupCleanup?.(); cancelScheduledChatConversationFromHash(); started = false; },
  };
  return view;
}
