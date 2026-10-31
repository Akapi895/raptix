import { initAssets, type AssetsDependencies } from '@/features/assets';
import { initAudit } from '@/features/audit';
import { initC2, type C2Event } from '@/features/c2';
import { initDashboard } from '@/features/dashboard';
import { initHitl, type HitlDefaults } from '@/features/hitl';
import { initInfoCollect } from '@/features/info-collect';
import { initKnowledge, createKnowledgeToast, type ToastKind } from '@/features/knowledge';
import { initMobileUI } from '@/features/mobile-ui';
import { initMonitor } from '@/features/monitor';
import { initNotifications, type NotificationItem } from '@/features/notifications';
import { initProjects } from '@/features/projects';
import { startProjectSwitcher } from '@/features/projects/switcher';
import { initRoles } from '@/features/roles';
import { initSettings } from '@/features/settings';
import { initSkills } from '@/features/skills';
import { initStorage } from '@/features/storage';
import { initTasks } from '@/features/tasks';
import { initTerminalFeature, buildTerminalURL } from '@/features/terminal';
import { initTokenUsage } from '@/features/token-usage';
import { initToolGuard } from '@/features/tool-guard';
import { initVulnerability } from '@/features/vulnerability';
import { initWebshell } from '@/features/webshell';
import { initWorkflows, createWorkflowOrchestration } from '@/features/workflows';
import { applyTranslations, currentLanguage, translateRuntime, type TranslationOptions } from '@/i18n';
import { createAccessBrowser, openAccessEventStream } from '@/platform/access-browser';
import { analyticsBrowser } from '@/platform/analytics-browser';
import { browser } from '@/platform/browser';
import { createMobileBrowser } from '@/platform/mobile-browser';
import { notificationBrowser } from '@/platform/notification-browser';
import { createRouterBrowserPort } from '@/platform/router-browser';
import { createSettingsBrowser } from '@/platform/settings-browser';
import { sessionStorage, storage } from '@/platform/storage';
import { terminalBrowser } from '@/platform/terminal-browser';
import { createPageLifecycle, createRouter, createRouterView, type PageId } from '@/router';
import { formatMarkdown } from '@/ui/markdown';
import { closeAppModal, isAppModalOpen, openAppModal, syncAppModalBodyLock } from '@/ui/modal';
import { createAuthDomain } from './auth';
import type { DomainDependencies } from './contracts';
import { createDomainLifetime } from './lifetime';

export type { DomainDependencies, DomainChatPorts } from './contracts';
export { createAuthDomain, type AuthDomain, type AuthDependencies } from './auth';

/** Application composition: cross-owner references are explicit lazy callbacks. */
export function createDomainApplication(deps: DomainDependencies) {
  const doc = deps.doc ?? browser.document;
  const chat = deps.chat;
  const lifetime = createDomainLifetime();
  const toast = createKnowledgeToast(doc);
  const notify = (message: string, kind = 'info') => {
    if (!lifetime.disposed) toast.show(message, (['success', 'error', 'warning', 'info'].includes(kind) ? kind : 'info') as ToastKind);
  };
  const t = (key: string, options?: Record<string, unknown>) => translateRuntime(key, options as TranslationOptions | undefined);
  const fallback = (key: string, text: string, options?: Record<string, string | number>) => { const value = t(key, options); return value === key ? text : value; };
  const run = (callback: () => unknown) => {
    if (lifetime.disposed) return;
    try { void Promise.resolve(callback()).catch(error => { if (!lifetime.disposed) auth.notifyApiError(String(error)); }); }
    catch (error) { auth.notifyApiError(String(error)); }
  };
  const deferModalContent = (callback: () => void) => lifetime.frame(() => lifetime.frame(callback));
  const auth = createAuthDomain({
    doc, ready: () => deps.i18nReady, notify,
    initializeChat: () => chat.initializeChatUI(),
    async refreshChat() {
      try { await chat.refreshChatConfig(); } catch (error) { console.warn('Refreshing chat configuration failed', error); }
      await Promise.allSettled([Promise.resolve(chat.loadConversations()), Promise.resolve(chat.loadActiveTasks(false))]);
      try { await projects.refreshChatProjectSelector({ reloadFolders: true }); } catch (error) { console.warn('Refreshing sidebar projects failed', error); }
    },
    robotBindingsChanged: () => { run(vulnerability.view.subscription); },
  });
  const request = auth.apiFetch;
  const can = (permission: string, message?: string) => auth.requirePermission(permission, message);
  const applyPermissions = (root: ParentNode) => auth.applyRBACToUI(root);
  const routerService = createRouter(createRouterBrowserPort(doc));
  const currentPage = () => routerService.page() ?? '';
  const navigate = (page: string) => routerService.go(page);
  const replaceHash = (hash: string) => {
    // Updates subscribers without replaying page initialization.
    routerService.navigate(hash, false);
  };
  const settingsBrowser = createSettingsBrowser();
  let c2Enabled = true;
  const settings = initSettings({
    doc, request, storage, t,
    browser: {
      ...settingsBrowser,
      settingsHash: section => {
        if (currentPage() === 'settings') routerService.replaceQuery(section === 'token-usage' ? { section } : {});
      },
      c2Enabled: enabled => { c2Enabled = enabled; settingsBrowser.c2Enabled(enabled); },
    },
    can, alert: browser.alert, confirm: browser.confirm, navigate,
    navigateSection: section => settings.controller.switchSettingsSection(section), notifyError: auth.notifyApiError,
    section: section => {
      switch (section) {
        case 'token-usage': run(tokens.service.refresh); break;
        case 'robots': run(vulnerability.view.subscription); break;
        case 'terminal': run(terminal.initTerminal); break;
        case 'audit': run(audit.view.init); break;
        case 'storage': run(storageFeature.initStorageSection); break;
      }
    },
    stopTokenUsage: () => tokens.service.stop(),
    syncDashboardAccessTabs: () => dashboard.syncAccessTabs(),
    refreshChatConfig: () => chat.refreshChatConfig(),
    populateChatChannels: ai => chat.populateChatChannels(ai),
    refreshMentionTools: () => run(() => chat.refreshMentionTools()),
    unauthorized: message => auth.view.showLoginOverlay(message),
    closeMCPDetail: () => chat.closeMCPDetail(),
  });
  const pagination = (root: HTMLElement) => settings.selects.pagination(root);
  const roles = initRoles({
    doc, request, storage, t: fallback, can, notify, confirm: browser.confirm,
    loadWorkflowOptions: id => { run(() => workflows.hooks.loadWorkflowOptionsForRoleModal(id)); },
    closeOtherChatPanels: () => { projects.closeChatProjectPanel(); chat.closeChatReasoningPanel(); },
    onRoleChanged: () => chat.roleChanged(), initPaginationSelects: pagination,
    isRolesPageOpen: () => currentPage() === 'roles-management',
  });
  const projects = initProjects(doc, {
    translate: t, hasPermission: auth.hasPermission, requirePermission: can, applyRBAC: applyPermissions,
    openModal: (id, options) => { openAppModal(id, options); }, closeModal: id => { closeAppModal(id); },
    isModalOpen: isAppModalOpen, syncModalBodyLock: syncAppModalBodyLock, deferModalContent,
    notify, notifyApiError: auth.notifyApiError,
    refreshProjectFilters: async () => { await vulnerability.view.refreshProjects(); await chat.refreshAllProjectFilterSelects(); },
    refreshConversationProjectFilter: () => chat.refreshConversationProjectFilter(),
    getConversationId: () => chat.currentConversationId(),
    getConversationProjectId: () => chat.getConversationProjectId(),
    setConversationProjectId: id => chat.setConversationProjectId(id),
    onConversationProjectBindingChanged: id => chat.onConversationProjectBindingChanged(id),
    refreshChatWelcomeEmptyState: () => chat.refreshChatWelcomeEmptyState(),
    loadConversation: id => chat.loadConversation(id), startNewConversation: options => chat.startNewConversation(options),
    openConversationContextMenu: (event, id, title) => chat.openConversationContextMenu(event, id, title),
    closeOtherChatPanels: () => { roles.view.closePanel(); chat.closeChatReasoningPanel(); },
    closeWebshellProjectPanel: () => webshell.controller.wsCloseProjectPanel(),
    applyWebshellProjectSelection: id => webshell.controller.applyWebshellAiProjectSelection(id),
    navigate, setVulnerabilityProjectFilter: id => { vulnerability.view.setFilter('project_id', id); return true; },
    setVulnerabilityIdFilter: id => vulnerability.view.setFilter('id', id),
    openAssetDetail: asset => assets.view.detailRecord(asset), initPaginationSelects: pagination,
    formatProjectName: name => chat.formatProjectName(name),
    applyProjectName: (element, name, empty) => chat.applyProjectName(element, name, empty),
  });
  async function initProjectsPage(): Promise<void> {
    const active = projects.getActiveProjectId();
    await projects.initProjectsPage();
    if (active && !lifetime.disposed) {
      try { await projects.selectProject(active); } catch (error) { console.warn('Selecting active project failed', error); }
    }
  }
  async function ensureProjectsLoaded(force?: boolean) {
    const list = await projects.ensureProjectsLoaded(force);
    if (!lifetime.disposed) chat.refreshConversationProjectFilter();
    return list;
  }
  const assetDeps: AssetsDependencies = {
    request, storage, t, locale: currentLanguage, can, alert: browser.alert, confirm: browser.confirm, prompt: browser.prompt,
    applyPermissions, enhanceSelect: settings.selects.enhance, syncSelect: settings.selects.sync,
    closeSelects: settings.selects.closeAll, refreshSelects: settings.selects.refresh, paginationSelects: pagination,
    hash: () => browser.location.hash, setHash: hash => { browser.location.hash = hash; }, replaceHash,
    onResize: listener => browser.on('resize', listener), copy: browser.clipboard.writeText, switchPage: navigate,
    loadConversation: async id => { await chat.loadConversation(id); },
    navigateConversation: async id => { await routerView.navigateToConversation(id); },
    currentConversation: () => chat.currentConversationId(), startConversation: async () => { await chat.startNewConversation(); },
    sendMessage: options => chat.sendMessage(options), requireExecutionEvidence: () => chat.requireExecutionEvidence(),
    refreshConversations: () => { run(() => chat.refreshChatProjectFoldersAfterAction()); run(() => chat.loadConversations()); },
    showQueue: id => { run(() => tasks.hooks.showBatchQueueDetail(id)); },
    currentRole: () => roles.service.currentRole, activeProject: () => projects.getActiveProjectId(),
    onProjectChange: listener => projects.service.subscribe(listener), setActiveProject: id => projects.setActiveProjectId(id),
    projectName: id => projects.getProjectName(id),
    refreshProjectAssets: async () => { await projects.loadProjectAssets(); },
    openProjectFact: async (id, key) => {
      if (!id || !key) return; navigate('projects'); await initProjectsPage(); await projects.selectProject(id);
      if (lifetime.disposed) return;
      projects.switchProjectTab('facts'); projects.viewProjectFactBody(key);
    },
    robotEnabled: type => settings.controller.getRobotStatus(type)?.state === 'enabled', notify,
  };
  const assets = initAssets(doc, assetDeps);
  const infoCollect = initInfoCollect(doc, assetDeps);
  const vulnerability = initVulnerability(doc, assetDeps, force => projects.fetchAllProjects(force));
  const workflows = initWorkflows({
    doc, request, t, sessionStorage, can, confirm: browser.confirm, notify, translate: applyTranslations,
    refreshRoleSelects: () => roles.view.refreshSkins(), applyPermissions,
    download: (blob, filename) => analyticsBrowser.download(blob, filename),
  });
  const tasks = initTasks({
    doc, request, t, storage, can, confirm: browser.confirm, alert: browser.alert,
    copy: browser.clipboard.writeText, navigate: hash => { browser.location.hash = hash; },
    activeProjectId: () => projects.getActiveProjectId(), initPaginationSelects: pagination,
    loadProjects: () => projects.fetchAllProjects(false), applyPermissions,
    enterWorkspace: () => { if (currentPage() !== 'workflows') browser.location.hash = 'workflows?tab=schedule'; },
    workflowOptions: () => workflows.service.list(true),
  });
  const orchestration = createWorkflowOrchestration({ doc, service: workflows.service, tasks, can, notify, selectedId: workflows.selectedId, dirty: workflows.isDirty });
  const accessBrowser = createAccessBrowser(doc);
  const webshell = initWebshell({
    browser: accessBrowser, request, t: (key, empty, options) => fallback(key, empty || key, options),
    notify, can, markdown: formatMarkdown, projectNames: () => projects.projectNameById,
    role: () => roles.service.currentRole, setRole: role => roles.view.selectRole(role),
    reasoning: () => chat.reasoning?.(),
    ensureProjects: () => ensureProjectsLoaded(),
    newProject: () => projects.showNewProjectModal('webshell'),
    renderProjectPicker: async options => {
      const render = () => projects.renderProjectPickerPanel('webshell', {
        listId: options.listId, searchInputId: options.searchInputId,
        getSelectedId: () => webshell.service.projectId(webshell.service.currentId || ''), onSelect: options.onSelect, t,
      });
      projects.initProjectPickerPanelSearch('webshell', options.searchInputId, () => projects.scheduleProjectPickerPanelSearch('webshell', () => { run(render); }));
      await render(); return true;
    },
  });
  const c2 = initC2({
    browser: accessBrowser, request, currentPage, can, notify, t,
    projectNames: () => projects.projectNameById, ensureProjects: () => ensureProjectsLoaded(),
    refreshDashboard: () => { run(dashboard.refresh); }, activeProject: () => projects.getActiveProjectId(),
    dynamicRender: applyPermissions, paginationSelects: pagination,
    eventStream: receive => openAccessEventStream(value => {
      if (!value || typeof value !== 'object' || !('id' in value) || !('category' in value) || !('message' in value)) return;
      receive(value as C2Event);
    }),
    upload: (path, form, progress, signal) => deps.uploadWithProgress
      ? deps.uploadWithProgress(path, form, { onProgress: value => progress(value.percent || 0) })
      : request(path, { method: 'POST', body: form, signal }),
  });
  const audit = initAudit(doc, {
    translate: t, getLocale: currentLanguage, applyTranslations, toast: notify, requirePermission: can,
    navigate, settingsSection: section => settings.controller.switchSettingsSection(section),
    loadConversation: id => chat.loadConversation(id),
    openModal: element => { openAppModal(element, { focus: false }); }, closeModal: id => { closeAppModal(id); },
    syncModalBodyLock: syncAppModalBodyLock, deferModalContent, initPaginationSelects: pagination,
    download: analyticsBrowser.download, viewport: analyticsBrowser.viewport,
  });
  const tokens = initTokenUsage(doc, {
    translate: t, getLocale: currentLanguage, getActiveProjectId: () => projects.getActiveProjectId(),
    navigate, settingsSection: section => settings.controller.switchSettingsSection(section),
    hash: analyticsBrowser.hash, setHash: analyticsBrowser.setHash,
  });
  const terminal = initTerminalFeature(doc, {
    ...terminalBrowser, terminalURL: () => buildTerminalURL(terminalBrowser.location(), auth.token()),
    allow: can, translate: t,
  });
  const storageFeature = initStorage(doc, request, { translate: t, confirm: browser.confirm, alert: browser.alert });
  const skills = initSkills({ doc, request, storage, t, can, confirm: browser.confirm, notify, afterRender: applyPermissions, initPaginationSelects: pagination });
  const knowledge = initKnowledge({
    doc, request, t, can, confirm: browser.confirm, notify, afterRender: applyPermissions, copy: browser.clipboard.writeText,
    navigateSettings: () => {
      navigate('settings');
      lifetime.later(() => {
        if (doc.querySelector('[data-section="knowledge"]')) { settings.controller.switchSettingsSection('knowledge'); return; }
        settings.controller.switchSettingsSection('basic');
        lifetime.later(() => {
          const input = doc.getElementById('knowledge-enabled'); input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const parent = input?.parentElement;
          if (parent) {
            const background = parent.style.backgroundColor; parent.style.transition = 'background-color .3s'; parent.style.backgroundColor = '#e3f2fd';
            lifetime.later(() => { parent.style.backgroundColor = background; }, 2000);
          }
        }, 300);
      }, 100);
    },
  });
  const monitor = initMonitor({
    doc, request, storage, translate: t, locale: currentLanguage, confirm: browser.confirm, alert: browser.alert,
    showDetail: id => { run(() => chat.showMCPDetail(id)); }, cancelExecution: id => { run(() => chat.cancelMCPToolExecution(id)); },
    isPageActive: () => currentPage() === 'mcp-monitor', initPaginationSelects: pagination,
  });
  let hitlDefaults: HitlDefaults | undefined;
  let hitlWhitelist: string[] | undefined;
  const hitl = initHitl(doc, {
    ...chat.hitl, request, storage, translate: t, getLocale: currentLanguage,
    getCurrentConversationId: () => chat.currentConversationId() || doc.querySelector<HTMLElement>('.conversation-item.active')?.dataset.conversationId || '',
    getExternalState: () => ({ auditBackend: hitlDefaults?.auditBackend, auditModel: hitlDefaults?.auditModel, whitelist: hitlWhitelist }),
    defaultsChanged: (defaults, whitelist) => {
      hitlDefaults = defaults; if (whitelist) hitlWhitelist = whitelist;
      chat.hitl.defaultsChanged?.(defaults, whitelist);
    },
    loadConversation: id => chat.loadConversation(id), loadActiveTasks: async () => { await chat.loadActiveTasks(); },
    submitWorkflowDecision: async (id, approved, comment) => {
      if (chat.hitl.submitWorkflowDecision) await chat.hitl.submitWorkflowDecision(id, approved, comment);
      else await hitl.service.resumeWorkflow(id, approved, comment);
    },
    navigate, currentPage, initPaginationSelects: pagination, alert: browser.alert, confirm: browser.confirm,
    now: Date.now, sleep: lifetime.sleep,
  });
  const toolGuard = initToolGuard({ doc, canRead: () => auth.hasPermission('config:read'), canWrite: () => can('config:write') });
  function navigateNotification(item: NotificationItem): void {
    switch (item.type) {
      case 'vulnerability_created': if (item.vulnerabilityId) browser.location.hash = 'vulnerabilities?id=' + encodeURIComponent(item.vulnerabilityId); break;
      case 'task_completed': case 'long_running_tasks': if (item.conversationId) run(() => routerView.navigateToConversation(item.conversationId!)); break;
      case 'task_failed': {
        navigate('mcp-monitor'); const id = item.executionId;
        if (id) lifetime.later(() => run(() => chat.showMCPDetail(id)), 450); break;
      }
      case 'hitl_pending': navigate('hitl'); break;
      case 'c2_session_online': {
        navigate('c2-sessions'); const id = item.sessionId;
        if (id) lifetime.later(() => run(async () => { await c2.controller.loadSessions(); if (!lifetime.disposed) c2.controller.selectSession(id); }), 120);
        break;
      }
    }
  }
  const notifications = initNotifications(doc, {
    request, translate: t, storage, runtime: notificationBrowser, locale: currentLanguage,
    navigate: navigateNotification, canMarkAll: () => can('notification:write'),
  });
  const dashboard = initDashboard(doc, {
    translate: t, applyTranslations, navigate, getActiveProjectId: () => projects.getActiveProjectId(), getLocale: currentLanguage,
    isC2Enabled: () => c2Enabled, openTokenUsage: () => tokens.view.open(), openNotifications: () => notifications.service.toggle(),
    initProjects: initProjectsPage, selectProject: async id => { await projects.selectProject(id); },
    switchProjectTab: tab => projects.switchProjectTab(tab), viewProjectFact: key => projects.viewProjectFactBody(key),
    showNewProjectModal: () => projects.showNewProjectModal('projects'),
  });
  const mobile = initMobileUI({
    doc, browser: createMobileBrowser(), request, translate: t, applyTranslations, switchPage: navigate, currentPage,
    startNewConversation: () => { run(() => chat.startNewConversation()); return true; },
    closeChatProjectPanel: () => projects.closeChatProjectPanel(), closeRoleSelectionPanel: () => roles.view.closePanel(),
    cycleTheme: () => { deps.cycleTheme(); return true; },
    locale: currentLanguage, selectLanguage: locale => { deps.selectLanguage(locale); return true; }, applyPermissions: () => applyPermissions(doc),
  });
  const pageLifecycle = createPageLifecycle(doc, {
    stopExternalMcpPoll: settings.controller.stopExternalMcpPoll, refreshDashboard: dashboard.refresh,
    prefetchProjectsForChat: projects.prefetchProjectsForChat, refreshChatProjectSelector: projects.refreshChatProjectSelector,
    loadToolGuardConfig: toolGuard.load, refreshHitlActivePanel: hitl.view.refreshActivePanel,
    initInfoCollectPage: infoCollect.view.initPage, loadAssetOverview: assets.view.overview, loadAssets: assets.view.load,
    initTasksPage: tasks.hooks.initTasksPage, refreshMonitorPanel: monitor.controller.refresh, startMonitorPoll: monitor.controller.startPolling,
    prepareToolsPagination: () => { settings.service.state.pagination.page_size = settings.service.getToolsPageSize(); },
    loadToolsList: settings.controller.loadToolsList, loadExternalMCPs: settings.controller.loadExternalMCPs,
    startExternalMcpPoll: settings.controller.startExternalMcpPoll, hasPermission: auth.hasPermission, loadConfig: settings.controller.loadConfig,
    initProjectsPage, initVulnerabilityPage: vulnerability.view.initPage, initWebshellPage: webshell.controller.initWebshellPage,
    initChatFilesPage: () => chat.initChatFilesPage(),
    refreshTokenUsage: () => doc.getElementById('settings-token-analysis') ? tokens.service.refresh() : undefined,
    loadRoles: roles.view.loadForPage, renderRolesList: roles.view.renderList,
    refreshWorkflows: async () => { if (can('workflow:read')) await workflows.hooks.refreshWorkflows(); await orchestration.sync(); }, loadSkillsMonitor: skills.controller.monitor, loadSkills: () => skills.controller.load(),
    loadKnowledgeCategories: knowledge.controller.categories,
    loadKnowledgePage: () => knowledge.controller.load(knowledge.service.state.pagination.currentCategory, 1, knowledge.service.state.pagination.pageSize),
    updateIndexProgress: knowledge.controller.updateIndex, loadRetrievalLogs: knowledge.controller.logs,
    stopKnowledgeIndexPoll: () => knowledge.controller.stopIndex(false), initC2: () => c2.controller.init(),
    cleanupTasksPage: () => { if (currentPage() !== 'workflows') tasks.hooks.cleanupTasksPage(); },
    stopTokenUsageRequests: tokens.service.stop, onError: error => console.warn('[router]', error),
  });
  function onNavigation(page: PageId) {
    c2.controller.navigationChanged(page);
    mobile.api.closeDrawer(); mobile.api.closeSheet(); if (page !== 'chat') mobile.api.closeChatDrawer();
    storage.set('csaiMobileTab', page); mobile.onPageChanged(page);
    if (page !== 'mcp-monitor') monitor.controller.stopPolling();
    for (const delay of [80, 400, 1200]) lifetime.later(() => {
      const target = doc.getElementById('page-' + page); if (currentPage() === page && target) mobile.api.wrapTables(target);
    }, delay);
  }
  const routerView = createRouterView(routerService, {
    ready: () => deps.i18nReady, initPage: pageLifecycle.init, invalidatePage: pageLifecycle.invalidate,
    applyPermissions, permissionAllowed: deps.permissionAllowedForElement,
    abandonConversation: () => chat.abandonConversation(), loadConversation: id => chat.loadConversation(id),
    setActiveProject: projects.setActiveProjectId, refreshChatProjectSelector: () => { run(projects.refreshChatProjectSelector); },
    switchSettingsSection: settings.controller.switchSettingsSection, syncC2Nav: settings.controller.syncC2NavOnceFromServer,
    onNavigation, onError: error => console.warn('[router]', error),
  }, doc);
  let stopSwitcher: (() => void) | undefined;
  let started: Promise<void> | undefined;
  let resolveHitlReady: () => void = () => {};
  const hitlReady = new Promise<void>(resolve => { resolveHitlReady = resolve; });
  function start(): Promise<void> {
    if (lifetime.disposed) return Promise.resolve();
    if (started) return started;
    // Calling auth.start first binds login immediately; never await a feature
    // request that can itself be waiting for the user to authenticate.
    const authReady = auth.start();
    settings.activate(); roles.activate(); projects.mount();
    assets.activate(); infoCollect.activate(); vulnerability.activate(); workflows.activate(); tasks.activate();
    void authReady.then(() => { if (!lifetime.disposed) orchestration.mount(); });
    webshell.activate(); c2.activate(); audit.afterClassicScripts(); tokens.afterClassicScripts();
    terminal.activate(); storageFeature.bind(); skills.activate(); knowledge.activate(); monitor.activate();
    notifications.activate(); mobile.activate();
    void hitl.afterClassicScripts().then(resolveHitlReady, error => { console.warn('HITL activation failed', error); resolveHitlReady(); });
    run(toolGuard.start); run(roles.view.loadForPage);
    installDomainEvents();
    stopSwitcher = startProjectSwitcher({
      doc, getActive: projects.getActiveProjectId, setActive: projects.setActiveProjectId,
      setConversationFilter: id => chat.setConversationProjectFilter(id), currentPage, selectProject: projects.selectProject,
      refreshDashboard: () => { run(dashboard.refresh); }, loadConversations: query => { run(() => chat.loadConversations(query)); },
      conversationsSearchQuery: () => chat.conversationsSearchQuery(), fetchProjectsList: () => projects.fetchProjectsList(false),
      getJson: async path => (await request(path)).json(), projectName: projects.getProjectName,
      showNewProjectModal: () => projects.showNewProjectModal('projects'),
      showProjectActionMenu: (event, id) => { if (event instanceof MouseEvent) projects.showProjectListActionMenu(event, id, 'chat'); }, t: fallback,
      ready: () => !!doc.querySelector('.header-actions'), host: () => doc.querySelector<HTMLElement>('.header-actions'),
      relocateActionMenu: () => { const menu = doc.getElementById('projects-list-action-menu'); if (menu && menu.parentElement !== doc.body) doc.body.append(menu); },
      wrapProjectsPage: () => {}, // initProjectsPage above preserves the selected project directly.
      setInterval: browser.setInterval, clearInterval: browser.clearInterval, logWarn: console.warn,
    });
    routerView.start();
    started = authReady;
    return started;
  }
  function installDomainEvents() {
    lifetime.on(doc, 'languagechange', () => {
      monitor.repaint(); run(() => chat.loadActiveTasks()); chat.refreshProgressAndTimelineI18n();
    });
    lifetime.on(doc, 'conversation-pinned-changed', event => {
      const data = event instanceof CustomEvent ? event.detail as { conversationId?: string; pinned?: boolean } : {};
      if (typeof data.conversationId === 'string') projects.updateChatProjectConversationPinnedState(data.conversationId, data.pinned === true);
      run(projects.refreshChatProjectFolders);
    });
    lifetime.on(doc, 'conversation-deleted', event => {
      const data = event instanceof CustomEvent ? event.detail as { conversationId?: string } : {};
      if (typeof data.conversationId === 'string') projects.removeChatProjectConversation(data.conversationId);
      run(projects.refreshChatProjectFolders);
    });
    lifetime.on(browser.events, 'hitl-interrupt', event => {
      const data = event instanceof CustomEvent ? event.detail as import('@/features/projects').Approval : {};
      projects.setProjectConversationApprovalStatus(data.conversationId || chat.currentConversationId(), true, data);
      if (currentPage() === 'hitl') run(hitl.view.refreshActivePanel);
    });
    lifetime.on(browser.events, 'hitl-resolved', event => {
      const data = event instanceof CustomEvent ? event.detail as { conversationId?: string } : {};
      projects.setProjectConversationApprovalStatus(data.conversationId || chat.currentConversationId(), false);
    });
    lifetime.on(browser.events, 'pageshow', () => { lifetime.later(() => hitl.service.reconcileUI(), 0); });
  }
  let disposal: Promise<void> | undefined;
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    lifetime.dispose(); resolveHitlReady(); stopSwitcher?.(); routerView.dispose(); pageLifecycle.dispose(); routerService.dispose();
    auth.dispose(); mobile.dispose(); notifications.dispose(); toolGuard.dispose();
    hitl.dispose(); monitor.controller.stopPolling(); monitor.dispose(); knowledge.dispose(); skills.dispose();
    storageFeature.dispose(); terminal.dispose(); tokens.dispose(); audit.dispose(); c2.dispose();
    orchestration.dispose(); tasks.dispose(); workflows.dispose(); vulnerability.dispose(); infoCollect.dispose(); assets.dispose();
    projects.dispose(); roles.dispose(); settings.dispose(); settingsBrowser.dispose(); dashboard.dispose(); toast.dispose();
    disposal = webshell.dispose(); return disposal;
  }
  return {
    auth,
    router: {
      service: routerService, view: routerView, currentPage, switchPage: navigate,
      navigateToConversation: routerView.navigateToConversation,
      syncChatConversationHash: (id: string) => { if (id.trim() && currentPage() === 'chat') routerService.replaceQuery({ conversation: id.trim() }); },
      clearChatConversationHash: () => { if (currentPage() === 'chat') routerService.replaceQuery({}); },
    },
    roles, projects: { ...projects, initProjectsPage, ensureProjectsLoaded }, assets, infoCollect, vulnerability,
    workflows, tasks, webshell,
    c2: { ...c2, downloadPayload: async (filename: string) => accessBrowser.download(await c2.service.downloadPayload(filename), filename) },
    audit, tokens, terminal, storage: storageFeature,
    skills, knowledge, monitor,
    hitl: { ...hitl, get ready() { return hitlReady; }, defaults: () => hitlDefaults, whitelist: () => hitlWhitelist },
    toolGuard, notifications, dashboard, mobile, settings,
    notify, start, dispose,
  };
}
export type DomainApplication = ReturnType<typeof createDomainApplication>;
