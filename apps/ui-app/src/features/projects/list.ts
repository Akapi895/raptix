import { projectsBrowser as browser } from '../../platform/projects-browser';
import type { ProjectsContext } from './context';
import { esc, formatProjectTime } from './dom';
import { sortProjectsForPicker } from './service';

export function createProjectList(ctx: ProjectsContext, refreshSelects: () => void) {
  const { service, deps, dom } = ctx, { t, fmt } = dom;
  let menuTarget = '', menuSource = '';
  function updateProjectsDetailVisibility() { const show = !!service.state.selectedId; dom.el('projects-detail-main')?.classList.toggle('has-project', show); dom.hidden('projects-detail-placeholder', show); dom.hidden('projects-detail-inner', !show); }
  function renderProjectsPagination() {
    const { page, pageSize, total } = service.state, pages = Math.max(1, Math.ceil(total / pageSize));
    const start = total ? (page - 1) * pageSize + 1 : 0, end = total ? Math.min(page * pageSize, total) : 0;
    const nav = (target: number, disabled: boolean, key: string, label: string) => `<button type="button" class="btn-icon-pagination" data-action="projects.page" data-page="${target}" ${disabled ? 'disabled' : ''} title="${esc(t(key))}" aria-label="${esc(t(key))}">${label}</button>`;
    dom.hidden('projects-pagination', false);
    dom.html('projects-pagination', `<div class="sidebar-list-pagination-inner sidebar-list-pagination-inner--compact"><span class="pagination-info">${esc(fmt('projects.paginationRange', `${start}-${end}/${total}`, { start, end, total }))}</span><div class="pagination-controls">${nav(page - 1, page <= 1 || !total, 'projects.paginationPrev', '‹')}<span class="pagination-page">${esc(fmt('projects.paginationPage', `${page}/${pages}`, { page, total: pages }))}</span>${nav(page + 1, page >= pages || !total, 'projects.paginationNext', '›')}</div><label class="pagination-page-size">${esc(t('projects.paginationPerPage'))}<select id="projects-page-size-pagination" class="projects-filter-select-native">${[20, 50, 100].map(size => `<option value="${size}" ${size === pageSize ? 'selected' : ''}>${size}</option>`).join('')}</select></label></div>`);
    refreshSelects();
  }
  function renderProjectsSidebar() {
    dom.text('projects-list-count', String(service.state.total || service.state.projects.length));
    const projects = service.state.projects;
    if (!projects.length) dom.html('projects-list', `<div class="projects-empty">${esc(t('projects.noProjects'))}${deps.hasPermission('project:write') ? `<br><button type="button" class="btn-primary btn-small projects-empty-btn" data-action="projects.showNewProjectModal">${esc(t('projects.newProject'))}</button>` : ''}</div>`);
    else dom.html('projects-list', projects.map(project => `<div class="projects-list-item${project.id === service.state.selectedId ? ' is-active' : ''}${project.status === 'archived' ? ' is-archived' : ''}" data-id="${esc(project.id)}" data-action="projects.select"><div class="projects-list-item-body"><div class="projects-list-item-name" title="${esc(project.name || t('common.untitled'))}">${esc(deps.formatProjectName(project.name || t('common.untitled')))}${project.pinned ? `<span class="projects-list-item-badge">${esc(t('projects.pinned'))}</span>` : ''}${project.status === 'archived' ? `<span class="projects-list-item-badge">${esc(t('projects.archived'))}</span>` : ''}</div><div class="projects-list-item-meta">${esc(formatProjectTime(t, project.updated_at))}</div></div><button type="button" class="projects-list-item-menu" data-action="projects.menu" data-id="${esc(project.id)}" title="${esc(t('projects.projectActions'))}" aria-label="${esc(t('projects.projectActions'))}">⋯</button></div>`).join(''));
    updateProjectsDetailVisibility(); const root = dom.el('projects-list'); if (root) deps.applyRBAC(root);
  }
  function renderDetail() {
    const project = service.state.project; if (!project) return;
    const title = dom.el('projects-detail-title'); if (title) deps.applyProjectName(title, project.name.trim() || t('projects.defaultProjectName'));
    dom.text('projects-detail-desc', (project.description || '').trim()); dom.hidden('projects-detail-desc', !project.description?.trim());
    const desc = dom.el('projects-detail-desc'); if (desc) { if (project.description?.trim()) desc.title = project.description.trim(); else desc.removeAttribute('title'); }
    for (const [id, value] of [['name', project.name], ['description', project.description || ''], ['scope', project.scope_json || ''], ['status', project.status || 'active']] as const) dom.setValue(`project-edit-${id}`, value);
    dom.setChecked('project-edit-pinned', project.pinned);
    renderDetailLabels(); refreshSelects();
  }
  function renderDetailLabels() {
    const project = service.state.project; if (!project) return;
    dom.text('projects-detail-status', t(project.status === 'archived' ? 'projects.statusArchived' : 'projects.statusActive'));
    const pill = dom.el('projects-detail-status'); if (pill) pill.className = 'projects-status-pill projects-status-pill--' + (project.status === 'archived' ? 'archived' : 'active');
    const time = formatProjectTime(t, project.updated_at); dom.text('projects-detail-meta-time', time); const meta = dom.el('projects-detail-meta'); if (meta) meta.title = fmt('projects.updatedPrefix', `Updated ${time}`, { time });
  }
  async function loadProjectsList() {
    service.invalidate(); await service.fetchProjectsList(dom.checked('projects-show-archived'));
    renderProjectsSidebar(); renderProjectsPagination();
    try { const all = await service.fetchAllProjects(dom.checked('projects-show-archived')); service.replaceProjectsCache(all); }
    catch (error) { console.warn(error); }
    await ctx.refreshSelector(); await deps.refreshProjectFilters();
  }
  async function goProjectsPage(page: number) {
    const totalPages = Math.max(1, Math.ceil(service.state.total / service.state.pageSize)), next = Math.min(Math.max(1, page), totalPages);
    if (next === service.state.page) return;
    await service.fetchProjectsList(dom.checked('projects-show-archived'), { page: next }); renderProjectsSidebar(); renderProjectsPagination(); const list = dom.el('projects-list'); if (list) list.scrollTop = 0;
  }
  async function filterProjectsList() { await service.fetchProjectsList(dom.checked('projects-show-archived'), { page: 1, search: dom.value('projects-list-search').trim().toLowerCase() }); renderProjectsSidebar(); renderProjectsPagination(); }
  async function changeProjectsPageSize() { if (!service.setListSize(Number(dom.value('projects-page-size-pagination')))) return; await service.fetchProjectsList(dom.checked('projects-show-archived'), { page: 1 }); renderProjectsSidebar(); renderProjectsPagination(); }
  function closeProjectListActionMenu() { const menu = dom.el('projects-list-action-menu'); if (menu) menu.style.display = 'none'; menuTarget = ''; menuSource = ''; }
  function showProjectListActionMenu(event: MouseEvent, id: string, source = '') {
    event.stopPropagation(); event.preventDefault();
    const menu = dom.el('projects-list-action-menu'); if (!menu) return;
    if (menuTarget === id && menu.style.display === 'block') return closeProjectListActionMenu();
    closeProjectListActionMenu(); const project = service.findProjectById(id); if (!project) return; menuTarget = id; menuSource = source;
    dom.text('projects-list-menu-edit-text', t(source === 'chat' ? 'projects.renameProject' : 'projects.editProject'));
    dom.text('projects-list-menu-pin-text', t(project.pinned ? 'projects.unpinProjectAction' : 'projects.pinProjectAction'));
    dom.text('projects-list-menu-archive-text', t(project.status === 'archived' ? 'projects.restoreProjectActive' : 'projects.archiveProject')); dom.text('projects-list-menu-delete-text', t('projects.deleteProject'));
    menu.style.display = 'block'; menu.style.visibility = 'visible'; menu.style.opacity = '1';
    const rect = menu.getBoundingClientRect(), viewport = browser.viewport();
    menu.style.left = `${event.clientX + rect.width > viewport.width ? Math.max(8, event.clientX - rect.width) : event.clientX}px`;
    menu.style.top = `${event.clientY + rect.height > viewport.height ? Math.max(8, event.clientY - rect.height) : event.clientY}px`; deps.applyRBAC(menu);
  }
  async function toggleProjectPinnedFromListMenu() {
    const id = menuTarget, project = service.findProjectById(id); closeProjectListActionMenu(); if (!project || !deps.requirePermission('project:write')) return;
    const pinned = !project.pinned; await service.saveProject(id, { pinned });
    for (const list of [service.state.projects, service.state.allProjects]) for (const item of list) if (item.id === id) item.pinned = pinned;
    service.state.projects = sortProjectsForPicker(service.state.projects); service.state.allProjects = sortProjectsForPicker(service.state.allProjects);
    renderProjectsSidebar(); await loadProjectsList();
  }
  async function toggleProjectArchiveById(id: string) {
    const project = service.findProjectById(id); if (!project || !deps.requirePermission('project:write')) return;
    const status = project.status === 'archived' ? 'active' : 'archived'; if (!browser.confirm(t(status === 'archived' ? 'projects.confirmArchiveProject' : 'projects.confirmRestoreProjectActive'))) return;
    await service.saveProject(id, { status }); await loadProjectsList();
    if (service.state.selectedId === id) await ctx.select(service.state.projects.some(project => project.id === id) ? id : service.state.projects[0]?.id || '');
  }
  async function deleteProjectById(id: string) {
    if (!id || !deps.requirePermission('project:delete') || !browser.confirm(t('projects.confirmDeleteProject'))) return;
    const index = service.state.projects.findIndex(project => project.id === id);
    await service.deleteProject(id); await loadProjectsList(); const next = service.state.projects[Math.min(Math.max(0, index), service.state.projects.length - 1)]; await ctx.select(next?.id || '');
  }
  return { renderProjectsSidebar, renderProjectsPagination, renderDetail, renderDetailLabels, updateProjectsDetailVisibility, loadProjectsList, goProjectsPage, filterProjectsList, changeProjectsPageSize, closeProjectListActionMenu, showProjectListActionMenu, toggleProjectPinnedFromListMenu, toggleProjectArchiveById, deleteProjectById,
    editProjectFromListMenu() { const id = menuTarget, fromChatSidebar = menuSource === 'chat'; closeProjectListActionMenu(); if (id) ctx.run(() => ctx.showEditProject(id, { fromChatSidebar })); },
    async toggleProjectArchiveFromListMenu() { const id = menuTarget; closeProjectListActionMenu(); if (id) await toggleProjectArchiveById(id); },
    async deleteProjectFromListMenu() { const id = menuTarget; closeProjectListActionMenu(); if (id) await deleteProjectById(id); },
    archiveCurrentProject: () => toggleProjectArchiveById(service.state.selectedId), deleteCurrentProject: () => deleteProjectById(service.state.selectedId),
  };
}
