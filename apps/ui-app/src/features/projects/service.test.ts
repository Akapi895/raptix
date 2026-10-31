import { describe, expect, it, vi } from 'vitest';
import { createHttp, HttpError } from '../../platform/http';
import type { KeyValueStorage } from '../../platform/storage';
import { createProjectsApi, createProjectsService, createProjectFoldersService, filterActiveProjectsLocal, getProjectApprovalTiming, isSparseFactBody, parseProjectsListResponse, type Project, type FactInput } from './index';

const project = (id: string, changes: Partial<Project> = {}): Project => ({ id, name: id, status: 'active', pinned: false, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...changes });
function persistence(initial: Record<string, string> = {}): KeyValueStorage {
  const values = new Map(Object.entries(initial)); return { get: key => values.get(key) ?? null, set: (key, value) => { values.set(key, value); return true; }, remove: key => values.delete(key) };
}
function setup(handler: (url: URL, method: string, body: unknown) => unknown | Promise<unknown>, saved = persistence()) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const result = await handler(new URL(String(input), 'http://test'), init?.method || 'GET', body);
    return result instanceof Response ? result : Response.json(result);
  });
  const transport = createHttp({ fetcher, session: { read: () => null, clear() {} }, events: { emit() {} } });
  const service = createProjectsService(createProjectsApi(transport), saved); return { service, fetcher, saved };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('public projects service', () => {
  it('accepts Go envelopes, historical items/string counts and array responses', () => {
    const p = project('p');
    expect(parseProjectsListResponse({ projects: [p], total: '31', limit: '20', offset: '20' })).toEqual({ items: [p], total: 31, limit: 20, offset: 20, isLegacyArray: false });
    expect(parseProjectsListResponse([p])).toMatchObject({ total: 1, isLegacyArray: true });
    expect(parseProjectsListResponse({ items: [p], total: '-2', offset: 'bad' })).toMatchObject({ total: 1, offset: 0 });
  });
  it('filters archived projects, searches description/id case-insensitively, pins first without mutating inputs', () => {
    const projects = [project('a', { name: 'Newer', updated_at: '2026-10-28' }), project('b', { description: 'AUTHORIZED host', pinned: true }), project('c', { status: 'archived' })];
    expect(filterActiveProjectsLocal(projects).map(p => p.id)).toEqual(['b', 'a']);
    expect(filterActiveProjectsLocal(projects, ' authorized ').map(p => p.id)).toEqual(['b']);
    expect(projects.map(p => p.id)).toEqual(['a', 'b', 'c']);
  });
  it('probes ambiguous full pages and keeps server-side search/status/pagination', async () => {
    const calls: URL[] = [];
    const { service } = setup(url => { calls.push(url); return url.searchParams.get('limit') === '1' ? [project('next')] : [project('a'), project('b')]; });
    await service.fetchProjectsList(false, { page: 3, pageSize: 2, search: 'a & b' });
    expect(service.state).toMatchObject({ page: 3, total: 7, search: 'a & b' });
    expect(calls.map(url => Object.fromEntries(url.searchParams))).toEqual([{ limit: '2', offset: '4', search: 'a & b', status: 'active' }, { limit: '1', offset: '6', search: 'a & b', status: 'active' }]);
  });
  it('does not discard a loaded page when the optional total probe fails', async () => {
    const { service } = setup(url => url.searchParams.get('limit') === '1' ? new Response('offline', { status: 503 }) : [project('a'), project('b')]);
    await service.fetchProjectsList(false, { pageSize: 2 }); expect(service.state.total).toBe(2);
  });
  it('fetches all pages even when a server caps page size, deduplicates concurrent cache loads, and remembers names', async () => {
    const gate = deferred<unknown>(); let calls = 0;
    const { service } = setup(url => { calls++; return url.searchParams.get('offset') === '0' ? gate.promise : { projects: [project('b', { name: 'Beta' })], total: 2 }; });
    const first = service.ensureProjectsLoaded(), second = service.ensureProjectsLoaded(); expect(first).toBe(second);
    gate.resolve({ projects: [project('a')], total: 2 }); expect((await first).map(p => p.id)).toEqual(['a', 'b']);
    await service.ensureProjectsLoaded(); expect(calls).toBe(2); expect(service.getProjectName('b')).toBe('Beta');
  });
  it('retries failed cache loads and rejects stale cache writes after invalidation', async () => {
    const stale = deferred<unknown>(); let calls = 0;
    const { service } = setup(() => { calls++; if (calls === 1) return stale.promise; return [project('new')]; });
    const first = service.ensureProjectsLoaded(); service.invalidate(); await service.ensureProjectsLoaded(); stale.resolve([project('old')]); await first;
    expect(service.state.allProjects.map(p => p.id)).toEqual(['new']); expect(service.isProjectsCacheReady()).toBe(true);
    service.invalidate(); expect(service.isProjectsCacheReady()).toBe(false);
    const failed = setup(() => new Response('down', { status: 500 })).service;
    await expect(failed.ensureProjectsLoaded()).rejects.toBeInstanceOf(HttpError); expect(failed.isProjectsCacheReady()).toBe(false);
  });
  it('keeps newer search and selection results when older requests finish later', async () => {
    const slow = deferred<unknown>(), oldSelection = deferred<unknown>();
    const { service } = setup(url => url.pathname.endsWith('/old') ? oldSelection.promise : url.pathname.endsWith('/new') ? project('new') : url.searchParams.get('search') === 'slow' ? slow.promise : [project('fast')]);
    const first = service.fetchProjectsList(false, { search: 'slow' }); await service.fetchProjectsList(false, { search: 'fast' }); slow.resolve([project('slow')]); await first;
    expect(service.state.projects[0]?.id).toBe('fast');
    const old = service.selectProject('old'); await service.selectProject('new'); oldSelection.resolve(project('old')); await old;
    expect(service.state.project?.id).toBe('new'); expect(service.getActiveProjectId()).toBe('new');
  });
  it('ignores graph/assets responses from an earlier selection including A→B→A', async () => {
    const graph = deferred<unknown>(), assets = deferred<unknown>();
    const { service } = setup(url => url.pathname.endsWith('/fact-graph') ? graph.promise : url.pathname === '/api/assets' ? assets.promise : project(url.pathname.split('/').pop() || ''));
    await service.selectProject('a'); const graphRequest = service.loadGraph('path', true), assetsRequest = service.loadAssets();
    await service.selectProject('b'); await service.selectProject('a'); graph.resolve({ nodes: [], edges: [] }); assets.resolve({ assets: [], total: 0, page: 1, total_pages: 1 });
    expect(await graphRequest).toBeNull(); expect(await assetsRequest).toBe(false); expect(service.state.graph).toBeNull();
  });
  it('preserves active storage keys, validates list sizes and clears a deleted or archived default project', async () => {
    const { service, saved } = setup((url, method) => method === 'DELETE' ? {} : project(url.pathname.split('/').pop() || '', { status: 'archived' }), persistence({ 'raptix.projects_list_page_size': '100', 'raptix.project_assets_page_size': '10', 'raptix.activeProjectId': 'old' }));
    expect(service.state).toMatchObject({ pageSize: 100, assetsPageSize: 10 }); expect(service.setListSize(21)).toBe(false); expect(service.setAssetsSize(50)).toBe(true);
    expect(saved.get('raptix.project_assets_page_size')).toBe('50'); expect(await service.ensureDefaultActiveProjectForNewChat()).toBe(''); expect(saved.get('raptix.activeProjectId')).toBeNull();
    service.setActiveProjectId('deleted'); await service.deleteProject('deleted'); expect(service.getActiveProjectId()).toBe('');
  });
  it('retains Go write payloads for settings, facts/links/pins, edge editing and conversation/asset binding', async () => {
    const calls: { path: string; method: string; body: unknown }[] = [];
    const { service } = setup((url, method, body) => { calls.push({ path: url.pathname, method, body }); return project('p'); });
    await service.selectProject('p'); calls.length = 0;
    await service.saveProject('p', { name: 'Project', scope_json: '{"targets":["test"]}', pinned: true, status: 'active' });
    const input: FactInput = { fact_key: 'finding/a', category: 'finding', summary: 'Summary', body: '```http', confidence: 'confirmed', pinned: true, links_text: 'discovered_on: target/a', related_vulnerability_id: '' };
    await service.saveFact('', input); await service.api.createEdge('p', 'target/a', 'finding/a', 'leads_to'); await service.api.deleteEdge('p', 'edge/1'); await service.api.confidence('p', 'finding/a', true);
    await service.api.bindConversation('conv/1', 'p'); await service.api.unbindAsset('asset');
    expect(calls).toEqual([
      { path: '/api/projects/p', method: 'PUT', body: { name: 'Project', scope_json: '{"targets":["test"]}', pinned: true, status: 'active' } },
      { path: '/api/projects/p/facts', method: 'POST', body: input },
      { path: '/api/projects/p/fact-edges', method: 'POST', body: { source_fact_key: 'target/a', target_fact_key: 'finding/a', edge_type: 'leads_to' } },
      { path: '/api/projects/p/fact-edges/edge%2F1', method: 'DELETE', body: undefined },
      { path: '/api/projects/p/facts/restore', method: 'POST', body: { fact_key: 'finding/a', fact_keys: ['finding/a'], confidence: 'tentative' } },
      { path: '/api/conversations/conv%2F1/project', method: 'PUT', body: { projectId: 'p' } },
      { path: '/api/assets/project-binding', method: 'PUT', body: { asset_ids: ['asset'], project_id: '' } },
    ]);
  });
  it('encodes graph/fact queries and accepts vulnerability array and Go/mock envelopes', async () => {
    const calls: URL[] = [], item = { id: 'v', title: 'Vuln', severity: 'high', status: 'open' };
    const { service } = setup(url => { calls.push(url); return url.pathname === '/api/vulnerabilities' ? { Vulnerabilities: [item] } : url.pathname.endsWith('/fact-graph') ? { nodes: [], edges: [] } : {}; });
    expect(await service.api.vulnerabilities('p', { q: 'a & b', severity: 'high' })).toEqual([item]);
    await service.api.fact('p/q', 'finding/a?b'); await service.api.graph('p', 'path', false);
    expect(calls[1]?.pathname).toBe('/api/projects/p%2Fq/facts'); expect(calls[1]?.searchParams.get('fact_key')).toBe('finding/a?b'); expect(calls[1]?.searchParams.get('include_links')).toBe('true');
    expect(calls[2]?.searchParams.get('exclude_deprecated')).toBe('0');
  });
  it('normalizes demo fact arrays/link counts without breaking Go single-fact editing', async () => {
    const fact = { id: 'f', project_id: 'p', fact_key: 'note/a', category: 'note', summary: 'A', body: '', confidence: 'confirmed', pinned: false, updated_at: '', incoming_links: 2, deprecated: true };
    const { service } = setup(() => [fact]);
    expect(await service.api.fact('p', 'note/a')).toMatchObject({ fact_key: 'note/a', incoming_links: [], confidence: 'deprecated', created_at: '' });
    await expect(service.api.fact('p', 'note/missing')).rejects.toMatchObject({ status: 404 });
  });
});

describe('project folders and fact rules', () => {
  it('loads Go conversation envelopes, ignores stale/nonhuman approvals and tracks completed unread state persistently', async () => {
    const saved = persistence();
    const { service } = setup(url => {
      if (url.pathname === '/api/conversations') return { conversations: [{ id: 'c', title: 'C', projectId: 'p' }] };
      if (url.pathname.endsWith('/tasks/completed')) return { tasks: [{ conversationId: 'done', status: 'completed', completedAt: '2026-10-28T12:00:00Z' }] };
      if (url.pathname.endsWith('/tasks')) return { tasks: [{ conversationId: 'c', status: 'running' }] };
      return { items: [{ conversationId: 'stale' }, { conversationId: 'c', reviewer: 'audit_agent' }, { conversationId: 'c', interruptId: 'human' }] };
    });
    const folders = createProjectFoldersService(service, saved); await folders.load();
    expect([...folders.state.pending.keys()]).toEqual(['c']); expect(folders.state.pending.get('c')?.interruptId).toBe('human');
    expect(folders.isUnread('done')).toBe(true); expect(folders.markViewed('done')).toBe(true); expect(folders.isUnread('done')).toBe(false);
    expect(folders.updateTasks([])).toBe(true); expect(folders.state.pending.size).toBe(0);
    expect(folders.setPinned('c', true)).toBe(true); expect(folders.remove('c')).toBe(true);
  });
  it('handles malformed storage and approval payload deadlines without throwing', () => {
    expect(getProjectApprovalTiming({ payload: '{broken' })).toEqual({ timeoutSeconds: 0, expiresAt: 0 });
    expect(getProjectApprovalTiming({ payload: JSON.stringify({ hitlApproval: { timeoutSeconds: 60, createdAt: '2026-10-28T00:00:00Z' } }) })).toEqual({ timeoutSeconds: 60, expiresAt: Date.parse('2026-10-28T00:01:00Z') });
    expect(getProjectApprovalTiming({ payload: 'null' })).toEqual({ timeoutSeconds: 0, expiresAt: 0 });
    expect(isSparseFactBody('finding', 'finding/test', 'one line')).toBe(true); expect(isSparseFactBody('note', 'auth/test', '')).toBe(false); expect(isSparseFactBody('note', 'exploit/test', 'curl target')).toBe(false);
  });
});
