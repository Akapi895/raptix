import type { ProjectsContext } from './context';
import { filterActiveProjectsLocal, matchProjectSearchQuery } from './service';
import { createProjectFoldersService, sortProjectFolderConversations } from './folder-service';
import { createProjectApprovalBadges } from './approvals';
import { createProjectPreviews, folderIcon, type FolderProject } from './previews';
import { esc } from './dom';
import type { Approval, ProjectConversation, TaskSummary } from './types';

const UNASSIGNED = '__chat_unassigned_project__';
const menuIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
export function createProjectFolders(ctx: ProjectsContext, showMenu: (event: MouseEvent, id: string, source: string) => void) {
  const { service, dom, deps } = ctx;
  const model = createProjectFoldersService(service), badges = createProjectApprovalBadges(dom), previews = createProjectPreviews(ctx, model);
  const expanded = new Set<string>(); let query = '', lastQuery = '', lastSelection: string | null = null, visible = 6, sequence = 0;
  const create = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => { const node = dom.document.createElement(tag); node.className = className; return node; };
  function kinds(conversations: ProjectConversation[]) { const result: string[] = []; if (conversations.some(item => model.state.pending.has(item.id))) result.push('approval'); if (conversations.some(item => model.isUnread(item.id))) result.push('unread'); if (conversations.some(item => model.state.runningIds.has(item.id))) result.push('running'); return result; }
  function selectChatProjectConversationItem(id: string) { dom.document.querySelectorAll<HTMLElement>('.project-conversation-row').forEach(row => { const button = row.querySelector<HTMLElement>('.project-conversation-item'), selected = !!id && button?.dataset.conversationId === id; row.classList.toggle('is-selected', selected); button?.classList.toggle('is-selected', selected); if (selected) button?.setAttribute('aria-current', 'true'); else button?.removeAttribute('aria-current'); }); }
  function appendConversation(list: HTMLElement, item: ProjectConversation, project: FolderProject) {
    const selected = deps.getConversationId() === item.id, row = create('div', 'project-conversation-row' + (selected ? ' is-selected' : '')), button = create('button', 'project-conversation-item' + (selected ? ' is-selected' : ''));
    button.type = 'button'; button.dataset.conversationId = item.id; if (selected) button.setAttribute('aria-current', 'true');
    const label = create('span', 'project-conversation-label'), title = create('span', 'project-conversation-title'); title.textContent = item.title || dom.t('projects.untitledConversation'); label.append(title);
    if (item.pinned) { const pin = create('span', 'conversation-item-pinned project-conversation-pinned'); pin.textContent = '📌'; pin.title = dom.t('projects.pinned'); pin.setAttribute('aria-label', pin.title); label.append(pin); }
    const statuses: string[] = []; if (model.state.pending.has(item.id)) statuses.push('approval'); if (model.state.runningIds.has(item.id)) statuses.push('running'); else if (model.isUnread(item.id)) statuses.push('unread'); badges.append(label, statuses, model.state.pending.get(item.id)); button.append(label);
    button.addEventListener('click', () => ctx.run(async () => { previews.suppress(); selectChatProjectConversationItem(item.id); await deps.loadConversation(item.id); if (deps.getConversationId() === item.id && model.markViewed(item.id)) render(); }));
    const menu = create('button', 'project-conversation-menu'); menu.type = 'button'; menu.title = dom.t('chat.conversationActions'); menu.setAttribute('aria-label', menu.title); menu.innerHTML = menuIcon; menu.addEventListener('click', event => deps.openConversationContextMenu(event, item.id, item.title || ''));
    row.append(button, menu); list.append(row); previews.bindConversation(row, button, item, project);
  }
  function appendFolder(list: HTMLElement, project: FolderProject, conversations: ProjectConversation[]) {
    const id = project.unassigned ? UNASSIGNED : project.id, open = expanded.has(id);
    const row = create('div', 'project-folder-row' + (open ? ' is-expanded' : '') + (project.unassigned ? ' is-unassigned' : ''));
    const button = create('button', 'project-folder-item'); button.type = 'button'; button.dataset.projectId = project.id; button.dataset.folderId = id; button.setAttribute('aria-label', project.name || dom.t('common.untitled')); button.setAttribute('aria-expanded', String(open));
    const disclosure = create('span', 'project-folder-disclosure'); disclosure.setAttribute('aria-hidden', 'true'); disclosure.innerHTML = `<svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true"><path d="${open ? 'M3.5 5.5 7.5 9.5l4-4' : 'm5.5 3.5 4 4-4 4'}" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const icon = create('span', 'project-folder-icon'); icon.setAttribute('aria-hidden', 'true'); icon.innerHTML = folderIcon(open);
    const label = create('span', 'project-folder-label'), title = create('span', 'project-folder-title'); deps.applyProjectName(title, project.name, dom.t('common.untitled')); label.append(title);
    if (!project.unassigned && project.pinned) { const pin = create('span', 'project-folder-pinned'); pin.textContent = '📌'; pin.title = dom.t('projects.pinned'); pin.setAttribute('aria-label', pin.title); label.append(pin); }
    badges.append(label, kinds(conversations), undefined, conversations.filter(item => model.state.pending.has(item.id)).length); button.append(disclosure, icon, label);
    button.addEventListener('click', () => { if (open) expanded.delete(id); else expanded.add(id); render(); });
    const actions = create('div', 'project-folder-actions');
    if (!project.unassigned) { const menu = create('button', 'project-folder-action project-folder-menu'); menu.type = 'button'; menu.title = dom.t('projects.projectActions'); menu.setAttribute('aria-label', menu.title); menu.innerHTML = menuIcon; menu.addEventListener('click', event => showMenu(event, project.id, 'chat')); actions.append(menu); }
    const add = create('button', 'project-folder-action project-folder-new-conversation'); add.type = 'button'; add.title = dom.t(project.unassigned ? 'chat.newUnassignedConversation' : 'chat.newConversationInProject'); add.setAttribute('aria-label', add.title); add.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    add.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); expanded.add(id); ctx.run(async () => { await deps.startNewConversation({ projectId: project.id }); render(); }); }); actions.append(add); row.append(button, actions); list.append(row); previews.bindFolder(row, button, project, conversations);
  }
  function render() {
    const list = dom.el('project-folders-list'); if (!list) return; previews.hide();
    const current = deps.getConversationId(), conversation = model.state.conversations.find(item => item.id === current);
    const selected = current ? model.state.ready && conversation ? conversation.projectId || conversation.project_id || '' : null : service.getActiveProjectId();
    if (selected !== null && selected !== lastSelection) { expanded.add(selected || UNASSIGNED); lastSelection = selected; }
    const filtered = filterActiveProjectsLocal(service.state.allProjects, query);
    const unassigned: FolderProject = { id: '', name: dom.t('projects.noProject'), description: dom.t('projects.noProjectDescription'), pinned: false, unassigned: true };
    const projects: FolderProject[] = matchProjectSearchQuery(unassigned, query) ? [...filtered.filter(item => item.pinned), unassigned, ...filtered.filter(item => !item.pinned)] : filtered;
    if (query.toLocaleLowerCase() !== lastQuery) { visible = 6; lastQuery = query.toLocaleLowerCase(); }
    const selectedIndex = projects.findIndex(item => (item.unassigned ? UNASSIGNED : item.id) === (selected === null ? null : selected || UNASSIGNED)); if (selectedIndex >= visible) visible = selectedIndex + 1;
    list.replaceChildren();
    if (!projects.length) { const empty = create('div', 'project-folders-empty'); empty.textContent = dom.t(query ? 'chat.filterProjectSearchEmpty' : 'projects.noProjects'); list.append(empty); return; }
    for (const project of projects.slice(0, visible)) {
      const conversations = sortProjectFolderConversations(model.state.conversations.filter(item => (item.projectId || item.project_id || '') === project.id));
      appendFolder(list, project, conversations); if (expanded.has(project.unassigned ? UNASSIGNED : project.id)) for (const item of conversations) appendConversation(list, item, project);
    }
    if (projects.length > visible) { const more = create('button', 'project-folders-load-more'); more.type = 'button'; more.setAttribute('aria-label', dom.fmt('chat.projectFoldersLoadMoreRemaining', `${dom.t('common.loadMore')} — ${projects.length - visible} projects remaining`, { count: projects.length - visible })); more.innerHTML = `<span>${esc(dom.t('common.loadMore'))}</span><span class="project-folders-load-more-count">${projects.length - visible}</span>`; more.addEventListener('click', loadMoreChatProjectFolders); list.append(more); }
  }
  async function refreshChatProjectFolders() {
    if (!dom.el('project-folders-list')) return; const seq = ++sequence;
    if (!service.isProjectsCacheReady()) dom.html('project-folders-list', `<div class="project-folders-empty">${esc(dom.t('common.loading'))}</div>`);
    try { await Promise.all([service.ensureProjectsLoaded(), model.load()]); if (seq === sequence) render(); }
    catch (error) { if (seq === sequence) dom.html('project-folders-list', `<div class="project-folders-empty">${esc(dom.t('projects.loadProjectsFailed'))}</div>`); console.warn(error); }
  }
  function loadMoreChatProjectFolders() { visible += 6; if (service.isProjectsCacheReady() && model.state.ready) render(); else ctx.run(refreshChatProjectFolders); }
  function handleProjectFolderSearch(value: string) { query = value.trim(); const clear = dom.el('conversation-search-clear'); if (clear) clear.style.display = query ? 'flex' : 'none'; if (service.isProjectsCacheReady() && model.state.ready) render(); else ctx.run(refreshChatProjectFolders); }
  return { model, render, previews, refreshChatProjectFolders, loadMoreChatProjectFolders, handleProjectFolderSearch, selectChatProjectConversationItem,
    clearProjectFolderSearch() { dom.setValue('conversation-search-input', ''); handleProjectFolderSearch(''); dom.field('conversation-search-input')?.focus(); },
    markCurrentProjectConversationViewed() { const changed = model.markViewed(deps.getConversationId()); if (changed) render(); return changed; },
    updateProjectFolderTaskStatuses(tasks: TaskSummary[]) { const finished = model.updateTasks(tasks); render(); if (finished) ctx.run(refreshChatProjectFolders); },
    setProjectConversationApprovalStatus(id: string, pending: boolean, details?: Approval) { model.setApproval(id, pending, details); render(); },
    syncProjectConversationApprovalStatuses(items: Approval[]) { model.syncApprovals(items); render(); },
    updateChatProjectConversationPinnedState(id: string, pinned: boolean) { const changed = model.setPinned(id, pinned); render(); return changed; },
    removeChatProjectConversation(id: string) { const changed = model.remove(id); previews.hide(); render(); return changed; },
    dispose() { sequence++; badges.dispose(); previews.dispose(); },
  };
}
