// The navbar project switcher: one dropdown that holds exactly one project, and scopes the whole app to it. Picking a project changes the
// chat's conversation filter, the open page, and the scoped views. The selector never shows "all" or "unbound": a conversation without a
// project is not listed while a project is picked.

export interface SwitcherProject {
  id: string;
  name?: string;
  status?: string;
}

export interface SwitcherPorts {
  doc: Document;
  getActive(): string;
  setActive(projectId: string): void;
  setConversationFilter(projectId: string): void;
  currentPage(): string;
  selectProject(projectId: string): Promise<unknown> | void;
  refreshDashboard(): void;
  loadConversations(query: string): void;
  conversationsSearchQuery(): string;
  fetchProjectsList(): Promise<unknown> | undefined;
  getJson(path: string): Promise<unknown>;
  projectName(projectId: string): string | undefined;
  showNewProjectModal(): void;
  showProjectActionMenu(event: Event, projectId: string): void;
  t(key: string, fallback: string): string;
  /** Whether the header and the project actions exist: the switcher starts only then. */
  ready(): boolean;
  /** Where the switcher is placed: the navbar's action area. */
  host(): HTMLElement | null;
  /** The shared project action menu lives in the projects page, which is hidden on other pages: it is moved to the body. */
  relocateActionMenu(): void;
  /** Keeps the projects page on the active project when it is opened. */
  wrapProjectsPage(): void;
  setInterval(callback: () => void, ms: number): number;
  clearInterval(handle: number): void;
  logWarn(message: string, error: unknown): void;
}

export const SWITCHER_ID = 'csai-project-switcher';

const FOLDER_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h4l2 2h6A2.5 2.5 0 0 1 20.5 8.5v8A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5v-10Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
const CARET_SVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 12l5 5L20 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const RELOAD_MS = 1500;
const FAST_POLL_MS = 250;
const FAST_POLL_TRIES = 80;

function isActive(project: SwitcherProject): boolean {
  return project.status !== 'archived';
}

function listFrom(data: unknown): SwitcherProject[] {
  const record = data as { projects?: SwitcherProject[]; items?: SwitcherProject[] } | null;
  return (record && (record.projects || record.items)) || [];
}

/** Starts the switcher: builds it when the header is ready, keeps its label in step, and picks an active project on start. */
export function startProjectSwitcher(ports: SwitcherPorts): () => void {
  const { doc } = ports;
  let projects: SwitcherProject[] = [];
  let applying = false;
  let inited = false;
  let lastLabelId: string | null = null;
  const timers: number[] = [];

  const el = (tag: string, cls?: string, html?: string): HTMLElement => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  };

  async function fetchProjects(): Promise<SwitcherProject[]> {
    try {
      const list = await ports.fetchProjectsList();
      if (Array.isArray(list)) return (list as SwitcherProject[]).filter(isActive);
    } catch { /* the API read below is the fallback */ }
    try {
      return listFrom(await ports.getJson('/api/projects?status=active&limit=200')).filter(isActive);
    } catch {
      return [];
    }
  }

  function nameOf(id: string): string {
    if (!id) return '';
    const name = ports.projectName(id);
    if (name && name !== id) return name;
    const project = projects.find(item => item.id === id);
    return project ? (project.name || project.id) : id;
  }

  function updateLabel(id: string): void {
    lastLabelId = id || '';
    const wrap = doc.getElementById(SWITCHER_ID);
    const label = wrap?.querySelector<HTMLElement>('.csai-ps-label');
    if (!label) return;
    label.textContent = id ? nameOf(id) : ports.t('projects.noProjectSelected', 'No project');
  }

  /** Makes the picked project the one the whole app shows. A second call while one runs is dropped. */
  async function applyActiveProject(id: string): Promise<void> {
    if (!id || applying) return;
    applying = true;
    try {
      ports.setActive(id);
      ports.setConversationFilter(id);
      const page = ports.currentPage();
      if (page === 'projects') {
        try { await ports.selectProject(id); } catch (error) { ports.logWarn('selectProject failed', error); }
      } else if (page === 'dashboard') {
        ports.refreshDashboard();
      } else if (page === 'chat') {
        ports.loadConversations(ports.conversationsSearchQuery());
      }
      updateLabel(id);
    } finally {
      applying = false;
    }
  }

  function closePanel(wrap: HTMLElement, panel: HTMLElement): void {
    panel.hidden = true;
    wrap.classList.remove('is-open');
  }

  function paintOptions(listWrap: HTMLElement, panel: HTMLElement, filterText: string): void {
    const active = ports.getActive();
    listWrap.innerHTML = '';
    const query = filterText.trim().toLowerCase();
    const shown = projects.filter(project => !query || (project.name || '').toLowerCase().indexOf(query) !== -1);
    if (!shown.length) {
      listWrap.appendChild(el('div', 'csai-ps-empty', query
        ? ports.t('projects.noMatchingProjects', 'No matching projects')
        : ports.t('projects.noProjectsYet', 'No projects yet')));
      return;
    }
    shown.forEach(project => {
      const option = el('button', 'csai-ps-option' + (project.id === active ? ' is-active' : '')) as HTMLButtonElement;
      option.type = 'button';
      option.innerHTML = '<span class="csai-ps-opt-name"></span><span class="csai-ps-option-check">' + CHECK_SVG + '</span>';
      const name = option.querySelector('.csai-ps-opt-name');
      if (name) name.textContent = project.name || project.id;
      option.addEventListener('click', event => {
        event.stopPropagation();
        const wrap = doc.getElementById(SWITCHER_ID);
        if (wrap) closePanel(wrap, panel);
        void applyActiveProject(project.id);
      });
      listWrap.appendChild(option);
    });
  }

  async function renderPanel(panel: HTMLElement): Promise<void> {
    projects = await fetchProjects();
    panel.innerHTML = '';
    const search = el('input', 'csai-ps-search') as HTMLInputElement;
    search.type = 'search';
    search.placeholder = ports.t('projects.searchProjects', 'Search projects…');
    panel.appendChild(search);
    const listWrap = el('div', 'csai-ps-list');
    panel.appendChild(listWrap);
    search.addEventListener('input', () => paintOptions(listWrap, panel, search.value));
    search.addEventListener('click', event => event.stopPropagation());
    paintOptions(listWrap, panel, '');

    const create = el('button', 'csai-ps-create', '<span>+</span><span></span>') as HTMLButtonElement;
    create.type = 'button';
    const label = create.querySelector('span:last-child');
    if (label) label.textContent = ports.t('projects.newProject', 'New project');
    create.addEventListener('click', event => {
      event.stopPropagation();
      const wrap = doc.getElementById(SWITCHER_ID);
      if (wrap) closePanel(wrap, panel);
      ports.showNewProjectModal();
    });
    panel.appendChild(create);
  }

  async function openPanel(wrap: HTMLElement, panel: HTMLElement): Promise<void> {
    panel.hidden = false;
    wrap.classList.add('is-open');
    await renderPanel(panel);
    panel.querySelector<HTMLElement>('.csai-ps-search')?.focus();
  }

  function buildSwitcher(host: HTMLElement): void {
    const wrap = el('div', 'csai-project-switcher');
    wrap.id = SWITCHER_ID;

    const trigger = el('button', 'csai-ps-trigger') as HTMLButtonElement;
    trigger.type = 'button';
    trigger.innerHTML = '<span class="csai-ps-icon">' + FOLDER_SVG + '</span><span class="csai-ps-label">—</span><span class="csai-ps-caret">' + CARET_SVG + '</span>';

    const actions = el('div', 'csai-ps-actions');
    const addButton = el('button', 'csai-ps-iconbtn', '+') as HTMLButtonElement;
    addButton.type = 'button';
    addButton.title = ports.t('projects.newProject', 'New project');
    const menuButton = el('button', 'csai-ps-iconbtn', '⋯') as HTMLButtonElement;
    menuButton.type = 'button';
    menuButton.title = ports.t('projects.projectActions', 'Project actions');
    actions.appendChild(addButton);
    actions.appendChild(menuButton);

    const panel = el('div', 'csai-ps-panel');
    panel.hidden = true;
    wrap.appendChild(trigger);
    wrap.appendChild(actions);
    wrap.appendChild(panel);
    host.insertBefore(wrap, host.firstChild);

    trigger.addEventListener('click', event => {
      event.stopPropagation();
      if (panel.hidden) void openPanel(wrap, panel);
      else closePanel(wrap, panel);
    });
    addButton.addEventListener('click', event => {
      event.stopPropagation();
      closePanel(wrap, panel);
      ports.showNewProjectModal();
    });
    menuButton.addEventListener('click', event => {
      event.stopPropagation();
      closePanel(wrap, panel);
      const id = ports.getActive();
      if (id) ports.showProjectActionMenu(event, id);
    });
    doc.addEventListener('click', event => {
      if (!wrap.contains(event.target as Node)) closePanel(wrap, panel);
    });
  }

  function ensureMounted(): boolean {
    const host = ports.host();
    if (!host) return false;
    if (!doc.getElementById(SWITCHER_ID)) buildSwitcher(host);
    ports.relocateActionMenu();
    return true;
  }

  /** Picks the active project on start: the saved one if it still exists, else the first project. */
  async function initActiveProject(): Promise<void> {
    if (inited) return;
    inited = true;
    projects = await fetchProjects();
    let active = ports.getActive();
    if (!active || !projects.some(project => project.id === active)) active = projects[0]?.id ?? '';
    if (active) void applyActiveProject(active);
    else updateLabel('');
  }

  function boot(): boolean {
    if (!ports.ready()) return false;
    ensureMounted();
    ports.wrapProjectsPage();
    void initActiveProject();
    return true;
  }

  ports.wrapProjectsPage();
  let tries = 0;
  const fastPoll = ports.setInterval(() => {
    tries += 1;
    if (boot() || tries > FAST_POLL_TRIES) ports.clearInterval(fastPoll);
  }, FAST_POLL_MS);
  timers.push(fastPoll);

  // Keeps the switcher present and its label in step. A cleared active project (after deleting it) picks the first one again.
  timers.push(ports.setInterval(() => {
    if (!ports.host()) return;
    if (!doc.getElementById(SWITCHER_ID)) { ensureMounted(); return; }
    const active = ports.getActive();
    if (active) {
      if (active !== lastLabelId) updateLabel(active);
      return;
    }
    if (inited && !applying) {
      void fetchProjects().then(list => {
        projects = list;
        if (list[0]) void applyActiveProject(list[0].id);
        else updateLabel('');
      });
    }
  }, RELOAD_MS));

  return () => {
    timers.forEach(timer => ports.clearInterval(timer));
    doc.getElementById(SWITCHER_ID)?.remove();
  };
}
