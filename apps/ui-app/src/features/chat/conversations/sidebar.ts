// The conversation sidebar around the list: the collapsible "recent conversations" section and its count, the search box,
// and the structure the sidebar takes on (the project folders section and the recent section). The upgrade is idempotent:
// a sidebar that already has the structure is left as it is.

export const RECENT_EXPANDED_STORAGE_KEY = 'raptix-chat-recent-conversations-expanded';

export interface SidebarDependencies {
  doc: Document;
  t(key: string, fallback: string): string;
  storage: { get(key: string): string | null; set(key: string, value: string): boolean };
  applyTranslations(root: HTMLElement): void;
  toggleRecent(): void;
}

export interface SidebarController {
  setRecentExpanded(expanded: boolean, options?: { persist?: boolean }): void;
  restoreRecentState(): void;
  toggleRecent(): void;
  updateRecentCount(total: unknown): void;
  /** Turns the sidebar of an older page into the current structure; a no-op when it already is. */
  ensureStructure(): void;
}

export function createSidebarController(deps: SidebarDependencies): SidebarController {
  const { doc, t } = deps;
  const byId = (id: string) => doc.getElementById(id);

  function setRecentExpanded(expanded: boolean, options: { persist?: boolean } = {}): void {
    const open = !!byId('chat-conversation-picker') || !!expanded;
    const section = byId('recent-conversations-section');
    const toggle = byId('recent-conversations-toggle');
    const body = byId('recent-conversations-body') as HTMLElement | null;
    const pagination = byId('conversations-pagination') as HTMLElement | null;
    if (section) section.classList.toggle('is-collapsed', !open);
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (toggle && byId('chat-conversation-picker')) { toggle.tabIndex = -1; toggle.setAttribute('aria-disabled', 'true'); }
    if (body) body.hidden = !open;
    if (pagination) pagination.hidden = !open || !pagination.childElementCount;
    if (options.persist !== false) deps.storage.set(RECENT_EXPANDED_STORAGE_KEY, open ? '1' : '0');
  }

  function restoreRecentState(): void {
    setRecentExpanded(deps.storage.get(RECENT_EXPANDED_STORAGE_KEY) === '1', { persist: false });
  }

  function toggleRecent(): void {
    const toggle = byId('recent-conversations-toggle');
    const expanded = toggle?.getAttribute('aria-expanded') === 'true';
    setRecentExpanded(!expanded);
  }

  function updateRecentCount(total: unknown): void {
    const count = byId('recent-conversations-count');
    if (count) count.textContent = String(Math.max(0, Number(total) || 0));
  }

  function ensureStructure(): void {
    // The task picker reuses the list, pagination and context actions without a sidebar.
    if (byId('chat-conversation-picker')) return;
    const sidebar = byId('conversation-sidebar');
    const content = sidebar?.querySelector<HTMLElement>('.sidebar-content');
    if (!sidebar || !content) return;

    const newTask = sidebar.querySelector<HTMLElement>('.new-chat-btn span:last-child');
    if (newTask) {
      newTask.setAttribute('data-i18n', 'chat.newTask');
      newTask.textContent = t('chat.newTask', 'New task');
    }

    const searchInput = byId('conversation-search-input') as HTMLInputElement | null;
    if (searchInput) {
      searchInput.setAttribute('data-i18n', 'projects.searchProjectsPlaceholder');
      searchInput.setAttribute('data-i18n-attr', 'placeholder');
      searchInput.setAttribute('data-act-keypress', '[["$ifKey","Enter"],["handleProjectFolderSearch","$value"]]');
      searchInput.placeholder = t('projects.searchProjectsPlaceholder', 'Search projects…');
    }
    byId('conversation-search-clear')?.setAttribute('data-action', 'projects.clearProjectFolderSearch');

    const projectFilter = content.querySelector<HTMLElement>('.conversation-project-filter');
    if (projectFilter) projectFilter.hidden = true;

    let projectSection = content.querySelector<HTMLElement>('.project-folders-section');
    const legacySection = content.querySelector<HTMLElement>('.task-folders-section');
    if (!projectSection && legacySection) {
      projectSection = legacySection;
      projectSection.className = 'project-folders-section';
      projectSection.setAttribute('aria-labelledby', 'project-folders-title');
      const legacyHeader = projectSection.querySelector<HTMLElement>('.task-folders-header');
      if (legacyHeader) legacyHeader.className = 'section-header project-folders-header';
      const legacyTitle = projectSection.querySelector<HTMLElement>('#task-folders-title');
      if (legacyTitle) {
        legacyTitle.id = 'project-folders-title';
        legacyTitle.setAttribute('data-i18n', 'chat.projectFolders');
        legacyTitle.textContent = t('chat.projectFolders', 'Projects');
      }
      const legacyList = projectSection.querySelector<HTMLElement>('#task-folders-list');
      if (legacyList) {
        legacyList.id = 'project-folders-list';
        legacyList.className = 'project-folders-list';
        legacyList.removeAttribute('role');
        legacyList.innerHTML = '';
      }
    }
    if (!projectSection) {
      projectSection = doc.createElement('section');
      projectSection.className = 'project-folders-section';
      projectSection.setAttribute('aria-labelledby', 'project-folders-title');
      projectSection.innerHTML =
        '<div class="section-header project-folders-header">' +
          '<span id="project-folders-title" class="section-title" data-i18n="chat.projectFolders">Projects</span>' +
          '<button type="button" class="add-group-btn project-folders-add-btn" data-require-permission="project:write" data-act-click=\'[["showNewProjectModalFromChatSidebar"]]\' data-i18n="projects.newProject" data-i18n-attr="title,aria-label" data-i18n-skip-text="true" title="New project" aria-label="New project">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '</button>' +
        '</div>' +
        '<div id="project-folders-list" class="project-folders-list"></div>';
      const searchBox = content.querySelector('.conversation-search-box');
      if (searchBox) searchBox.insertAdjacentElement('afterend', projectSection);
      else content.insertBefore(projectSection, content.firstChild);
    }

    const projectHeader = projectSection.querySelector<HTMLElement>('.project-folders-header');
    if (projectHeader && !projectHeader.querySelector('.project-folders-add-btn')) {
      const add = doc.createElement('button');
      add.type = 'button';
      add.className = 'add-group-btn project-folders-add-btn';
      add.dataset.requirePermission = 'project:write';
      add.setAttribute('data-act-click', '[["showNewProjectModalFromChatSidebar"]]');
      add.setAttribute('data-i18n', 'projects.newProject');
      add.setAttribute('data-i18n-attr', 'title,aria-label');
      add.setAttribute('data-i18n-skip-text', 'true');
      add.title = t('projects.newProject', 'New project');
      add.setAttribute('aria-label', add.title);
      add.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      projectHeader.appendChild(add);
    }

    const recent = content.querySelector<HTMLElement>('.recent-conversations-section');
    if (recent) {
      recent.id = 'recent-conversations-section';
      recent.classList.add('is-collapsed');
      if (!byId('recent-conversations-toggle')) upgradeRecentSection(recent);
    }

    deps.applyTranslations(sidebar);
  }

  /** The older recent section: its header becomes a toggle, and its list moves into a collapsible body. */
  function upgradeRecentSection(recent: HTMLElement): void {
    const oldHeader = recent.querySelector<HTMLElement>(':scope > .section-header');
    const title = oldHeader?.querySelector<HTMLElement>('.section-title');
    const actions = oldHeader?.querySelector<HTMLElement>('.section-header-actions');
    const list = recent.querySelector<HTMLElement>('#conversations-list');

    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.id = 'recent-conversations-toggle';
    toggle.className = 'section-header recent-conversations-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'recent-conversations-body');
    toggle.setAttribute('data-i18n', 'chat.toggleRecentConversations');
    toggle.setAttribute('data-i18n-attr', 'title,aria-label');
    toggle.setAttribute('data-i18n-skip-text', 'true');
    toggle.title = t('chat.toggleRecentConversations', 'Expand/collapse recent conversations');
    toggle.setAttribute('aria-label', toggle.title);
    toggle.addEventListener('click', () => deps.toggleRecent());
    if (title) toggle.appendChild(title);
    else toggle.innerHTML = '<span class="section-title" data-i18n="chat.recentConversations">Recent conversations</span>';

    const meta = doc.createElement('span');
    meta.className = 'recent-conversations-toggle-meta';
    meta.innerHTML =
      '<span id="recent-conversations-count" class="recent-conversations-count">0</span>' +
      '<svg class="recent-conversations-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    toggle.appendChild(meta);

    const body = doc.createElement('div');
    body.id = 'recent-conversations-body';
    body.className = 'recent-conversations-body';
    body.hidden = true;
    if (actions) {
      actions.classList.add('recent-conversations-actions');
      body.appendChild(actions);
    }
    if (list) body.appendChild(list);
    oldHeader?.remove();
    recent.prepend(toggle);
    recent.appendChild(body);
  }

  return { setRecentExpanded, restoreRecentState, toggleRecent, updateRecentCount, ensureStructure };
}
