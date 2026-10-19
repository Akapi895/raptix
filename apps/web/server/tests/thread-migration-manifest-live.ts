import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDbClient, disconnectDb } from '../src/db/client.js';
import { RuntimeOwnershipService } from '../src/services/runtime-ownership.js';

// ADR-0092 I07: the migration manifest an operator imports from the legacy runtime, read directly against real
// PostgreSQL. No controller, no runtime: this is the control-plane record rebindThread later reads instead of
// trusting a client-supplied message count.
const url = process.env.ENVIRONMENT_TEST_DATABASE_URL ?? '';
assert.match(url, /^postgresql:\/\/[^@\s]+@127\.0\.0\.1:\d{2,5}\/raptix_envtest$/, 'ENVIRONMENT_TEST_DATABASE_URL must point at the throwaway raptix_envtest database on 127.0.0.1');

const db = createDbClient({ connectionString: url });
const ownership = new RuntimeOwnershipService(db);
const checks: string[] = [];
const suffix = randomUUID().slice(0, 8);

const project = (tag: string) => db.engagement.create({ data: { name: `manifest-${tag}-${suffix}`, workspaceSlug: `manifest-${tag}-${suffix}`, targetType: 'web_url', targetValue: 'https://lab.invalid', authorizationConfirmed: true } });

try {
  // 1. An operator (the owner, here) imports a manifest and it is readable back.
  const a = await project('a');
  const t1 = randomUUID();
  const imported = await ownership.importMigrationManifest('local', a.id, [{ threadId: t1, verifiedMessageCount: 75, sourceSlug: a.workspaceSlug }]);
  assert.equal(imported, 1);
  assert.equal(await ownership.verifiedMessageCount('local', a.id, t1), 75);
  checks.push('an operator imports a manifest and the verified count is readable back');

  // 2. A thread with no imported record has no verified count.
  assert.equal(await ownership.verifiedMessageCount('local', a.id, randomUUID()), null);
  checks.push('a thread with no imported record has no verified count');

  // 3. Re-importing the same thread overwrites the count (the operator re-ran the verifier).
  await ownership.importMigrationManifest('local', a.id, [{ threadId: t1, verifiedMessageCount: 80, sourceSlug: a.workspaceSlug }]);
  assert.equal(await ownership.verifiedMessageCount('local', a.id, t1), 80);
  checks.push('re-importing the same thread overwrites its verified count');

  // 4. A manifest naming a different project's slug is refused, and nothing is written.
  const b = await project('b');
  const t2 = randomUUID();
  await assert.rejects(ownership.importMigrationManifest('local', b.id, [{ threadId: t2, verifiedMessageCount: 10, sourceSlug: a.workspaceSlug }]), /Invalid|different project/);
  assert.equal(await ownership.verifiedMessageCount('local', b.id, t2), null);
  checks.push('a manifest naming a different project\'s slug is refused, and nothing is written');

  // 5. A non-owner, non-member actor cannot import a manifest for the project.
  await assert.rejects(ownership.importMigrationManifest('someone-else', a.id, [{ threadId: randomUUID(), verifiedMessageCount: 1, sourceSlug: a.workspaceSlug }]));
  checks.push('a caller with no access to the project cannot import its manifest');

  // 6. Bounds: an empty manifest, one over the size limit, and an out-of-range count are all refused.
  await assert.rejects(ownership.importMigrationManifest('local', a.id, []));
  await assert.rejects(ownership.importMigrationManifest('local', a.id, [{ threadId: t1, verifiedMessageCount: 0, sourceSlug: a.workspaceSlug }]));
  await assert.rejects(ownership.importMigrationManifest('local', a.id, [{ threadId: t1, verifiedMessageCount: 100001, sourceSlug: a.workspaceSlug }]));
  checks.push('an empty manifest and an out-of-range message count are refused');
} finally {
  await disconnectDb(db);
}

console.log(`ADR-0092 I07 migration manifest checks passed (${checks.length} groups)`);
for (const check of checks) console.log(`  - ${check}`);
