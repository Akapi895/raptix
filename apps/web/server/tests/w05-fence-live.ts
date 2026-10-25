import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { createDbClient } from '../src/db/client.js';
import { EngagementsRepository } from '../src/repositories/engagements-repository.js';
import { ProjectsService } from '../src/services/projects-service.js';
import { LocalProjectFiles } from './support/local-project-files.js';
import { recordingSandboxes } from './support/project-sandboxes.js';
import { GovernanceService } from '../src/services/governance-service.js';
import { ScopeService } from '../src/services/scope-service.js';
import { ClosureService } from '../src/services/closure-service.js';
import { buildApp } from '../src/app.js';

// W05 real-PostgreSQL gate:
//  1. An in-flight long mutation (holding the shared mutation fence key 0)
//     must never block or refuse an emergency stop.
//  2. The durable estop latch must be persisted BEFORE the runtime cancel
//     side effect runs, so a lost runtime ack still blocks closure.
//  3. A failing runtime cancel answers 2xx with truthful outcome 'unknown'
//     and keeps the closure checklist blocked.
const database = process.env.W05_FENCE_TEST_DATABASE_URL ?? '';
assert.match(database, /@127\.0\.0\.1:5433\/raptix_web_w05f_20261016$/);
const workspace = process.env.W05_FENCE_TEST_WORKSPACE!;
assert.ok(workspace.includes('w05f'));
await mkdir(workspace, { recursive: true });
const DB = 'raptix_web_w05f_20261016';
const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations');

async function withAdmin(action: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ connectionString: database.replace(`/${DB}`, '/postgres') });
  await client.connect();
  try { await action(client); } finally { await client.end(); }
}

async function recreateDatabase(): Promise<void> {
  await withAdmin(async (client) => {
    await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [DB]);
    await client.query(`DROP DATABASE IF EXISTS "${DB}"`);
    await client.query(`CREATE DATABASE "${DB}"`);
  });
}

async function dropDatabase(): Promise<string> {
  try {
    await withAdmin(async (client) => {
      await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [DB]);
      await client.query(`DROP DATABASE IF EXISTS "${DB}"`);
    });
    return 'dropped';
  } catch (error) {
    return `survived: ${(error as Error).message.slice(0, 200)}`;
  }
}

const migrations = (await readdir(migrationsDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name !== 'migration_lock.toml')
  .map((entry) => entry.name)
  .sort();

const checks: string[] = [];
let cleanupResult = 'not_run';

try {
  await recreateDatabase();
  const applyClient = new Client({ connectionString: database });
  await applyClient.connect();
  try {
    for (const migration of migrations) {
      await applyClient.query(await readFile(path.join(migrationsDir, migration, 'migration.sql'), 'utf8'));
    }
  } finally { await applyClient.end(); }

  const db = createDbClient({ connectionString: database });
  const identity = { id: 'local', mode: 'local-single-user' } as const;
  const projects = new ProjectsService({ repository: new EngagementsRepository(db.engagement), files: new LocalProjectFiles(workspace), identity, sandboxes: recordingSandboxes() });
  const project = await projects.createProject('local', {
    name: 'w05-fence-lab',
    targetType: 'web_url',
    targetValue: 'http://authorized-w05f.invalid',
    authorizationConfirmed: true,
    brief: 'Authorized W05 fence lab: in-flight command versus emergency stop barrier.',
  });

  let cancelCalls = 0;
  let latchVisibleAtCancel = false;
  let failCancel = false;
  const cancelRun = async (): Promise<string> => {
    cancelCalls += 1;
    latchVisibleAtCancel = (await db.emergencyStop.count({ where: { engagementId: project.id } })) > 0;
    if (failCancel) throw new Error('w05: runtime did not report a terminal outcome');
    return 'stopped';
  };

  const app = await buildApp({
    workflowDb: db,
    governanceService: new GovernanceService(db, new ScopeService(db)),
    closureService: new ClosureService(db),
    cancelRun,
  });

  try {
    // Simulate a long in-flight mutation (e.g. a C2 command doing provider
    // I/O): it holds the shared mutation fence (key 0) inside an open
    // transaction and does not commit until released below.
    const barrier = new Client({ connectionString: database });
    await barrier.connect();
    await barrier.query('BEGIN');
    await barrier.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [project.id]);

    let stopStatus = 0;
    let stopBody: { outcome?: string } = {};
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/engagements/${project.id}/estops`,
        payload: { scope: 'project', reason: 'W05: stop must win over in-flight work' },
      });
      stopStatus = response.statusCode;
      stopBody = response.json() as { outcome?: string };
    } finally {
      await barrier.query('COMMIT');
      await barrier.end();
    }
    assert.ok(stopStatus >= 200 && stopStatus < 300, `emergency stop must be accepted while a mutation holds the fence (got ${stopStatus})`);
    assert.equal(stopBody.outcome, 'stopped', `runtime cancel must be dispatched and reported (got ${JSON.stringify(stopBody)})`);
    assert.equal(cancelCalls, 1, 'runtime cancel dispatch must happen');
    checks.push('estop accepted while an in-flight mutation holds the shared mutation fence');

    assert.equal(latchVisibleAtCancel, true, 'the durable estop latch must exist BEFORE the runtime cancel side effect');
    const stops = await db.emergencyStop.findMany({ where: { engagementId: project.id } });
    assert.equal(stops.length, 1);
    assert.equal(stops[0]!.outcome, 'stopped');
    checks.push('estop latch persisted before the cancel side effect and finalized truthfully');

    failCancel = true;
    const degraded = await app.inject({
      method: 'POST',
      url: `/api/engagements/${project.id}/estops`,
      payload: { scope: 'project', reason: 'W05: runtime down during cancel' },
    });
    assert.ok(degraded.statusCode >= 200 && degraded.statusCode < 300, `degraded stop must still answer 2xx, got ${degraded.statusCode}`);
    const degradedRow = await db.emergencyStop.findFirst({ where: { engagementId: project.id }, orderBy: { createdAt: 'desc' } });
    assert.equal(degradedRow?.outcome, 'unknown');
    checks.push('runtime outage during cancel answers 2xx with truthful unknown outcome');

    // The unresolved stop latch must block closure — closure can never slip
    // in between the estop reservation and its finalization.
    const closure = await app.inject({
      method: 'POST',
      url: `/api/engagements/${project.id}/closure/request`,
      payload: { reason: 'W05: closure must not win over an unresolved stop' },
    });
    assert.equal(closure.statusCode, 409, 'closure request must be blocked by unresolved stops');
    assert.ok(closure.body.includes('estop'), `closure must cite the estop blocker: ${closure.body}`);
    checks.push('unresolved estop latch blocks closure in the checklist');
  } finally {
    await app.close();
    await db.$disconnect();
  }
} catch (error) {
  cleanupResult = await dropDatabase();
  const evidencePath = process.env.W05_FENCE_EVIDENCE_PATH!;
  await mkdir(path.dirname(evidencePath), { recursive: true }).catch(() => undefined);
  await writeFile(evidencePath, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), checks, cleanup: cleanupResult }, null, 2) + '\n').catch(() => undefined);
  throw error;
}

cleanupResult = await dropDatabase();
await writeFile(process.env.W05_FENCE_EVIDENCE_PATH!, JSON.stringify({ ok: true, checks, cleanup: cleanupResult }, null, 2) + '\n');
console.log(`W05 fence PostgreSQL checks passed (${checks.length} groups)`);
