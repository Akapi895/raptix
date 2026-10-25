import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDbClient } from '../src/db/client.js';
import { RuntimeOwnershipService } from '../src/services/runtime-ownership.js';
import { EngagementsRepository } from '../src/repositories/engagements-repository.js';
import { ProjectsService } from '../src/services/projects-service.js';
import { LocalProjectFiles } from './support/local-project-files.js';
import { recordingSandboxes } from './support/project-sandboxes.js';
import { buildApp } from '../src/app.js';
import { isRequestRecoveryView, isThreadBindingView } from '@raptix/web-contracts';

const database = process.env.W05_TEST_DATABASE_URL ?? '';
assert.match(database, /@127\.0\.0\.1:5433\/raptix_web_w02_(fresh|oldcopy)_20261001$/);
const workspace = process.env.W05_TEST_WORKSPACE!;
assert.ok(workspace.includes('opencode') && workspace.includes('w05'));
await mkdir(workspace, { recursive: true });
const db = createDbClient({ connectionString: database });
const service = new RuntimeOwnershipService(db);
const identity = { id: 'local', mode: 'local-single-user' } as const;
const projects = new ProjectsService({ repository: new EngagementsRepository(db.engagement), files: new LocalProjectFiles(workspace), identity, sandboxes: recordingSandboxes() });
const app = await buildApp({ projectsService: projects, runtimeOwnership: service });
const checks: string[] = [];
async function failure(action: () => Promise<unknown>, status: number): Promise<void> {
  await assert.rejects(action, (error: { statusCode?: number; code?: string }) => error.statusCode === status || error.code === (status === 404 ? 'not_found' : status === 409 ? 'conflict' : 'bad_request'));
}
async function http(url: string, status: number, method: 'GET' | 'PATCH' | 'POST' = 'GET', payload?: unknown): Promise<unknown> {
  const response = await app.inject({ method, url, ...(payload === undefined ? {} : { payload: JSON.stringify(payload), headers: { 'content-type': 'application/json' } }) });
  assert.equal(response.statusCode, status, response.body);
  if (status === 200 && method === 'GET') assert.equal(response.headers['cache-control'], 'no-store');
  return response.json();
}

try {
  const suffix = randomUUID();
  const project = await db.engagement.create({ data: { name: `w05-${suffix}`, workspaceSlug: `w05-${suffix}`, targetType: 'web_url', targetValue: 'http://authorized-w05.invalid', authorizationConfirmed: true } });
  const other = await db.engagement.create({ data: { name: `w05-other-${suffix}`, workspaceSlug: `w05-other-${suffix}`, targetType: 'web_url', targetValue: project.targetValue, authorizationConfirmed: true } });
  const foreign = await db.engagement.create({ data: { name: `w05-foreign-${suffix}`, workspaceSlug: `w05-foreign-${suffix}`, userId: 'other-owner', targetType: 'web_url', targetValue: project.targetValue, authorizationConfirmed: true } });
  const threadId = randomUUID();
  const proof = await service.prepareBinding('local', project.id, 'soundwave', 'planning');
  await failure(() => service.prepareBinding('other-owner', project.id, 'soundwave', 'planning'), 404);
  await failure(() => service.bindThread('local', project.id, { threadId, assistantId: 'soundwave', kind: 'planning', contextHash: 'forged' }), 409);
  const binding = { threadId, assistantId: 'soundwave', kind: 'planning' as const, contextHash: proof };
  const concurrentBindings = await Promise.all(Array.from({ length: 8 }, () => service.bindThread('local', project.id, binding)));
  assert.ok(concurrentBindings.every(isThreadBindingView));
  assert.equal(await db.engagementThread.count({ where: { threadId } }), 1);
  await failure(() => service.getBinding('local', other.id, threadId), 404);
  await failure(() => service.getBinding('other-owner', project.id, threadId), 404);
  await failure(() => service.getBinding('local', project.id, threadId, { assistantId: 'different', kind: 'planning' }), 409);
  await failure(() => service.getBinding('local', project.id, threadId, { assistantId: 'soundwave', kind: 'execution' }), 409);
  const otherProof = await service.prepareBinding('local', other.id, 'soundwave', 'planning');
  await failure(() => service.bindThread('local', other.id, { ...binding, contextHash: otherProof }), 409);
  await db.engagement.update({ where: { id: other.id }, data: { threadId: 'legacy-unproven-pointer' } });
  await failure(() => service.getBinding('local', other.id, 'legacy-unproven-pointer'), 404);
  assert.equal((await db.engagement.findUniqueOrThrow({ where: { id: project.id } })).threadId, null);
  await http(`/api/engagements/${project.id}`, 409, 'PATCH', { targetValue: 'http://changed.invalid' });
  await http(`/api/engagements/${project.id}`, 200, 'PATCH', { displayName: 'W05 safe display update' });
  checks.push('owned immutable/context-bound thread identity, concurrent binding, unproven legacy pointer and target lock');

  for (let i = 0; i < 6; i++) {
    const racing = await db.engagement.create({ data: { name: `w05-race-${i}-${suffix}`, workspaceSlug: `w05-race-${i}-${suffix}`, targetType: 'web_url', targetValue: project.targetValue, authorizationConfirmed: true } });
    const raceProof = await service.prepareBinding('local', racing.id, 'soundwave', 'planning');
    const results = await Promise.allSettled([
      service.bindThread('local', racing.id, { ...binding, threadId: randomUUID(), contextHash: raceProof }),
      projects.patchProject('local', racing.id, { targetValue: 'http://race-new-target.invalid' }),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const persisted = await db.engagement.findUniqueOrThrow({ where: { id: racing.id } });
    assert.equal(persisted.targetValue, results[0]!.status === 'fulfilled' ? project.targetValue : 'http://race-new-target.invalid');
    assert.equal(await db.engagementThread.count({ where: { engagementId: racing.id } }), results[0]!.status === 'fulfilled' ? 1 : 0);
  }
  checks.push('six concurrent first-binding/target-PATCH races cannot bind a stale target');

  const intent = { message: 'Controlled ledger intent; do not execute', options: { a: 1, b: 2 } };
  const requestId = `intent-${suffix}`;
  const reservations = await Promise.all(Array.from({ length: 12 }, () => service.reserve('local', project.id, requestId, 'create_run', intent, threadId)));
  assert.equal(reservations.filter(row => row.reserved).length, 1);
  const winner = reservations.find(row => row.reserved)!;
  assert.equal(winner.reserved, true);
  if (!winner.reserved) throw new Error('Missing reservation winner');
  const replay = await service.reserve('local', project.id, requestId, 'create_run', { options: { b: 2, a: 1 }, message: intent.message }, threadId);
  assert.equal(replay.reserved, false);
  assert.ok(!('token' in replay));
  await failure(() => service.reserve('local', project.id, requestId, 'create_run', { ...intent, message: 'Changed' }, threadId), 409);
  await failure(() => service.reserve('local', project.id, requestId, 'resume', intent, threadId), 409);
  await failure(() => service.reserve('local', project.id, `parallel-${suffix}`, 'create_run', intent, threadId), 409);
  await failure(() => service.reserve('local', other.id, `cross-${suffix}`, 'create_run', intent, threadId), 404);
  await failure(() => service.reserve('local', project.id, 'invalid/id', 'create_run', intent, threadId), 400);
  checks.push('12 concurrent duplicate intents reserve once; stable canonical fingerprint and different intent conflicts');

  await failure(() => service.markUncertain('local', project.id, requestId, 'wrong-token'), 409);
  await service.markUncertain('local', project.id, requestId, winner.token);
  assert.equal((await service.recover('local', project.id, requestId)).state, 'uncertain');
  await failure(() => service.rejectBeforeDispatch('local', project.id, requestId, winner.token), 409);
  await failure(() => service.reserve('local', project.id, `uncertain-${suffix}`, 'create_run', intent, threadId), 409);
  const runId = randomUUID();
  assert.equal((await service.accept('local', project.id, requestId, winner.token, threadId, runId)).state, 'accepted');
  await service.accept('local', project.id, requestId, winner.token, threadId, runId);
  await failure(() => service.accept('local', project.id, requestId, winner.token, threadId, randomUUID()), 409);
  await failure(() => service.reserve('local', project.id, `accepted-${suffix}`, 'create_run', intent, threadId), 409);
  await failure(() => service.releaseCompletedRun('local', project.id, requestId, randomUUID()), 409);
  await service.releaseCompletedRun('local', project.id, requestId, runId);
  const next = await service.reserve('local', project.id, `next-${suffix}`, 'resume', { expectedRunId: runId, value: 'Controlled response' }, threadId);
  assert.ok(next.reserved);
  if (!next.reserved) throw new Error('Missing next reservation');
  await service.rejectBeforeDispatch('local', project.id, next.request.requestId, next.token);
  assert.equal((await service.reserve('local', project.id, next.request.requestId, 'resume', { expectedRunId: runId, value: 'Controlled response' }, threadId)).request.state, 'rejected');
  checks.push('private reservation token, uncertainty retains active slot, acceptance idempotence, verified-run release and no rejected replay');

  const secondThread = randomUUID();
  const createId = `thread-${suffix}`;
  const creating = await service.reserve('local', project.id, createId, 'create_thread', { kind: 'execution', assistantId: 'decepticon' });
  assert.ok(creating.reserved);
  if (!creating.reserved) throw new Error('Missing thread reservation');
  await service.bindThread('local', project.id, { threadId: secondThread, assistantId: 'decepticon', kind: 'execution', contextHash: await service.prepareBinding('local', project.id, 'decepticon', 'execution') });
  await service.accept('local', project.id, createId, creating.token, secondThread, null);
  assert.equal((await service.reserve('local', project.id, createId, 'create_thread', { assistantId: 'decepticon', kind: 'execution' })).reserved, false);
  const parallelPlanning = randomUUID();
  await service.bindThread('local', project.id, { ...binding, threadId: parallelPlanning });
  const simultaneous = await Promise.all([service.reserve('local', project.id, `active-a-${suffix}`, 'create_run', intent, threadId), service.reserve('local', project.id, `active-b-${suffix}`, 'create_run', intent, parallelPlanning)]);
  assert.ok(simultaneous.every(row => row.reserved));
  await db.webRequestLedger.updateMany({ where: { engagementId: project.id, state: 'creating' }, data: { updatedAt: new Date(Date.now() - 600_000) } });
  assert.ok(await service.sweepStaleCreating() >= 2);
  for (const row of simultaneous) assert.equal((await service.recover('local', project.id, row.request.requestId)).state, 'uncertain');
  await failure(() => service.reserve('local', project.id, `stale-retry-${suffix}`, 'create_run', intent, secondThread), 409);
  checks.push('multiple planning/execution threads, independent thread slots, stale creating becomes uncertain without releasing reservation');

  const racingThread = randomUUID();
  await service.bindThread('local', project.id, { ...binding, threadId: racingThread });
  const competing = await Promise.allSettled([service.reserve('local', project.id, `race-a-${suffix}`, 'create_run', intent, racingThread), service.reserve('local', project.id, `race-b-${suffix}`, 'create_run', intent, racingThread)]);
  assert.equal(competing.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(await db.webRequestLedger.count({ where: { activeThreadId: racingThread } }), 1);
  checks.push('two distinct concurrent intents on one thread have one durable active-slot winner');

  const recreatedDb = createDbClient({ connectionString: database });
  try {
    const recreated = new RuntimeOwnershipService(recreatedDb);
    assert.equal((await recreated.reserve('local', project.id, requestId, 'create_run', intent, threadId)).reserved, false);
    assert.equal((await recreated.recover('local', project.id, requestId)).runId, runId);
  } finally { await recreatedDb.$disconnect(); }
  const recovered = await http(`/api/engagements/${project.id}/requests/${requestId}`, 200);
  assert.ok(isRequestRecoveryView(recovered));
  assert.ok(isThreadBindingView(await http(`/api/engagements/${project.id}/thread-bindings/${threadId}`, 200)));
  await http(`/api/engagements/${foreign.id}/requests/${requestId}`, 404);
  await http(`/api/engagements/${other.id}/requests/${requestId}`, 404);
  await http(`/api/engagements/${other.id}/thread-bindings/${threadId}`, 404);
  await http(`/api/engagements/${project.id}/requests/short`, 400);
  await http(`/api/engagements/${project.id}/threads`, 404, 'POST', { threadId: randomUUID() });
  const wire = JSON.stringify(recovered);
  for (const privateValue of [winner.token, proof, project.userId, intent.message, workspace]) assert.ok(!wire.includes(privateValue));
  checks.push('persisted client recreation and real route recovery; no token/context/path/payload leaks, cross-owner denial and no submission API');

  await db.engagement.update({ where: { id: project.id }, data: { targetValue: 'http://out-of-band-change.invalid' } });
  await failure(() => service.getBinding('local', project.id, threadId), 409);
  await failure(() => service.reserve('local', project.id, `poisoned-${suffix}`, 'create_run', intent, threadId), 409);
  await db.engagement.update({ where: { id: project.id }, data: { targetValue: project.targetValue } });
  checks.push('persisted context mismatch fails closed instead of rebinding a hydrated thread');

  // Leave a fresh creating record for the separate real-process restart gate.
  const pendingId = `restart-${suffix}`;
  await service.reserve('local', other.id, pendingId, 'create_thread', { kind: 'planning', assistantId: 'soundwave' });
  await writeFile(process.env.W05_EVIDENCE_PATH!, JSON.stringify({ ok: true, checks, engagementId: other.id, requestId: pendingId, accepted: { engagementId: project.id, requestId, runId } }, null, 2) + '\n');
  console.log(`W05 PostgreSQL service/HTTP checks passed (${checks.length} groups)`);
} finally { await app.close(); await db.$disconnect(); }
