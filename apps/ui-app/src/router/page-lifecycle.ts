import type { PageId, Route } from './service';

type Hook = () => unknown;
export interface PageLifecycleDependencies {
  stopExternalMcpPoll?: Hook;
  refreshDashboard?: Hook;
  prefetchProjectsForChat?: Hook;
  refreshChatProjectSelector?: Hook;
  loadToolGuardConfig?: Hook;
  refreshHitlActivePanel?: Hook;
  refreshHitlPending?: Hook;
  initInfoCollectPage?: Hook;
  loadAssetOverview?: Hook;
  loadAssets?: Hook;
  initTasksPage?: Hook;
  refreshMonitorPanel?: Hook;
  startMonitorPoll?: Hook;
  prepareToolsPagination?: Hook;
  loadToolsList?: (page: number, search: string) => unknown;
  loadExternalMCPs?: Hook;
  startExternalMcpPoll?: Hook;
  hasPermission?: (permission: string) => boolean;
  loadConfig?: (loadTools: boolean, options?: { silent: boolean }) => unknown;
  initProjectsPage?: Hook;
  initVulnerabilityPage?: Hook;
  initWebshellPage?: Hook;
  initChatFilesPage?: Hook;
  refreshTokenUsage?: Hook;
  loadRoles?: Hook;
  renderRolesList?: Hook;
  refreshWorkflows?: Hook;
  loadSkillsMonitor?: Hook;
  initSkillsPagination?: Hook;
  loadSkills?: Hook;
  loadKnowledgeCategories?: Hook;
  loadKnowledgePage?: Hook;
  updateIndexProgress?: Hook;
  loadRetrievalLogs?: Hook;
  stopKnowledgeIndexPoll?: Hook;
  initC2?: (page: PageId) => unknown;
  cleanupTasksPage?: Hook;
  stopTokenUsageRequests?: Hook;
  onError(error: unknown): void;
}

/** Router orchestration only: all cross-domain work is injected, never fetched here. */
export function createPageLifecycle(root: Document, deps: PageLifecycleDependencies) {
  let sequence = 0;
  let activePage: PageId | null = null;
  let toolsTimer: ReturnType<typeof setTimeout> | undefined;
  function run(hook: Hook | undefined): void {
    if (!hook) return;
    try { void Promise.resolve(hook()).catch(deps.onError); } catch (error) { deps.onError(error); }
  }
  function invalidate(): void { sequence++; activePage = null; clearTimeout(toolsTimer); }
  function resetSearch(name: string): void {
    const input = root.querySelector<HTMLInputElement>('#' + name + '-search');
    if (input) input.value = '';
    const clear = root.getElementById(name + '-search-clear');
    if (clear) clear.style.display = 'none';
  }
  function init(route: Route, sectionHandled = false): void {
    invalidate();
    const token = sequence;
    const page = route.page;
    activePage = page;
    run(deps.stopExternalMcpPoll);
    switch (page) {
      case 'dashboard': run(deps.refreshDashboard); break;
      case 'chat': run(deps.prefetchProjectsForChat); run(deps.refreshChatProjectSelector); break;
      case 'tool-guard': run(deps.loadToolGuardConfig); break;
      case 'hitl': run(deps.refreshHitlActivePanel ?? deps.refreshHitlPending); break;
      case 'info-collect': run(deps.initInfoCollectPage); break;
      case 'asset-overview': run(deps.loadAssetOverview); break;
      case 'asset-library': run(deps.loadAssets); break;
      case 'tasks': run(deps.initTasksPage); break;
      case 'mcp-monitor': run(deps.refreshMonitorPanel); run(deps.startMonitorPoll); break;
      case 'mcp-management': {
        const afterConfig = () => {
          if (sequence !== token) return;
          run(deps.prepareToolsPagination);
          if (deps.loadToolsList) toolsTimer = setTimeout(() => {
            if (sequence === token) run(() => deps.loadToolsList?.(1, ''));
          }, 100);
          run(deps.loadExternalMCPs);
          run(deps.startExternalMcpPoll);
        };
        if (deps.loadConfig && (deps.hasPermission?.('config:read') ?? true)) {
          void Promise.resolve().then(() => deps.loadConfig?.(false, { silent: true })).catch(deps.onError).then(afterConfig);
        } else afterConfig();
        break;
      }
      case 'projects': run(deps.initProjectsPage); break;
      case 'vulnerabilities': run(deps.initVulnerabilityPage); break;
      case 'webshell': run(deps.initWebshellPage); break;
      case 'chat-files': run(deps.initChatFilesPage); break;
      case 'settings':
        run(() => deps.loadConfig?.(false));
        // A deep-link section callback already performs its own load.
        if (!sectionHandled) {
          if (root.getElementById('settings-section-token-usage')?.classList.contains('active')) run(deps.refreshTokenUsage);
        }
        break;
      case 'roles-management':
        resetSearch('roles');
        if (deps.loadRoles) run(async () => { await deps.loadRoles?.(); if (sequence === token) await deps.renderRolesList?.(); });
        break;
      case 'workflows': run(deps.refreshWorkflows); break;
      case 'skills-monitor': run(deps.loadSkillsMonitor); break;
      case 'skills-management': resetSearch('skills'); run(deps.initSkillsPagination); run(deps.loadSkills); break;
      case 'c2-listeners': case 'c2-sessions': case 'c2-activity': case 'c2-tasks': case 'c2-payloads': case 'c2-events': case 'c2-profiles':
        run(() => deps.initC2?.(page)); break;
      // These hooks used to live in knowledge.js's switchPage wrapper. They must
      // also run for service-owned hash changes and delegated navigation now.
      case 'knowledge-management':
        run(deps.loadKnowledgeCategories); run(deps.loadKnowledgePage);
        if (deps.updateIndexProgress) run(async () => {
          try { await deps.updateIndexProgress?.(); }
          finally { if (activePage !== 'knowledge-management') run(deps.stopKnowledgeIndexPoll); }
        });
        break;
      case 'knowledge-retrieval-logs': run(deps.loadRetrievalLogs); break;
    }
    if (page !== 'tasks') run(deps.cleanupTasksPage);
    if (page !== 'knowledge-management') run(deps.stopKnowledgeIndexPoll);
    if (page !== 'settings') run(deps.stopTokenUsageRequests);
  }
  return { init, invalidate, dispose: invalidate };
}
