import { projectsBrowser as browser } from '../../platform/projects-browser';
import { filterActiveProjectsLocal } from './service';
import { esc } from './dom';
import type { ProjectsContext } from './context';
import type { PickerConfig, PickerKey } from './types';

export function createProjectPicker(ctx: ProjectsContext, renderFolders: () => void, foldersReady: () => boolean) {
  const { service, dom, deps } = ctx;
  const states: Record<PickerKey, { sequence: number; timer?: ReturnType<typeof setTimeout> }> = { chat: { sequence: 0 }, webshell: { sequence: 0 } };
  const bound = new WeakSet<HTMLElement>(); let normalizing: Promise<void> | undefined;
  const getChatProjectSelection = () => deps.getConversationId() ? deps.getConversationProjectId() : service.getActiveProjectId();
  function clearProjectPickerPanelSearch(key: PickerKey, inputId: string) { const state = states[key]; state.sequence++; clearTimeout(state.timer); state.timer = undefined; dom.setValue(inputId, ''); }
  function scheduleProjectPickerPanelSearch(key: PickerKey, load: () => void | Promise<void>) { const state = states[key]; clearTimeout(state.timer); state.timer = setTimeout(() => { state.timer = undefined; ctx.run(load); }, 100); }
  function initProjectPickerPanelSearch(key: PickerKey, inputId: string, search: () => void) {
    const input = dom.el(inputId); if (!input || bound.has(input)) return; bound.add(input);
    input.addEventListener('input', search); input.addEventListener('keydown', event => { if (event.key === 'Escape') { if (key === 'chat') closeChatProjectPanel(); else deps.closeWebshellProjectPanel(); } });
  }
  async function renderProjectPickerPanel(key: PickerKey, config: PickerConfig) {
    const state = states[key], list = dom.el(config.listId); if (!list) return;
    const query = dom.value(config.searchInputId).trim(), seq = ++state.sequence, selectedId = config.getSelectedId(), t = config.t || dom.t;
    const append = (project: { id: string; name: string; description?: string }) => {
      const none = !project.id, selected = none ? !selectedId : selectedId === project.id;
      const desc = none ? project.description || '' : project.description?.trim() || t('projects.sharedFactBoard');
      const button = dom.document.createElement('button'); button.type = 'button'; button.className = 'role-selection-item-main' + (selected ? ' selected' : ''); button.setAttribute('role', 'option'); button.setAttribute('aria-label', project.name || t('common.untitled')); button.setAttribute('data-selection-detail', desc);
      button.addEventListener('click', () => ctx.run(() => config.onSelect(project.id)));
      button.innerHTML = `<div class="role-selection-item-icon-main">${none ? '—' : '📁'}</div><div class="role-selection-item-content-main"><div class="role-selection-item-name-main" title="${esc(project.name || t('common.untitled'))}">${esc(deps.formatProjectName(project.name || t('common.untitled')))}</div><div class="role-selection-item-description-main">${esc(none ? desc : desc.slice(0, 80))}</div></div>${selected ? '<div class="role-selection-checkmark-main">✓</div>' : ''}`;
      list.append(button);
    };
    const none = () => append({ id: '', name: t('projects.noProject'), description: t('projects.noProjectDescription') });
    const message = (text: string, loading = false) => { const node = dom.document.createElement('div'); node.className = loading ? 'chat-project-panel-loading' : 'chat-project-panel-empty'; node.textContent = text; list.append(node); };
    if (!service.isProjectsCacheReady()) { list.replaceChildren(); none(); message(t('common.loading'), true); }
    try {
      const all = await service.ensureProjectsLoaded(); if (seq !== state.sequence) return;
      list.replaceChildren(); none(); const filtered = filterActiveProjectsLocal(all, query); filtered.forEach(append); if (query && !filtered.length) message(t('chat.filterProjectSearchEmpty'));
    } catch { if (seq !== state.sequence) return; list.replaceChildren(); none(); message(t('chat.filterProjectSearchFailed')); }
  }
  const loadChatProjectPanelList = () => renderProjectPickerPanel('chat', { listId: 'chat-project-list', searchInputId: 'chat-project-search', getSelectedId: getChatProjectSelection, onSelect: selectChatProject });
  function updateChatProjectButtonLabel() { const text = dom.el('chat-project-text'); if (text) { const id = getChatProjectSelection(); deps.applyProjectName(text, id && service.names[id] ? service.names[id] : dom.t('projects.noProject')); deps.refreshChatWelcomeEmptyState(); } }
  async function ensureChatProjectButtonLabel() { const id = getChatProjectSelection().trim(); if (id && !service.names[id]) await service.fetchProjectSummary(id); updateChatProjectButtonLabel(); }
  function normalizeStaleChatProjectSelection(): Promise<void> {
    if (normalizing) return normalizing;
    const raw = getChatProjectSelection().trim(), conversationId = deps.getConversationId();
    if (!raw) return Promise.resolve();
    const request = (async () => {
      const project = await service.fetchProjectSummary(raw);
      if (project && project.status !== 'archived') return;
      if (deps.getConversationId() !== conversationId || getChatProjectSelection().trim() !== raw) return;
      if (conversationId) { deps.setConversationProjectId(''); try { await service.api.bindConversation(conversationId, ''); } catch (error) { console.warn(error); } }
      else service.setActiveProjectId('');
    })().finally(() => { if (normalizing === request) normalizing = undefined; });
    normalizing = request; return request;
  }
  function closeChatProjectPanel() {
    const panel = dom.el('chat-project-panel'); if (panel) panel.style.display = 'none'; const button = dom.el('chat-project-btn'); button?.classList.remove('active'); button?.setAttribute('aria-expanded', 'false'); clearProjectPickerPanelSearch('chat', 'chat-project-search');
  }
  async function renderChatProjectPanel() {
    initProjectPickerPanelSearch('chat', 'chat-project-search', () => scheduleProjectPickerPanelSearch('chat', loadChatProjectPanelList));
    clearProjectPickerPanelSearch('chat', 'chat-project-search'); await loadChatProjectPanelList(); const panel = dom.el('chat-project-panel'); if (panel) deps.applyRBAC(panel); browser.frame(() => dom.field('chat-project-search')?.focus());
  }
  async function toggleChatProjectPanel() {
    const panel = dom.el('chat-project-panel'); if (!panel) return;
    if (panel.style.display && panel.style.display !== 'none') return closeChatProjectPanel();
    deps.closeOtherChatPanels(); panel.style.display = 'flex'; const button = dom.el('chat-project-btn'); button?.classList.add('active'); button?.setAttribute('aria-expanded', 'true'); await renderChatProjectPanel();
  }
  async function applyChatProjectSelection(id: string) {
    if (id === getChatProjectSelection()) { updateChatProjectButtonLabel(); await ctx.refreshFolders(); return; }
    const conversationId = deps.getConversationId();
    if (conversationId) {
      try { await service.api.bindConversation(conversationId, id); if (deps.getConversationId() === conversationId) deps.setConversationProjectId(id); deps.notify(dom.t(id ? 'projects.projectBound' : 'projects.projectUnbound'), 'success'); }
      catch (error) { browser.alert(dom.t('projects.updateProjectBindingFailed') + ': ' + (error instanceof Error ? error.message : String(error))); updateChatProjectButtonLabel(); return; }
    } else service.setActiveProjectId(id);
    updateChatProjectButtonLabel(); await ctx.refreshFolders(); deps.onConversationProjectBindingChanged(id);
  }
  async function selectChatProject(id: string) { closeChatProjectPanel(); await applyChatProjectSelection(id || ''); }
  async function refreshChatProjectSelector(options: { renderFolders?: boolean; reloadFolders?: boolean } = {}) {
    if (!dom.el('chat-project-btn')) return;
    try { await normalizeStaleChatProjectSelection(); await ensureChatProjectButtonLabel(); } catch (error) { console.warn(error); }
    if (options.renderFolders !== false) { if (options.reloadFolders !== false || !service.isProjectsCacheReady() || !foldersReady()) await ctx.refreshFolders(); else renderFolders(); }
    if (dom.el('chat-project-panel')?.style.display === 'flex') await loadChatProjectPanelList();
  }
  function prefetchProjectsForChat() { const id = getChatProjectSelection().trim(); if (id && !service.names[id]) ctx.run(() => service.fetchProjectSummary(id)); ctx.run(async () => { await service.ensureProjectsLoaded(); deps.refreshConversationProjectFilter(); }); }
  return { getChatProjectSelection, resolveChatProjectSelection: getChatProjectSelection, normalizeStaleChatProjectSelection, clearProjectPickerPanelSearch, scheduleProjectPickerPanelSearch, initProjectPickerPanelSearch, renderProjectPickerPanel, loadChatProjectPanelList, updateChatProjectButtonLabel, ensureChatProjectButtonLabel, renderChatProjectPanel, closeChatProjectPanel, toggleChatProjectPanel, applyChatProjectSelection, selectChatProject, refreshChatProjectSelector, prefetchProjectsForChat,
    onChatProjectChange: () => applyChatProjectSelection(getChatProjectSelection()),
    dispose() { for (const state of Object.values(states)) { state.sequence++; clearTimeout(state.timer); } },
  };
}
