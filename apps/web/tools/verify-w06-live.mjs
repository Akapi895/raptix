import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { createDbClient } from '../server/dist/db/client.js'
import { EngagementsRepository } from '../server/dist/repositories/engagements-repository.js'
import { ProjectsService } from '../server/dist/services/projects-service.js'
import { RuntimeOwnershipService } from '../server/dist/services/runtime-ownership.js'
import { RuntimeContextService } from '../server/dist/services/runtime/runtime-context.js'
import { RuntimeReadClient } from '../server/dist/integrations/runtime/read-client.js'
import { loadRuntimeConfig } from '../server/dist/config/runtime.js'
import { isRuntimeContextView } from '@raptix/web-contracts'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const workspaceRoot = path.join(repo, 'workspace')
assert.ok(existsSync(workspaceRoot))
const runtimeUrl = 'http://127.0.0.1:2400'
const database = 'postgresql://w02_test_20261001:w02_local_test_only@127.0.0.1:5433/raptix_web_w02_fresh_20261001'
const db = createDbClient({ connectionString: database })
const ownership = new RuntimeOwnershipService(db)
const projects = new ProjectsService({ repository: new EngagementsRepository(db.engagement), workspaceRoot, identity: { id: 'local', mode: 'local-single-user' } })
const config = loadRuntimeConfig({ LANGGRAPH_API_URL: runtimeUrl, RAPTIX_RUNTIME_WORKSPACE_ROOT: '/workspace' })
const resolver = new RuntimeContextService({ config, projects, ownership, workspaceRoot, runtime: new RuntimeReadClient(runtimeUrl) })
const slug = `w06-context-${randomUUID()}`
const directory = path.join(workspaceRoot, slug)
assert.ok(!existsSync(directory), 'Refuse to reuse any existing workspace')
const fixtureToken = randomUUID()
let child, remoteId, project, evidence
const checks = []
async function runtime(method, endpoint, body, expected = 200) {
  const response = await fetch(`${runtimeUrl}${endpoint}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), signal: AbortSignal.timeout(15000) })
  assert.equal(response.status, expected, `${method} ${endpoint}: ${await response.clone().text()}`)
  return response.status === 204 ? null : response.json()
}
async function api(endpoint, status = 200) {
  const response = await fetch(`http://127.0.0.1:5283/api${endpoint}`, { signal: AbortSignal.timeout(20000) })
  const body = await response.json(); assert.equal(response.status, status, JSON.stringify(body)); return body
}
async function stop() {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)) }
}
try {
  project = await projects.createProject('local', { name: slug, targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true })
  const planningName = 'W06 isolated context verification'
  const bundle = {
    roe: { engagement_name: planningName, client: 'Local test fixture', start_date: '2026-10-02', end_date: '2026-10-02', engagement_type: 'external', testing_window: 'Context-only local verification; no target operations', authorization_reference: 'W06 isolated context fixture', in_scope: [{ target: project.targetValue, type: 'web-url' }] },
    conops: { engagement_name: planningName, executive_summary: 'Verify context and state persistence only; no assessment execution.' },
    deconfliction: { engagement_name: planningName },
    'threat-profile': { engagement_name: planningName, actor_name: 'Test', tier: 'tier-1', sophistication: 'low', motivation: 'testing' },
    contact: { engagement_name: planningName, primary_operator: { name: 'Local Operator', role: 'Owner', channel: 'local' } },
    'data-handling': { engagement_name: planningName }, abort: { engagement_name: planningName }, cleanup: { engagement_name: planningName },
  }
  for (const [name, document] of Object.entries(bundle)) writeFileSync(path.join(directory, 'plan', `${name}.json`), JSON.stringify(document))
  const context = await resolver.resolve('local', project.id, { kind: 'planning' })
  assert.equal(context.assistantId, 'soundwave'); assert.equal(context.publicView.executionReady, true)
  const cli = JSON.parse(readFileSync(new URL('../tests/fixtures/w06/cli-context.json', import.meta.url), 'utf8'))
  assert.deepEqual(context.configurable, { ...cli.configurable, engagement_name: slug, workspace_path: `/workspace/${slug}` })
  const hydrationProgram = "import sys,json,hashlib; from pathlib import Path; import raptix.middleware.engagement as m; cfg=json.loads(sys.argv[1]); m._configurable_from_runnable_config=lambda:cfg; print('W06_LIVE='+json.dumps({'values':m._hydrate_engagement_state({}),'roeHash':hashlib.sha256((Path(cfg['workspace_path'])/'plan/roe.json').read_bytes()).hexdigest()}))"
  const capture = spawnSync('docker', ['exec', 'raptix-langgraph', 'python', '-c', hydrationProgram, JSON.stringify(context.configurable)], { encoding: 'utf8', timeout: 60000 })
  assert.equal(capture.status, 0, 'Installed middleware/mount verification failed')
  const hydrated = JSON.parse(capture.stdout.split('\n').find(s => s.startsWith('W06_LIVE=')).slice('W06_LIVE='.length))
  assert.deepEqual(hydrated.values, context.configurable)
  assert.equal(hydrated.roeHash, createHash('sha256').update(readFileSync(path.join(directory, 'plan/roe.json'))).digest('hex'))
  checks.push('actual CLI configurable parity, installed runtime middleware hydration and API/runtime workspace-file identity')
  const remote = await runtime('POST', '/threads', { metadata: { ...context.metadata, graph_id: context.assistantId, w06_fixture_token: fixtureToken } })
  remoteId = remote.thread_id
  await ownership.bindThread('local', project.id, { threadId: remoteId, assistantId: context.assistantId, kind: 'planning', contextHash: context.bindingHash, runtimeConfigHash: context.runtimeConfigHash })
  await runtime('POST', `/threads/${remoteId}/state`, { values: hydrated.values, as_node: '__start__' })
  writeFileSync(new URL('../tests/fixtures/w06/runtime-thread.json', import.meta.url), JSON.stringify({ provenance: 'owned live W06 context-only thread/checkpoint fixture', thread: await runtime('GET', `/threads/${remoteId}`), state: await runtime('GET', `/threads/${remoteId}/state`) }, null, 2) + '\n')
  assert.equal((await resolver.resolve('local', project.id, { kind: 'planning', threadId: remoteId })).publicView.threadVerified, true)
  checks.push('real acknowledged owned runtime thread, hydrated checkpoint and persisted full binding proof validate end-to-end')

  child = spawn(process.execPath, ['dist/main.js'], { cwd: path.join(repo, 'apps/web/server'), env: { ...process.env, DATABASE_URL: database, WORKSPACE_PATH: workspaceRoot, LANGGRAPH_API_URL: runtimeUrl, RAPTIX_RUNTIME_WORKSPACE_ROOT: '/workspace', PORT: '5283', HOST: '127.0.0.1' }, stdio: 'pipe' })
  let log = ''; child.stdout.on('data', b => { log += b }); child.stderr.on('data', b => { log += b })
  let alive = false
  for (let i = 0; i < 100; i++) {
    assert.equal(child.exitCode, null, log)
    try { alive = (await fetch('http://127.0.0.1:5283/api/health', { signal: AbortSignal.timeout(500) })).ok } catch { /* bounded owned-process startup */ }
    if (alive) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(alive)
  const publicContext = await api(`/engagements/${project.id}/runtime-context?kind=planning&threadId=${remoteId}`)
  assert.ok(isRuntimeContextView(publicContext)); assert.equal(publicContext.threadVerified, true)
  for (const privateValue of ['/workspace', workspaceRoot, context.runtimeConfigHash, context.bindingHash, fixtureToken]) assert.ok(!JSON.stringify(publicContext).includes(privateValue))
  const agents = await api('/agents'); assert.equal(agents.source, 'runtime'); assert.ok(agents.graphs.includes('soundwave')); assert.ok(agents.graphs.includes('decepticon')); assert.ok(!agents.graphs.includes('recon'))
  assert.equal((await api(`/engagements/${project.id}/runtime-context?kind=execution`)).assistantId, 'decepticon')
  await api(`/engagements/${project.id}/runtime-context?kind=execution&assistantId=recon`, 503)
  await api(`/engagements/${project.id}/runtime-context?kind=planning&workspace_path=/forged`, 400)
  await api(`/engagements/${project.id}/runtime-context?kind=execution&threadId=${remoteId}`, 409)
  const foreign = await db.engagement.create({ data: { name: `w06-foreign-${randomUUID()}`, userId: 'foreign-owner', targetType: 'web_url', targetValue: project.targetValue, authorizationConfirmed: true } })
  await api(`/engagements/${foreign.id}/runtime-context?kind=planning`, 404)
  const caps = await api('/capabilities'); assert.deepEqual(caps.capabilities.agents, { supported: true, available: true }); assert.equal(caps.capabilities.runs.supported, true)
  assert.equal((await api('/health/ready')).checks.runtime.status, 'ok')
  checks.push('compiled new-API context/catalog/capability/readiness routes, no private-config leakage and rejected browser/owner/assistant overrides')

  await runtime('PATCH', `/threads/${remoteId}`, { metadata: { engagement_id: 'foreign-engagement' } })
  await api(`/engagements/${project.id}/runtime-context?kind=planning&threadId=${remoteId}`, 409)
  await runtime('PATCH', `/threads/${remoteId}`, { metadata: context.metadata })
  await runtime('POST', `/threads/${remoteId}/state`, { values: { target_value: 'https://foreign.invalid' }, as_node: '__start__' })
  await api(`/engagements/${project.id}/runtime-context?kind=planning&threadId=${remoteId}`, 409)
  await runtime('POST', `/threads/${remoteId}/state`, { values: { target_value: project.targetValue }, as_node: '__start__' })
  await db.engagementThread.update({ where: { threadId: remoteId }, data: { runtimeConfigHash: null } })
  await api(`/engagements/${project.id}/runtime-context?kind=planning&threadId=${remoteId}`, 409)
  await db.engagementThread.update({ where: { threadId: remoteId }, data: { runtimeConfigHash: context.runtimeConfigHash } })
  assert.equal((await api(`/engagements/${project.id}/runtime-context?kind=planning&threadId=${remoteId}`)).threadVerified, true)
  checks.push('actual remote metadata/state mismatch and missing persisted proof fail closed; existing context is not forcibly overwritten')
  const unavailable = new RuntimeContextService({ config, projects, ownership, workspaceRoot, runtime: new RuntimeReadClient('http://127.0.0.1:1', 100) })
  await assert.rejects(() => unavailable.resolve('local', project.id, { kind: 'planning' }), error => error.statusCode === 503)
  checks.push('unreachable runtime returns unavailable without source-catalog fallback')
  evidence = { ok: true, provenance: 'real PostgreSQL/new API/runtime catalog/thread/checkpoint plus installed middleware hydration; no runs/models/tools submitted', projectId: project.id, runtimeThreadId: remoteId, workspaceSlug: slug, runtimeGraphs: agents.graphs, checks, ownedThreadRemovedAfterGate: true }
} finally {
  await stop()
  if (remoteId) {
    const remote = await runtime('GET', `/threads/${remoteId}`)
    assert.equal(remote.metadata.w06_fixture_token, fixtureToken, 'Refuse to delete a thread without the owned fixture marker')
    await runtime('DELETE', `/threads/${remoteId}`, undefined, 204)
  }
  if (project) rmSync(directory, { recursive: true, force: true })
  await db.$disconnect()
}
writeFileSync(new URL('../docs/integration/w06-live.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n')
console.log(`W06 live context/catalog/thread/checkpoint parity gate passed (${checks.length} groups)`)
