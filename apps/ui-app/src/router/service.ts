export const pageIds = ['dashboard', 'chat', 'hitl', 'tool-guard', 'asset-overview', 'asset-library', 'info-collect', 'projects', 'vulnerabilities', 'webshell', 'chat-files', 'mcp-monitor', 'mcp-management', 'knowledge-management', 'knowledge-retrieval-logs', 'roles-management', 'workflows', 'skills-monitor', 'skills-management', 'settings', 'tasks', 'c2-listeners', 'c2-sessions', 'c2-activity', 'c2-tasks', 'c2-payloads', 'c2-events', 'c2-profiles'] as const;
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
  if (page === 'agents-management') page = 'roles-management';
  if (page === 'asset-overview' || page === 'assets') page = 'asset-library';
  if (page === 'discover-assets') page = 'info-collect';
  if (page === 'tasks') { page = 'workflows'; query.set('tab', 'schedule'); }
  return isPageId(page) ? { page, query } : null;
}
export function routeHash(route: Route): string {
  const query = route.query.toString();
  // Keep the projects feature ID stable while exposing its user-facing route.
  const page = route.page === 'projects' ? 'operation-center' : route.page;
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
      if (['c2-tasks', 'c2-events', 'c2-profiles', 'c2'].includes(page)) { const route = parseRoute(page + (query ? '?' + new URLSearchParams(query) : '')); if (route) commit(route, 'replace'); return; }
      if (page === 'tasks') { commit({ page: 'workflows', query: new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(query)), tab: 'schedule' }) }, 'replace'); return; }
      if (page === 'asset-overview') page = 'asset-library';
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
