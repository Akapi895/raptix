import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDbClient, disconnectDb } from '../src/db/client.js';
import { HostControllerClient } from '../src/integrations/environments/controller-client.js';
import { EnvironmentLifecycle } from '../src/services/environments/environment-lifecycle.js';
import { ProjectEnvironmentService, runtimeUrlFor } from '../src/services/environments/project-environment-service.js';
import { startControllerDouble } from './support/controller-double.js';

// ADR-0092 I02/I05 evidence: the control plane's lifecycle against a real PostgreSQL and a stateful controller
// double on loopback. It starts no containers. It refuses anything except the throwaway raptix_envtest database.
const url = process.env.ENVIRONMENT_TEST_DATABASE_URL ?? '';
assert.match(url, /^postgresql:\/\/[^@\s]+@127\.0\.0\.1:\d{2,5}\/raptix_envtest$/, 'ENVIRONMENT_TEST_DATABASE_URL must point at the throwaway raptix_envtest database on 127.0.0.1');

const TOKEN = `lifecycle-${randomUUID()}-controller-token`;
const DEPLOYMENT = `i02-${randomUUID()}`;
const db = createDbClient({ connectionString: url });
const checks: string[] = [];

const double = await startControllerDouble(TOKEN);
const { containers, stuck, injected } = double;
const controllerUrl = double.url;

const service = new ProjectEnvironmentService(db, DEPLOYMENT);
const lifecycle = new EnvironmentLifecycle(db, service, new HostControllerClient(controllerUrl, TOKEN), {
  deploymentId: DEPLOYMENT,
  runtimeImage: 'ghcr.io/example/runtime@sha256:' + 'a'.repeat(64),
  sandboxImage: 'ghcr.io/example/sandbox@sha256:' + 'b'.repeat(64),
  workspaceHostRoot: 'D:/work',
  stopTimeoutSeconds: 5,
}, { probe: async () => true, readinessTimeoutMs: 2000, pollIntervalMs: 10 });

const suffix = randomUUID().slice(0, 8);
const project = (tag: string) => db.engagement.create({ data: { name: `i02-${tag}-${suffix}`, workspaceSlug: `i02-${tag}-${suffix}`, targetType: 'web_url', targetValue: 'https://lab.invalid', authorizationConfirmed: true } });
const activate = (engagementId: string, tag: string, expectedVersion: number) => service.submit('local', engagementId, { requestId: `act-${tag}-${suffix}`, action: 'activate', expectedVersion });
const stop = (engagementId: string, tag: string, expectedVersion: number) => service.submit('local', engagementId, { requestId: `stop-${tag}-${suffix}`, action: 'stop', expectedVersion });
const envRow = (engagementId: string) => db.projectEnvironment.findUniqueOrThrow({ where: { deploymentId_engagementId: { deploymentId: DEPLOYMENT, engagementId } } });
const slot = () => db.deploymentSlot.findUniqueOrThrow({ where: { deploymentId: DEPLOYMENT } });

try {
  // 1. Bring-up succeeds: both containers run, the environment is ready with its derived endpoint.
  const a = await project('a');
  const accepted = await activate(a.id, 'a', 0);
  assert.equal(accepted.status, 'accepted');
  const ready = await lifecycle.bringUp(a.id, accepted.commandId!, accepted.version);
  assert.equal(ready.phase, 'ready');
  const rowA = await envRow(a.id);
  assert.equal(rowA.observedState, 'ready');
  assert.equal(rowA.runtimeUrl, runtimeUrlFor(DEPLOYMENT, rowA.id));
  assert.equal(rowA.generation, 1);
  for (const role of ['runtime', 'sandbox']) assert.equal(containers.get(`${rowA.id}:${role}`)?.running, true);
  checks.push('bring-up creates, starts and observes both containers, then reports ready with the derived endpoint');

  // 2. Shut-down stops both containers and releases the slot only on the observed stop.
  const stopping = await stop(a.id, 'a', ready.version);
  assert.equal(stopping.phase, 'stopping');
  const stopped = await lifecycle.shutDown(a.id, stopping.commandId!, stopping.version);
  assert.equal(stopped.phase, 'idle');
  assert.equal((await envRow(a.id)).runtimeUrl, null);
  for (const role of ['runtime', 'sandbox']) assert.equal(containers.get(`${rowA.id}:${role}`)?.running, false);
  checks.push('shut-down stops both containers and releases the slot only after both are observed stopped');

  // 3. A refusal that created nothing running releases the slot (missing image on the sandbox).
  const b = await project('b');
  injected.set('ensure:sandbox', { status: 409, body: { error: 'image_missing' } });
  const acceptedB = await activate(b.id, 'b', stopped.version);
  const failedB = await lifecycle.bringUp(b.id, acceptedB.commandId!, acceptedB.version);
  assert.equal(failedB.phase, 'idle', 'nothing is running, so the slot is released');
  assert.equal((await envRow(b.id)).observedState, 'stopped');
  checks.push('a missing image releases the slot when nothing is running, so the next project can start');

  // 4. An unknown outcome keeps the slot held as uncertain, and only an observed stop releases it.
  const c = await project('c');
  const acceptedC = await activate(c.id, 'c', failedB.version);
  injected.set('start:runtime', { status: 502, body: {} });
  const uncertain = await lifecycle.bringUp(c.id, acceptedC.commandId!, acceptedC.version);
  assert.equal(uncertain.phase, 'uncertain');
  const e = await project('e');
  const busy = await activate(e.id, 'e', uncertain.version);
  assert.equal(busy.status, 'busy', 'an uncertain slot holds out other projects');
  const stopC = await stop(c.id, 'c', uncertain.version);
  assert.equal(stopC.phase, 'stopping', 'the owner may stop an uncertain environment to reconcile it');
  const recovered = await lifecycle.shutDown(c.id, stopC.commandId!, stopC.version);
  assert.equal(recovered.phase, 'idle', 'the observed stop releases the slot');
  checks.push('an unknown start outcome leaves the slot held, refuses other projects as busy, and is reconciled by the owner');

  // 5. A stop the controller cannot confirm keeps the slot held until a later observed stop.
  const f = await project('f');
  const fStart = await activate(f.id, 'f', (await slot()).version);
  const fReady = await lifecycle.bringUp(f.id, fStart.commandId!, fStart.version);
  assert.equal(fReady.phase, 'ready');
  const rowF = await envRow(f.id);
  stuck.add(`${rowF.id}:runtime`);
  const fStop = await stop(f.id, 'f', fReady.version);
  const fStuck = await lifecycle.shutDown(f.id, fStop.commandId!, fStop.version);
  assert.equal(fStuck.phase, 'uncertain', 'a container still running after stop keeps the slot');
  stuck.delete(`${rowF.id}:runtime`);
  const fDone = await lifecycle.shutDown(f.id, fStop.commandId!, fStuck.version);
  assert.equal(fDone.phase, 'idle');
  checks.push('a stop the controller cannot confirm holds the slot until a later observed stop releases it');

  // 6. The controller cannot answer even the first observation. The slot is held as uncertain, at the caller's version.
  const g = await project('g');
  const gStart = await activate(g.id, 'g', (await slot()).version);
  injected.set('observe:runtime', { status: 503, body: {} });
  const unanswered = await lifecycle.bringUp(g.id, gStart.commandId!, gStart.version);
  assert.equal(unanswered.status, 'accepted');
  assert.equal(unanswered.phase, 'uncertain', 'an unanswered observation keeps the slot held');
  assert.equal(unanswered.version, gStart.version + 1);
  checks.push('a controller that cannot answer the first observation leaves the slot held as uncertain, at the right version');

} finally {
  await double.close();
  await disconnectDb(db);
}

console.log(`ADR-0092 environment lifecycle checks passed (${checks.length} groups)`);
for (const check of checks) console.log(`  - ${check}`);
