import { storage, type KeyValueStorage } from '../../platform/storage';
import { HttpError } from '../../platform/http';
import { createProjectsApi, type ProjectsApi } from './client';
import type { CreateProjectRequest, UpdateProjectRequest } from '../../api/types/project';
import type { FactInput, ListOptions, ParsedProjects, Project, ProjectsSnapshot } from './types';

const ACTIVE = 'raptix.activeProjectId';
const LIST_SIZE = 'raptix.projects_list_page_size';
const ASSET_SIZE = 'raptix.project_assets_page_size';
export function parseProjectsListResponse(data: Awaited<ReturnType<ProjectsApi['list']>>): ParsedProjects {
  if (Array.isArray(data)) return { items: data, total: data.length, limit: data.length, offset: 0, isLegacyArray: true };
  const items = data.projects ?? data.items ?? [];
  const count = (raw: number | string | undefined, fallback: number) => {
    const n = typeof raw === 'number' ? raw : Number.parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return { items, total: count(data.total, items.length), limit: count(data.limit, items.length) || items.length, offset: count(data.offset, 0), isLegacyArray: false };
}
export function matchProjectSearchQuery(project: Pick<Project, 'id' | 'name' | 'description'>, query = ''): boolean {
  const q = query.trim().toLowerCase();
  return !q || [project.id, project.name, project.description].some(value => (value ?? '').toLowerCase().includes(q));
}
export function sortProjectsForPicker(projects: Project[]): Project[] {
  const updated = (project: Project) => project.updated_at || (typeof project.updatedAt === 'string' ? project.updatedAt : '');
  return [...projects].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || updated(b).localeCompare(updated(a)));
}
export function filterActiveProjectsLocal(projects: Project[], query = ''): Project[] {
  return sortProjectsForPicker(projects.filter(p => p.id && p.status !== 'archived' && matchProjectSearchQuery(p, query)));
}

export function createProjectsService(api: ProjectsApi = createProjectsApi(), persistence: KeyValueStorage = storage) {
  const savedSize = (key: string, allowed: number[], fallback: number) => { const size = Number(persistence.get(key)); return allowed.includes(size) ? size : fallback; };
  const state: ProjectsSnapshot = {
    projects: [], allProjects: [], selectedId: '', project: null, tab: 'facts', page: 1,
    pageSize: savedSize(LIST_SIZE, [20, 50, 100], 50), total: 0, search: '',
    assets: [], assetsPage: 1, assetsPageSize: savedSize(ASSET_SIZE, [10, 20, 50, 100], 20), assetsTotal: 0, assetsTotalPages: 1, graph: null,
  };
  const names: Record<string, string> = {};
  let ready = false;
  let cacheGeneration = 0;
  let allRequest: Promise<Project[]> | null = null;
  let listSequence = 0;
  let selectionSequence = 0;
  let assetsSequence = 0;
  let graphSequence = 0;
  const subscribers = new Set<() => void>();
  const emit = () => subscribers.forEach(listener => listener());
  function remember(list: Project[]) { for (const p of list) if (p.id) names[p.id] = p.name || p.id; }
  function rebuild(list: Project[]) { for (const key of Object.keys(names)) delete names[key]; remember(list); }
  function getActiveProjectId() { return persistence.get(ACTIVE) ?? ''; }
  function setActiveProjectId(id: string) { if (id) persistence.set(ACTIVE, id); else persistence.remove(ACTIVE); emit(); }
  async function fetchAllProjects(includeArchived = false) {
    const all: Project[] = [];
    const seen = new Set<string>();
    let offset = 0;
    for (;;) {
      const parsed = parseProjectsListResponse(await api.list({ limit: 200, offset, ...(!includeArchived ? { status: 'active' } : {}) }));
      const fresh = parsed.items.filter(p => !seen.has(p.id));
      fresh.forEach(p => { seen.add(p.id); all.push(p); });
      if (!fresh.length || (!parsed.isLegacyArray && parsed.total > parsed.items.length ? offset + parsed.items.length >= parsed.total : parsed.items.length < 200)) break;
      offset += parsed.items.length;
    }
    return all;
  }
  function ensureProjectsLoaded(force = false): Promise<Project[]> {
    if (!force && ready) return Promise.resolve(state.allProjects);
    if (!force && allRequest) return allRequest;
    const generation = ++cacheGeneration;
    const request = fetchAllProjects().then(list => {
      if (generation === cacheGeneration) { state.allProjects = list; rebuild(list); ready = true; emit(); }
      return list;
    }).finally(() => { if (allRequest === request) allRequest = null; });
    allRequest = request;
    return request;
  }
  async function fetchProjectsList(includeArchived = false, options: ListOptions = {}) {
    const seq = ++listSequence;
    const page = options.page ?? state.page;
    const size = options.pageSize ?? state.pageSize;
    const search = options.search ?? state.search;
    const offset = (page - 1) * size;
    const query = { limit: size, offset, ...(search ? { search } : {}), ...(!includeArchived ? { status: 'active' } : {}) };
    const parsed = parseProjectsListResponse(await api.list(query));
    let total = Math.max(parsed.total, offset + parsed.items.length);
    if (parsed.items.length === size && (parsed.isLegacyArray || parsed.total <= offset + parsed.items.length)) {
      try {
        const probe = parseProjectsListResponse(await api.list({ ...query, offset: offset + size, limit: 1 }));
        total = Math.max(total, probe.total, probe.items.length ? offset + size + 1 : 0);
      } catch { /* A failed optional probe must not discard a successful page. */ }
    }
    if (seq === listSequence) {
      Object.assign(state, { projects: parsed.items, page, pageSize: size, total, search });
      remember(parsed.items); emit();
    }
    return parsed.items;
  }
  async function fetchProjectSummary(id: string) {
    if (!id.trim()) return null;
    try { const project = await api.get(id); remember([project]); return project; }
    catch (error) { if (error instanceof HttpError) return null; throw error; }
  }
  async function selectProject(id: string) {
    const seq = ++selectionSequence;
    ++assetsSequence; ++graphSequence;
    state.selectedId = id; state.assetsPage = 1; state.project = null; state.graph = null; state.assets = [];
    if (id) setActiveProjectId(id);
    emit();
    const project = id ? await api.get(id) : null;
    if (seq !== selectionSequence) return null;
    state.project = project; if (project) remember([project]); emit(); return project;
  }
  async function loadAssets(page = state.assetsPage): Promise<boolean> {
    const seq = ++assetsSequence, id = state.selectedId;
    let data: Awaited<ReturnType<ProjectsApi['assets']>>;
    try { data = await api.assets(id, Math.max(1, page), state.assetsPageSize); }
    catch (error) { if (seq !== assetsSequence || id !== state.selectedId) return false; throw error; }
    if (seq !== assetsSequence || id !== state.selectedId) return false;
    const totalPages = Math.max(1, Number(data.total_pages) || 1);
    if (data.page > totalPages) return loadAssets(totalPages);
    Object.assign(state, { assets: data.assets ?? [], assetsPage: data.page || page, assetsTotal: data.total || 0, assetsTotalPages: totalPages });
    return true;
  }
  return {
    api, state, names, subscribe(listener: () => void) { subscribers.add(listener); return () => subscribers.delete(listener); },
    getActiveProjectId, setActiveProjectId, getProjectName: (id: string) => names[id] || id || '',
    rememberProjectsInNameMap: remember, rebuildProjectNameMap: rebuild,
    isProjectsCacheReady: () => ready, fetchAllProjects, ensureProjectsLoaded, fetchProjectsList, fetchProjectSummary, selectProject,
    invalidate() { ready = false; cacheGeneration++; state.allProjects = []; allRequest = null; },
    replaceProjectsCache(list: Project[]) { cacheGeneration++; allRequest = null; state.allProjects = list; rebuild(list); ready = true; emit(); },
    findProjectById: (id: string) => state.projects.find(p => p.id === id) ?? state.allProjects.find(p => p.id === id),
    async searchActiveProjects(query: string, options: { status?: string; limit?: number; offset?: number } = {}) {
      const result = parseProjectsListResponse(await api.list({ status: 'active', limit: query.trim() ? 200 : 50, offset: 0, ...options, ...(query.trim() ? { search: query.trim() } : {}) }));
      remember(result.items); return result;
    },
    async ensureDefaultActiveProjectForNewChat() {
      const id = getActiveProjectId(); if (!id) return '';
      const project = await fetchProjectSummary(id).catch(() => null);
      if (project && project.status !== 'archived') return project.id;
      setActiveProjectId(''); return '';
    },
    setListSize(size: number) { if (![20, 50, 100].includes(size)) return false; persistence.set(LIST_SIZE, String(size)); state.pageSize = size; state.page = 1; return true; },
    setAssetsSize(size: number) { if (![10, 20, 50, 100].includes(size)) return false; persistence.set(ASSET_SIZE, String(size)); state.assetsPageSize = size; state.assetsPage = 1; return true; },
    loadAssets,
    async loadGraph(view: string, exclude: boolean) {
      const seq = ++graphSequence, id = state.selectedId;
      try { const graph = await api.graph(id, view, exclude); if (seq !== graphSequence || id !== state.selectedId) return null; state.graph = graph; return graph; }
      catch (error) { if (seq !== graphSequence || id !== state.selectedId) return null; throw error; }
    },
    saveProject: (id: string, body: CreateProjectRequest | UpdateProjectRequest) => api.save(id, body),
    saveFact: (id: string, body: FactInput) => api.saveFact(state.selectedId, id, body),
    async deleteProject(id: string) { await api.delete(id); if (getActiveProjectId() === id) setActiveProjectId(''); if (state.selectedId === id) { state.selectedId = ''; state.project = null; } },
    async linkFact(fact: FactInput & { id: string }, vulnerabilityId: string) { await api.saveFact(state.selectedId, fact.id, { fact_key: fact.fact_key, category: fact.category, summary: fact.summary, body: fact.body || '', confidence: fact.confidence, related_vulnerability_id: vulnerabilityId }); },
  };
}
export type ProjectsService = ReturnType<typeof createProjectsService>;
