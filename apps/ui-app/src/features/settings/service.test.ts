import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSettingsService } from './service';
import { getToolKey, object, type ConfigObject, type Tool } from './model';
import type { ApiFetch } from './contracts';

const channel = (name = 'Main') => ({ name, provider: 'openai_compatible', api_key: '********', base_url: 'https://llm.example/v1', model: 'model', reasoning: { profile: 'auto', opaque: 'preserve' } });
const config = () => ({ ai: { default_channel: 'main', channels: { main: channel(), extra: channel('Extra') } }, agent: { max_iterations: 30, tool_timeout_minutes: 600 }, multi_agent: { enabled: true, orchestration: 'supervisor', batch_use_multi_agent: true, model_retry_max_retries: 7, tool_search_always_visible_tools: ['lab__lookup'], tool_search_always_visible_effective_tools: ['lab__lookup', 'builtin'] }, robots: { session: { opaque: true }, wechat: { bot_token: '********', get_updates_buf: 'cursor' } }, unknown_section: { keep: true } });
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
interface Call { url: string; method: string; body: ConfigObject }
function fixture(handle?: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined) {
  let current: ConfigObject = config(); const calls: Call[] = []; const saved = new Map<string, string>();
  const request: ApiFetch = async (url, init) => {
    const body = init?.body ? object(JSON.parse(String(init.body))) : {}; const method = init?.method || 'GET'; calls.push({ url, method, body });
    const override = handle?.(url, init); if (override) return override;
    if (url === '/api/config') { if (method === 'PUT') current = { ...current, ...body }; return response(current); }
    if (url.startsWith('/api/config/tools?')) return response({ tools: [], page: 1, total_pages: 1 });
    return response({});
  };
  const can = vi.fn(() => true);
  const service = createSettingsService({ request, can, t: (key, opts) => opts?.name ? `${key}:${String(opts.name)}` : key, storage: { get: key => saved.get(key) || null, set: (key, value) => { saved.set(key, value); } } });
  return { service, calls, saved, can, current: () => current, replace: (value: ConfigObject) => current = value };
}
afterEach(() => vi.useRealTimers());

describe('settings public service', () => {
  it('loads legacy OpenAI and canonical channel profiles without losing opaque Go sections or masked secrets', async () => {
    const f = fixture(); f.replace({ openai: { api_key: '********', base_url: 'https://api.deepseek.com/v1', model: 'deepseek', provider: 'openai', reasoning: { effort: 'high' } }, agent: { unknown: 9 } });
    await f.service.loadConfig(); expect(f.service.state.config).toMatchObject({ agent: { unknown: 9 }, ai: { default_channel: 'default', channels: { default: { api_key: '********', reasoning: { profile: 'deepseek', effort: 'high' } } } } }); f.service.dispose();
  });
  it('round trips channel-only saves, merges latest channels, then applies and honors server-canonical ids', async () => {
    const f = fixture(); await f.service.loadConfig(); const id = f.service.newChannel('New_Channel'); f.service.editChannel(id, channel('New'));
    const latest = config(); Object.assign(latest.ai.channels, { concurrent: channel('Concurrent') }); f.replace(latest);
    await f.service.persistAI(true, true);
    const writes = f.calls.filter(call => call.method === 'PUT'); expect(writes).toHaveLength(1); expect(Object.keys(writes[0]!.body)).toEqual(['ai']);
    expect(Object.keys(object(writes[0]!.body.ai).channels as ConfigObject)).toEqual(expect.arrayContaining(['main', 'extra', 'concurrent', 'new-channel']));
    expect(f.calls.findIndex(call => call.url === '/api/config/apply')).toBeGreaterThan(f.calls.indexOf(writes[0]!));
    expect(f.service.state.selectedChannel).toBe(id); expect(f.current().unknown_section).toEqual({ keep: true }); f.service.dispose();
  });
  it('deletes without merging the removed channel back, protects bulk default, and retains at least one', async () => {
    const f = fixture(); await f.service.loadConfig(); expect(f.service.removeChannels(['main', 'extra'], true)).toBe(1);
    await f.service.persistAI(false, false); expect(Object.keys(f.service.config().ai.channels)).toEqual(['main']);
    expect(() => f.service.removeChannels(['main'], false)).toThrow('At least one AI channel must remain'); f.service.dispose();
  });
  it('does not send invalid channel saves, forbidden writes, or apply after failed writes', async () => {
    const f = fixture((url, init) => url === '/api/config' && init?.method === 'PUT' ? response({ error: 'write rejected' }, 409) : undefined);
    await f.service.loadConfig(); f.service.editChannel('main', { name: 'draft' }); await expect(f.service.persistAI(true, true)).rejects.toThrow('Base URL');
    expect(f.calls.filter(call => call.method === 'PUT')).toEqual([]); f.service.editChannel('main', channel());
    await expect(f.service.persistAI(false, true)).rejects.toThrow('write rejected'); expect(f.calls.some(call => call.url === '/api/config/apply')).toBe(false);
    f.can.mockReturnValue(false); await expect(f.service.saveTools()).rejects.toThrow('common.noPermission'); expect(() => f.service.removeChannels(['extra'], false)).toThrow(); f.service.dispose();
  });
  it('retains same-name tools from different MCPs and edits across search, filter and pagination when saving', async () => {
    const tools: Tool[] = [{ name: 'lookup', enabled: true, is_external: false }, { name: 'lookup', enabled: true, is_external: true, external_mcp: 'lab' }, { name: 'lookup', enabled: false, is_external: true, external_mcp: 'other' }];
    const f = fixture(url => {
      if (!url.startsWith('/api/config/tools?')) return;
      const query = new URL(url, 'https://test').searchParams, page = Number(query.get('page'));
      return response({ tools: [tools[page - 1]], page, page_size: 1, total: 3, total_enabled: 2, total_pages: 3 });
    });
    await f.service.loadConfig(); await f.service.loadTools(1, 'lookup'); f.service.setTool('lookup', false);
    f.service.state.externalFilter = 'lab'; f.service.state.status = 'true'; await f.service.loadTools(2, 'lookup'); f.service.setTool('lab::lookup', false);
    await f.service.loadTools(3, ''); f.service.setTool('other::lookup', true);
    expect(f.service.state.toolStates.size).toBe(3); await f.service.saveTools();
    const write = f.calls.find(call => call.method === 'PUT')!.body;
    expect(write.tools).toEqual([{ name: 'lookup', enabled: false, is_external: false, external_mcp: '' }, { name: 'lookup', enabled: false, is_external: true, external_mcp: 'lab' }, { name: 'lookup', enabled: true, is_external: true, external_mcp: 'other' }]);
    expect(write.multi_agent).toMatchObject({ orchestration: 'supervisor', model_retry_max_retries: 7, tool_search_always_visible_tools: ['lab::lookup'] });
    expect(f.calls.filter(call => call.url.includes('page_size=100')).every(call => !call.url.includes('search=') && !call.url.includes('external_mcp=') && !call.url.includes('enabled='))).toBe(true); f.service.dispose();
  });
  it('locks effective builtin pins, canonicalizes legacy aliases and persists user pins only', async () => {
    const f = fixture(); await f.service.loadConfig(); const external: Tool = { name: 'lookup', enabled: true, is_external: true, external_mcp: 'lab' };
    expect(f.service.isAlwaysVisible(external)).toBe(true); expect(f.service.isBuiltin({ name: 'builtin', enabled: true })).toBe(true);
    f.service.setAlwaysVisible('builtin', true); f.service.setAlwaysVisible('lab__lookup', false); f.service.setAlwaysVisible('other__lookup', true);
    expect(f.service.alwaysVisibleForSave()).toEqual(['other::lookup']); f.service.dispose();
  });
  it('handles a failed all-tools fetch using actual retained edits, and applies the submitted form sections', async () => {
    const f = fixture(url => url.startsWith('/api/config/tools?') ? response({ error: 'offline' }, 503) : undefined);
    await f.service.loadConfig(); f.service.setTool('lab::lookup', false, { name: 'lookup', enabled: true, is_external: true, external_mcp: 'lab' });
    await f.service.applySettings({ robots: f.current().robots, vision: { enabled: false, jpeg_quality: 0 }, ai: f.service.config().ai });
    expect(f.calls.find(call => call.method === 'PUT')?.body).toMatchObject({ robots: { session: { opaque: true }, wechat: { bot_token: '********', get_updates_buf: 'cursor' } }, tools: [{ name: 'lookup', enabled: false, external_mcp: 'lab' }], vision: { jpeg_quality: 0 } }); f.service.dispose();
  });
  it('ignores superseded tool responses even when the transport ignores abort', async () => {
    let first: ((response: Response) => void) | undefined;
    const f = fixture(url => url.includes('search=old') ? new Promise<Response>(resolve => first = resolve) : url.includes('search=new') ? response({ tools: [{ name: 'new', enabled: true }], total_pages: 1 }) : undefined);
    const old = f.service.loadTools(1, 'old'); await f.service.loadTools(1, 'new'); first?.(response({ tools: [{ name: 'old', enabled: true }], total_pages: 1 }));
    expect(await old).toBe(false); expect(f.service.state.tools.map(getToolKey)).toEqual(['new']); f.service.dispose();
  });
  it('treats a superseded config abort as normal startup control flow and ignores late config after disposal', async () => {
    let count = 0, late: ((response: Response) => void) | undefined;
    const f = fixture((url, init) => {
      if (url !== '/api/config') return;
      count++;
      if (count === 1) return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
      if (count === 3) return new Promise<Response>(resolve => late = resolve);
    });
    const first = f.service.loadConfig(); await f.service.loadConfig(); expect(await first).toBe(false);
    const previous = f.service.state.config; const pending = f.service.loadConfig(); f.service.dispose(); late?.(response({ ai: { default_channel: 'late', channels: { late: channel() } } })); expect(await pending).toBe(false); expect(f.service.state.config).toBe(previous);
  });
  it('runs at most two AI probes concurrently and does not apply a stale probe after editing credentials', async () => {
    let inFlight = 0, maximum = 0; const pending: (() => void)[] = [];
    const f = fixture(url => {
      if (url !== '/api/config/test-openai') return;
      inFlight++; maximum = Math.max(maximum, inFlight);
      return new Promise<Response>(resolve => pending.push(() => { inFlight--; resolve(response({ success: true, latency_ms: 42 })); }));
    });
    await f.service.loadConfig(); const id = f.service.newChannel('third', channel('Third')); const ids = ['main', 'extra', id]; const changed = vi.fn(); const probes = f.service.probeChannels(ids, changed);
    expect(pending).toHaveLength(2); f.service.editChannel('main', { ...channel(), api_key: 'changed' }); pending[0]!(); pending[1]!();
    await vi.waitFor(() => expect(pending).toHaveLength(3)); pending[2]!(); await probes;
    expect(maximum).toBe(2); expect(f.service.state.probes.has('main')).toBe(false); expect(f.service.state.probes.get('extra')?.status).toBe('ready'); f.service.dispose();
  });
  it('decodes demo model lists and Go connection errors, preserving credential scope/channel identity', async () => {
    const f = fixture(url => url === '/api/config/list-models' ? response({ models: ['one', 'two'] }) : url === '/api/config/test-typesafe' ? response({ error: 'bad credential' }, 400) : undefined);
    expect(await f.service.client.models({ provider: 'openai', api_key: '********', credential_scope: 'vision', channel_id: 'main' })).toMatchObject({ success: true, models: ['one', 'two'] });
    expect(f.calls[0]?.body).toMatchObject({ credential_scope: 'vision', channel_id: 'main' }); await expect(f.service.client.test('typesafe', {})).rejects.toThrow('bad credential'); f.service.dispose();
  });
  it('validates MCP multi-import, supports stdio/http/SSE and only updates the named edit', async () => {
    const f = fixture(); await expect(f.service.saveMCP('[]')).rejects.toThrow('mcp.configMustBeObject'); await expect(f.service.saveMCP('{"bad":{"type":"sse"}}')).rejects.toThrow('mcp.configSseNeedUrl');
    await f.service.saveMCP(JSON.stringify({ 'name / <&"': { command: 'python', args: ['${HOME}/tool.py'], external_mcp_enable: true }, http: { type: 'http', url: 'https://mcp' }, sse: { transport: 'sse', url: 'https://mcp/sse' } }));
    expect(f.calls.filter(call => call.method === 'PUT').map(call => call.url)).toEqual(['/api/external-mcp/name%20%2F%20%3C%26%22', '/api/external-mcp/http', '/api/external-mcp/sse']);
    expect(object(f.calls[0]?.body.config)).not.toHaveProperty('external_mcp_enable');
    f.service.state.editingMCP = 'http'; await expect(f.service.saveMCP('{"other":{"command":"x"}}')).rejects.toThrow('mcp.configEditMustContainName:http');
    await f.service.saveMCP('{"http":{"type":"http","url":"https://new"},"other":{"command":"x"}}'); expect(f.calls.filter(call => call.method === 'PUT')).toHaveLength(4); f.service.dispose();
  });
  it('uses URL-safe MCP start/stop/delete calls and exact password request casing', async () => {
    const f = fixture(); await f.service.toggleMCP('lab / special', 'connected'); await f.service.toggleMCP('lab / special', 'disabled'); f.service.state.externalFilter = 'lab / special'; await f.service.deleteMCP('lab / special'); await f.service.changePassword('old', 'new-password');
    expect(f.calls.map(call => [call.url, call.method])).toEqual([['/api/external-mcp/lab%20%2F%20special/stop', 'POST'], ['/api/external-mcp/lab%20%2F%20special/start', 'POST'], ['/api/external-mcp/lab%20%2F%20special', 'DELETE'], ['/api/auth/change-password', 'POST']]);
    expect(f.calls[3]?.body).toEqual({ oldPassword: 'old', newPassword: 'new-password' }); expect(f.service.state.externalFilter).toBe(''); f.service.dispose();
  });
  it('cancels bounded MCP polling and late config/tool state commits on dispose', async () => {
    vi.useFakeTimers(); const f = fixture(); const changed = vi.fn(); const poll = f.service.pollMCP('lab', 30, changed, true); f.service.dispose(); f.service.dispose(); await poll; await vi.advanceTimersByTimeAsync(60000); expect(f.calls).toEqual([]); expect(changed).not.toHaveBeenCalled();
  });
  it('persists valid page sizes, fetches C2 once and retries after network failure', async () => {
    let count = 0; const f = fixture(url => url === '/api/config' && ++count === 1 ? Promise.reject(new Error('network')) : undefined);
    expect(f.service.setPageSize(0)).toBe(false); expect(f.service.setPageSize(50)).toBe(true); expect(f.saved.get('toolsPageSize')).toBe('50');
    expect(await f.service.syncC2Once()).toBeNull(); expect(await f.service.syncC2Once()).toHaveProperty('ai'); expect(await f.service.syncC2Once()).toBeNull(); f.service.dispose();
  });
});
