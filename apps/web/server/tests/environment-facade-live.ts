import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDbClient, disconnectDb } from '../src/db/client.js';
import { buildApp } from '../src/app.js';
import { HostControllerClient } from '../src/integrations/environments/controller-client.js';
import { EnvironmentFacade } from '../src/services/environments/environment-facade.js';
import { EnvironmentLifecycle } from '../src/services/environments/environment-lifecycle.js';
import { ProjectEnvironmentService } from '../src/services/environments/project-environment-service.js';
import { startControllerDouble } from './support/controller-double.js';
import { EngagementsRepository } from '../src/repositories/engagements-repository.js';
import { RuntimeRouter, prismaRouteSource } from '../src/integrations/runtime/runtime-router.js';
import { RuntimeOwnershipService } from '../src/services/runtime-ownership.js';

// ADR-0092 I05 facade evidence: the HTTP lifecycle that the Web UI and the CLI share, through Fastify, on a real
// PostgreSQL and a controller double. It refuses anything except the throwaway raptix_envtest database.
const url = process.env.ENVIRONMENT_TEST_DATABASE_URL ?? '';
assert.match(url, /^postgresql:\/\/[^@\s]+@127\.0\.0\.1:\d{2,5}\/raptix_envtest$/, 'ENVIRONMENT_TEST_DATABASE_URL must point at the throwaway raptix_envtest database on 127.0.0.1');

const TOKEN = `facade-${randomUUID()}-controller-token`;
const DEPLOYMENT = `i05-${randomUUID()}`;
const db = createDbClient({ connectionString: url });
const double = await startControllerDouble(TOKEN);
const service = new ProjectEnvironmentService(db, DEPLOYMENT);
let legacyQuiescent = true;
const lifecycle = new EnvironmentLifecycle(db, service, new HostControllerClient(double.url, TOKEN), {
  deploymentId: DEPLOYMENT,
  runtimeImage: 'ghcr.io/example/runtime@sha256:' + 'a'.repeat(64),
  sandboxImage: 'ghcr.io/example/sandbox@sha256:' + 'b'.repeat(64),
  workspaceHostRoot: 'D:/work',
  stopTimeoutSeconds: 5,
}, { probe: async () => true, readinessTimeoutMs: 2000, pollIntervalMs: 10, legacyQuiescent: async () => legacyQuiescent });
const facade = new EnvironmentFacade(service, lifecycle);
const app = await buildApp({ environments: facade });
const bare = await buildApp({ environments: new EnvironmentFacade(service) });
const checks: string[] = [];
const suffix = randomUUID().slice(0, 8);

// Clients poll the state while a transition runs, as the Web UI and the CLI do. This waits for the settled state.
async function settled(engagementId: string, observed: string, phase: string): Promise<void> {
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    const state = await app.inject({ method: 'GET', url: `/api/engagements/${engagementId}/environment` });
    if (state.json().environment.observedState === observed && state.json().slot.phase === phase) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`the environment never settled at ${observed}/${phase}`);
}

const project = (tag: string, userId = 'local') => db.engagement.create({ data: { name: `i05-${tag}-${suffix}`, workspaceSlug: `i05-${tag}-${suffix}`, userId, targetType: 'web_url', targetValue: 'https://lab.invalid', authorizationConfirmed: true } });

try {
  const repository = new EngagementsRepository(db.engagement, undefined, DEPLOYMENT);
  const managed = await repository.create('local', { name: `managed-${suffix}`, workspaceSlug: `managed-${suffix}`, targetType: 'web_url', targetValue: 'https://lab.invalid', authorizationConfirmed: true });
  const router = new RuntimeRouter('http://legacy.invalid:2024', prismaRouteSource(db, DEPLOYMENT));
  await assert.rejects(() => router.endpoint(managed.id), { state: 'unprovisioned' });
  checks.push('project creation registers an unprovisioned environment atomically and never routes it to legacy');
  const a = await project('a');
  const b = await project('b');
  const foreign = await project('foreign', 'someone-else');

  // 1. The state of a new project is unprovisioned and holds nothing.
  const initial = await app.inject({ method: 'GET', url: `/api/engagements/${a.id}/environment` });
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.json().environment.observedState, 'unprovisioned');
  assert.equal(initial.json().slot.held, false);
  checks.push('a new project reports unprovisioned and holds no slot');

  // 2. Activate brings the environment up through the controller and answers ready.
  const activated = await app.inject({ method: 'POST', url: `/api/engagements/${a.id}/environment/commands`, payload: { requestId: `act-a-${suffix}`, action: 'activate', expectedVersion: 0 } });
  assert.equal(activated.statusCode, 200, activated.body);
  assert.equal(activated.json().phase, 'starting', 'the answer returns at once; the work runs in the background');
  await settled(a.id, 'ready', 'ready');
  const ready = await app.inject({ method: 'GET', url: `/api/engagements/${a.id}/environment` });
  assert.equal(ready.json().environment.observedState, 'ready');
  assert.equal(ready.json().slot.ownedByThisProject, true);
  assert.equal(ready.json().slot.activeEngagementId, a.id);
  checks.push('activate starts both containers through the controller and reports the project ready');

  // 3. Another project is refused as busy. The answer carries no id of the project that holds the slot.
  const busy = await app.inject({ method: 'POST', url: `/api/engagements/${b.id}/environment/commands`, payload: { requestId: `act-b-${suffix}`, action: 'activate', expectedVersion: ready.json().slot.version } });
  assert.equal(busy.statusCode, 200, "a busy answer is data, not an error");
  assert.equal(busy.json().status, 'busy');
  assert.equal(busy.body.includes(a.id), false, 'the busy answer must not name the active project');
  const bState = await app.inject({ method: 'GET', url: `/api/engagements/${b.id}/environment` });
  assert.equal(bState.json().slot.held, true);
  assert.equal(bState.json().slot.ownedByThisProject, false);
  assert.equal(bState.json().slot.activeEngagementId, null);
  checks.push('another project is refused as busy and sees only that the slot is held, never who holds it');

  // 4. A foreign project answers 404 and leaks nothing.
  const denied = await app.inject({ method: 'GET', url: `/api/engagements/${foreign.id}/environment` });
  assert.equal(denied.statusCode, 404);
  checks.push('a project owned by someone else answers not found');

  // 5. A malformed command is refused before anything is recorded.
  const malformed = await app.inject({ method: 'POST', url: `/api/engagements/${a.id}/environment/commands`, payload: { requestId: 'x', action: 'delete', expectedVersion: 0 } });
  assert.equal(malformed.statusCode, 400);
  checks.push('a malformed command is refused as a bad request');

  // 6. Stop shuts the containers down and releases the slot, and then another project can start.
  const stopped = await app.inject({ method: 'POST', url: `/api/engagements/${a.id}/environment/commands`, payload: { requestId: `stop-a-${suffix}`, action: 'stop', expectedVersion: ready.json().slot.version } });
  assert.equal(stopped.statusCode, 200, stopped.body);
  assert.equal(stopped.json().phase, 'stopping');
  await settled(a.id, 'stopped', 'idle');
  const started = await app.inject({ method: 'POST', url: `/api/engagements/${b.id}/environment/commands`, payload: { requestId: `act-b2-${suffix}`, action: 'activate', expectedVersion: (await app.inject({ method: 'GET', url: `/api/engagements/${a.id}/environment` })).json().slot.version } });
  assert.equal(started.statusCode, 200, started.body);
  assert.equal(started.json().phase, 'starting');
  await settled(b.id, 'ready', 'ready');
  checks.push('stop releases the slot, and the next project starts in the same deployment');

  // 7. Without a controller the facade answers 503 and records nothing.
  const before = await db.environmentCommand.count({ where: { deploymentId: DEPLOYMENT, requestId: `act-nc-${suffix}` } });
  const unconfigured = await bare.inject({ method: 'POST', url: `/api/engagements/${a.id}/environment/commands`, payload: { requestId: `act-nc-${suffix}`, action: 'activate', expectedVersion: 0 } });
  assert.equal(unconfigured.statusCode, 503);
  assert.equal(await db.environmentCommand.count({ where: { deploymentId: DEPLOYMENT, requestId: `act-nc-${suffix}` } }), before);
  checks.push('without a configured controller, activate answers 503 and writes no command record');

  await assert.rejects(() => facade.prepare('local', managed.id, `prepare-busy-${suffix}`), /Another project/);
  await assert.rejects(() => facade.prepare('someone-else', managed.id, `prepare-foreign-${suffix}`), { statusCode: 404 });
  const legacy = await project('legacy');
  await facade.prepare('local', legacy.id, `prepare-legacy2-${suffix}`);
  assert.equal(await db.projectEnvironment.count({ where: { deploymentId: DEPLOYMENT, engagementId: legacy.id } }), 0);
  checks.push('planning preparation refuses busy and foreign managed projects and leaves legacy projects unchanged');

  const bReady = await facade.state('local', b.id);
  await facade.command('local', b.id, { requestId: `stop-b-${suffix}`, action: 'stop', expectedVersion: bReady.slot.version });
  await settled(b.id, 'stopped', 'idle');
  await assert.rejects(() => new EnvironmentFacade(service).prepare('local', managed.id, `prepare-no-controller-${suffix}`), { statusCode: 503 });
  await assert.rejects(() => facade.prepare('local', managed.id, `prepare-managed-${suffix}`), { code: 'conflict', details: { field: 'environment' } });
  await settled(managed.id, 'ready', 'ready');
  const commands = await db.environmentCommand.count({ where: { deploymentId: DEPLOYMENT } });
  await facade.prepare('local', managed.id, `prepare-managed-${suffix}`);
  assert.equal(await db.environmentCommand.count({ where: { deploymentId: DEPLOYMENT } }), commands);
  assert.equal((await router.endpoint(managed.id)).environmentId, (await db.projectEnvironment.findUniqueOrThrow({ where: { deploymentId_engagementId: { deploymentId: DEPLOYMENT, engagementId: managed.id } } })).id);
  checks.push('planning preparation activates both managed containers, waits for ready and does not repeat a ready command');

  const managedReady = await facade.state('local', managed.id);
  await facade.command('local', managed.id, { requestId: `stop-managed-${suffix}`, action: 'stop', expectedVersion: managedReady.slot.version });
  await settled(managed.id, 'stopped', 'idle');
  const ownership = new RuntimeOwnershipService(db, service);
  const threadId = randomUUID();
  const contextHash = await ownership.prepareBinding('local', legacy.id, 'soundwave', 'planning');
  await ownership.bindThread('local', legacy.id, { threadId, assistantId: 'soundwave', kind: 'planning', contextHash });
  const runRequest = `legacy-pending-${suffix}`;
  const reservation = await ownership.reserve('local', legacy.id, runRequest, 'create_run', { message: 'not dispatched' }, threadId);
  assert.ok(reservation.reserved);
  try {
    await assert.rejects(() => facade.prepare('local', managed.id, `prepare-legacy-busy-${suffix}`), /Another project/);
    assert.equal((await facade.state('local', managed.id)).environment.observedState, 'stopped');
    checks.push('a legacy planning reservation prevents automatic activation of a managed project');
  } finally {
    await ownership.rejectBeforeDispatch('local', legacy.id, runRequest, reservation.token);
  }
  legacyQuiescent = false;
  await assert.rejects(() => facade.prepare('local', managed.id, `prepare-legacy-checkpoint-${suffix}`), { code: 'conflict', details: { field: 'environment' } });
  let checkpointRefusal = await facade.state('local', managed.id);
  for (let attempt = 0; attempt < 200 && checkpointRefusal.slot.phase === 'starting'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    checkpointRefusal = await facade.state('local', managed.id);
  }
  assert.equal(checkpointRefusal.environment.observedState, 'stopped');
  assert.equal(checkpointRefusal.environment.lastError, 'legacy_not_quiescent');
  assert.equal(checkpointRefusal.slot.phase, 'idle');
  assert.equal([...double.containers.values()].some(container => container.projectId === managed.workspaceSlug && container.running), false);
  checks.push('a paused/questioned legacy checkpoint refuses managed startup even without an active ledger marker');
} finally {
  await app.close();
  await bare.close();
  await double.close();
  await disconnectDb(db);
}

console.log(`ADR-0092 environment facade checks passed (${checks.length} groups)`);
for (const check of checks) console.log(`  - ${check}`);
