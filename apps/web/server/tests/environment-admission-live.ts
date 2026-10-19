import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { EnvironmentCommandResult } from '@raptix/web-contracts';
import { createDbClient, disconnectDb } from '../src/db/client.js';
import { ProjectEnvironmentService } from '../src/services/environments/project-environment-service.js';
import { RuntimeOwnershipService } from '../src/services/runtime-ownership.js';
import { ProjectNotFoundError } from '../src/services/projects-service.js';
import { ProjectPolicyError } from '../src/security/project-policy.js';

// ADR-0092 I01 evidence against a real PostgreSQL. Refuses anything except the
// throwaway raptix_envtest database on loopback, so it cannot reach a live stack.
const url = process.env.ENVIRONMENT_TEST_DATABASE_URL ?? '';
assert.match(url, /^postgresql:\/\/[^@\s]+@127\.0\.0\.1:\d{2,5}\/raptix_envtest$/, 'ENVIRONMENT_TEST_DATABASE_URL must point at the throwaway raptix_envtest database on 127.0.0.1');

// One deployment key per run: the slot is global per deployment, so runs stay independent.
const DEPLOYMENT = `i01-${randomUUID()}`;
const suffix = randomUUID().slice(0, 8);
const first = createDbClient({ connectionString: url });
// A second client is a second entrypoint (for example the CLI next to the Web server).
const second = createDbClient({ connectionString: url });
const checks: string[] = [];
const isConflict = (error: unknown): boolean => error instanceof ProjectPolicyError && error.code === 'conflict';

const service = (client = first): ProjectEnvironmentService => new ProjectEnvironmentService(client, DEPLOYMENT);
const command = (tag: string, action: 'activate' | 'stop', expectedVersion: number) => ({ requestId: `${tag}-${suffix}`, action, expectedVersion });
const mentions = (result: EnvironmentCommandResult, engagementId: string): boolean => JSON.stringify(result).includes(engagementId);

try {
  const project = (tag: string) => ({ name: `i01-${tag}-${suffix}`, workspaceSlug: `i01-${tag}-${suffix}`, targetType: 'web_url' as const, targetValue: 'https://lab.invalid', authorizationConfirmed: true });
  const a = await first.engagement.create({ data: project('a') });
  const b = await first.engagement.create({ data: project('b') });
  await first.webMembership.create({ data: { engagementId: a.id, userId: `operator-${suffix}`, role: 'operator' } });
  await first.webMembership.create({ data: { engagementId: a.id, userId: `viewer-${suffix}`, role: 'viewer' } });

  // 1. Two entrypoints activate different projects at the same time: one winner.
  const [webA, cliB] = await Promise.all([
    service().submit('local', a.id, command('web-a', 'activate', 0)),
    service(second).submit('local', b.id, command('cli-b', 'activate', 0)),
  ]);
  // Both clients observed version 0. The loser's compare-and-set fails, so it learns the new version, not the winner.
  assert.deepEqual([webA.status, cliB.status].sort(), ['accepted', 'stale']);
  const winner = webA.status === 'accepted' ? a : b;
  const loser = winner === a ? b : a;
  const winnerCommand = webA.status === 'accepted' ? webA : cliB;
  const stale = webA.status === 'stale' ? webA : cliB;
  assert.equal(stale.phase, 'starting');
  assert.equal(stale.version, 1);
  assert.equal('activeEngagementId' in stale, false, 'a non-owner never learns the active project id');
  assert.equal(mentions(stale, winner.id), false, 'the stale answer must not name the winning project');
  const slot = await first.deploymentSlot.findUniqueOrThrow({ where: { deploymentId: DEPLOYMENT } });
  assert.equal(slot.ownerEngagementId, winner.id);
  assert.equal(slot.phase, 'starting');
  assert.equal(slot.version, 1);
  checks.push('concurrent activation from two clients admits exactly one project and hides the winner from the loser');

  // 2. Same requestId and payload replays the recorded answer; a different payload conflicts.
  const winnerTag = webA.status === 'accepted' ? 'web-a' : 'cli-b';
  const replay = await service().submit('local', winner.id, command(winnerTag, 'activate', 0));
  assert.equal(replay.status, 'replayed');
  assert.equal(replay.commandId, winnerCommand.commandId);
  assert.equal(replay.version, 1, 'a replay does not move the slot');
  await assert.rejects(() => service().submit('local', winner.id, command(winnerTag, 'activate', 1)), isConflict);
  checks.push('a retry with the same requestId replays the record; a changed payload is refused as a conflict');

  // 3. The loser retries with the version it now knows and is refused as busy, still without the winner's id.
  const busy = await service(second).submit('local', loser.id, command('retry-loser', 'activate', 1));
  assert.equal(busy.status, 'busy');
  assert.equal(busy.reason, 'slot_held');
  assert.equal(busy.phase, 'starting');
  assert.equal('activeEngagementId' in busy, false, 'busy never carries the active project id');
  assert.equal(mentions(busy, winner.id), false, 'busy must not name the winning project anywhere in the body');
  const staleVersion = await service(second).submit('local', loser.id, command('old-version-loser', 'activate', 0));
  assert.equal(staleVersion.reason, 'stale_version');
  checks.push('a stale compare-and-set reports the new version; the retry with that version is busy and names nothing');

  // 4. A restarted process still sees the held slot (crash after reserve).
  const restarted = createDbClient({ connectionString: url });
  try {
    const afterRestart = await service(restarted).submit('local', loser.id, command('restart-loser', 'activate', 1));
    assert.equal(afterRestart.status, 'busy');
    assert.equal(afterRestart.phase, 'starting');
  } finally { await disconnectDb(restarted); }
  checks.push('a restarted process still sees the reserved slot as held');

  // 5. Elapsed time never releases the slot; only an observed stop does.
  await first.$executeRaw`UPDATE "DeploymentSlot" SET "updatedAt" = CURRENT_TIMESTAMP - INTERVAL '7 days' WHERE "deploymentId" = ${DEPLOYMENT}`;
  const expired = await service().submit('local', loser.id, command('expired-loser', 'activate', 1));
  assert.equal(expired.status, 'busy', 'an old reservation is still held');
  checks.push('a reservation older than any lease is still held');

  // 6. Viewers and foreign callers get 404-class refusals and write nothing.
  await assert.rejects(() => service().submit(`stranger-${suffix}`, a.id, command('stranger', 'activate', 1)), ProjectNotFoundError);
  await assert.rejects(() => service().submit(`viewer-${suffix}`, a.id, command('viewer', 'stop', 1)), ProjectNotFoundError);
  assert.equal(await first.environmentCommand.count({ where: { deploymentId: DEPLOYMENT, requestId: { in: [`stranger-${suffix}`, `viewer-${suffix}`] } } }), 0);
  checks.push('foreign callers and viewers are refused as not found and leave no command record');

  // 7. A non-owner cannot stop the active project; the refusal names nothing.
  const denied = await service(second).submit('local', loser.id, command('stop-loser', 'stop', 1));
  assert.equal(denied.status, 'refused');
  assert.equal(denied.reason, 'not_active');
  assert.equal(mentions(denied, winner.id), false);
  checks.push('a non-owner stop is refused without naming the active project');

  // 8. The owner stops; duplicates replay or ensure; only an observed stop releases.
  const stopping = await service().submit('local', winner.id, command('stop-winner', 'stop', 1));
  assert.equal(stopping.status, 'accepted');
  assert.equal(stopping.phase, 'stopping');
  assert.equal(stopping.version, 2);
  const stopReplay = await service().submit('local', winner.id, command('stop-winner', 'stop', 1));
  assert.equal(stopReplay.status, 'replayed');
  const stopEnsure = await service().submit('local', winner.id, command('stop-again', 'stop', 2));
  assert.equal(stopEnsure.status, 'accepted');
  assert.equal(stopEnsure.commandId, stopping.commandId, 'a second stop joins the stop already in progress');
  const stopCommandId = stopping.commandId!;
  const wrongCommand = await service().observe({ commandId: 'not-the-active-command', expectedVersion: 2, observation: 'stopped' });
  assert.equal(wrongCommand.reason, 'stale_command');
  const staleObservation = await service().observe({ commandId: stopCommandId, expectedVersion: 1, observation: 'stopped' });
  assert.equal(staleObservation.reason, 'stale_version');
  const released = await service().observe({ commandId: stopCommandId, expectedVersion: 2, observation: 'stopped' });
  assert.equal(released.status, 'accepted');
  assert.equal(released.phase, 'idle');
  assert.equal(released.version, 3);
  const winnerEnv = await first.projectEnvironment.findUniqueOrThrow({ where: { deploymentId_engagementId: { deploymentId: DEPLOYMENT, engagementId: winner.id } } });
  assert.equal(winnerEnv.observedState, 'stopped');
  assert.equal(winnerEnv.desiredState, 'stopped');
  checks.push('stop is idempotent per in-flight command; the slot is released only by the matching observed stop');

  // 9. Uncertain keeps the slot held; the loser is refused until the uncertainty is resolved.
  const claimed = await service().submit('local', loser.id, command('claim-loser', 'activate', 3));
  assert.equal(claimed.status, 'accepted');
  const claimCommandId = claimed.commandId!;
  const ready = await service().observe({ commandId: claimCommandId, expectedVersion: 4, observation: 'ready' });
  assert.equal(ready.phase, 'ready');
  const uncertain = await service().observe({ commandId: claimCommandId, expectedVersion: 5, observation: 'uncertain' });
  assert.equal(uncertain.phase, 'uncertain');
  const held = await service().submit('local', winner.id, command('return-winner', 'activate', uncertain.version));
  assert.equal(held.status, 'busy', 'an uncertain slot is held even for another project');
  const ownUncertain = await service().submit('local', loser.id, command('own-uncertain', 'activate', uncertain.version));
  assert.equal(ownUncertain.status, 'refused');
  assert.equal(ownUncertain.reason, 'uncertain');
  const settled = await service().observe({ commandId: claimCommandId, expectedVersion: uncertain.version, observation: 'stopped' });
  assert.equal(settled.phase, 'idle');
  checks.push('an uncertain slot stays held for other projects and releases only after an observed stop');

  // 10. Run admission inside the reserving transaction (real ledger rows).
  const ownership = new RuntimeOwnershipService(first, service());
  const plain = new RuntimeOwnershipService(first);
  const bind = async (engagementId: string): Promise<string> => {
    const threadId = randomUUID();
    const contextHash = await plain.prepareBinding('local', engagementId, 'decepticon', 'execution');
    await plain.bindThread('local', engagementId, { threadId, assistantId: 'decepticon', kind: 'execution', contextHash });
    return threadId;
  };
  const intent = { message: 'i01 admission probe', options: {} };
  const threadA1 = await bind(a.id);
  const runA1 = await ownership.reserve('local', a.id, `run-a1-${suffix}`, 'create_run', intent, threadA1);
  assert.equal(runA1.reserved, true, 'an idle deployment admits, as before this change');
  checks.push('an idle deployment admits a run exactly as before the environment slot existed');

  const claimA = await service().submit('local', a.id, command('claim-a', 'activate', 7));
  assert.equal(claimA.status, 'accepted', 'slot version after the earlier idle release');
  const threadA2 = await bind(a.id);
  await assert.rejects(() => ownership.reserve('local', a.id, `run-a2-${suffix}`, 'create_run', intent, threadA2), isConflict);
  checks.push('a starting environment refuses a new run for its own project');

  const readyA = await service().observe({ commandId: claimA.commandId!, expectedVersion: claimA.version, observation: 'ready' });
  assert.equal(readyA.phase, 'ready');
  const runA2 = await ownership.reserve('local', a.id, `run-a2-${suffix}`, 'create_run', intent, threadA2);
  assert.equal(runA2.reserved, true, 'a ready owner admits its own run');
  checks.push('a ready owner admits its own new run');

  const threadB = await bind(b.id);
  await assert.rejects(() => ownership.reserve('local', b.id, `run-b1-${suffix}`, 'create_run', intent, threadB), isConflict);
  const replayA1 = await ownership.reserve('local', a.id, `run-a1-${suffix}`, 'create_run', intent, threadA1);
  assert.equal(replayA1.reserved, false, 'a recorded request replays even after the slot moved');
  checks.push('a run for another project is refused while the slot is held; recorded replays are not gated');

  console.log(`ADR-0092 I01 environment admission checks passed (${checks.length} groups)`);
  for (const check of checks) console.log(`  - ${check}`);
} finally {
  await disconnectDb(first);
  await disconnectDb(second);
}
