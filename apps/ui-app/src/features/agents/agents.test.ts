import { describe, expect, it, vi } from 'vitest';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { createHttp } from '../../platform/http';
import { createAgentsClient, createAgentsService, parseToolsInput, renderAgentCards, type AgentDraft, type AgentsClient, type MarkdownAgent } from './index';

const agent: MarkdownAgent = { filename: 'review.md', id: 'review', name: 'Reviewer', instruction: 'Review code' };
const draft: AgentDraft = { filename: 'review.md', id: ' review ', name: ' Reviewer ', description: ' description ', tools: 'a, b; c | d,,', instruction: ' Review code ', bind_role: ' role ', max_iterations: '7', kind: 'sub' };
function client(): AgentsClient {
  return { list: vi.fn(async () => ({ agents: [agent], dir: '/agents' })), get: vi.fn(async () => agent), save: vi.fn(async () => ({})), delete: vi.fn(async () => ({})) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
describe('agents public service', () => {
  it('loads, stably orders orchestrators first, and publishes loading and completion', async () => {
    const api = client();
    const source = [agent, { ...agent, filename: 'orch.md', is_orchestrator: true }, { ...agent, filename: 'second.md' }];
    api.list = async () => ({ agents: source, dir: '/agents' });
    const service = createAgentsService(api);
    const loading: boolean[] = [];
    service.subscribe(() => loading.push(service.state.loading));
    await service.load();
    expect(service.state.agents.map(a => a.filename)).toEqual(['orch.md', 'review.md', 'second.md']);
    expect(source[0]).toBe(agent);
    expect(service.state.directory).toBe('/agents');
    expect(loading).toEqual([true, false]);
  });
  it('keeps the newest refresh when responses arrive out of order', async () => {
    const api = client(), first = deferred<{ agents: MarkdownAgent[] }>();
    api.list = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ agents: [{ ...agent, name: 'New' }] });
    const service = createAgentsService(api);
    const pending = service.load(); await service.load();
    first.resolve({ agents: [agent] }); await pending;
    expect(service.state.agents[0]?.name).toBe('New');
  });
  it('exposes load errors and recovers on the next refresh', async () => {
    const api = client(), failure = new Error('denied');
    api.list = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce({});
    const service = createAgentsService(api);
    await expect(service.load()).rejects.toThrow('denied');
    expect(service.state).toMatchObject({ loading: false, loadError: failure });
    await service.load();
    expect(service.state).toMatchObject({ agents: [], directory: '', loadError: undefined });
  });
  it('normalizes the complete Go write DTO and creates with an optional filename', async () => {
    const api = client(), service = createAgentsService(api);
    await expect(service.save({ ...draft, filename: '' })).resolves.toBe(true);
    expect(api.save).toHaveBeenCalledWith(null, { filename: '', id: 'review', name: 'Reviewer', description: 'description', tools: ['a', 'b', 'c', 'd'], instruction: 'Review code', bind_role: 'role', max_iterations: 7, kind: '' });
    expect(parseToolsInput(' , ; | ')).toEqual([]);
  });
  it.each([
    [{ name: ' ' }, 'agentsPage.nameRequired'],
    [{ instruction: ' ' }, 'agentsPage.instructionRequired'],
    [{ filename: '../bad.md' }, 'agentsPage.filenameInvalid'],
  ])('validates before writing: %j', async (patch, key) => {
    const api = client(), service = createAgentsService(api);
    await expect(service.save({ ...draft, ...patch })).rejects.toThrow(key);
    expect(api.save).not.toHaveBeenCalled();
  });
  it('permits blank orchestrator instructions by role, reserved name, or existing metadata', async () => {
    const api = client(), service = createAgentsService(api);
    await service.save({ ...draft, kind: 'orchestrator', instruction: '' });
    await service.save({ ...draft, filename: 'Orchestrator.md', instruction: '' });
    api.get = async () => ({ ...agent, is_orchestrator: true });
    await service.edit('review.md');
    await service.save({ ...draft, filename: 'ignored.md', instruction: '' });
    expect(api.save).toHaveBeenLastCalledWith('review.md', expect.not.objectContaining({ filename: expect.anything() }));
  });
  it('retains the requested edit filename if omitted by a transitional response', async () => {
    const api = client(); api.get = async () => ({ ...agent, filename: '' });
    const service = createAgentsService(api);
    await service.edit('original.md'); await service.save(draft);
    expect(api.save).toHaveBeenCalledWith('original.md', expect.any(Object));
  });
  it('blocks save while editing loads and ignores a response after close/reset', async () => {
    const api = client(), pending = deferred<MarkdownAgent>(); api.get = () => pending.promise;
    const service = createAgentsService(api), edit = service.edit('review.md');
    expect(service.state.editingPending).toBe(true);
    expect(await service.save(draft)).toBe(false);
    service.reset(); pending.resolve(agent);
    expect(await edit).toBeNull();
    expect(service.state).toMatchObject({ editing: null, editingPending: false });
    expect(api.save).not.toHaveBeenCalled();
  });
  it('ignores stale edit failures without closing a newer editor', async () => {
    const api = client(), old = deferred<MarkdownAgent>();
    api.get = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(agent);
    const service = createAgentsService(api), first = service.edit('old.md');
    await service.edit('review.md'); old.reject(new Error('old failure'));
    expect(await first).toBeNull(); expect(service.state.editing).toEqual(agent);
  });
  it('prevents duplicate saves, unlocks on error, and retains the editor for retry', async () => {
    const api = client(), pending = deferred<unknown>(); api.save = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({});
    const service = createAgentsService(api); await service.edit('review.md');
    const first = service.save(draft);
    expect(await service.save(draft)).toBe(false);
    pending.reject(new Error('disk full')); await expect(first).rejects.toThrow('disk full');
    expect(service.state.saving).toBe(false); expect(service.state.editing?.filename).toBe('review.md');
    await expect(service.save(draft)).resolves.toBe(true);
  });
  it('deletes only the requested file and propagates failures', async () => {
    const api = client(), service = createAgentsService(api);
    await service.delete('review.md'); expect(api.delete).toHaveBeenCalledWith('review.md');
    api.delete = async () => { throw new Error('forbidden'); };
    await expect(service.delete('review.md')).rejects.toThrow('forbidden');
  });
});

it('uses the existing Go/mock endpoints, verbs, JSON body, and encoded file path', async () => {
  const requests: { path: string; method: string; body: unknown; authorization: string | null }[] = [];
  const transport = createHttp({
    session: { read: () => ({ token: 'auth-token' }), clear() {} },
    fetcher: async (url, init) => {
      requests.push({ path: String(url), method: init?.method ?? '', body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined, authorization: new Headers(init?.headers).get('Authorization') });
      return new Response(JSON.stringify({ agents: [], ...agent }), { status: 200 });
    },
  });
  const api = createAgentsClient(transport), service = createAgentsService(api);
  await service.load(); await service.save(draft); await service.edit('odd #.md'); await service.save(draft); await service.delete('odd #.md');
  expect(requests.map(r => [r.method, r.path])).toEqual([
    ['GET', '/api/multi-agent/markdown-agents'], ['POST', '/api/multi-agent/markdown-agents'],
    ['GET', '/api/multi-agent/markdown-agents/odd%20%23.md'], ['PUT', '/api/multi-agent/markdown-agents/review.md'], ['DELETE', '/api/multi-agent/markdown-agents/odd%20%23.md'],
  ]);
  expect(requests.every(r => r.authorization === 'Bearer auth-token')).toBe(true);
  expect(requests[1]?.body).toMatchObject({ tools: ['a', 'b', 'c', 'd'], max_iterations: 7, kind: '' });
});

it('renders existing card classes and safe, round-trippable delegated filenames without inline code', () => {
  const filename = `odd'"<& #.md`;
  const html = renderAgentCards([{ ...agent, filename, name: '<script>bad()</script>', description: '<img onerror="bad()">', is_orchestrator: true }], key => key);
  const root = parseFragment(html), elements: DefaultTreeAdapterMap['element'][] = [];
  function visit(node: DefaultTreeAdapterMap['node']): void {
    if ('tagName' in node) elements.push(node);
    if ('childNodes' in node) node.childNodes.forEach(visit);
  }
  visit(root);
  expect(elements.some(el => el.tagName === 'script' || el.tagName === 'img')).toBe(false);
  expect(elements.flatMap(el => el.attrs).some(attr => /^on/.test(attr.name))).toBe(false);
  expect(html).toContain('agent-role-badge--orchestrator');
  const buttons = elements.filter(el => el.tagName === 'button');
  expect(buttons.map(el => el.attrs.find(a => a.name === 'data-action')?.value)).toEqual(['edit-agent-md', 'delete-agent-md']);
  expect(buttons.map(el => decodeURIComponent(el.attrs.find(a => a.name === 'data-agent-file')?.value ?? ''))).toEqual([filename, filename]);
});
