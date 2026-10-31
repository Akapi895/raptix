import { createMobileGestures } from './gestures';
import type { MobileLifecycle } from './lifecycle';
import type { createMobileService } from './service';
import type { MobileDependencies } from './types';
import type { MobileView } from './view';

const selectionPanels = ['#chat-project-panel', '#role-selection-panel'];
export function createMobileController(deps: MobileDependencies, view: MobileView, life: MobileLifecycle, service: ReturnType<typeof createMobileService>) {
  const { doc, browser } = deps;
  const state = { drawerOpen: false, sheetOpen: false, chatDrawerOpen: false, booted: false };
  let started = false, activated = false, baseHeight = browser.height() || 0, lastPanelOpen: boolean | null = null, lastPage: string | undefined;
  const isMobile = () => browser.media ? browser.media.matches : browser.width() < 768;
  const loggedOut = () => { const overlay = view.query('#login-overlay'); return !!overlay && overlay.style.display !== 'none'; };
  const available = () => started && !life.disposed;
  const gestures = createMobileGestures(life, () => available() && isMobile());
  const selectionPanelOpen = () => selectionPanels.some(selector => { const panel = view.query(selector); return panel !== null && getComputedStyle(panel).display !== 'none'; });
  function showScrim() { life.class(view.ensureScrim(), 'm-show', true); life.class(doc.body, 'm-locked', true); }
  function hideScrimIfIdle() {
    if (state.drawerOpen || state.sheetOpen || state.chatDrawerOpen || (isMobile() && selectionPanelOpen())) return;
    const scrim = view.query('#m-scrim'); if (scrim) life.class(scrim, 'm-show', false);
    life.class(doc.body, 'm-locked', false);
  }
  function clearDrawer(selector: string) {
    const node = view.query(selector);
    if (node) { life.class(node, 'm-open', false); life.style(node, 'transform', ''); life.style(node, 'transition', ''); }
  }
  function closeDrawer() { if (!available()) return; clearDrawer('#main-sidebar'); state.drawerOpen = false; hideScrimIfIdle(); }
  function closeChatDrawer() {
    if (!available()) return;
    clearDrawer('#conversation-sidebar'); state.chatDrawerOpen = false; life.class(doc.body, 'm-chat-drawer-open', false); hideScrimIfIdle();
  }
  function closeSheet() {
    if (!available()) return;
    const sheet = view.query('#m-sheet');
    if (sheet) { life.class(sheet, 'm-show', false); life.style(sheet, 'transform', ''); life.style(sheet, 'transition', ''); }
    state.sheetOpen = false; hideScrimIfIdle();
  }
  function closeSelectionPanels() {
    if (!available()) return;
    for (const selector of selectionPanels) {
      const panel = view.query(selector); if (panel) { life.style(panel, 'transform', ''); life.style(panel, 'transition', ''); }
    }
    for (const close of [deps.closeChatProjectPanel, deps.closeRoleSelectionPanel]) {
      try { close(); } catch { /* Selection features may not have initialized yet. */ }
    }
    syncSelectionScrim();
  }
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  function openDrawer() {
    if (!available() || !isMobile()) return;
    const sidebar = view.query('#main-sidebar'); if (!sidebar) return;
    closeSheet(); closeChatDrawer(); life.class(sidebar, 'm-open', true); state.drawerOpen = true; showScrim();
    life.cancel(focusTimer);
    const input = view.query<HTMLInputElement>('.m-drawer-search input', sidebar);
    if (input) focusTimer = life.later(() => { if (state.drawerOpen && isMobile() && input.isConnected) input.focus({ preventScroll: true }); }, 320);
  }
  function openChatDrawer() {
    if (!available() || !isMobile()) return;
    const sidebar = view.query('#conversation-sidebar'); if (!sidebar) return;
    if (state.chatDrawerOpen) { closeChatDrawer(); return; }
    closeDrawer(); closeSheet(); life.class(sidebar, 'm-open', true); state.chatDrawerOpen = true;
    life.class(doc.body, 'm-chat-drawer-open', true); showScrim();
  }
  function openSheet() {
    if (!available() || !isMobile()) return;
    closeDrawer(); const sheet = view.query('#m-sheet'); if (!sheet) return;
    life.class(sheet, 'm-show', true); state.sheetOpen = true; showScrim();
  }
  function updatePanelOffset() {
    const composer = view.query('.chat-input-container'); if (!composer) return;
    const top = composer.getBoundingClientRect().top, height = browser.height() || doc.documentElement.clientHeight;
    life.style(doc.documentElement, '--m-panel-offset', `${Math.round(Math.max(60, height - top + 8))}px`);
    life.style(doc.documentElement, '--m-panel-maxh', `${Math.max(200, Math.min(Math.round(top - 16), Math.round(height * .45)))}px`);
  }
  function syncSelectionScrim() {
    if (!available()) return;
    const open = isMobile() && selectionPanelOpen(); if (open === lastPanelOpen) return;
    lastPanelOpen = open;
    life.class(doc.body, 'm-panel-open', open);
    if (open) { updatePanelOffset(); showScrim(); } else hideScrimIfIdle();
  }
  function syncKeyboard() {
    const viewport = browser.viewport;
    life.class(doc.body, 'm-keyboard', !!viewport && isMobile() && baseHeight - viewport.height - viewport.offsetTop > 120);
    if (isMobile() && selectionPanelOpen()) updatePanelOffset();
  }
  function syncViewportHeight() {
    const height = browser.height() || doc.documentElement.clientHeight;
    if (height > baseHeight) baseHeight = height;
    life.style(doc.documentElement, '--m-app-height', `${height}px`);
  }
  function syncAuthChrome() {
    if (!available()) return;
    const bar = view.query('#m-tabbar'), out = loggedOut(); if (bar) life.style(bar, 'display', out ? 'none' : '');
    if (out) { closeDrawer(); closeSheet(); closeChatDrawer(); }
  }
  function wrapTables(root?: ParentNode) { if (available() && isMobile()) view.wrapTables(root); }
  function onPageChanged(page: string) {
    if (!available()) return;
    view.setActiveTab(page);
    if (!state.booted || page === lastPage) return;
    lastPage = page; closeDrawer(); closeSheet(); if (page !== 'chat') closeChatDrawer(); browser.rememberPage(page);
    for (const delay of [80, 400, 1200]) life.later(() => {
      if (lastPage !== page) return;
      const target = doc.getElementById('page-' + page); if (target) wrapTables(target);
    }, delay);
  }
  const watched = new WeakSet<Element>(), composers = new WeakSet<Element>();
  function watchElements() {
    for (const selector of selectionPanels) {
      const panel = view.query(selector); if (!panel || watched.has(panel)) continue;
      watched.add(panel);
      life.observe(panel, { attributes: true, attributeFilter: ['style', 'class'] }, syncSelectionScrim);
      gestures.panel(panel, closeSelectionPanels, 'selection');
    }
    const overlay = view.query('#login-overlay');
    if (overlay && !watched.has(overlay)) {
      watched.add(overlay); let previous = loggedOut();
      life.observe(overlay, { attributes: true, attributeFilter: ['style', 'class'] }, () => {
        syncAuthChrome(); const current = loggedOut();
        if (current !== previous) { previous = current; void service.refreshHitlBadge(); }
      });
    }
    const composer = view.query('.chat-input-container');
    if (composer && !composers.has(composer) && typeof ResizeObserver !== 'undefined') {
      composers.add(composer);
      const observer = new ResizeObserver(() => { if (available() && isMobile() && selectionPanelOpen()) updatePanelOffset(); });
      observer.observe(composer); life.own(() => observer.disconnect());
    }
    for (const page of view.all('.page')) {
      if (watched.has(page)) continue; watched.add(page);
      life.observe(page, { attributes: true, attributeFilter: ['class'] }, () => { if (page.classList.contains('active')) onPageChanged(page.id.replace(/^page-/, '')); });
    }
    if (!state.booted) return;
    gestures.drawer(view.query('#main-sidebar'), closeDrawer); gestures.drawer(view.query('#conversation-sidebar'), closeChatDrawer);
    gestures.panel(view.query('#m-sheet'), closeSheet, 'sheet');
  }
  function boot() {
    if (!available() || !isMobile()) return;
    view.inject(); syncAuthChrome();
    view.setActiveTab(deps.currentPage() || view.query('.page.active')?.id.replace(/^page-/, '') || browser.hash().replace(/^#/, '').split('?')[0] || 'dashboard');
    if (!state.booted) {
      state.booted = true;
      gestures.edge(doc, () => state.drawerOpen || state.sheetOpen || state.chatDrawerOpen || loggedOut(), openDrawer);
      service.start();
    }
    watchElements(); syncSelectionScrim(); wrapTables(view.query('.page.active') ?? doc);
    deps.applyTranslations(doc.body);
    try { deps.applyPermissions(); } catch { /* RBAC may still be initializing. */ }
  }
  function onBreakpointChange() {
    if (!available()) return;
    if (isMobile()) { syncViewportHeight(); syncKeyboard(); boot(); }
    else {
      closeDrawer(); closeSheet(); closeChatDrawer(); closeSelectionPanels();
      const scrim = view.query('#m-scrim'); if (scrim) life.class(scrim, 'm-show', false);
      life.class(doc.body, 'm-locked', false); life.class(doc.body, 'm-keyboard', false); life.class(doc.body, 'm-panel-open', false);
      life.style(doc.documentElement, '--m-app-height', ''); lastPanelOpen = false;
      void service.refreshHitlBadge(); // Invalidate a mobile request still in flight.
    }
  }
  async function fullscreen() {
    if (!await browser.fullscreen() && available()) view.toast(view.text('mobile.fullscreenUnsupported', 'Fullscreen is not supported in this browser'));
  }
  function cycleLanguage() {
    const locales = view.locales(), current = String(deps.locale() || doc.documentElement.lang || 'en-US');
    const index = Math.max(0, locales.findIndex(locale => locale.lang === current)), next = locales[(index + 1) % locales.length];
    if (next && deps.selectLanguage(next.lang)) view.toast(next.name);
  }
  function action(name: string) {
    switch (name) {
      case 'toggle-nav': if (state.drawerOpen) closeDrawer(); else openDrawer(); break;
      case 'close-nav': closeDrawer(); break;
      case 'toggle-sheet': if (state.sheetOpen) closeSheet(); else openSheet(); break;
      case 'close-sheet': closeSheet(); break;
      case 'toggle-chat': openChatDrawer(); break;
      case 'close-chat': closeChatDrawer(); break;
      case 'scrim': closeDrawer(); closeSheet(); closeChatDrawer(); closeSelectionPanels(); break;
      case 'new-chat': if (!deps.startNewConversation()) view.toast(view.text('mobile.chatModuleMissing', 'The chat module is not loaded yet')); break;
      case 'api-docs': if (!view.clickDesktopControl(/\/api-docs/, 'open-api-docs')) browser.navigate('/api-docs'); break;
      case 'github': view.clickDesktopControl(/github\.com/i, 'open-github'); break;
      case 'theme': {
        if (!deps.cycleTheme()) view.query('#theme-toggle-btn')?.click();
        const resolved = doc.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        // The old runtime keeps the untranslated theme key if the translator
        // exists but has no matching resource.
        const name = deps.translate('theme.' + resolved) || resolved;
        view.toast(view.text('mobile.themeNow', 'Theme: {{name}}', { name })); break;
      }
      case 'language': cycleLanguage(); break;
      case 'top': view.scrollToTop(); break;
      case 'reload': browser.reload(); break;
      case 'fullscreen': void fullscreen(); break;
    }
  }
  function bindEvents() {
    // Capture outside-close runs before a selector's own toggle handler, so a
    // newly opened panel cannot immediately close itself on the same click.
    life.on<MouseEvent>(doc, 'click', event => {
      if (!selectionPanelOpen()) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(selectionPanels.join(',') + ',#chat-project-btn,#role-selector-btn')) return;
      closeSelectionPanels();
    }, true);
    life.on<MouseEvent>(doc, 'click', event => {
      const target = event.target instanceof Element ? event.target : null; if (!target) return;
      const control = target.closest<HTMLElement>('[data-mobile-action]');
      if (control) {
        if (control.matches(':disabled,[aria-disabled="true"],[data-state-disabled="true"]')) return;
        action(control.dataset.mobileAction ?? '');
        if (control.classList.contains('m-sheet-item') && control.dataset.mobileKeepOpen !== 'true') closeSheet();
        return;
      }
      const tab = target.closest<HTMLElement>('#m-tabbar .m-tab');
      if (tab?.dataset.tab) { deps.switchPage(tab.dataset.tab); closeDrawer(); closeSheet(); closeChatDrawer(); return; }
      if (!isMobile()) return;
      if (target.closest('#main-sidebar')) {
        const sub = target.closest<HTMLElement>('.nav-submenu-item'), item = target.closest('.nav-item-content');
        if (sub?.dataset.page || (item?.closest('.nav-item') && !item.closest('.nav-item-has-submenu'))) life.later(closeDrawer, 60);
      }
      if (state.chatDrawerOpen && target.closest('#conversation-sidebar') && !target.closest('.project-folder-item,.section-header,.recent-conversations-toggle,.m-close-btn') &&
        target.closest('.conversation-item,.project-conversation-item,.new-chat-btn,.project-folder-new-conversation')) life.later(closeChatDrawer, 90);
    });
    life.on<InputEvent>(doc, 'input', event => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.matches('[data-mobile-search]')) view.filterNav(target.value);
    });
    life.on(doc, 'visibilitychange', () => { if (!doc.hidden) void service.refreshHitlBadge(); });
    life.on(browser.events, 'hashchange', () => {
      const page = deps.currentPage() || browser.hash().replace(/^#/, '').split('?')[0]; if (page) onPageChanged(page);
    });
  }
  function watchDom() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    life.observe(doc.body, { childList: true, subtree: true }, records => {
      const added = records.flatMap(record => Array.from(record.addedNodes)).filter((node): node is HTMLElement => node instanceof HTMLElement);
      const structures = '#login-overlay,#chat-project-panel,#role-selection-panel,.chat-input-container,.page,#main-sidebar,#conversation-sidebar,.chat-container,header .header-content';
      if (added.some(node => node.matches(structures) || node.querySelector(structures))) { if (state.booted && isMobile()) boot(); else watchElements(); }
      const hasTable = added.some(node => (node.matches('table') && !node.parentElement?.classList.contains('m-table-scroll')) || (!node.classList.contains('m-table-scroll') && node.querySelector('table:not(.m-no-wrap table)')));
      if (!hasTable) return;
      life.cancel(timer); timer = life.later(() => { const page = view.query('.page.active'); if (page) wrapTables(page); }, 260);
    });
  }
  function start() {
    if (started || life.disposed) return; started = true;
    syncViewportHeight(); syncKeyboard(); bindEvents(); watchDom();
    let mobile = isMobile();
    life.on(browser.events, 'resize', () => {
      syncViewportHeight(); syncKeyboard();
      if (!browser.media && mobile !== isMobile()) { mobile = isMobile(); onBreakpointChange(); }
    });
    life.on(browser.events, 'orientationchange', () => { life.later(syncViewportHeight, 220); life.later(syncKeyboard, 260); });
    if (browser.viewport) {
      let frame = 0;
      const update = () => { if (!frame) frame = life.frame(() => { frame = 0; syncKeyboard(); }); };
      life.on(browser.viewport, 'resize', update); life.on(browser.viewport, 'scroll', update);
    }
    if (browser.media) {
      if (typeof browser.media.addEventListener === 'function') life.on(browser.media, 'change', onBreakpointChange);
      else { browser.media.addListener(onBreakpointChange); life.own(() => browser.media?.removeListener(onBreakpointChange)); }
    }
    if (isMobile()) boot(); else watchElements();
  }
  return {
    isMobile, loggedOut, enabled: () => available() && state.booted && isMobile(),
    openDrawer, closeDrawer, openChatDrawer, closeChatDrawer, openSheet, closeSheet, closeSelectionPanels, wrapTables, onPageChanged,
    toast(message: string, ms?: number) { if (available()) view.toast(message, ms); },
    activate() {
      if (activated || life.disposed) return; activated = true;
      if (doc.readyState === 'loading') life.on(doc, 'DOMContentLoaded', start, { once: true }); else start();
    },
  };
}
