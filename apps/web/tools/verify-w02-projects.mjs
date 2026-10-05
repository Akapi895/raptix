import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { isProjectViewModel } from '@raptix/web-contracts'

const db = process.argv[2]
if (!['fresh', 'oldcopy'].includes(db)) throw new Error('Only controlled W02 databases are allowed')
const databaseUrl = `postgresql://w02_test_20261001:w02_local_test_only@127.0.0.1:5433/raptix_web_w02_${db}_20261001`
const workspace = path.join(tmpdir(), 'opencode', `raptix-w02-${db}-${Date.now()}`)
mkdirSync(path.join(workspace, 'stray-cli-directory'), { recursive: true })
const child = spawn(process.execPath, ['dist/main.js'], {
  cwd: fileURLToPath(new URL('../server/', import.meta.url)),
  env: { ...process.env, HOST: '127.0.0.1', PORT: '5280', NODE_ENV: 'test', DATABASE_URL: databaseUrl, WORKSPACE_PATH: workspace }, stdio: 'pipe',
})
let log = ''
child.stdout.on('data', chunk => { log += chunk.toString() })
child.stderr.on('data', chunk => { log += chunk.toString() })
const results = []
const base = 'http://127.0.0.1:5280'
async function request(method, url, body, expected) {
  const response = await fetch(`${base}${url}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) })
  const payload = await response.json()
  assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(payload)}`)
  results.push({ method, url, expected, status: response.status, payload })
  return payload
}
try {
  let alive = false
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null) throw new Error(`API exited: ${log}`)
    try { alive = (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).status === 200 } catch { /* Wait for child startup. */ }
    if (alive) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.equal(alive, true, `API never started: ${log}`)
  const before = await request('GET', '/api/engagements', undefined, 200)
  assert.ok(before.every(isProjectViewModel))
  assert.ok(before.every(project => project.workspaceSlug !== 'stray-cli-directory'))
  const slug = `w02-${db}-${Date.now()}`
  const input = { name: slug, displayName: 'Controlled API test', targetType: 'web_url', targetValue: 'http://authorized-test.invalid', authorizationConfirmed: true }
  await request('POST', '/api/engagements', { ...input, authorizationConfirmed: false }, 400)
  await request('POST', '/api/engagements', { ...input, name: '../escape' }, 400)
  await request('POST', '/api/engagements', { ...input, targetValue: 'javascript:alert(1)' }, 400)
  await request('POST', '/api/engagements', { ...input, userId: 'another-owner' }, 400)
  const created = await request('POST', '/api/engagements', input, 201)
  assert.ok(isProjectViewModel(created))
  assert.equal(created.metadataState, 'verified')
  assert.equal(created.assetCount, null)
  assert.ok(existsSync(path.join(workspace, slug, 'plan')))
  await request('GET', `/api/engagements/${created.id}`, undefined, 200)
  await request('POST', '/api/engagements', input, 409)
  const patched = await request('PATCH', `/api/engagements/${created.id}`, { displayName: 'Changed display only' }, 200)
  assert.equal(patched.workspaceSlug, slug)
  await request('PATCH', `/api/engagements/${created.id}`, { name: 'renamed-slug' }, 400)
  await request('PATCH', `/api/engagements/${created.id}`, { threadId: 'arbitrary-runtime-thread' }, 400)
  await request('GET', '/api/engagements/unknown-id', undefined, 404)
  const concurrent = { ...input, name: `${slug}-race` }
  const raceResponses = await Promise.all([fetch(`${base}/api/engagements`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(concurrent) }), fetch(`${base}/api/engagements`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(concurrent) })])
  assert.deepEqual(raceResponses.map(response => response.status).sort(), [201, 409])
  const after = await request('GET', '/api/engagements', undefined, 200)
  assert.equal(after.filter(project => project.workspaceSlug === concurrent.name).length, 1)
  assert.ok(after.every(isProjectViewModel))
  const caps = await request('GET', '/api/capabilities', undefined, 200)
  assert.ok(Object.values(caps.capabilities).some(capability => capability.supported && capability.available))
  await request('GET', '/api/health/ready', undefined, 503)
  writeFileSync(new URL(`../docs/integration/w02-${db}-api.json`, import.meta.url), JSON.stringify({ ok: true, dbLane: db, workspace, raceStatuses: [201, 409], originalProjectIds: before.map(project => project.id), results }, null, 2) + '\n')
  console.log(`W02 ${db}: real PostgreSQL-backed API, public DTO, safe list/patch and concurrent slug uniqueness passed`)
} finally {
  child.kill('SIGTERM')
  await new Promise(resolve => { child.once('exit', resolve); if (child.exitCode !== null) resolve() })
}
