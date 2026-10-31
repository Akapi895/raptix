import { icons } from './icons';
import type { MobileLifecycle } from './lifecycle';
import type { TranslateOptions } from './types';

const tabs = [
  { id: 'dashboard', label: 'Dashboard', key: 'nav.dashboard', icon: 'dashboard' },
  { id: 'chat', label: 'Chats', key: 'nav.chat', icon: 'chat' },
  { id: 'hitl', label: 'Approvals', key: 'nav.hitl', icon: 'hitl' },
  { id: 'tasks', label: 'Tasks', key: 'nav.tasks', icon: 'tasks' },
] as const;
export type MobileAction = 'toggle-nav' | 'close-nav' | 'toggle-sheet' | 'close-sheet' | 'close-chat' | 'toggle-chat' | 'new-chat' | 'scrim' |
  'api-docs' | 'github' | 'theme' | 'language' | 'top' | 'reload' | 'fullscreen';

/** DOM construction only. Actions are explicit data attributes; no inline code. */
export function createMobileView(doc: Document, life: MobileLifecycle, translate: (key: string, options?: TranslateOptions) => string) {
  const query = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = doc) => root.querySelector<T>(selector);
  const all = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = doc) => Array.from(root.querySelectorAll<T>(selector));
  function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html?: string): HTMLElementTagNameMap[K] {
    const node = doc.createElement(tag); node.className = cls;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }
  function text(key: string, fallback: string, options?: TranslateOptions) {
    const translated = translate(key, options);
    if (translated && translated !== key) return translated;
    return fallback.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match: string, name: string) => options && Object.hasOwn(options, name) ? String(options[name]) : '');
  }
  function label(node: HTMLElement, key: string, fallback: string) {
    node.setAttribute('data-i18n', key); node.textContent = text(key, fallback); return node;
  }
  function attr(node: HTMLElement, attribute: string, key: string, fallback: string) {
    const list = (node.getAttribute('data-i18n-attr') ?? '').split(',').map(value => value.trim()).filter(value => value && value !== attribute);
    list.push(attribute); node.setAttribute('data-i18n', key); node.setAttribute('data-i18n-attr', list.join(','));
    node.setAttribute(attribute, text(key, fallback));
  }
  function aria(node: HTMLElement, key: string, fallback: string) {
    node.setAttribute('data-i18n-skip-text', 'true'); attr(node, 'aria-label', key, fallback);
  }
  function button(cls: string, icon: keyof typeof icons, action: MobileAction) {
    const node = element('button', cls, icons[icon]); node.type = 'button'; node.dataset.mobileAction = action; return node;
  }
  function closeButton(cls: string, action: MobileAction, key: string, fallback: string) {
    const node = button(cls, 'close', action); aria(node, key, fallback); return node;
  }
  function injectHeader() {
    const content = query('header .header-content'); if (!content) return;
    if (!query('.m-menu-btn', content)) {
      const node = life.node(button('m-menu-btn m-mobile-only', 'menu', 'toggle-nav'));
      aria(node, 'mobile.openNav', 'Open navigation menu'); content.prepend(node);
    }
    const actions = query('.header-actions', content);
    if (actions && !query('.m-more-btn', actions)) {
      const node = life.node(button('m-more-btn m-mobile-only', 'more', 'toggle-sheet'));
      aria(node, 'mobile.moreActions', 'More actions'); actions.append(node);
    }
  }
  function injectDrawer() {
    const sidebar = query('#main-sidebar'); if (!sidebar || query('.m-drawer-head', sidebar)) return;
    const head = life.node(element('div', 'm-drawer-head m-mobile-only'));
    head.append(element('div', 'm-drawer-brand', '<img src="/static/logo.png" alt="Raptix"><span class="brand-wordmark"><span class="brand-wordmark__core">Raptix</span><span class="brand-wordmark__ai"></span></span>'),
      closeButton('m-close-btn', 'close-nav', 'mobile.closeNav', 'Close navigation menu'));
    const search = life.node(element('div', 'm-drawer-search m-mobile-only')), input = element('input');
    input.type = 'search'; attr(input, 'placeholder', 'mobile.searchMenu', 'Search menu…'); attr(input, 'aria-label', 'mobile.searchMenu', 'Search menu'); input.autocomplete = 'off';
    input.dataset.mobileSearch = 'true';
    const empty = label(element('div', 'm-nav-empty m-mobile-only'), 'mobile.noMatch', 'No matching menu'); empty.hidden = true;
    search.append(input, empty); sidebar.prepend(search); sidebar.prepend(head);
  }
  function injectChatDrawer() {
    if (query('#chat-conversation-picker')) return;
    const sidebar = query('#conversation-sidebar'); if (!sidebar || query('.m-chat-drawer-close', sidebar)) return;
    const close = closeButton('m-close-btn m-chat-drawer-close', 'close-chat', 'mobile.closeChatList', 'Close conversation list');
    const header = query('.conversation-sidebar-header', sidebar);
    if (header) header.append(life.node(close));
    else {
      const head = life.node(element('div', 'm-chat-drawer-head m-mobile-only'));
      head.append(label(element('span', 'm-chat-drawer-title'), 'mobile.chatList', 'Conversations'), close); sidebar.prepend(head);
    }
  }
  function injectTabbar() {
    if (query('#m-tabbar')) return;
    const bar = life.node(element('nav', 'm-mobile-only')); bar.id = 'm-tabbar'; aria(bar, 'mobile.mainNav', 'Main navigation');
    for (const tab of tabs) {
      const node = element('button', 'm-tab', icons[tab.icon]); node.type = 'button'; node.dataset.tab = tab.id;
      node.append(label(element('span'), tab.key, tab.label));
      if (tab.id === 'hitl') { const badge = element('span', 'm-tab-badge'); badge.dataset.badgeFor = 'hitl'; badge.style.display = 'none'; node.append(badge); }
      bar.append(node);
    }
    doc.body.append(bar);
  }
  function sheetItem(key: string, fallback: string, icon: keyof typeof icons, action: MobileAction, keepOpen = false) {
    const node = button('m-sheet-item', icon, action); node.append(label(element('span'), key, fallback));
    if (keepOpen) node.dataset.mobileKeepOpen = 'true'; return node;
  }
  function injectSheet() {
    if (query('#m-sheet')) return;
    const sheet = life.node(element('div', 'm-mobile-only')); sheet.id = 'm-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
    aria(sheet, 'mobile.moreActions', 'More actions');
    const head = element('div', 'm-sheet-head');
    head.append(label(element('span', 'm-sheet-title'), 'mobile.moreActions', 'More actions'), closeButton('m-close-btn', 'close-sheet', 'common.close', 'Close'));
    const body = element('div', 'm-sheet-body');
    body.append(
      sheetItem('header.apiDocs', 'API Docs', 'doc', 'api-docs'), sheetItem('header.github', 'GitHub', 'github', 'github'),
      sheetItem('mobile.switchTheme', 'Switch theme', 'theme', 'theme', true), sheetItem('mobile.switchLanguage', 'Switch language', 'lang', 'language', true),
      element('div', 'm-sheet-sep'), sheetItem('mobile.backToTop', 'Back to top', 'top', 'top', true),
      sheetItem('mobile.refreshPage', 'Reload page', 'refresh', 'reload'), sheetItem('mobile.fullscreen', 'Fullscreen', 'full', 'fullscreen', true),
    );
    sheet.append(element('div', 'm-sheet-grip'), head, body); doc.body.append(sheet);
  }
  function injectChatBar() {
    if (query('#chat-conversation-picker')) return;
    const container = query('.chat-container'); if (!container || query('#m-chat-bar', container)) return;
    const bar = life.node(element('div', 'm-chat-bar m-mobile-only')); bar.id = 'm-chat-bar';
    const list = button('m-chat-bar-btn', 'list', 'toggle-chat'); list.append(label(element('span'), 'mobile.conversations', 'Chats'));
    const fresh = button('m-chat-bar-btn m-primary', 'plus', 'new-chat'); fresh.append(label(element('span'), 'mobile.newChat', 'New chat')); fresh.dataset.requirePermission = 'chat:write';
    bar.append(list, element('div', 'm-chat-bar-spacer'), fresh); container.prepend(bar);
  }
  function ensureScrim() {
    let scrim = query('#m-scrim');
    if (!scrim) { scrim = life.node(element('div', 'm-scrim')); scrim.id = 'm-scrim'; scrim.dataset.mobileAction = 'scrim'; doc.body.append(scrim); }
    return scrim;
  }
  function filterNav(keyword: string) {
    const sidebar = query('#main-sidebar'); if (!sidebar) return;
    const search = keyword.trim().toLowerCase(), items = all('.nav-item', sidebar);
    for (const item of items) {
      life.class(item, 'm-nav-hidden', false);
      const content = query('.nav-item-content', item), selfText = (content?.textContent ?? item.textContent ?? '').toLowerCase();
      const selfHit = !search || selfText.includes(search); let subHit = false;
      for (const sub of all('.nav-submenu-item', item)) {
        const hit = !search || (sub.textContent ?? '').toLowerCase().includes(search);
        life.class(sub, 'm-nav-hit', !!search && hit); life.class(sub, 'm-nav-hidden', !!search && !hit && !selfHit);
        if (hit && search) subHit = true;
      }
      if (!search) { life.class(item, 'm-nav-hit', false); continue; }
      if (selfHit || subHit) {
        life.class(item, 'm-nav-hit', selfHit && !subHit); if (subHit) life.class(item, 'expanded', true);
      } else life.class(item, 'm-nav-hidden', true);
    }
    const empty = query('.m-nav-empty'); if (empty) empty.hidden = !search || items.some(item => !item.classList.contains('m-nav-hidden'));
    for (const label of all('.nav-section-label', sidebar)) {
      let next = label.nextElementSibling, visible = false;
      while (next && !next.classList.contains('nav-section-label')) {
        if (next.classList.contains('nav-item') && !next.classList.contains('m-nav-hidden')) { visible = true; break; }
        next = next.nextElementSibling;
      }
      life.class(label, 'm-nav-hidden', !!search && !visible);
    }
  }
  // Only wrappers created by this lifecycle are unwrapped on disposal. A table
  // moved by another feature is never moved back into an obsolete parent.
  function wrapTables(root: ParentNode = doc) {
    for (const table of all<HTMLTableElement>('table', root)) {
      const parent = table.parentElement;
      if (!parent || parent.classList.contains('m-table-scroll') || table.closest('.m-no-wrap')) continue;
      const columns = table.querySelectorAll('thead th').length || table.querySelectorAll('tr:first-child td').length;
      const wrapper = element('div', 'm-table-scroll' + (columns > 0 && columns <= 3 ? ' m-tight' : ''));
      parent.insertBefore(wrapper, table); wrapper.append(table);
      life.own(() => { if (wrapper.parentNode) wrapper.replaceWith(...wrapper.childNodes); else if (table.parentNode === wrapper) wrapper.removeChild(table); });
    }
  }
  // These attributes belong to mobile even when a host supplies existing chrome.
  const activeAttributes = new WeakSet<HTMLElement>();
  function setActiveTab(page: string) {
    for (const node of all('.m-tab', query('#m-tabbar') ?? doc.createDocumentFragment())) {
      if (!activeAttributes.has(node)) {
        activeAttributes.add(node); const previous = node.getAttribute('aria-current');
        life.own(() => { if (previous === null) node.removeAttribute('aria-current'); else node.setAttribute('aria-current', previous); });
      }
      const active = node.dataset.tab === page && tabs.some(tab => tab.id === page);
      life.class(node, 'm-active', active); if (active) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
    }
  }
  const badgeSnapshots = new WeakSet<HTMLElement>();
  function setHitlBadge(count: number) {
    const badge = query('[data-badge-for="hitl"]'); if (!badge) return;
    if (!badgeSnapshots.has(badge)) { badgeSnapshots.add(badge); const previous = badge.textContent; life.own(() => { badge.textContent = previous; }); }
    badge.textContent = count > 0 ? count > 99 ? '99+' : String(count) : '';
    life.style(badge, 'display', count > 0 ? 'inline-block' : 'none');
  }
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const toastSnapshots = new WeakSet<HTMLElement>();
  function toast(message: string, ms = 1800) {
    if (life.disposed) return;
    let box = query('#m-toast');
    if (!box) { box = life.node(element('div')); box.id = 'm-toast'; doc.body.append(box); }
    if (!toastSnapshots.has(box)) { toastSnapshots.add(box); const previous = box.textContent, saved = box; life.own(() => { saved.textContent = previous; }); }
    box.textContent = message; life.class(box, 'm-show', true); life.cancel(toastTimer);
    const target = box; toastTimer = life.later(() => life.class(target, 'm-show', false), ms || 1800);
  }
  function clickDesktopControl(matcher: RegExp, action: string) {
    // Links retain their destinations; buttons identify their action explicitly.
    for (const node of all('.header-actions button, .header-actions a')) {
      if (node.dataset.action !== action && node.dataset.desktopAction !== action && !matcher.test(node.getAttribute('href') || '')) continue;
      node.click(); return true;
    }
    return false;
  }
  function locales() {
    const seen = new Map<string, string>();
    for (const option of all('#lang-dropdown .lang-option')) {
      const language = option.dataset.lang;
      if (language && !seen.has(language)) seen.set(language, (option.textContent ?? '').trim());
    }
    return seen.size ? [...seen].map(([lang, name]) => ({ lang, name })) : [{ lang: 'en-US', name: 'English' }];
  }
  function scrollToTop() {
    (query('.page.active .page-content') ?? query('.page.active'))?.scrollTo({ top: 0, behavior: 'smooth' });
    if (query('#page-chat')?.classList.contains('active')) query('#chat-messages')?.scrollTo({ top: 0, behavior: 'smooth' });
  }
  return { query, all, text, ensureScrim, filterNav, wrapTables, setActiveTab, setHitlBadge, toast, clickDesktopControl, locales, scrollToTop,
    inject() { injectHeader(); injectDrawer(); injectChatDrawer(); injectTabbar(); injectSheet(); injectChatBar(); ensureScrim(); },
  };
}
export type MobileView = ReturnType<typeof createMobileView>;
