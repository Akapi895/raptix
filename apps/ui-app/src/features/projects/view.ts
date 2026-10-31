import { projectsBrowser as browser } from '../../platform/projects-browser';
import { createProjectsDom } from './dom';
import { createProjectForms } from './forms';
import { createProjectTables } from './tables';
import { createProjectGraph } from './graph';
import { createProjectList } from './list';
import { createProjectFolders } from './folders';
import { createProjectPicker } from './picker';
import { createProjectsSelects } from './selects';
import type { ProjectsContext } from './context';
import type { ProjectsDependencies, ProjectTab } from './types';
import type { ProjectsService } from './service';

const tabs: ProjectTab[] = ['facts', 'graph', 'assets', 'conversations', 'vulns', 'settings'];
export function createProjectsView(document: Document, deps: ProjectsDependencies, service: ProjectsService) {
  const dom = createProjectsDom(document, deps.translate);
  let mounted = false, disposed = false;
  const cleanups: (() => void)[] = [], timers = new Map<string, ReturnType<typeof setTimeout>>();
  const run = (work: () => void | Promise<unknown>) => { try { Promise.resolve(work()).catch(error => deps.notifyApiError(error instanceof Error ? error.message : String(error))); } catch (error) { deps.notifyApiError(error instanceof Error ? error.message : String(error)); } };
  const ctx: ProjectsContext = {
    service, deps, dom, run,
    reload: () => list.loadProjectsList(), select: id => selectProject(id), refreshStats: () => tables.refreshProjectHeaderStats(),
    refreshFacts: () => tables.loadProjectFacts(), refreshGraph: () => graph.loadProjectFactGraph(), refreshVulnerabilities: () => tables.loadProjectVulnerabilities(),
    refreshFolders: () => folders.refreshChatProjectFolders(), refreshSelector: options => picker.refreshChatProjectSelector(options),
    applyChatProject: id => picker.applyChatProjectSelection(id), closeChatPanel: () => picker.closeChatProjectPanel(),
    showEditProject: (id, options) => forms.showEditProjectModal(id, options), showEditFact: key => forms.showEditFactModal(key), showFact: key => forms.viewProjectFactBody(key),
    showNewFact: () => forms.showAddFactModal(), openVulnerability: id => tables.openVulnerabilityDetail(id), renderSidebar: () => list.renderProjectsSidebar(),
  };
  const selects = createProjectsSelects(dom, {
    'project-facts-filter-category': () => run(ctx.refreshFacts), 'project-facts-filter-confidence': () => run(ctx.refreshFacts),
    'project-graph-view': () => run(ctx.refreshGraph), 'project-vulns-filter-severity': () => run(ctx.refreshVulnerabilities), 'project-vulns-filter-status': () => run(ctx.refreshVulnerabilities),
    'projects-page-size-pagination': () => run(() => list.changeProjectsPageSize()),
  });
  const forms = createProjectForms(ctx), tables = createProjectTables(ctx), graph = createProjectGraph(ctx), list = createProjectList(ctx, selects.refresh);
  const folders = createProjectFolders(ctx, list.showProjectListActionMenu), picker = createProjectPicker(ctx, folders.render, () => folders.model.state.ready);
  function debounce(key: string, work: () => void | Promise<void>) { clearTimeout(timers.get(key)); timers.set(key, setTimeout(() => { timers.delete(key); run(work); }, 280)); }
  async function selectProject(id: string) {
    graph.reset();
    for (const field of ['project-facts-search', 'project-facts-filter-category', 'project-facts-filter-confidence', 'project-vulns-search', 'project-vulns-filter-severity', 'project-vulns-filter-status']) dom.setValue(field, '');
    dom.setChecked('project-facts-filter-sparse', false); selects.syncAll();
    const loading = service.selectProject(id); list.renderProjectsSidebar(); list.updateProjectsDetailVisibility();
    const project = await loading; if (!project || disposed) return;
    list.renderDetail(); await tables.refreshProjectHeaderStats(); if (id === service.state.selectedId) switchProjectTab(service.state.tab);
  }
  function switchProjectTab(tab: string) {
    let next: ProjectTab = tabs.find(value => value === tab) ?? 'facts';
    if (next === 'assets' && !deps.hasPermission('asset:read')) next = 'facts'; service.state.tab = next;
    for (const key of tabs) { dom.el(`project-tab-${key}`)?.classList.toggle('is-active', key === next); dom.el(`project-tab-${key}`)?.setAttribute('aria-selected', String(key === next)); dom.hidden(`project-panel-${key}`, key !== next); }
    if (next === 'facts') run(ctx.refreshFacts); if (next === 'graph') run(ctx.refreshGraph); if (next === 'assets') run(() => tables.loadProjectAssets()); if (next === 'conversations') run(tables.loadProjectConversations); if (next === 'vulns') run(ctx.refreshVulnerabilities);
  }
  async function initProjectsPage() {
    const page = dom.el('page-projects'); if (!page || page.style.display === 'none') return;
    deps.syncModalBodyLock(); list.updateProjectsDetailVisibility(); selects.refresh(); list.renderProjectsPagination(); await list.loadProjectsList();
    const fromHash = new URLSearchParams(browser.hash().split('?')[1] || '').get('id');
    const id = service.state.selectedId || fromHash || service.state.projects[0]?.id || '';
    if (id) await selectProject(id); else list.renderProjectsSidebar();
  }
  const actions: Record<string, (element: HTMLElement, event: Event) => void | Promise<void>> = {
    select: element => selectProject(element.dataset.id || ''), page: element => list.goProjectsPage(Number(element.dataset.page)),
    menu: (element, event) => { if (event instanceof MouseEvent) list.showProjectListActionMenu(event, element.dataset.id || ''); },
    'edit-fact': element => forms.showEditFactModal(element.dataset.key || ''), 'view-fact': element => forms.viewProjectFactBody(element.dataset.key || ''),
    'delete-fact': element => tables.deleteProjectFact(element.dataset.id || ''), 'restore-fact': element => tables.restoreProjectFactByKey(element.dataset.key || ''), 'deprecate-fact': element => tables.deprecateProjectFactByKey(element.dataset.key || ''),
    'assets-page': element => tables.loadProjectAssets(Number(element.dataset.page)), 'asset-detail': element => tables.openProjectAssetDetail(Number(element.dataset.index)), 'unbind-asset': element => tables.unbindAssetFromProject(Number(element.dataset.index)),
    'open-conversation': element => tables.openProjectConversation(element.dataset.id || ''), 'promote-conversation': element => tables.promoteConversationAttackChain(element.dataset.id || ''), 'unbind-conversation': element => tables.unbindConversationFromProject(element.dataset.id || ''),
    'open-vulnerability': element => tables.openVulnerabilityDetail(element.dataset.id || ''), 'vulnerability-facts': element => tables.viewFactsForVulnerability(element.dataset.id || ''),
    'focus-edge': element => graph.focusProjectFactGraphEdge(element.dataset.edgeId || ''), 'delete-edge': element => graph.deleteProjectFactEdge(element.dataset.edgeId || ''),
    tab: element => switchProjectTab(element.dataset.tab || 'facts'), template: element => forms.insertFactBodyTemplate(element.dataset.kind || 'attack'),
  };
  // Exact, finite bindings for existing shell attributes. No source strings are
  // evaluated or interpreted; dynamic markup is emitted with data-actions.
  const simpleActions: Record<string, () => void | Promise<void>> = {
    loadProjectsList: list.loadProjectsList, showNewProjectModal: () => forms.showNewProjectModal(), showNewProjectModalFromChat: forms.showNewProjectModalFromChat,
    showNewProjectModalFromChatSidebar: forms.showNewProjectModalFromChatSidebar, saveProjectModal: forms.saveProjectModal, closeProjectModal: forms.closeProjectModal,
    showAddFactModal: forms.showAddFactModal, saveFactModal: forms.saveFactModal, closeFactModal: forms.closeFactModal, closeFactDetailModal: forms.closeFactDetailModal,
    saveProjectSettings: forms.saveProjectSettings, archiveCurrentProject: list.archiveCurrentProject, deleteCurrentProject: list.deleteCurrentProject,
    editProjectFromListMenu: list.editProjectFromListMenu, toggleProjectPinnedFromListMenu: list.toggleProjectPinnedFromListMenu, toggleProjectArchiveFromListMenu: list.toggleProjectArchiveFromListMenu, deleteProjectFromListMenu: list.deleteProjectFromListMenu,
    toggleChatProjectPanel: picker.toggleChatProjectPanel, closeChatProjectPanel: picker.closeChatProjectPanel, clearProjectFolderSearch: folders.clearProjectFolderSearch,
    openVulnerabilitiesForProject: () => tables.openVulnerabilitiesForProject(), loadProjectFacts: tables.loadProjectFacts, loadProjectFactGraph: graph.loadProjectFactGraph,
    centerProjectFactGraph: graph.centerProjectFactGraph, toggleProjectFactGraphConnectMode: graph.toggleProjectFactGraphConnectMode, closeProjectFactGraphSidebar: graph.closeProjectFactGraphSidebar,
    openSelectedGraphFactDetail: graph.openSelectedGraphFactDetail, editSelectedGraphFact: graph.editSelectedGraphFact,
    formatProjectScopeJson: forms.formatProjectScopeJson, insertProjectScopeExample: forms.insertProjectScopeExample,
    linkFactToExistingVulnerability: forms.linkFactToExistingVulnerability, createVulnerabilityFromCurrentFact: forms.createVulnerabilityFromCurrentFact, editFactFromDetail: forms.editFactFromDetail,
  };
  Object.entries(simpleActions).forEach(([name, work]) => { actions[name] = () => work(); });
  function bindStatic() {
    for (const [id, close] of [['project-modal', forms.closeProjectModal], ['fact-modal', forms.closeFactModal], ['fact-detail-modal', forms.closeFactDetailModal]] as const) {
      const overlay = dom.el(id); if (!overlay) continue;
      const listener = (event: Event) => { if (event.target === overlay) close(); }; overlay.addEventListener('click', listener); cleanups.push(() => overlay.removeEventListener('click', listener));
    }
    const inputs: [string, string, () => void][] = [
      ['projects-list-search', 'input', () => debounce('list', list.filterProjectsList)], ['project-facts-search', 'input', () => debounce('facts', tables.loadProjectFacts)],
      ['project-vulns-search', 'input', () => debounce('vulns', tables.loadProjectVulnerabilities)], ['project-graph-search', 'input', graph.filterProjectFactGraph],
      ['conversation-search-input', 'input', () => folders.handleProjectFolderSearch(dom.value('conversation-search-input'))],
      ['projects-show-archived', 'change', () => run(list.loadProjectsList)], ['project-facts-filter-sparse', 'change', () => run(ctx.refreshFacts)], ['project-facts-filter-hide-deprecated', 'change', () => run(ctx.refreshFacts)],
      ['fact-modal-key', 'input', forms.updateFactFormHints], ['fact-modal-summary', 'input', forms.updateFactFormHints], ['fact-modal-body', 'input', forms.updateFactFormHints], ['fact-modal-category', 'change', forms.updateFactFormHints],
    ];
    for (const [id, type, listener] of inputs) { const element = dom.el(id); if (!element) continue; element.addEventListener(type, listener); cleanups.push(() => element.removeEventListener(type, listener)); }
  }
  function mount() {
    if (mounted || disposed) return; mounted = true; bindStatic(); selects.refresh();
    const click = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null, element = target?.closest<HTMLElement>('[data-action^="projects."]');
      if (element) { if (element instanceof HTMLButtonElement && element.disabled) return; const action = actions[(element.dataset.action || '').slice(9)]; if (action) { event.preventDefault(); event.stopPropagation(); run(() => action(element, event)); } }
      if (!target?.closest('#projects-list-action-menu, .projects-list-item-menu, .project-folder-menu')) list.closeProjectListActionMenu();
      if (!target?.closest('.project-selector-wrapper')) picker.closeChatProjectPanel();
    };
    const change = (event: Event) => { const target = event.target; if (target instanceof HTMLSelectElement && target.dataset.change === 'projects.assets-size') run(() => tables.changeProjectAssetsPageSize(target.value)); };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return; list.closeProjectListActionMenu(); folders.previews.hide();
      if (deps.isModalOpen('project-modal')) forms.closeProjectModal(); else if (deps.isModalOpen('fact-modal')) forms.closeFactModal(); else if (deps.isModalOpen('fact-detail-modal')) forms.closeFactDetailModal();
    };
    const language = () => { list.renderProjectsSidebar(); list.renderProjectsPagination(); selects.syncAll(); picker.updateChatProjectButtonLabel(); run(ctx.refreshFolders); if (dom.el('chat-project-panel')?.style.display === 'flex') run(picker.loadChatProjectPanelList); if (service.state.selectedId) { list.renderDetailLabels(); run(ctx.refreshStats); switchProjectTab(service.state.tab); } };
    document.addEventListener('click', click); document.addEventListener('change', change); document.addEventListener('keydown', keydown); document.addEventListener('languagechange', language);
    cleanups.push(() => { document.removeEventListener('click', click); document.removeEventListener('change', change); document.removeEventListener('keydown', keydown); document.removeEventListener('languagechange', language); });
    const mark = () => folders.markCurrentProjectConversationViewed();
    const container = document.querySelector('#page-chat .chat-container'); container?.addEventListener('pointerdown', mark, { passive: true }); container?.addEventListener('focusin', mark); dom.el('chat-input')?.addEventListener('input', mark);
    cleanups.push(() => { container?.removeEventListener('pointerdown', mark); container?.removeEventListener('focusin', mark); dom.el('chat-input')?.removeEventListener('input', mark); });
    const footer = document.querySelector<HTMLElement>('.project-fact-graph-footer');
    const wheel = (event: WheelEvent) => { if (!footer || footer.scrollWidth <= footer.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return; const next = Math.max(0, Math.min(footer.scrollWidth - footer.clientWidth, footer.scrollLeft + event.deltaY)); if (next !== footer.scrollLeft) { footer.scrollLeft = next; event.preventDefault(); } };
    footer?.addEventListener('wheel', wheel, { passive: false }); cleanups.push(() => footer?.removeEventListener('wheel', wheel));
    run(() => picker.refreshChatProjectSelector());
  }
  return { ...forms, ...tables, ...list, ...picker, ...folders, ...graph, initProjectsPage, selectProject, switchProjectTab, mount,
    debouncedLoadProjectFacts: () => debounce('facts', tables.loadProjectFacts), debouncedLoadProjectVulnerabilities: () => debounce('vulns', tables.loadProjectVulnerabilities), filterProjectsList: () => debounce('list', list.filterProjectsList),
    refreshProjectsFilterSelects: selects.refresh, syncAllProjectsFilterSelects: selects.syncAll,
    dispose() { disposed = true; cleanups.forEach(cleanup => cleanup()); timers.forEach(timer => clearTimeout(timer)); selects.dispose(); picker.dispose(); folders.dispose(); graph.dispose(); },
  };
}
