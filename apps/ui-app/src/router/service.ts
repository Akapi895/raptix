export const pageIds = ['dashboard', 'chat', 'hitl', 'tool-guard', 'asset-overview', 'asset-management', 'projects', 'vulnerabilities', 'webshell', 'vault', 'file-management', 'mcp-monitor', 'mcp-management', 'knowledge-management', 'agents', 'workflows', 'skills-monitor', 'skills-management', 'settings', 'tasks', 'c2-listeners', 'c2-sessions', 'c2-activity', 'c2-tasks', 'c2-payloads', 'c2-events', 'c2-profiles'] as const;
export type PageId = typeof pageIds[number];
export interface Route { page: PageId; query: URLSearchParams }
export interface Navigation { route: Route; previous: Route | null; kind: 'replace' | 'external' | 'initial'; pageChanged: boolean; restore: boolean }
export function isPageId(value: string): value is PageId { return pageIds.some(page => page === value); }
export function parseRoute(hash: string): Route | null {
  const clean = hash.replace(/^#/, '').replace(/^\//, '');
  const separator = clean.indexOf('?');
  let page = separator < 0 ? clean : clean.slice(0, separator);
  const query = new URLSearchParams(separator < 0 ? '' : clean.slice(separator + 1));
  if (page === 'platform-rbac' || page === 'system-update' || (page === 'settings' && (query.get('section') === 'rbac' || query.get('section') === 'update'))) return { page: 'dashboard', query: new URLSearchParams() };
  if (page === 'c2') page = 'c2-listeners';
  if (page === 'c2-tasks' || page === 'c2-events') { query.set('tab', page === 'c2-events' ? 'events' : 'tasks'); page = 'c2-activity'; }
  if (page === 'c2-profiles') { page = 'c2-listeners'; query.set('tab', 'profiles'); }
  if (page === 'operation-center') page = 'projects';
  if (page === 'agents-management' || page === 'specialist-management' || page === 'roles-management') {
    // The Agents page keeps selection, scope and tab state in the frontend; legacy deep links lose only those params.
    page = 'agents';
    for (const key of ['specialist', 'scope', 'tab']) query.delete(key);
  }
  if (page === 'asset-overview' || page === 'assets' || page === 'asset-library') page = 'asset-management';
  if (page === 'chat-files' || page === 'files') page = 'file-management';
  if (page === 'mcp') page = 'mcp-management';
  if (page === 'knowledge') page = 'knowledge-management';
  if (page === 'knowledge-retrieval-logs') { page = 'knowledge-management'; query.set('tab', 'logs'); }
  if (page === 'webshell-management') page = 'webshell';
  if (page === 'system-settings') page = 'settings';
  if (page === 'settings' && (query.get('section') === 'rbac' || query.get('section') === 'update')) return { page: 'dashboard', query: new URLSearchParams() };
  if (page === 'tasks') { page = 'workflows'; query.set('tab', 'schedule'); }
  return isPageId(page) ? { page, query } : null;
}
export function routeHash(route: Route): string {
  const params = new URLSearchParams(route.query);
  if (route.page === 'knowledge-management') params.delete('tab');
  const query = params.toString();
  // Feature IDs remain stable while URLs use concise public names.
  const publicNames: Partial<Record<PageId, string>> = { projects: 'operation-center', 'asset-management': 'assets', 'file-management': 'files', 'knowledge-management': 'knowledge' };
  const page = publicNames[route.page] ?? route.page;
  return page + (query ? '?' + query : '');
}
export interface RouterPort {
  readHash(): string; replaceHash(hash: string): void;
  onHash(listener: () => void): () => void;
  canActivate?(page: PageId): boolean;
}
export function createRouter(port: RouterPort) {
  let current: Route | null = null;
  let started = false;
  let stop: (() => void) | undefined;
  const listeners = new Set<(event: Navigation) => void>();
  function commit(route: Route, kind: Navigation['kind'], restore = true): void {
    if (port.canActivate && !port.canActivate(route.page)) return;
    const previous = current;
    if (previous && routeHash(previous) === routeHash(route)) {
      if (port.readHash() !== '#' + routeHash(route)) port.replaceHash(routeHash(route));
      return;
    }
    current = { page: route.page, query: new URLSearchParams(route.query) };
    const hash = routeHash(current);
    if (port.readHash() !== '#' + hash) port.replaceHash(hash);
    const event: Navigation = { route: { page: current.page, query: new URLSearchParams(current.query) }, previous, kind, pageChanged: previous?.page !== route.page, restore };
    listeners.forEach(listener => listener(event));
  }
  function getRoute(): Route | null { return current ? { page: current.page, query: new URLSearchParams(current.query) } : null; }
  return {
    current: getRoute,
    page: (): PageId | null => current?.page ?? null,
    start(): void {
      if (started) return; started = true;
      stop = port.onHash(() => { const route = parseRoute(port.readHash()); if (route) commit(route, 'external'); });
      commit(parseRoute(port.readHash()) ?? { page: 'dashboard', query: new URLSearchParams() }, 'initial');
    },
    go(page: string, query?: URLSearchParams | Record<string, string>): void {
      if (page === 'platform-rbac') { commit({ page: 'dashboard', query: new URLSearchParams() }, 'replace'); return; }
      if (['c2-tasks', 'c2-events', 'c2-profiles', 'c2', 'knowledge-retrieval-logs', 'specialist-management', 'agents-management', 'roles-management'].includes(page)) { const route = parseRoute(page + (query ? '?' + new URLSearchParams(query) : '')); if (route) commit(route, 'replace'); return; }
      if (page === 'tasks') { commit({ page: 'workflows', query: new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(query)), tab: 'schedule' }) }, 'replace'); return; }
      if (page === 'asset-overview') page = 'asset-management';
      if (page === 'assets') page = 'asset-management';
      if (page === 'files') page = 'file-management';
      if (page === 'mcp') page = 'mcp-management';
      if (page === 'knowledge') page = 'knowledge-management';
      if (page === 'webshell-management') page = 'webshell';
      if (page === 'system-settings') page = 'settings';
      if (!isPageId(page)) return;
      // Classic feature callbacks may have updated their query without hashchange.
      const location = parseRoute(port.readHash());
      const preserved = ['chat', 'vulnerabilities', 'settings'].includes(page) && location?.page === page ? location.query : undefined;
      commit({ page, query: new URLSearchParams(query ?? preserved) }, 'replace');
    },
    navigate(hash: string, restore = true): void { const route = parseRoute(hash); if (route) commit(route, 'replace', restore); },
    // Persist feature-owned state without restoring it a second time (e.g. loadConversation).
    replaceQuery(query: URLSearchParams | Record<string, string>): void { if (current) commit({ page: current.page, query: new URLSearchParams(query) }, 'replace', false); },
    subscribe(listener: (event: Navigation) => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose(): void { stop?.(); stop = undefined; listeners.clear(); started = false; current = null; },
  };
}
export type Router = ReturnType<typeof createRouter>;
