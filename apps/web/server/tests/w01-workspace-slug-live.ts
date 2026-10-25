import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import type { ProjectViewModel } from '@raptix/web-contracts';
import { createDbClient } from '../src/db/client.js';
import { EngagementsRepository } from '../src/repositories/engagements-repository.js';
import { ProjectsService, ProjectNameConflictError } from '../src/services/projects-service.js';
import { recordingSandboxes } from './support/project-sandboxes.js';
import { LocalProjectFiles } from './support/local-project-files.js';
import { RuntimeOwnershipService } from '../src/services/runtime-ownership.js';
import { requestFingerprint } from '../src/security/request-fingerprint.js';

// W01 real-PostgreSQL gate: globally unique workspace slugs across owners,
// isolated plan dirs, concurrent allocation, and the upgrade backfill
// (bound/oldest row keeps `name`, colliders derive a unique suffix) with
// persisted thread context hashes staying valid for backfilled rows.
const database = process.env.W01_TEST_DATABASE_URL ?? '';
assert.match(database, /@127\.0\.0\.1:5433\/raptix_web_w01_20261016$/);
const workspace = process.env.W01_TEST_WORKSPACE!;
assert.ok(workspace.includes('w01'));
await mkdir(workspace, { recursive: true });
const FRESH_DB = 'raptix_web_w01_20261016';
const UPGRADE_DB = 'raptix_web_w01_upgrade_20261016';
const adminUrl = database.replace(`/${FRESH_DB}`, '/postgres');
const NEW_MIGRATION = '20261016000000_engagement_workspace_slug';
const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations');

async function withAdmin(action: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try { await action(client); } finally { await client.end(); }
}

async function recreateDatabase(name: string): Promise<void> {
  await withAdmin(async (client) => {
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [name],
    );
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
    await client.query(`CREATE DATABASE "${name}"`);
  });
}

async function dropDatabase(name: string): Promise<string> {
  try {
    await withAdmin(async (client) => {
      await client.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [name],
      );
      await client.query(`DROP DATABASE IF EXISTS "${name}"`);
    });
    return 'dropped';
  } catch (error) {
    return `survived: ${(error as Error).message.slice(0, 200)}`;
  }
}

async function rawClient(name: string): Promise<Client> {
  const client = new Client({ connectionString: adminUrl.replace('/postgres', `/${name}`) });
  await client.connect();
  return client;
}

const migrations = (await readdir(migrationsDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name !== 'migration_lock.toml')
  .map((entry) => entry.name)
  .sort();
assert.ok(migrations.includes(NEW_MIGRATION), 'new W01 migration missing');

async function applyMigrations(name: string, skipNew: boolean): Promise<void> {
  const client = await rawClient(name);
  try {
    for (const migration of migrations) {
      if (skipNew && migration === NEW_MIGRATION) continue;
      const sql = await readFile(path.join(migrationsDir, migration, 'migration.sql'), 'utf8');
      await client.query(sql);
    }
  } finally { await client.end(); }
}

const TARGET = { targetType: 'web_url' as const, targetValue: 'http://authorized-w01.invalid', authorizationConfirmed: true, brief: 'Authorized W01 lab assessment with scoped constraints.' };
const identity = { id: 'local', mode: 'local-single-user' } as const;
const checks: string[] = [];
const cleanup: Record<string, string> = {};

try {
  await recreateDatabase(FRESH_DB);
  await recreateDatabase(UPGRADE_DB);
  cleanup[FRESH_DB] = 'recreated';
  cleanup[UPGRADE_DB] = 'recreated';

  // ── Fresh schema: cross-owner isolation through the real repository ──
  await applyMigrations(FRESH_DB, false);
  const fresh = createDbClient({ connectionString: database });
  const projects = new ProjectsService({ repository: new EngagementsRepository(fresh.engagement), files: new LocalProjectFiles(workspace), identity, sandboxes: recordingSandboxes() });
  const ownership = new RuntimeOwnershipService(fresh);
  try {
    const a = await projects.createProject('local', { name: 'acme-web', ...TARGET });
    assert.equal(a.workspaceSlug, 'acme-web');
    const b = await projects.createProject('operator-b', { name: 'acme-web', ...TARGET });
    assert.ok(b.workspaceSlug.startsWith('acme-web-'), `derived slug: ${b.workspaceSlug}`);
    assert.notEqual(a.workspaceSlug, b.workspaceSlug);
    checks.push('two owners same name get name + derived globally unique slugs');

    await writeFile(path.join(workspace, a.workspaceSlug, 'plan', 'marker-a.txt'), 'owner A', 'utf8');
    let leaked = false;
    try { await readFile(path.join(workspace, b.workspaceSlug, 'plan', 'marker-a.txt')); leaked = true; } catch { leaked = false; }
    assert.equal(leaked, false, 'owner B workspace must not contain owner A marker');
    checks.push('plan dirs are distinct; owner A marker absent from owner B workspace');

    await assert.rejects(
      () => projects.createProject('local', { name: 'acme-web', ...TARGET }),
      (error: unknown) => error instanceof ProjectNameConflictError,
    );
    checks.push('same-owner duplicate name still 409 conflicts');

    const raced = await Promise.allSettled([
      projects.createProject('racer-1', { name: 'race-lab', ...TARGET }),
      projects.createProject('racer-2', { name: 'race-lab', ...TARGET }),
    ]);
    const fulfilled = raced.filter((row): row is PromiseFulfilledResult<ProjectViewModel> => row.status === 'fulfilled');
    assert.equal(fulfilled.length, 2);
    assert.notEqual(fulfilled[0]!.value.workspaceSlug, fulfilled[1]!.value.workspaceSlug);
    checks.push('concurrent same-name creates across owners both succeed with distinct slugs');

    const allocator = new EngagementsRepository(fresh.engagement);
    const nextSlug = await allocator.allocateWorkspaceSlug('acme-web');
    assert.ok(nextSlug !== a.workspaceSlug && nextSlug !== b.workspaceSlug);
    checks.push('allocator never hands out a taken slug');

    // Persisted-thread compatibility: a context hash created with the OLD
    // formula (partition == display name) still binds for slug==name rows.
    const legacy = await fresh.engagement.create({ data: { name: 'legacy-bound', workspaceSlug: 'legacy-bound', userId: 'local', targetType: 'web_url', targetValue: TARGET.targetValue, authorizationConfirmed: true } });
    const threadId = 'legacy-thread-1';
    const legacyHash = requestFingerprint({ engagementId: legacy.id, workspaceSlug: legacy.name, targetType: legacy.targetType, targetValue: legacy.targetValue, authorizationConfirmed: legacy.authorizationConfirmed, assistantId: 'soundwave', kind: 'planning' });
    await fresh.engagementThread.create({ data: { threadId, engagementId: legacy.id, assistantId: 'soundwave', kind: 'planning', contextHash: legacyHash } });
    assert.equal((await ownership.getBinding('local', legacy.id, threadId)).threadId, threadId);
    assert.equal(await ownership.prepareBinding('local', legacy.id, 'soundwave', 'planning'), legacyHash);
    checks.push('pre-migration thread context hash stays valid for backfilled slug==name rows');
  } finally { await fresh.$disconnect(); }

  // ── Upgrade: old schema + collision fixture, then the W01 migration ──
  await applyMigrations(UPGRADE_DB, true);
  const seed = await rawClient(UPGRADE_DB);
  let boundId: string;
  try {
    const inserted = await seed.query<{ id: string; userId: string }>(
      `INSERT INTO "Engagement" ("id","name","targetType","targetValue","authorizationConfirmed","userId","threadId","runtimeContextLockedAt","createdAt","updatedAt")
       VALUES
         ($1,'collide','web_url',$3,true,'collider-a',NULL,NULL,$4,$4),
         ($2,'collide','web_url',$3,true,'collider-b','th-bound',$5,$6,$6),
         ($7,'unique-lab','web_url',$3,true,'local',NULL,NULL,$4,$4)
       RETURNING "id","userId"`,
      [
        'w01-collider-a', 'w01-collider-b', TARGET.targetValue,
        new Date('2026-10-10T00:00:00Z'), new Date('2026-10-11T00:00:00Z'),
        new Date('2026-10-11T00:00:00Z'), 'w01-unique-lab',
      ],
    );
    boundId = inserted.rows.find((row) => row.userId === 'collider-b')!.id;
    // Context hash as it was persisted before the migration (partition == name).
    const oldHash = requestFingerprint({ engagementId: boundId, workspaceSlug: 'collide', targetType: 'web_url', targetValue: TARGET.targetValue, authorizationConfirmed: true, assistantId: 'soundwave', kind: 'planning' });
    await seed.query(
      `INSERT INTO "EngagementThread" ("threadId","engagementId","assistantId","kind","contextHash","createdAt","updatedAt") VALUES ('th-bound',$1,'soundwave','planning',$2,$3,$3)`,
      [boundId, oldHash, new Date('2026-10-13T00:00:00Z')],
    );
    const pre = await seed.query<{ count: string }>("SELECT count(*)::text AS count FROM \"Engagement\" WHERE \"name\" = 'collide'");
    assert.equal(pre.rows[0]!.count, '2', 'fixture rows actually collided pre-migration');
  } finally { await seed.end(); }

  const migrationSql = await readFile(path.join(migrationsDir, NEW_MIGRATION, 'migration.sql'), 'utf8');
  const applyClient = await rawClient(UPGRADE_DB);
  try { await applyClient.query(migrationSql); } finally { await applyClient.end(); }

  const verify = await rawClient(UPGRADE_DB);
  try {
    const rows = await verify.query<{ name: string; userId: string; workspaceSlug: string }>(
      'SELECT "name","userId","workspaceSlug" FROM "Engagement"',
    );
    const colliderA = rows.rows.find((row) => row.userId === 'collider-a')!;
    const colliderB = rows.rows.find((row) => row.userId === 'collider-b')!;
    const uniqueRow = rows.rows.find((row) => row.name === 'unique-lab')!;
    assert.equal(colliderB.workspaceSlug, 'collide', 'bound row keeps name');
    assert.equal(uniqueRow.workspaceSlug, 'unique-lab', 'singleton keeps name');
    assert.equal(colliderA.workspaceSlug, `collide-${createHash('md5').update('w01-collider-a').digest('hex').slice(0, 6)}`, 'collider derives md5 suffix');
    const index = await verify.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'Engagement' AND indexname = 'Engagement_workspaceSlug_key'",
    );
    assert.equal(index.rows.length, 1, 'unique index present');
    checks.push('upgrade backfill: bound/oldest keeps name, collider derives md5 suffix, unique index created');

    const upgradedDb = createDbClient({ connectionString: adminUrl.replace('/postgres', `/${UPGRADE_DB}`) });
    const upgradedOwnership = new RuntimeOwnershipService(upgradedDb);
    try {
      assert.equal((await upgradedOwnership.getBinding('collider-b', 'w01-collider-b', 'th-bound')).threadId, 'th-bound');
      checks.push('bound thread on the row that kept its name still verifies after migration');
    } finally { await upgradedDb.$disconnect(); }
  } finally { await verify.end(); }
} finally {
  // Dedicated W01 namespace only — never touches shared databases.
  cleanup[FRESH_DB] = await dropDatabase(FRESH_DB);
  cleanup[UPGRADE_DB] = await dropDatabase(UPGRADE_DB);
}

await writeFile(process.env.W01_EVIDENCE_PATH!, JSON.stringify({ ok: true, checks, cleanup }, null, 2) + '\n');
console.log(`W01 PostgreSQL checks passed (${checks.length} groups)`);
