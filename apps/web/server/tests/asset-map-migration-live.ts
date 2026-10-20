// Asset Map catalog migration gate (plan phases 2 and 8) on real PostgreSQL, in an isolated database.
//
//   ASSET_MAP_MIGRATION_TEST_DATABASE_URL=postgresql://<user>:<pass>@127.0.0.1:5433/raptix_web_asset_map_<tag> \
//     npx tsx apps/web/server/tests/asset-map-migration-live.ts
//
// The database name must contain "raptix_web_asset_map_", and the host must be loopback. The script
// creates that database, applies every migration in order, and drops it at the end. It checks:
//   1. upgrade: the AssetIdentity migration adds the table and both indexes, and leaves WebAsset alone;
//   2. concurrent writes: eight connections insert the same identities; each identity lands once and
//      no insert fails (the catalog is keyed by the deterministic assetId, so replays are no-ops);
//   3. ambiguity: a second identity for the same (engagement, kind, namespace, canonicalKey) is refused
//      by the unique index instead of being merged into the first;
//   4. rollback: the down script drops only AssetIdentity, and WebAsset keeps its rows;
//   5. the upgrade and rollback cycle repeats without residue.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const databaseUrl = process.env.ASSET_MAP_MIGRATION_TEST_DATABASE_URL ?? '';
const parsed = new URL(databaseUrl);
assert.match(parsed.pathname, /^\/raptix_web_asset_map_[a-z0-9_]+$/, 'the database name must start with raptix_web_asset_map_');
assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname), 'the migration gate only runs against a loopback database');

const databaseName = parsed.pathname.slice(1);
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = '/postgres';

const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(serverDir, 'prisma', 'migrations');
const rollbackFile = path.join(serverDir, 'prisma', 'rollback', '20261031000100_asset_identity.down.sql');
const identityMigration = '20261031000100_asset_identity';
const identityCount = 500;
const writers = 8;

const report: Record<string, unknown> = { database: databaseName, checks: {} };
const checks = report.checks as Record<string, boolean>;

async function withClient<T>(connectionString: string, action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

async function migrationDirectories(): Promise<string[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

async function tableExists(client: Client, table: string): Promise<boolean> {
  const result = await client.query<{ present: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) AS present",
    [table],
  );
  return result.rows[0]?.present === true;
}

async function applyMigration(client: Client, name: string): Promise<void> {
  const sql = await readFile(path.join(migrationsDir, name, 'migration.sql'), 'utf8');
  await client.query(sql);
}

function identity(index: number): [string, string, string, string, string, number] {
  return [`asset_${index.toString().padStart(6, '0')}`, 'eng-gate', 'host', 'default', `10.20.${Math.floor(index / 250)}.${index % 250}`, 2];
}

async function insertIdentities(client: Client, rows: Array<[string, string, string, string, string, number]>): Promise<void> {
  const values: unknown[] = [];
  const tuples = rows.map((row, rowIndex) => {
    const offset = rowIndex * 6;
    values.push(...row);
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`;
  });
  await client.query(
    `INSERT INTO "AssetIdentity" ("id", "engagementId", "kind", "namespace", "canonicalKey", "keyVersion") VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`,
    values,
  );
}

async function run(): Promise<void> {
  await withClient(adminUrl.toString(), client => client.query(`CREATE DATABASE "${databaseName}"`));
  try {
    const directories = await migrationDirectories();
    assert.equal(directories.at(-1), identityMigration, 'the asset identity migration must be the newest');

    // 1. Upgrade: every earlier migration, then the catalog migration.
    await withClient(databaseUrl, async client => {
      for (const name of directories.slice(0, -1)) await applyMigration(client, name);
      checks.catalogAbsentBeforeUpgrade = !(await tableExists(client, 'AssetIdentity'));
      await applyMigration(client, identityMigration);
      // Fixture rows for WebAsset only: foreign-key triggers are off for this session because the
      // gate has no Engagement rows. The point is that the catalog rollback leaves them alone.
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(
        `INSERT INTO "WebAsset" ("id", "engagementId", "identifier", "createdBy", "createdAt", "updatedAt")
         VALUES ('web-asset-keep-1', 'eng-gate', '10.20.0.1', 'gate', now(), now()),
                ('web-asset-keep-2', 'eng-gate', '10.20.0.2', 'gate', now(), now())`,
      );
      await client.query(`SET session_replication_role = 'origin'`);
      checks.catalogPresentAfterUpgrade = await tableExists(client, 'AssetIdentity');
      const indexes = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'AssetIdentity'`,
      );
      checks.bothIndexesCreated =
        indexes.rows.some(row => row.indexname === 'AssetIdentity_engagementId_kind_namespace_canonicalKey_key') &&
        indexes.rows.some(row => row.indexname === 'AssetIdentity_engagementId_kind_idx');
    });

    // 2. Concurrent writes: every writer inserts the same identities; each identity lands exactly once.
    const rows = Array.from({ length: identityCount }, (_, index) => identity(index));
    const connections = await Promise.all(Array.from({ length: writers }, () => {
      const client = new Client({ connectionString: databaseUrl });
      return client.connect().then(() => client);
    }));
    try {
      await Promise.all(connections.map(client => insertIdentities(client, rows)));
    } finally {
      await Promise.all(connections.map(client => client.end()));
    }
    await withClient(databaseUrl, async client => {
      const count = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM "AssetIdentity"');
      const written = Number(count.rows[0]?.count ?? -1);
      report.identitiesAfterConcurrentWrites = written;
      checks.concurrentWritesLandOnce = written === identityCount;
    });

    // 3. Ambiguity: a different id for an existing locator is refused, not merged.
    await withClient(databaseUrl, async client => {
      const conflict = await client
        .query(
          `INSERT INTO "AssetIdentity" ("id", "engagementId", "kind", "namespace", "canonicalKey", "keyVersion") VALUES ($1, $2, $3, $4, $5, $6)`,
          ['asset_conflict', 'eng-gate', 'host', 'default', identity(0)[4], 2],
        )
        .then(() => null, (error: { code?: string }) => error.code ?? 'unknown');
      checks.ambiguousLocatorRefused = conflict === '23505';
    });

    // 4. Rollback: only the catalog goes; WebAsset keeps its rows.
    await withClient(databaseUrl, async client => {
      await client.query(await readFile(rollbackFile, 'utf8'));
      checks.catalogDroppedByRollback = !(await tableExists(client, 'AssetIdentity'));
      const kept = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM "WebAsset"');
      checks.webAssetUntouchedByRollback = kept.rows[0]?.count === '2';
    });

    // 5. The cycle repeats: upgrade again, then roll back again.
    await withClient(databaseUrl, async client => {
      await applyMigration(client, identityMigration);
      await insertIdentities(client, rows.slice(0, 10));
      const count = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM "AssetIdentity"');
      checks.secondUpgradeWritable = count.rows[0]?.count === '10';
      await client.query(await readFile(rollbackFile, 'utf8'));
      checks.secondRollbackClean = !(await tableExists(client, 'AssetIdentity'));
    });
  } finally {
    await withClient(adminUrl.toString(), client =>
      client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`),
    );
  }
}

try {
  await run();
  report.ok = Object.values(checks).every(Boolean);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  report.ok = false;
  report.error = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}
