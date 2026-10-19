import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDbClient, disconnectDb } from '../src/db/client.js';
import { buildApp } from '../src/app.js';
import { HostControllerClient } from '../src/integrations/environments/controller-client.js';
import { EnvironmentFacade } from '../src/services/environments/environment-facade.js';
import { EnvironmentLifecycle } from '../src/services/environments/environment-lifecycle.js';
import { ProjectEnvironmentService } from '../src/services/environments/project-environment-service.js';
import { startControllerDouble } from './support/controller-double.js';

// ADR-0092 I05 facade evidence: the HTTP lifecycle that the Web UI and the CLI share, through Fastify, on a real
// PostgreSQL and a controller double. It refuses anything except the throwaway raptix_envtest database.
const url = process.env.ENVIRONMENT_TEST_DATABASE_URL ?? '';
assert.match(url, /^postgresql:\/\/[^@\s]+@127\.0\.0\.1:\d{2,5}\/raptix_envtest$/, 'ENVIRONMENT_TEST_DATABASE_URL must point at the throwaway raptix_envtest database on 127.0.0.1');

const TOKEN = `facade-${randomUUID()}-controller-token`;
const DEPLOYMENT = `i05-${randomUUID()}`;
const db = createDbClient({ connectionString: url });
const double = await startControllerDouble(TOKEN);
const service = new ProjectEnvironmentService(db, DEPLOYMENT);
const lifecycle = new EnvironmentLifecycle(db, service, new HostControllerClient(double.url, TOKEN), {
  deploymentId: DEPLOYMENT,
  runtimeImage: 'ghcr.io/example/runtime@sha256:' + 'a'.repeat(64),
  sandboxImage: 'ghcr.io/example/sandbox@sha256:' + 'b'.repeat(64),
  workspaceHostRoot: 'D:/work',
  stopTimeoutSeconds: 5,
});
const app = await buildApp({ environments: new EnvironmentFacade(service, lifecycle) });
const bare = await buildApp({ environments: new EnvironmentFacade(service) });
const checks: string[] = [];
const suffix = randomUUID().slice(0, 8);

const project = (tag: string, userId = 'local') => db.engagement.create({ data: { name: `i05-${tag}-${suffix}`, workspaceSlug: `i05-${tag}-${suffix}`, userId, targetType: 'web_url', targetValue: 'https://lab.invalid', authorizationConfirmed: true } });

try {
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
  assert.equal(activated.json().phase, 'ready');
  const ready = await app.inject({ method: 'GET', url: `/api/engagements/${a.id}/environment` });
  assert.equal(ready.json().environment.observedState, 'ready');
  assert.equal(ready.json().slot.ownedByThisProject, true);
  assert.equal(ready.json().slot.activeEngagementId, a.id);
  checks.push('activate starts both containers through the controller and reports the project ready');

  // 3. Another project is refused as busy. The answer carries no id of the project that holds the slot.
  const busy = await app.inject({ method: 'POST', url: `/api/engagements/${b.id}/environment/commands`, payload: { requestId: `act-b-${suffix}`, action: 'activate', expectedVersion: ready.json().slot.version } });
  assert.equal(busy.statusCode, 409);
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
  assert.equal(stopped.json().phase, 'idle');
  const started = await app.inject({ method: 'POST', url: `/api/engagements/${b.id}/environment/commands`, payload: { requestId: `act-b2-${suffix}`, action: 'activate', expectedVersion: stopped.json().version } });
  assert.equal(started.statusCode, 200, started.body);
  assert.equal(started.json().phase, 'ready');
  checks.push('stop releases the slot, and the next project starts in the same deployment');

  // 7. Without a controller the facade answers 503 and records nothing.
  const before = await db.environmentCommand.count({ where: { deploymentId: DEPLOYMENT, requestId: `act-nc-${suffix}` } });
  const unconfigured = await bare.inject({ method: 'POST', url: `/api/engagements/${a.id}/environment/commands`, payload: { requestId: `act-nc-${suffix}`, action: 'activate', expectedVersion: 0 } });
  assert.equal(unconfigured.statusCode, 503);
  assert.equal(await db.environmentCommand.count({ where: { deploymentId: DEPLOYMENT, requestId: `act-nc-${suffix}` } }), before);
  checks.push('without a configured controller, activate answers 503 and writes no command record');
} finally {
  await app.close();
  await bare.close();
  await double.close();
  await disconnectDb(db);
}

console.log(`ADR-0092 environment facade checks passed (${checks.length} groups)`);
for (const check of checks) console.log(`  - ${check}`);
