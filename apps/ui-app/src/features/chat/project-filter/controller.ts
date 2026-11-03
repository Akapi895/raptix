// The project filter of the conversation list: which project the list shows (remembered between visits), the options of
// its dropdown and their search, and the heading the sidebar takes for the filter in use.

import type { CustomSelects } from './select';
import { NONE_VALUE } from './select';

export const FILTER_STORAGE_KEY = 'raptix.conversations_project_filter';
export const FILTER_SELECT_ID = 'conversation-project-filter';

export interface ProjectLike {
  id: string;
  name?: string;
  status?: string;
}

export interface FilterDependencies {
  doc: Document;
  t(key: string, fallback: string, values?: Record<string, unknown>): string;
  storage: { get(key: string): string | null; set(key: string, value: string): boolean; remove(key: string): boolean };
  projectNames(): Record<string, string>;
  ensureProjectsLoaded(): Promise<ProjectLike[]>;
  isProjectsCacheReady(): boolean;
  filterActiveProjects(projects: ProjectLike[], query: string): ProjectLike[];
  fetchProjectSummary(id: string): Promise<ProjectLike | null>;
  reloadList(): void;
  selects: CustomSelects;
}

export interface ConversationProjectFilter {
  get(): string;
  set(projectId: string): void;
  /** Rebuilds the native options with the saved filter, and drops the filter when its project is gone. */
  refreshOptions(): Promise<void>;
  /** Re-reads the options of a project select for its search text. */
  loadOptions(selectId: string): Promise<void>;
  /** Rebuilds the options of any project select with the value it holds, dropping it when its project is gone. */
  refreshSelect(selectId: string): Promise<void>;
  onChange(projectId: string): void;
  /** The heading of the recent-conversations section for the filter in use. */
  updateSidebarTitle(): void;
  initSelect(): void;
  syncSelect(): void;
}

export function createConversationProjectFilter(deps: FilterDependencies): ConversationProjectFilter {
  const { doc, t, storage } = deps;

  function get(): string {
    return storage.get(FILTER_STORAGE_KEY) || '';
  }

  function set(projectId: string): void {
    const value = (projectId || '').trim();
    if (value) storage.set(FILTER_STORAGE_KEY, value);
    else storage.remove(FILTER_STORAGE_KEY);
    const select = doc.getElementById(FILTER_SELECT_ID) as HTMLSelectElement | null;
    if (select && select.value !== value) select.value = value;
    syncSelect();
    updateSidebarTitle();
  }

  function syncSelect(): void {
    deps.selects.syncProject(FILTER_SELECT_ID);
  }

  function initSelect(): void {
    deps.selects.initProject(FILTER_SELECT_ID);
  }

  function pinnedNativeOptions(select: HTMLSelectElement): void {
    select.innerHTML = '';
    const all = doc.createElement('option');
    all.value = '';
    all.textContent = t('chat.filterAllProjects', 'All projects');
    all.setAttribute('data-i18n', 'chat.filterAllProjects');
    select.appendChild(all);
    const unbound = doc.createElement('option');
    unbound.value = NONE_VALUE;
    unbound.textContent = t('chat.filterUnboundProjects', 'Unbound');
    unbound.setAttribute('data-i18n', 'chat.filterUnboundProjects');
    select.appendChild(unbound);
  }

  async function resolveSelection(projectId: string): Promise<string> {
    const saved = (projectId || '').trim();
    if (!saved || saved === NONE_VALUE) return saved;
    const project = await deps.fetchProjectSummary(saved);
    if (!project || !project.id || project.status === 'archived') return '';
    return project.id;
  }

  async function appendSelectedOption(select: HTMLSelectElement, projectId: string): Promise<void> {
    const id = (projectId || '').trim();
    if (!id || id === NONE_VALUE) return;
    if (Array.prototype.some.call(select.options, (option: HTMLOptionElement) => option.value === id)) return;
    const project = await deps.fetchProjectSummary(id);
    const label = (project && (project.name || project.id)) || deps.projectNames()[id] || id;
    const option = doc.createElement('option');
    option.value = id;
    option.textContent = label;
    select.appendChild(option);
  }

  async function refreshOptions(): Promise<void> {
    const select = doc.getElementById(FILTER_SELECT_ID) as HTMLSelectElement | null;
    if (!select) return;
    const saved = get();
    pinnedNativeOptions(select);
    const normalized = await resolveSelection(saved);
    if (normalized && normalized !== NONE_VALUE) await appendSelectedOption(select, normalized);
    if (normalized !== saved) set(normalized);
    select.value = normalized;
    syncSelect();
    updateSidebarTitle();
  }

  /** The search results of a project select: the pinned entries, then the projects that match the search text. */
  async function loadOptions(selectId: string): Promise<void> {
    const reg = deps.selects.registry[selectId];
    if (!reg?.optionsList) return;
    const query = (reg.searchInput?.value || '').trim();
    const seq = ++reg.filterSearchSeq;
    const needsFetch = !deps.isProjectsCacheReady();
    let loading: HTMLElement | null = null;
    if (needsFetch) {
      deps.selects.renderPinnedOptions(reg);
      loading = deps.selects.statusMessage(reg.optionsList, 'conversation-project-filter-status', t('common.loading', 'Loading…'));
    }
    try {
      const all = await deps.ensureProjectsLoaded();
      if (seq !== reg.filterSearchSeq) return;
      deps.selects.renderPinnedOptions(reg);
      const selected = reg.select.value;
      const pinned = new Set(['', NONE_VALUE]);
      const projects = deps.filterActiveProjects(all, query);
      projects.forEach(project => {
        if (pinned.has(project.id)) return;
        reg.optionsList?.appendChild(deps.selects.optionButton(project.id, project.name || project.id, selected));
      });
      if (query && projects.length === 0) {
        deps.selects.statusMessage(reg.optionsList as HTMLElement, 'conversation-project-filter-empty', t('chat.filterProjectSearchEmpty', 'No matching projects'));
      }
    } catch {
      if (seq !== reg.filterSearchSeq) return;
      deps.selects.renderPinnedOptions(reg);
      deps.selects.statusMessage(reg.optionsList as HTMLElement, 'conversation-project-filter-empty', t('chat.filterProjectSearchFailed', 'Failed to load projects. Try again.'));
    } finally {
      if (loading?.parentNode) loading.remove();
    }
  }

  function onChange(projectId: string): void {
    set(projectId || '');
    deps.reloadList();
  }

  function updateSidebarTitle(): void {
    const title = doc.querySelector<HTMLElement>('.recent-conversations-section .section-title');
    if (!title) return;
    const filter = get();
    const names = deps.projectNames();
    if (filter && filter !== NONE_VALUE) {
      const name = names[filter] || filter;
      const full = t('chat.projectConversationsTitle', `${name} · conversations`, { name });
      title.textContent = full;
      title.title = full;
      title.classList.add('section-title--filtered');
      title.removeAttribute('data-i18n');
    } else if (filter === NONE_VALUE) {
      const full = t('chat.unboundConversationsTitle', 'Unbound conversations');
      title.textContent = full;
      title.title = full;
      title.classList.add('section-title--filtered');
      title.setAttribute('data-i18n', 'chat.unboundConversationsTitle');
    } else {
      title.classList.remove('section-title--filtered');
      title.removeAttribute('title');
      title.setAttribute('data-i18n', 'chat.recentConversations');
      title.textContent = t('chat.recentConversations', 'Recent conversations');
    }
  }

  async function refreshSelect(selectId: string): Promise<void> {
    const select = doc.getElementById(selectId) as HTMLSelectElement | null;
    if (!select) return;
    pinnedNativeOptions(select);
    const normalized = await resolveSelection(select.value || '');
    if (normalized && normalized !== NONE_VALUE) await appendSelectedOption(select, normalized);
    select.value = normalized;
    deps.selects.syncProject(selectId);
  }

  return { get, set, refreshOptions, loadOptions, refreshSelect, onChange, updateSidebarTitle, initSelect, syncSelect };
}
