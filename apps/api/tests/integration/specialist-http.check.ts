/** Actual BFF HTTP → PostgreSQL → LangGraph HTTP → real tools/MCP acceptance. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDbClient } from '../../src/db/client.js';
import type { SpecialistCatalog, SpecialistConfiguration, SpecialistSelection } from '@raptix/web-contracts';

interface LoadedEvidence { revision: number; project_id: string | null; tools: string[]; selection: SpecialistSelection; assembled_specialists?: Record<string, LoadedEvidence> }
interface RuntimeValues { specialist_configuration: Record<string, LoadedEvidence> }

assert.ok(process.env.SPECIALIST_TEST_DATABASE_URL, 'Use a disposable migrated test database');
assert.ok(process.env.SPECIALIST_TEST_RUNTIME_TOKEN_FILE, 'Use the controlled test runtime token');
const db = createDbClient({ connectionString: process.env.SPECIALIST_TEST_DATABASE_URL });
const api = process.env.SPECIALIST_TEST_API_URL ?? 'http://127.0.0.1:58039';
const runtime = process.env.SPECIALIST_TEST_RUNTIME_URL ?? 'http://127.0.0.1:58139';
const runtimeToken = (await readFile(process.env.SPECIALIST_TEST_RUNTIME_TOKEN_FILE, 'utf8')).trim();
const login = await fetch(api + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'controlled-test', password: 'controlled-test-password' }) });
assert.equal(login.status, 200);
const { token } = await login.json() as { token: string };
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(api + path, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  assert.equal(response.status, 200, await response.clone().text());
  return await response.json() as T;
}
try {
  if (process.env.SPECIALIST_TEST_VERIFY_RESTART) {
    const project = await db.project.findFirstOrThrow({ where: { name: 'Controlled project A' }, orderBy: { createdAt: 'desc' } });
    const restored = await request<SpecialistConfiguration>('/api/specialists/recon/configuration?project_id=' + project.id);
    assert.equal(restored.revision, 2);
    assert.ok(restored.effective.tools.includes('tool:foundry_access_test'));
    console.info('Verified configuration persistence after restarting the actual API container.');
  } else {
  await db.appConfig.deleteMany({ where: { key: 'specialist-capabilities-v1' } });
  const a = await db.project.create({ data: { name: 'Controlled project A', workspaceSlug: 'controlled-a-' + Date.now() } });
  const b = await db.project.create({ data: { name: 'Controlled project B', workspaceSlug: 'controlled-b-' + Date.now() } });
  const catalog = await request<SpecialistCatalog>('/api/specialists/recon/catalog');
  assert.ok(catalog.tools.some((t: { id: string }) => t.id === 'tool:solidity_scan'));
  assert.ok(catalog.servers.some((s: { id: string; reachable: boolean }) => s.id === 'controlled' && s.reachable));
  const additions = { skills: ['/skills/standard/analyst/sql-injection/SKILL.md'], tools: ['tool:solidity_scan'], mcp: ['mcp:controlled:echo_marker'] };
  const response = await fetch(api + '/api/specialists/recon/configuration?project_id=' + a.id, { method: 'PUT', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ revision: 0, additions }) });
  assert.equal(response.status, 200, await response.clone().text());
  const saved = await request<SpecialistConfiguration>('/api/specialists/recon/configuration?project_id=' + a.id);
  assert.deepEqual(saved.effective, additions);
  async function execute(role: string, projectId: string): Promise<RuntimeValues> {
    const run = await request<{ status: string; conversationId: string }>('/api/eino-agent', { projectId, role, message: 'Run the controlled capability probe; do not contact any target.' });
    assert.equal(run.status, 'success');
    const conversation = await db.conversation.findUniqueOrThrow({ where: { id: run.conversationId } });
    const state = await fetch(runtime + '/threads/' + conversation.runtimeThreadId + '/state', { headers: { authorization: 'Bearer ' + runtimeToken } });
    assert.equal(state.status, 200);
    return (await state.json() as { values: RuntimeValues }).values;
  }
  const direct = await execute('recon', a.id);
  const delegated = await execute('raptix', a.id);
  assert.deepEqual(direct.specialist_configuration.recon.selection, delegated.specialist_configuration.raptix.assembled_specialists!.recon.selection);
  assert.equal(direct.specialist_configuration.recon.revision, 1);
  assert.equal(direct.specialist_configuration.recon.project_id, a.id);
  const isolated = await execute('recon', b.id);
  assert.ok(!isolated.specialist_configuration.recon.tools.includes('solidity_scan'));
  assert.ok(!isolated.specialist_configuration.recon.tools.some((name: string) => name.startsWith('mcp_')));
  const updated = await fetch(api + '/api/specialists/recon/configuration?project_id=' + a.id, { method: 'PUT', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ revision: 1, additions: { ...additions, tools: [...additions.tools, 'tool:foundry_access_test'] } }) });
  assert.equal(updated.status, 200);
  const fresh = await execute('recon', a.id);
  assert.equal(fresh.specialist_configuration.recon.revision, 2);
  assert.ok(fresh.specialist_configuration.recon.tools.includes('foundry_access_test'));
  assert.equal(direct.specialist_configuration.recon.revision, 1);
  console.info('Verified HTTP acceptance: saved/reloaded project configuration, direct Recon and orchestrator task execution, actual skill/tool/MCP calls, and Project B isolation.');
  }
} finally { await db.$disconnect(); }
