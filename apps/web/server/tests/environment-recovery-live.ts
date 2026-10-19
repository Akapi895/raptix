import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDbClient, disconnectDb } from '../src/db/client.js';
import { HostControllerClient } from '../src/integrations/environments/controller-client.js';
import { EnvironmentLifecycle } from '../src/services/environments/environment-lifecycle.js';
import { ProjectEnvironmentService } from '../src/services/environments/project-environment-service.js';
import { startControllerDouble } from './support/controller-double.js';

// ADR-0092 I06 evidence: archive, a stop that drains the runs it would cut off, and a visible reason for a failed
// attempt. Real PostgreSQL and the stateful controller double on loopback. It starts no containers, and it refuses
// anything except the throwaway raptix_envtest database.
const url = process.env.ENVIRONMENT_TEST_DATABASE_URL ?? '';
assert.match(url, /^postgresql:\/\/[^@\s]+@127\.0\.0\.1:\d{2,5}\/raptix_envtest$/, 'ENVIRONMENT_TEST_DATABASE_URL must point at the throwaway raptix_envtest database on 127.0.0.1');

const TOKEN = `recovery-${randomUUID()}-controller-token`;
const DEPLOYMENT = `i06-${randomUUID()}`;
const db = createDbClient({ connectionString: url });
const checks: string[] = [];

const double = await startControllerDouble(TOKEN);
const { containers, injected } = double;
const runStatuses = new Map<string, string>();
const busyThreads = new Set<string>();

const service = new ProjectEnvironmentService(db, DEPLOYMENT);
const lifecycle = new EnvironmentLifecycle(db, service, new HostControllerClient(double.url, TOKEN), {
  deploymentId: DEPLOYMENT,
  runtimeImage: 'ghcr.io/example/runtime@sha256:' + 'a'.repeat(64),
  sandboxImage: 'ghcr.io/example/sandbox@sha256:' + 'b'.repeat(64),
  workspaceHostRoot: 'D:/work',
  stopTimeoutSeconds: 5,
}, {
  probe: async () => true,
  readinessTimeoutMs: 2000,
  pollIntervalMs: 10,
  drainTimeoutMs: 300,
  runStatus: async (_endpoint, _threadId, runId) => runStatuses.get(runId) ?? 'running',
  threadBusy: async (_endpoint, threadId) => busyThreads.has(threadId),
});

const suffix = randomUUID().slice(0, 8);
const project = (tag: string) => db.engagement.create({ data: { name: `i06-${tag}-${suffix}`, workspaceSlug: `i06-${tag}-${suffix}`, targetType: 'web_url', targetValue: 'https://lab.invalid', authorizationConfirmed: true } });
const command = (engagementId: string, tag: string, action: 'activate' | 'stop' | 'archive' | 'unarchive', expectedVersion: number) =>
  service.submit('local', engagementId, { requestId: `${action}-${tag}-${suffix}`, action, expectedVersion });
const envRow = (engagementId: string) => db.projectEnvironment.findUniqueOrThrow({ where: { deploymentId_engagementId: { deploymentId: DEPLOYMENT, engagementId } } });
const slot = () => db.deploymentSlot.findUniqueOrThrow({ where: { deploymentId: DEPLOYMENT } });
const running = (environmentId: string) => ['runtime', 'sandbox'].every(role => containers.get(`${environmentId}:${role}`)?.running === true);

try {
  // 1. Archive is refused while the project holds the slot, accepted once it is stopped, and blocks activation and runs
  // until it is unarchived. Archived data is kept: the row and its generation survive.
  const a = await project('a');
  const aStart = await command(a.id, 'a1', 'activate', 0);
  const aReady = await lifecycle.bringUp(a.id, aStart.commandId!, aStart.version);
  assert.equal(aReady.phase, 'ready');
  const heldArchive = await command(a.id, 'a2', 'archive', aReady.version);
  assert.equal(heldArchive.status, 'refused');
  assert.equal(heldArchive.reason, 'held', 'a held project cannot be archived');
  const aStop = await command(a.id, 'a3', 'stop', aReady.version);
  const aStopped = await lifecycle.shutDown(a.id, aStop.commandId!, aStop.version);
  assert.equal(aStopped.phase, 'idle');
  const archive = await command(a.id, 'a4', 'archive', aStopped.version);
  assert.equal(archive.status, 'accepted');
  const archivedView = await service.state('local', a.id);
  assert.equal(archivedView.environment.archived, true);
  const rowA = await envRow(a.id);
  assert.equal(rowA.generation, 1, 'archive keeps the generation and the data');
  const blocked = await command(a.id, 'a5', 'activate', archive.version);
  assert.equal(blocked.status, 'refused');
  assert.equal(blocked.reason, 'archived', 'an archived project cannot start');
  await db.$transaction(tx => service.assertAdmits(tx, a.id)).then(
    () => assert.fail('an archived project must not admit a run'),
    (error: unknown) => assert.match(String(error), /archived/),
  );
  const unarchive = await command(a.id, 'a6', 'unarchive', archive.version);
  assert.equal(unarchive.status, 'accepted');
  assert.equal((await service.state('local', a.id)).environment.archived, false);
  const restart = await command(a.id, 'a7', 'activate', unarchive.version);
  assert.equal(restart.status, 'accepted', 'an unarchived project starts again');
  const restarted = await lifecycle.bringUp(a.id, restart.commandId!, restart.version);
  assert.equal(restarted.phase, 'ready');
  const aStop2 = await command(a.id, 'a8', 'stop', restarted.version);
  assert.equal((await lifecycle.shutDown(a.id, aStop2.commandId!, aStop2.version)).phase, 'idle', 'the slot is released for the next project');
  checks.push('archive is refused while held, accepted when stopped, blocks activation and runs until unarchived, and keeps the generation');

  // 2. A stop waits for the run it would cut off. While the run is in flight nothing is stopped, the slot returns to
  // ready with a bounded reason, and the containers keep running. A run that finishes lets the next stop complete.
  const d = await project('d');
  const dStart = await command(d.id, 'd1', 'activate', (await slot()).version);
  assert.equal(dStart.status, 'accepted');
  const dReady = await lifecycle.bringUp(d.id, dStart.commandId!, dStart.version);
  assert.equal(dReady.phase, 'ready');
  const dRow = await envRow(d.id);
  const thread = `t-${suffix}-d`;
  await db.engagementThread.create({ data: { threadId: thread, engagementId: d.id, assistantId: 'soundwave', kind: 'planning', contextHash: 'ctx' } });
  await db.webRequestLedger.create({ data: { engagementId: d.id, requestId: `run-d-${suffix}`, operation: 'create_run', payloadHash: 'payload', reservationToken: randomUUID(), threadId: thread, runId: 'run-d-1', activeThreadId: thread, state: 'accepted' } });
  const dStop = await command(d.id, 'd2', 'stop', dReady.version);
  assert.equal(dStop.phase, 'stopping');
  const undrained = await lifecycle.shutDown(d.id, dStop.commandId!, dStop.version);
  assert.equal(undrained.phase, 'ready', 'an active run returns the slot to ready');
  assert.equal(undrained.version, dStop.version + 1);
  const afterUndrained = await envRow(d.id);
  assert.equal(afterUndrained.observedState, 'ready');
  assert.equal(afterUndrained.lastError, 'run_active');
  assert.equal(running(dRow.id), true, 'nothing is stopped while a run is in flight');
  const stopCommand = await db.environmentCommand.findUniqueOrThrow({ where: { deploymentId_requestId: { deploymentId: DEPLOYMENT, requestId: `stop-d2-${suffix}` } } }).catch(() => null);
  assert.equal(stopCommand?.outcome, 'refused', 'the stop command records the refusal');
  assert.equal(stopCommand?.reason, 'run_active');
  runStatuses.set('run-d-1', 'success');
  const retryStop = await command(d.id, 'd3', 'stop', undrained.version);
  assert.equal(retryStop.phase, 'stopping');
  const drained = await lifecycle.shutDown(d.id, retryStop.commandId!, retryStop.version);
  assert.equal(drained.phase, 'idle');
  assert.equal(running(dRow.id), false, 'the containers stop once the run has ended');
  const releasedLedger = await db.webRequestLedger.findFirstOrThrow({ where: { engagementId: d.id, requestId: `run-d-${suffix}` } });
  assert.equal(releasedLedger.activeThreadId, null, 'an ended run releases its thread');
  checks.push('a stop waits for an in-flight run, returns the slot to ready with run_active, keeps the containers, and completes once the run ends');

  // 3. A failed start states its bounded reason on the project, so the user is not left with a silent stop.
  const r = await project('r');
  injected.set('ensure:runtime', { status: 422, body: { error: 'rejected_path' } });
  const rStart = await command(r.id, 'r1', 'activate', (await slot()).version);
  assert.equal(rStart.status, 'accepted');
  const rFailed = await lifecycle.bringUp(r.id, rStart.commandId!, rStart.version);
  assert.equal(rFailed.phase, 'idle', 'a refused start rolls back to stopped');
  const rState = await service.state('local', r.id);
  assert.equal(rState.environment.observedState, 'stopped');
  assert.equal(rState.environment.lastError, 'rejected_path', 'the refusal reason is visible on the project');
  checks.push('a refused start rolls back and the project states the bounded reason rejected_path');

  // 4. A stop the controller did not answer is retried, and the stop still completes.
  const t = await project('t');
  const tStart = await command(t.id, 't1', 'activate', (await slot()).version);
  const tReady = await lifecycle.bringUp(t.id, tStart.commandId!, tStart.version);
  assert.equal(tReady.phase, 'ready');
  const tRow = await envRow(t.id);
  injected.set('stop:runtime', { status: 503, body: {} });
  const tStop = await command(t.id, 't2', 'stop', tReady.version);
  const tStopped = await lifecycle.shutDown(t.id, tStop.commandId!, tStop.version);
  assert.equal(tStopped.phase, 'idle', 'a transient stop failure is retried to completion');
  assert.equal(running(tRow.id), false);
  checks.push('a stop the controller does not answer is retried, and the stop completes once it answers');

  // 5. A restart during a stop resumes it. While a run is in flight the restart drains again and returns the slot to
  // ready; the containers are never stopped or released under a live run.
  const u = await project('u');
  const uStart = await command(u.id, 'u1', 'activate', (await slot()).version);
  const uReady = await lifecycle.bringUp(u.id, uStart.commandId!, uStart.version);
  const uRow = await envRow(u.id);
  const uThread = `t-${suffix}-u`;
  await db.engagementThread.create({ data: { threadId: uThread, engagementId: u.id, assistantId: 'soundwave', kind: 'planning', contextHash: 'ctx' } });
  await db.webRequestLedger.create({ data: { engagementId: u.id, requestId: `run-u-${suffix}`, operation: 'create_run', payloadHash: 'payload', reservationToken: randomUUID(), threadId: uThread, runId: 'run-u-1', activeThreadId: uThread, state: 'accepted' } });
  runStatuses.set('run-u-1', 'running');
  const uStop = await command(u.id, 'u2', 'stop', uReady.version);
  assert.equal(uStop.phase, 'stopping');
  await lifecycle.resumePending();
  const afterRestart = await slot();
  assert.equal(afterRestart.phase, 'ready', 'a restart with a live run returns the stop to ready');
  assert.equal(running(uRow.id), true, 'the containers keep running across the restart');
  runStatuses.set('run-u-1', 'success');
  const uStop2 = await command(u.id, 'u3', 'stop', afterRestart.version);
  assert.equal((await lifecycle.shutDown(u.id, uStop2.commandId!, uStop2.version)).phase, 'idle');
  checks.push('a restart during a stop resumes it: a live run returns the slot to ready, and the stop completes after the run ends');

  // 6. A stale in-flight marker does not hold a stop when the runtime is not running: nothing can be executing, so the
  // stop completes at once and the marker stays on record for its owner.
  const v = await project('v');
  const vStart = await command(v.id, 'v1', 'activate', (await slot()).version);
  const vReady = await lifecycle.bringUp(v.id, vStart.commandId!, vStart.version);
  const vRow = await envRow(v.id);
  const vThread = `t-${suffix}-v`;
  await db.engagementThread.create({ data: { threadId: vThread, engagementId: v.id, assistantId: 'soundwave', kind: 'planning', contextHash: 'ctx' } });
  await db.webRequestLedger.create({ data: { engagementId: v.id, requestId: `run-v-${suffix}`, operation: 'create_run', payloadHash: 'payload', reservationToken: randomUUID(), threadId: vThread, runId: 'run-v-1', activeThreadId: vThread, state: 'accepted' } });
  runStatuses.set('run-v-1', 'running');
  const containerRuntime = containers.get(`${vRow.id}:runtime`);
  assert.ok(containerRuntime, 'the runtime container exists');
  containerRuntime.running = false;
  const vStop = await command(v.id, 'v2', 'stop', vReady.version);
  const vStopped = await lifecycle.shutDown(v.id, vStop.commandId!, vStop.version);
  assert.equal(vStopped.phase, 'idle', 'a stop with a stale marker and a stopped runtime completes');
  const kept = await db.webRequestLedger.findFirstOrThrow({ where: { engagementId: v.id, requestId: `run-v-${suffix}` } });
  assert.equal(kept.activeThreadId, vThread, 'the stale marker stays on record for its owner');
  checks.push('a stop completes at once when the runtime is not running, and the in-flight marker stays on record');

  // 7. A run the running runtime does not know is not executing, so it does not hold the stop and its marker is released.
  const w = await project('w');
  const wStart = await command(w.id, 'w1', 'activate', (await slot()).version);
  const wReady = await lifecycle.bringUp(w.id, wStart.commandId!, wStart.version);
  const wThread = `t-${suffix}-w`;
  await db.engagementThread.create({ data: { threadId: wThread, engagementId: w.id, assistantId: 'soundwave', kind: 'planning', contextHash: 'ctx' } });
  await db.webRequestLedger.create({ data: { engagementId: w.id, requestId: `run-w-${suffix}`, operation: 'create_run', payloadHash: 'payload', reservationToken: randomUUID(), threadId: wThread, runId: 'run-w-1', activeThreadId: wThread, state: 'accepted' } });
  runStatuses.set('run-w-1', 'not_found');
  const wStop = await command(w.id, 'w2', 'stop', wReady.version);
  const wStopped = await lifecycle.shutDown(w.id, wStop.commandId!, wStop.version);
  assert.equal(wStopped.phase, 'idle', 'a run the runtime does not know does not hold the stop');
  const released = await db.webRequestLedger.findFirstOrThrow({ where: { engagementId: w.id, requestId: `run-w-${suffix}` } });
  assert.equal(released.activeThreadId, null, 'the marker of a run that is not executing is released');
  checks.push('a run the runtime does not know does not hold the stop, and its marker is released');

  // 8. The ledger can be empty while the runtime still runs an instance of a thread. That instance holds the stop, and
  // the stop completes once the runtime reports it finished.
  const y = await project('y');
  const yStart = await command(y.id, 'y1', 'activate', (await slot()).version);
  const yReady = await lifecycle.bringUp(y.id, yStart.commandId!, yStart.version);
  const yRow = await envRow(y.id);
  const yThread = `t-${suffix}-y`;
  await db.engagementThread.create({ data: { threadId: yThread, engagementId: y.id, assistantId: 'soundwave', kind: 'planning', contextHash: 'ctx' } });
  busyThreads.add(yThread);
  const yStop = await command(y.id, 'y2', 'stop', yReady.version);
  const yHeld = await lifecycle.shutDown(y.id, yStop.commandId!, yStop.version);
  assert.equal(yHeld.phase, 'ready', 'a running instance with an empty ledger returns the stop to ready');
  assert.equal(running(yRow.id), true, 'nothing is stopped while the instance runs');
  busyThreads.delete(yThread);
  const yStop2 = await command(y.id, 'y3', 'stop', yHeld.version);
  assert.equal((await lifecycle.shutDown(y.id, yStop2.commandId!, yStop2.version)).phase, 'idle');
  checks.push('a running instance holds a stop even when the ledger is empty, and the stop completes once it finishes');

  // 9. A restart finds a ready slot whose containers are gone. The slot is held as uncertain with the reason, not left ready.
  const z = await project('z');
  const zStart = await command(z.id, 'z1', 'activate', (await slot()).version);
  const zReady = await lifecycle.bringUp(z.id, zStart.commandId!, zStart.version);
  const zRow = await envRow(z.id);
  containers.get(`${zRow.id}:runtime`)!.running = false;
  await lifecycle.resumePending();
  const zAfterRestart = await slot();
  assert.equal(zAfterRestart.phase, 'uncertain', 'a ready slot whose containers are gone is not ready after a restart');
  const zState = await service.state('local', z.id);
  assert.equal(zState.environment.lastError, 'not_running_at_restart');
  const zStop = await command(z.id, 'z2', 'stop', zAfterRestart.version);
  assert.equal((await lifecycle.shutDown(z.id, zStop.commandId!, zStop.version)).phase, 'idle', 'the owner reconciles the uncertain slot by stopping');
  checks.push('a restart finds a ready slot whose containers are gone and holds it as uncertain with the reason, and the owner reconciles it');
} finally {
  await double.close();
  await disconnectDb(db);
}

console.log(`ADR-0092 environment recovery checks passed (${checks.length} groups)`);
for (const check of checks) console.log(`  - ${check}`);
