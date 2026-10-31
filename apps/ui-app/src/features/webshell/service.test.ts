import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebshellService, type Request } from './service';
import { getWebshellParentPath, normalizeDbSchema, normalizeWebshellEncoding, normalizeWebshellOS, parseWebshellListItems, type WebshellConnection } from './model';
import { buildWebshellDbCommand, newWebshellDbProfile, parseWebshellDbExecOutput, parseWebshellDbSchema } from './index';

const conn: WebshellConnection = { id: 'ws_secret', url: 'https://example.test/shell.php', password: '********', type: 'php', method: 'POST', cmdParam: 'run', encoding: 'GBK', os: 'auto', remark: 'test', createdAt: '' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.useRealTimers());
describe('WebShell public service', () => {
  it.each([false, true])('uses backend transport without a mode override (multi enabled: %s)', async enabled => {
    const calls: { path: string; body?: unknown }[] = [];
    const service = createWebshellService({ request: async (path, init) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return path === '/api/config' ? json({ multi_agent: { enabled } }) : new Response('data: {"type":"response","message":"Recorded","data":{"finalized":true}}\n\n');
    } });
    const result = await service.sendAi(conn, 'Review');
    expect(calls.map(call => call.path)).toEqual(['/api/config', enabled ? '/api/multi-agent/stream' : '/api/eino-agent/stream']);
    expect(calls[1]?.body).toEqual({ message: 'Review', webshellConnectionId: conn.id, conversationId: '', role: '', finalization: { requireExecutionEvidence: true } });
    expect(result.finalized).toBe(true);
    await service.dispose();
  });

  it('does not start a WebShell AI run if configuration is unavailable', async () => {
    const request = vi.fn(async () => json({ error: 'Unavailable' }, 503));
    const service = createWebshellService({ request });
    const result = await service.sendAi(conn, 'Review');
    expect(request).toHaveBeenCalledOnce();
    expect(result.sending).toBe(false);
    expect(result.error).toContain('503');
    await service.dispose();
  });
  it('carries the connection ID with a masked password to exec/file and normalizes the wire fields', async () => {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const request: Request = async (path, init) => { calls.push({ path, body: JSON.parse(String(init?.body)) as Record<string, unknown> }); return json({ ok: true, output: 'ok' }); };
    const service = createWebshellService({ request });
    await service.execute(conn, 'whoami'); await service.file(conn, { action: 'read', path: '/etc/hostname' });
    expect(calls.map(call => call.path)).toEqual(['/api/webshell/exec', '/api/webshell/file']);
    for (const call of calls) expect(call.body).toMatchObject({ connection_id: 'ws_secret', password: '********', cmd_param: 'run', method: 'post', encoding: 'gbk', os: 'auto' });
    await service.dispose();
  });
  it('uses a fresh token for each probe and refuses a stale/fixed echo', async () => {
    let previous = ''; const commands: string[] = [];
    const service = createWebshellService({ request: async (_path, init) => { const body = JSON.parse(String(init?.body)) as { command: string }; commands.push(body.command); const token = body.command.slice(5); const output = previous || token; previous = token; return json({ ok: true, output }); } });
    expect((await service.probe(conn)).ok).toBe(true); expect((await service.probe(conn)).ok).toBe(false);
    expect(commands[0]).not.toEqual(commands[1]); await service.dispose();
  });
  it('loads persistent state only once for concurrent selectors and saves debounced changes', async () => {
    vi.useFakeTimers(); const calls: { path: string; method: string; body?: string }[] = [];
    const service = createWebshellService({ request: async (path, init) => { calls.push({ path, method: init?.method || 'GET', body: init?.body?.toString() }); if (path.endsWith('/state') && init?.method !== 'PUT') return json({ state: { terminalSessions: { sessions: [{ id: 'saved', name: 'Saved terminal' }], activeId: 'saved' }, dbState: { aiMemo: 'persisted memo' } } }); return json({}); } });
    await Promise.all([service.ensureState(conn), service.ensureState(conn)]);
    expect(calls).toHaveLength(1); expect(service.state(conn.id).terminalSessions.activeId).toBe('saved'); expect(service.state(conn.id).dbState.aiMemo).toBe('persisted memo');
    service.state(conn.id).dbState.aiMemo = 'new memo'; service.queueSave(conn.id); service.queueSave(conn.id);
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toHaveLength(2); expect(JSON.parse(calls[1]!.body!)).toMatchObject({ state: { dbState: { aiMemo: 'new memo' } } }); await service.dispose();
  });
  it('uploads every binary chunk in order and stops at the first rejected chunk', async () => {
    const chunks: { chunk_index: number; content: string }[] = [];
    const service = createWebshellService({ request: async (_path, init) => { const body = JSON.parse(String(init?.body)) as { chunk_index: number; content: string }; chunks.push(body); return json(body.chunk_index === 1 ? { ok: false, error: 'disk full' } : { ok: true }); } });
    await expect(service.upload(conn, '/tmp', { name: 'binary.dat', arrayBuffer: async () => new Uint8Array(65000).fill(255).buffer })).rejects.toThrow('disk full');
    expect(chunks.map(chunk => chunk.chunk_index)).toEqual([0, 1]); expect(atob(chunks[0]!.content)).toHaveLength(32000); await service.dispose();
  });
  it('moves project drafts to the streamed conversation and requires finalization evidence', async () => {
    const requests: { path: string; body?: Record<string, unknown> }[] = [];
    const frames = [{ type: 'conversation', data: { conversationId: 'conv_1' } }, { type: 'response_start' }, { type: 'response_delta', message: '\u5019\u9009' }, { type: 'response', message: 'unverified conclusion' }, { type: 'done' }];
    const service = createWebshellService({ role: () => 'operator', request: async (path, init) => {
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined });
      if (path === '/api/config') return json({ multi_agent: { enabled: true } });
      if (path.endsWith('/stream')) return new Response(frames.map(frame => 'data: ' + JSON.stringify(frame) + '\r\n\r\n').join(''));
      return json({});
    } });
    await service.setProject(conn.id, 'p1'); const run = await service.sendAi(conn, 'test');
    const sent = requests.find(request => request.path === '/api/multi-agent/stream')?.body;
    expect(sent).toMatchObject({ projectId: 'p1', role: 'operator', webshellConnectionId: conn.id, finalization: { requireExecutionEvidence: true } });
    expect(sent).not.toHaveProperty('orchestration');
    expect(sent).not.toHaveProperty('agentMode');
    expect(service.conversationId(conn.id)).toBe('conv_1'); expect(service.projectId(conn.id)).toBe('p1'); expect(run.finalized).toBe(false); expect(run.response).toContain('Still verifying; no final conclusion yet'); expect(run.details.some(detail => detail.message === 'unverified conclusion')).toBe(true);
    await service.dispose();
  });
  it('accepts finalized responses split across UTF-8/SSE chunk boundaries without dropping repeated deltas', async () => {
    const bytes = new TextEncoder().encode('data: {"type":"response_delta","message":"\u54c8"}\n\ndata: {"type":"response_delta","message":"\u54c8"}\n\ndata: {"type":"response","message":"\u54c8\u54c8","data":{"finalized":true}}\n\n');
    const responses: string[] = [];
    const service = createWebshellService({ request: async path => path === '/api/config' ? json({}) : new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } })) });
    const result = await service.sendAi(conn, 'hello', (event, run) => { if (event.type === 'response_delta') responses.push(run.response); });
    expect(responses).toEqual(['\u54c8', '\u54c8\u54c8']); expect(result.finalized).toBe(true); expect(result.response).toBe('\u54c8\u54c8'); await service.dispose();
  });
  it('cancels the transport and backend run, then releases sending state', async () => {
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; }); const calls: string[] = [];
    const service = createWebshellService({ request: async (path, init) => {
      calls.push(path); if (path === '/api/config') return json({}); if (path === '/api/agent-loop/cancel') return json({});
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"conversation","data":{"conversationId":"cancel_me"}}\n\n')); init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true }); started(); } }));
    } });
    const running = service.sendAi(conn, 'long request'); await ready;
    await vi.waitFor(() => expect(service.conversationId(conn.id)).toBe('cancel_me'));
    await service.stopAi(); const result = await running; expect(result.sending).toBe(false); expect(result.error).toBe(''); expect(calls).toContain('/api/agent-loop/cancel'); await service.dispose();
  });
});
describe('WebShell path and database contracts', () => {
  it('restores both historical table-name arrays and newer column maps from saved profiles', () => {
    expect(normalizeDbSchema({ legacy: ['users', 'logs'], current: { tables: { users: [' name ', 'id', 'id'], logs: null } } })).toEqual({ legacy: { tables: { logs: [], users: [] } }, current: { tables: { logs: [], users: ['id', 'name'] } } });
  });
  it('preserves Windows drive roots and relative traversal', () => {
    expect(getWebshellParentPath('C:\\')).toBe('C:/'); expect(getWebshellParentPath('/')).toBe('/'); expect(getWebshellParentPath('.')).toBe('..'); expect(getWebshellParentPath('../..')).toBe('../../..'); expect(normalizeWebshellEncoding(' utf8 ')).toBe('utf-8'); expect(normalizeWebshellOS('Windows')).toBe('windows');
  });
  it('parses spaces in Unix/Windows filenames while ignoring directory headers', () => {
    const files = parseWebshellListItems('total 12\n-rw-r--r-- 1 root root 42 Oct 29 12:00 file name.txt\n Directory of C:\\test\n2026/10/29  13:20  <DIR>  folder name\n2026/10/29  13:20  1,024  data.bin');
    expect(files.map(file => [file.name, file.type, file.size])).toEqual([['file name.txt', 'file', '42'], ['folder name', 'directory', ''], ['data.bin', 'file', '1024']]);
  });
  it('quotes shell credentials, encodes Unicode SQL, and retains schema/exit information', () => {
    const profile = newWebshellDbProfile(); profile.password = "a'b; echo BAD"; profile.sql = "SELECT '\u6c49\u5b57';";
    const command = buildWebshellDbCommand(profile); expect(command).toContain("MYSQL_PWD='a'\\''b; echo BAD'"); expect(command).toContain('base64 -d'); expect(command).not.toContain(profile.sql);
    expect(parseWebshellDbExecOutput('db_name|table_name|column_name\napp|users|id\napp|users|id\n__CSAI_DB_RC__:0')).toMatchObject({ rc: 0 });
    expect(parseWebshellDbSchema('db_name|table_name|column_name\napp|users|id\napp|users|id')).toEqual({ app: { tables: { users: ['id'] } } });
  });
});
