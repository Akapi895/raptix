import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import pg from 'pg'

const lane = process.argv[2]
const phase = process.argv.includes('--w07') ? 'w07-migration' : process.argv.includes('--w06') ? 'w06-migration' : 'w05'
assert.ok(['fresh', 'oldcopy'].includes(lane), 'Only controlled test databases are allowed')
const databaseUrl = `postgresql://w02_test_20261001:w02_local_test_only@127.0.0.1:5433/raptix_web_w02_${lane}_20261001`
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const server = path.join(repo, 'clients/web-raptix/server')
const workspace = path.join(tmpdir(), 'opencode', `raptix-w05-${lane}-${Date.now()}`)
mkdirSync(workspace, { recursive: true })
const evidencePath = path.join(workspace, 'service-evidence.json')
const pool = new pg.Pool({ connectionString: databaseUrl })
const steps = []
function run(command, args, env = {}) {
  const result = spawnSync(command, args, { cwd: server, env: { ...process.env, ...env }, stdio: 'inherit', timeout: 120000 })
  assert.equal(result.status, 0, `${command} ${args.join(' ')}`)
  steps.push({ command: `${command} ${args.join(' ')}`, exitCode: result.status })
}
function fingerprint(rows) {
  return createHash('sha256').update(JSON.stringify(rows.map(({ runtimeContextLockedAt, ...record }) => record))).digest('hex')
}
async function start() {
  const child = spawn(process.execPath, ['dist/main.js'], { cwd: server, env: { ...process.env, HOST: '127.0.0.1', PORT: '5282', NODE_ENV: 'test', DATABASE_URL: databaseUrl, WORKSPACE_PATH: workspace }, stdio: 'pipe' })
  let log = ''
  child.stdout.on('data', chunk => { log += chunk }); child.stderr.on('data', chunk => { log += chunk })
  try {
    for (let i = 0; i < 100; i++) {
      assert.equal(child.exitCode, null, log)
      try { if ((await fetch('http://127.0.0.1:5282/api/health', { signal: AbortSignal.timeout(500) })).ok) return child } catch { /* bounded startup wait */ }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('New API did not start')
  } catch (error) { await stop(child); throw error }
}
async function stop(child) {
  if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)) }
}
async function recover(engagementId, requestId) {
  const response = await fetch(`http://127.0.0.1:5282/api/engagements/${engagementId}/requests/${requestId}`)
  assert.equal(response.status, 200)
  return response.json()
}

let child
try {
  const beforeRows = (await pool.query('SELECT * FROM "Engagement" ORDER BY "id"')).rows
  const beforeMigrations = (await pool.query('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name')).rows
  run(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/c', 'npm run prisma:migrate'] : ['run', 'prisma:migrate'], { DATABASE_URL: databaseUrl })
  const afterRows = (await pool.query('SELECT * FROM "Engagement" ORDER BY "id"')).rows
  assert.equal(fingerprint(beforeRows), fingerprint(afterRows), 'Migration altered existing engagement data')
  const afterMigrations = (await pool.query('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name')).rows
  for (const migration of beforeMigrations) assert.deepEqual(afterMigrations.find(row => row.migration_name === migration.migration_name), migration)
  run(process.execPath, ['--import', 'tsx', 'tests/w05-live.ts'], { W05_TEST_DATABASE_URL: databaseUrl, W05_TEST_WORKSPACE: workspace, W05_EVIDENCE_PATH: evidencePath })
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
  child = await start()
  const initial = await recover(evidence.engagementId, evidence.requestId)
  assert.equal(initial.state, 'creating')
  const accepted = await recover(evidence.accepted.engagementId, evidence.accepted.requestId)
  assert.equal(accepted.state, 'accepted'); assert.equal(accepted.runId, evidence.accepted.runId)
  await stop(child); child = undefined
  await pool.query('UPDATE "WebRequestLedger" SET "updatedAt" = NOW() - INTERVAL \'10 minutes\' WHERE "engagementId"=$1 AND "requestId"=$2', [evidence.engagementId, evidence.requestId])
  child = await start()
  const restarted = await recover(evidence.engagementId, evidence.requestId)
  assert.equal(restarted.state, 'uncertain')
  assert.equal((await recover(evidence.accepted.engagementId, evidence.accepted.requestId)).runId, evidence.accepted.runId)
  writeFileSync(new URL(`../docs/integration/${phase}-${lane}.json`, import.meta.url), JSON.stringify({ ok: true, lane, workspace, migration: { preservedRows: beforeRows.length, beforeHash: fingerprint(beforeRows), afterHash: fingerprint(afterRows), preservedMigrationChecksums: beforeMigrations.length }, steps, ...evidence, processRestart: { initial: initial.state, restarted: restarted.state, acceptedRunPreserved: true } }, null, 2) + '\n')
  console.log(`W05 ${lane}: additive migration/data preservation, concurrency/ownership and real API process restart passed`)
} finally { if (child) await stop(child); await pool.end() }
