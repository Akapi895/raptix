import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createMock } from './index';
import { AUTH_KEY, STORE_KEY, type MockRuntime } from './runtime';
import { SEED_VERSION, seedSchema, projectSchema, vulnerabilitySchema, queueSchema, workflowSchema, listenerSchema } from './types';
import { seed } from './seed';
import { buildMockResponse, type DispatchResult } from '../platform/mock-transport';
import { parseSse } from '../platform/sse';
import { connectTerminal } from './terminal';
import { createHash } from 'node:crypto';

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
async function request(mock: MockRuntime, method: string, url: string, body?: unknown, signal: AbortSignal | null = null): Promise<DispatchResult> {
  const response = mock.dispatch({ method, url, body: body === undefined ? null : JSON.stringify(body), headers: {}, signal });
  await vi.advanceTimersByTimeAsync(1);
  return response;
}
function bodyOf(result: DispatchResult): unknown { if (!('body' in result)) throw new Error('Expected JSON result'); return result.body; }
const eventSchema = z.object({ type: z.string(), message: z.string(), data: z.record(z.string(), z.unknown()) });
async function eventsOf(result: DispatchResult) {
  const reader = buildMockResponse(result).body?.getReader();
  if (!reader) throw new Error('Expected SSE body');
  const events = [];
  for await (const event of parseSse(reader, { schema: eventSchema })) events.push(event);
  return events;
}
afterEach(() => { vi.useRealTimers(); });

describe('typed mock fixture and router', () => {
  it('retains every method/path in the 272-route fixture catalog (284 minus the 12 retired system/update + robot/wechat mock routes, Tier 7)', () => {
    const mock = createMock({ delayMs: 0 });
    const catalog = mock.routes.map(route => route.method + ' ' + route.pattern).sort();
    expect(catalog).toContain('GET /api/hitl/logs/:id');
    expect(catalog).toContain('GET /api/workflows/runs'); expect(catalog).toContain('GET /api/batch-tasks/runs');
    const original = catalog.filter(route => !['GET /api/hitl/logs/:id', 'GET /api/workflows/runs', 'GET /api/batch-tasks/runs'].includes(route));
    expect(original).toHaveLength(272);
    expect(createHash('sha256').update(original.join('\n')).digest('hex')).toBe('207ef2b26a0136eedbdfb704333b2d255de31a8728babe6f18eccb326b8c4711');
  });

  it('retains the original seed, version, storage keys and browser session shape', () => {
    expect(seedSchema.parse(seed()).__version).toBe('2026-10-28-9');
    const storage = memoryStorage();
    const mock = createMock({ storage, delayMs: 0 });
    mock.seedSession();
    const stored = storage.getItem(AUTH_KEY);
    expect(stored).not.toBeNull();
    const session = z.object({ token: z.string(), expiresAt: z.string(), user: z.object({ id: z.string(), username: z.string(), display_name: z.string() }), roles: z.array(z.string()), permissions: z.array(z.string()), scope: z.string() }).parse(JSON.parse(stored || 'null'));
    expect(session).toMatchObject({ token: 'mock-session-token', user: { id: 'user-admin', username: 'admin', display_name: 'Administrator' }, roles: ['Administrator'], scope: 'all' });
    expect(session.permissions).toContain('chat:write');
    expect(mock.state.projects).toHaveLength(3);
    expect(mock.state.vulnerabilities).toHaveLength(6);
    expect(mock.state.hitlPending).toEqual([]);
    expect(storage.getItem(STORE_KEY)).toContain(SEED_VERSION);
    const project = mock.state.projects[0]; if (!project) throw new Error('Missing seed project');
    project.name = 'Persisted';
    mock.save();
    expect(createMock({ storage }).state.projects[0]?.name).toBe('Persisted');
    expect(createMock({ storage, forceReset: true }).state.projects[0]?.name).toBe('Lab Web Perimeter');
    expect(storage.getItem(AUTH_KEY)).toBeNull();
    storage.setItem(STORE_KEY, '{broken');
    expect(createMock({ storage }).state.projects).toHaveLength(3);
    storage.setItem(STORE_KEY, JSON.stringify({ __version: SEED_VERSION, projects: 'wrong' }));
    expect(createMock({ storage }).state.projects).toHaveLength(3);
  });

  it('preserves login/disabled-user/logout and RBAC mutations', async () => {
    vi.useFakeTimers();
    const mock = createMock({ delayMs: 0 });
    expect((await request(mock, 'GET', '/api/auth/validate')).status).toBe(401);
    expect((await request(mock, 'POST', '/api/auth/login', { username: 'missing', password: 'bad' })).status).toBe(401);
    expect((await request(mock, 'POST', '/api/auth/login', { username: 'admin' })).status).toBe(400);
    expect((await request(mock, 'POST', '/api/auth/login', { username: 'carol', password: 'demo' })).status).toBe(403);
    // Original demo accepts every nonempty password for an enabled seeded user.
    expect(bodyOf(await request(mock, 'POST', '/api/auth/login', { username: 'alice', password: 'demo' }))).toMatchObject({ token: 'mock-session-user-alice', user: { id: 'user-alice' }, scope: 'assigned' });
    expect((await request(mock, 'GET', '/api/rbac/me')).status).toBe(200);
    const role = z.object({ id: z.string() }).parse(bodyOf(await request(mock, 'POST', '/api/rbac/roles', { name: 'Custom', permissions: ['chat:read'] })));
    expect(bodyOf(await request(mock, 'PUT', '/api/rbac/roles/' + role.id, { description: 'Edited' }))).toMatchObject({ description: 'Edited', permissions: ['chat:read'] });
    expect((await request(mock, 'DELETE', '/api/rbac/roles/role-admin')).status).toBe(400);
    expect((await request(mock, 'DELETE', '/api/rbac/roles/' + role.id)).status).toBe(200);
    await request(mock, 'POST', '/api/auth/logout');
    expect((await request(mock, 'GET', '/api/auth/validate')).status).toBe(401);
  });

  it('covers project/fact/edge, vulnerability and asset CRUD with Go pagination', async () => {
    vi.useFakeTimers();
    const mock = createMock({ delayMs: 0 });
    const project = projectSchema.parse(bodyOf(await request(mock, 'POST', '/api/projects', { name: 'New engagement', scope_json: '{"targets":["example.com"]}' })));
    const id = project.id;
    expect(bodyOf(await request(mock, 'GET', '/api/projects?search=New&limit=1&offset=0'))).toMatchObject({ total: 1, limit: 1, offset: 0 });
    await request(mock, 'PUT', '/api/projects/' + id, { name: 'Edited', pinned: true, unknown: 'ignored' });
    const fact = z.object({ id: z.string(), fact_key: z.string() }).parse(bodyOf(await request(mock, 'POST', '/api/projects/' + id + '/facts', { fact_key: 'host.demo', summary: 'Demo host' })));
    await request(mock, 'POST', '/api/projects/' + id + '/facts/deprecate', { fact_keys: [fact.fact_key] });
    expect(bodyOf(await request(mock, 'GET', '/api/projects/' + id + '/facts?hide_deprecated=true'))).toEqual([]);
    await request(mock, 'POST', '/api/projects/' + id + '/facts/restore', { ids: [fact.id] });
    const edge = z.object({ id: z.string() }).parse(bodyOf(await request(mock, 'POST', '/api/projects/' + id + '/fact-edges', { source_fact_key: fact.fact_key, target_fact_key: 'target.demo' })));
    expect(bodyOf(await request(mock, 'GET', '/api/projects/' + id + '/fact-graph'))).toMatchObject({ nodes: [{ id: 'host.demo' }], edges: [{ source: 'host.demo', target: 'target.demo' }] });
    await request(mock, 'DELETE', '/api/projects/' + id + '/fact-edges/' + edge.id);
    await request(mock, 'DELETE', '/api/projects/' + id + '/facts/' + fact.id);
    const vuln = vulnerabilitySchema.parse(bodyOf(await request(mock, 'POST', '/api/vulnerabilities', { title: 'Fixture finding', project_id: id, severity: 'high' })));
    expect(bodyOf(await request(mock, 'GET', '/api/vulnerabilities?project_id=' + id + '&page_size=1'))).toMatchObject({ total: 1, page: 1, page_size: 1 });
    await request(mock, 'PUT', '/api/vulnerabilities/' + vuln.id, { status: 'confirmed' });
    expect((await request(mock, 'POST', '/api/vulnerabilities/' + vuln.id + '/retest', { prompt: 'Verify' })).status).toBe(400);
    expect(bodyOf(await request(mock, 'GET', '/api/vulnerabilities/' + vuln.id))).toMatchObject({ status: 'confirmed' });
    await request(mock, 'DELETE', '/api/vulnerabilities/batch', { ids: [vuln.id] });
    expect((await request(mock, 'GET', '/api/vulnerabilities/' + vuln.id)).status).toBe(404);
    await request(mock, 'POST', '/api/assets/import', { assets: [{ host: 'test.example.com', project_id: id }] });
    const asset = mock.state.assets.find(asset => asset.host === 'test.example.com');
    if (!asset) throw new Error('Missing imported asset');
    await request(mock, 'PUT', '/api/assets/bulk', { ids: [asset.id], patch: { criticality: 'high' } });
    expect(bodyOf(await request(mock, 'GET', '/api/assets?project_id=' + id))).toMatchObject({ assets: [{ criticality: 'high' }], total: 1, page_size: 20 });
    await request(mock, 'POST', '/api/assets/batch-delete', { ids: [asset.id] });
    await request(mock, 'DELETE', '/api/projects/' + id);
    expect((await request(mock, 'GET', '/api/projects/' + id)).status).toBe(404);
    expect(mock.unhandled).toEqual([]);
  });

  it('covers queues, workflow graphs, config, MCP and C2 mutations', async () => {
    vi.useFakeTimers();
    const mock = createMock({ delayMs: 0 });
    const queue = queueSchema.parse(bodyOf(await request(mock, 'POST', '/api/batch-tasks', { title: 'Queue', tasks: ['One', 'Two'], scheduleMode: 'cron', cronExpr: '0 2 * * *' })));
    expect(queue.tasks.map(task => task.message)).toEqual(['One', 'Two']);
    await request(mock, 'POST', '/api/batch-tasks/' + queue.id + '/start');
    expect(bodyOf(await request(mock, 'GET', '/api/batch-tasks/' + queue.id))).toMatchObject({ status: 'running', scheduleEnabled: true });
    const first = queue.tasks[0]; if (!first) throw new Error('Missing task');
    await request(mock, 'POST', '/api/batch-tasks/' + queue.id + '/tasks/' + first.id + '/run');
    await request(mock, 'PUT', '/api/batch-tasks/' + queue.id + '/metadata', { title: 'Renamed' });
    await request(mock, 'DELETE', '/api/batch-tasks/' + queue.id);
    const workflow = workflowSchema.parse(bodyOf(await request(mock, 'POST', '/api/workflows', { name: 'Graph', graph: { nodes: [{ id: 'start', type: 'start' }], edges: [] } })));
    expect(bodyOf(await request(mock, 'PUT', '/api/workflows/' + workflow.id, { enabled: true }))).toMatchObject({ version: 2, node_count: 1, enabled: true });
    await request(mock, 'DELETE', '/api/workflows/' + workflow.id);
    await request(mock, 'GET', '/api/config');
    await request(mock, 'PUT', '/api/config', { log: { level: 'debug' } });
    expect(bodyOf(await request(mock, 'GET', '/api/config'))).toMatchObject({ version: 'v1.7.24', log: { level: 'debug' } });
    await request(mock, 'POST', '/api/external-mcp', { name: 'custom' });
    expect(bodyOf(await request(mock, 'POST', '/api/external-mcp/custom/start'))).toMatchObject({ status: 'connected', tools_count: 3 });
    await request(mock, 'DELETE', '/api/external-mcp/custom');
    const listener = listenerSchema.parse(bodyOf(await request(mock, 'POST', '/api/c2/listeners', { name: 'New', bindHost: '127.0.0.1', bindPort: 9443 })));
    await request(mock, 'POST', '/api/c2/listeners/' + listener.id + '/start');
    expect(bodyOf(await request(mock, 'GET', '/api/c2/listeners/' + listener.id))).toMatchObject({ status: 'running' });
    await request(mock, 'DELETE', '/api/c2/listeners/' + listener.id);
    const spec = z.object({ paths: z.record(z.string(), z.unknown()) }).parse(bodyOf(await request(mock, 'GET', '/api/openapi/spec')));
    expect(Object.keys(spec.paths)).toContain('/api/conversations/{id}');
    expect(mock.unhandled).toEqual([]);
  });

  it('rejects invalid typed bodies and records unknown routes exactly once', async () => {
    vi.useFakeTimers();
    const mock = createMock({ delayMs: 0 });
    expect((await request(mock, 'POST', '/api/projects', { name: 42 })).status).toBe(400);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await request(mock, 'GET', '/api/not-registered'); await request(mock, 'GET', '/api/not-registered');
    expect(mock.unhandled).toEqual(['GET /api/not-registered']); warn.mockRestore();
  });

  it('preserves settings section replacement and additional provider/robot configuration across reloads', async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const mock = createMock({ storage, delayMs: 0 });
    const settings = {
      agent: { max_iterations: 30, tool_wait_timeout_seconds: 60, external_mcp_max_concurrent_total: 16 },
      multi_agent: { enabled: true, robot_default_agent_mode: 'eino_single', model_retry_max_retries: 3 },
      robots: { telegram: { enabled: true, bot_token: 'fictional-demo-token' }, wechat: { enabled: false } },
      tools: [{ name: 'http_probe', enabled: true, is_external: false, external_mcp: '' }],
    };
    expect((await request(mock, 'PUT', '/api/config', settings)).status).toBe(200);
    expect(bodyOf(await request(mock, 'GET', '/api/config'))).toMatchObject(settings);
    expect(mock.state.config?.agent).not.toHaveProperty('timeout_seconds');
    expect(createMock({ storage }).state.config).toMatchObject(settings);
  });
});

describe('background agent streams', () => {
  it('creates a new conversation for the browser composer null conversation ID', async () => {
    vi.useFakeTimers();
    const mock = createMock({ delayMs: 0 });
    const collected = eventsOf(await request(mock, 'POST', '/api/eino-agent/stream', { message: 'Hello migration', conversationId: null, role: '' }));
    await vi.advanceTimersByTimeAsync(20000);
    const events = await collected;
    const conversationId = z.string().parse(events.find(event => event.type === 'conversation')?.data.conversationId);
    expect(mock.state.conversations[0]).toMatchObject({ id: conversationId, title: 'Hello migration' });
    expect(mock.state.messages.at(-1)).toMatchObject({ conversationId, role: 'assistant' });
    expect(events.at(-1)?.type).toBe('done');
  });

  it('frames scan events and saves the final turn after a reader aborts and reattaches', async () => {
    vi.useFakeTimers();
    const mock = createMock({ delayMs: 0 });
    const controller = new AbortController();
    const initial = await request(mock, 'POST', '/api/eino-agent/stream', { message: 'scan ports', conversationId: 'conv-recon-01' }, controller.signal);
    const disconnected = eventsOf(initial);
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await vi.advanceTimersByTimeAsync(500);
    expect((await disconnected).map(event => event.type)).toContain('conversation');
    expect(bodyOf(await request(mock, 'GET', '/api/agent-loop/tasks'))).toMatchObject({ tasks: [{ conversationId: 'conv-recon-01', status: 'running' }] });
    const resumed = eventsOf(await request(mock, 'GET', '/api/agent-loop/task-events?conversationId=conv-recon-01'));
    await vi.advanceTimersByTimeAsync(20000);
    const events = await resumed;
    expect(events.map(event => event.type)).toEqual(expect.arrayContaining(['tool_call', 'tool_result', 'response_delta', 'response', 'done']));
    expect(events.find(event => event.type === 'tool_call')?.data).toMatchObject({ toolName: 'nmap_scan', arguments: { target: '198.51.100.0/24', ports: '80,443,3000' } });
    expect(events.find(event => event.type === 'response')?.data).toMatchObject({ finalized: true, finalizable: true, completionReason: 'completed', evidenceVerified: true, missingChecks: [] });
    expect(mock.state.messages.at(-1)).toMatchObject({ role: 'assistant', conversationId: 'conv-recon-01' });
    expect(bodyOf(await request(mock, 'GET', '/api/agent-loop/tasks'))).toEqual({ tasks: [] });
  });

  it.each(['approve', 'reject'])('resumes HITL with %s and preserves the decision log', async decision => {
    vi.useFakeTimers();
    const mock = createMock({ delayMs: 0 });
    const collected = eventsOf(await request(mock, 'POST', '/api/multi-agent/stream', { message: 'token replay', conversationId: 'conv-api-03', orchestration: 'deep' }));
    await vi.advanceTimersByTimeAsync(5000);
    const pending = mock.state.hitlPending[0]; if (!pending) throw new Error('Expected live approval');
    expect(bodyOf(await request(mock, 'GET', '/api/agent-loop/tasks'))).toMatchObject({ tasks: [{ orchestration: 'deep' }] });
    await request(mock, 'POST', '/api/hitl/decision', { interruptId: pending.interruptId, decision });
    await vi.advanceTimersByTimeAsync(15000);
    const events = await collected;
    expect(events.map(event => event.type)).toContain(decision === 'reject' ? 'hitl_rejected' : 'hitl_resumed');
    expect(mock.state.hitlPending).toEqual([]);
    expect(mock.state.hitlLogs[0]).toMatchObject({ interruptId: pending.interruptId, decision, tool: 'token_replay' });
    expect(mock.state.messages.at(-1)?.content).toContain(decision === 'reject' ? 'rejected by a human' : '60 seconds');
  });

  it('round-trips approval policy and conversation scope through Go-shaped demo endpoints', async () => {
    vi.useFakeTimers();
    const storage = memoryStorage(); const mock = createMock({ storage, delayMs: 0 });
    await request(mock, 'PUT', '/api/hitl/default-config', { mode: 'review_edit', reviewer: 'audit_agent', timeoutSeconds: 0 });
    await request(mock, 'PUT', '/api/hitl/config', { conversationId: 'conv-api-03', enabled: true, mode: 'approval', reviewer: 'human', timeoutSeconds: 120, sensitiveTools: [] });
    expect(bodyOf(await request(mock, 'GET', '/api/hitl/config/conv-api-03'))).toMatchObject({ defaultMode: 'review_edit', defaultReviewer: 'audit_agent', hitl: { mode: 'approval', reviewer: 'human', timeoutSeconds: 120 } });
    await request(mock, 'PUT', '/api/hitl/tool-whitelist', { toolWhitelist: ['search_knowledge', 'custom_tool'] });
    await request(mock, 'PUT', '/api/hitl/audit-strategy', { auditAgentPrompt: 'Read only', auditAgentPromptReviewEdit: 'Narrow the scope' });
    const restored = createMock({ storage, delayMs: 0 });
    expect(bodyOf(await request(restored, 'GET', '/api/hitl/default-config'))).toMatchObject({ defaultMode: 'review_edit', defaultReviewer: 'audit_agent', defaultTimeoutSeconds: 0 });
    expect(bodyOf(await request(restored, 'GET', '/api/hitl/tool-whitelist'))).toMatchObject({ toolWhitelist: ['search_knowledge', 'custom_tool'] });
    expect(bodyOf(await request(restored, 'GET', '/api/hitl/audit-strategy'))).toMatchObject({ auditAgentPrompt: 'Read only', auditAgentPromptReviewEdit: 'Narrow the scope' });
  });

  it('filters demo decision history, opens details, and clears only matching records', async () => {
    vi.useFakeTimers(); const mock = createMock({ delayMs: 0 });
    expect(bodyOf(await request(mock, 'GET', '/api/hitl/logs?q=auth&decision=reject&decidedBy=human'))).toMatchObject({ total: 1, items: [{ id: 'hl-2', toolName: 'token_replay', comment: 'Repeated auth requests were not in scope', decidedBy: 'human' }] });
    expect(bodyOf(await request(mock, 'GET', '/api/hitl/logs/hl-2'))).toMatchObject({ id: 'hl-2', decision: 'reject' });
    expect(bodyOf(await request(mock, 'DELETE', '/api/hitl/logs?decision=reject', { all: true }))).toEqual({ deleted: 1 });
    expect(bodyOf(await request(mock, 'GET', '/api/hitl/logs'))).toMatchObject({ total: 1, items: [{ id: 'hl-1' }] });
    expect((await request(mock, 'GET', '/api/hitl/logs/hl-2')).status).toBe(404);
  });

  it('reports errors and cancellation without completing an assistant answer', async () => {
    vi.useFakeTimers();
    const mock = createMock({ delayMs: 0 });
    const initialCount = mock.state.messages.length;
    const failed = eventsOf(await request(mock, 'POST', '/api/eino-agent/stream', { message: 'error please', conversationId: 'conv-recon-01' }));
    await vi.advanceTimersByTimeAsync(5000);
    expect((await failed).map(event => event.type)).toContain('error');
    expect(mock.state.messages).toHaveLength(initialCount);
    const cancelled = eventsOf(await request(mock, 'POST', '/api/eino-agent/stream', { message: 'scan', conversationId: 'conv-recon-01' }));
    await request(mock, 'POST', '/api/agent-loop/cancel', { conversationId: 'conv-recon-01' });
    await vi.advanceTimersByTimeAsync(10000);
    expect((await cancelled).map(event => event.type)).toContain('cancelled');
    expect(mock.state.messages).toHaveLength(initialCount);
  });

  it('implements the same fake terminal commands, resize and backspace', () => {
    const output: string[] = [];
    const terminal = connectTerminal(new URL('http://mock.local/api/terminal/ws'), text => output.push(text));
    terminal.send(''); terminal.send('{"type":"resize","cols":80,"rows":24}'); terminal.send('whoamx\u007fi\r');
    expect(output.join('')).toContain('Welcome to the Raptix demo terminal');
    expect(output.join('')).toContain('labuser\r\ndemo@lab:~$ ');
    expect(output.join('')).not.toContain('resize');
  });
});
