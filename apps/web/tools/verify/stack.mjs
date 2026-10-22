// Isolated real-mode verification stack for the web console. It starts a dedicated PostgreSQL container (tmpfs data, random
// password, unique name), applies the server migrations, starts the API from source and Vite, bootstraps one owner from
// the API environment, creates a viewer and fixtures through the API, then runs the route smoke for the requested modes.
// Everything it starts is stopped and removed on exit. Credentials are generated per run, given to child processes through
// the environment and never written to the repository; the fixture manifest holds identifiers only.
// Usage: node tools/verify/stack.mjs [--modes mock,real] [--out <dir>] [--routes a,b]
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..', '..');
const root = path.resolve(web, '..', '..');
const require = createRequire(path.join(web, 'package.json'));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const modes = arg('--modes', 'mock,real');
const routes = arg('--routes', null);
// The knowledge graph (Neo4j) backs the library and the observed graph. It runs by default; --no-graph leaves it out.
const withGraph = !process.argv.includes('--no-graph');
const graphSeed = path.join(root, 'packages/raptix/raptix/skills/.graph/skills.cypher');
const out = arg('--out', mkdtempSync(path.join(tmpdir(), 'raptix-stack-')));
mkdirSync(out, { recursive: true });

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const children = [];
let container = null;
let graphContainer = null;
const log = (message) => console.log(`[stack] ${message}`);

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', timeout: 120000, ...options });
  if (result.status !== 0) throw new Error(`${executable} ${args[0]} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}

function start(name, args, cwd, env) {
  const logFile = openSync(path.join(out, `${name}.log`), 'w');
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', logFile, logFile], windowsHide: true });
  children.push({ name, child });
  log(`started ${name} (PID ${child.pid})`);
  return child;
}

async function ready(url, label, attempts = 90) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      // The server has no answer yet; the loop below decides when to give up.
    }
    const ended = children.find(({ child }) => child.exitCode !== null);
    if (ended) throw new Error(`${ended.name} exited before ${label} was ready; see ${out}`);
    await pause(1000);
  }
  throw new Error(`${label} did not answer at ${url}`);
}

async function login(api, username, password) {
  const response = await fetch(`${api}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.equal(response.status, 200, `login ${username}: ${response.status}`);
  return { cookie: response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; '), csrf: (await response.json()).csrfToken };
}

async function request(api, session, method, endpoint, body) {
  const response = await fetch(api + endpoint, { method, headers: { cookie: session.cookie, 'x-csrf-token': session.csrf, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  assert.ok([200, 201].includes(response.status), `${method} ${endpoint}: ${response.status} ${JSON.stringify(result).slice(0, 200)}`);
  return result;
}

async function seed(api, owner) {
  const project = await request(api, owner, 'POST', '/api/engagements', { name: 'stack-verify', displayName: 'Stack verification project', targetType: 'web_url', targetValue: 'https://verification.invalid', authorizationConfirmed: true, brief: 'Isolated UI verification only. No target scanning, model calls or offensive execution. All captures are generated fixture bytes.' });
  const prefix = `/api/engagements/${project.id}`;
  const bytes = Buffer.from('﻿print("retained fixture")\r\n', 'utf8');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const capture = await request(api, owner, 'POST', `${prefix}/artifacts/captures`, { requestId: randomUUID(), filename: 'stack-fixture.txt', mediaType: 'text/plain', base64: bytes.toString('base64') });
  await request(api, owner, 'PATCH', `${prefix}/artifacts/captures/${capture.id}/classification`, { classification: 'standard', expectedVersion: 1, reason: 'Generated verification fixture.' });
  const finding = await request(api, owner, 'POST', `${prefix}/curated-findings`, { title: 'Stack verification finding', severity: 'medium', detail: 'Generated fixture for the route smoke.', reproduction: { prerequisites: 'Generated fixture only', inputs: 'No target', steps: ['Read the retained fixture'], expectedObservation: 'Exact original bytes', limitations: 'No exploitation attempted', artifact: { captureId: capture.id, digest } } });
  const report = await request(api, owner, 'POST', `${prefix}/report-records`, { title: 'Stack verification report', summary: 'Generated fixture for the route smoke.' });
  const viewerPassword = randomUUID();
  await request(api, owner, 'POST', `${prefix}/members`, { username: 'viewer', displayName: 'Stack Viewer', password: viewerPassword, role: 'viewer' });
  const reviewerPassword = randomUUID();
  await request(api, owner, 'POST', `${prefix}/members`, { username: 'reviewer', displayName: 'Stack Reviewer', password: reviewerPassword, role: 'reviewer' });
  // A confirmed finding is the reporting readiness precondition: the author sends it to review, an independent reviewer confirms it.
  await request(api, owner, 'POST', `${prefix}/curated-findings/${finding.id}/transition`, { to: 'review', expectedVersion: finding.version ?? 1 });
  const reviewerSession = await login(api, 'reviewer', reviewerPassword);
  await request(api, reviewerSession, 'POST', `${prefix}/curated-findings/${finding.id}/transition`, { to: 'confirmed', expectedVersion: (finding.version ?? 1) + 1 });
  // The asset detail route needs an imported host.
  await request(api, owner, 'POST', `${prefix}/assets/inventory/import`, { identifiers: ['stack-host-01.verify.example.test'], kind: 'host' });
  const inventory = await request(api, owner, 'GET', `${prefix}/assets/inventory`);
  // The library reads come from the knowledge graph (Neo4j), which this stack does not start: without it the library routes are not registered.
  const probe = await fetch(`${api}/api/library`, { headers: { cookie: owner.cookie } });
  const library = {};
  if (probe.status === 200) {
    const view = await request(api, owner, 'GET', '/api/library');
    const skill = view.skills.find((candidate) => candidate.mitreIds.length > 0) ?? view.skills[0];
    const skillDetail = await request(api, owner, 'GET', `/api/library/skills/${encodeURIComponent(skill.name)}`);
    const proposal = await request(api, owner, 'POST', `${prefix}/library-proposals`, { skillName: skill.name, proposedBody: `${skillDetail.body}\n<!-- stack verification -->\n`, rationale: 'Generated proposal for the route smoke.' });
    Object.assign(library, { playbook: skill.name, technique: skill.mitreIds[0], proposal: proposal.id });
  } else {
    log(`library fixtures not seeded: GET /api/library answers ${probe.status} because the stack runs without the knowledge graph`);
  }
  return { project: project.id, finding: finding.id, evidence: capture.id, report: report.id, asset: inventory.assets[0].id, knowledgeGraph: probe.status === 200, ...library, viewer: { username: 'viewer', password: viewerPassword }, reviewer: { username: 'reviewer', password: reviewerPassword } };
}

async function runSmoke(env, manifestFile, modesToRun, name) {
  const smokeOut = path.join(out, `${name}.json`);
  const extra = [...(routes ? ['--routes', routes] : []), ...(process.argv.includes('--discover') ? ['--discover'] : [])];
  const result = spawnSync(process.execPath, [path.join(here, 'route-smoke.mjs'), '--modes', modesToRun, '--fixtures-real', manifestFile, '--out', smokeOut, ...extra], { cwd: web, env, encoding: 'utf8', timeout: 900000 });
  writeFileSync(path.join(out, `${name}.log`), `${result.stdout}${result.stderr}`);
  process.stdout.write(result.stdout);
  return result.status;
}

function runFlow(env, manifestFile, script, name) {
  const flowOut = path.join(out, `${name}.json`);
  const result = spawnSync(process.execPath, [path.join(here, 'flows', script), '--app', env.RAPTIX_VERIFY_APP, '--fixtures', manifestFile, '--out', flowOut], { cwd: web, env, encoding: 'utf8', timeout: 900000 });
  writeFileSync(path.join(out, `${name}.log`), `${result.stdout}${result.stderr}`);
  process.stdout.write(result.stdout);
  return result.status;
}

function runClick(env, manifestFile, mode, appUrl) {
  const clickOut = path.join(out, `flows-assets-click-${mode}.json`);
  const result = spawnSync(process.execPath, [path.join(here, 'flows', 'assets-click.mjs'), '--mode', mode, '--app', appUrl, '--fixtures', manifestFile, '--out', clickOut], { cwd: web, env, encoding: 'utf8', timeout: 900000 });
  writeFileSync(path.join(out, `flows-assets-click-${mode}.log`), `${result.stdout}${result.stderr}`);
  process.stdout.write(result.stdout);
  return result.status;
}

function runReportsClick(env, manifestFile, mode, appUrl) {
  const clickOut = path.join(out, `flows-reports-click-${mode}.json`);
  const result = spawnSync(process.execPath, [path.join(here, 'flows', 'reports-click.mjs'), '--mode', mode, '--app', appUrl, '--fixtures', manifestFile, '--out', clickOut], { cwd: web, env, encoding: 'utf8', timeout: 900000 });
  writeFileSync(path.join(out, `flows-reports-click-${mode}.log`), `${result.stdout}${result.stderr}`);
  process.stdout.write(result.stdout);
  return result.status;
}

function runSettingsClick(env, manifestFile, mode, appUrl) {
  const clickOut = path.join(out, `flows-settings-click-${mode}.json`);
  const result = spawnSync(process.execPath, [path.join(here, 'flows', 'settings-click.mjs'), '--mode', mode, '--app', appUrl, '--fixtures', manifestFile, '--out', clickOut], { cwd: web, env, encoding: 'utf8', timeout: 900000 });
  writeFileSync(path.join(out, `flows-settings-click-${mode}.log`), `${result.stdout}${result.stderr}`);
  process.stdout.write(result.stdout);
  return result.status;
}

function runFlows(env, manifestFile) {
  const statuses = [runFlow(env, manifestFile, 'reports.mjs', 'flows-reports'), runFlow(env, manifestFile, 'assets-library.mjs', 'flows-assets-library')];
  return statuses.every((code) => code === 0) ? 0 : 1;
}

function stopChildren() {
  for (const { name, child } of children.reverse()) {
    if (child.exitCode !== null) continue;
    const stopped = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 5000, encoding: 'utf8' });
    log(`${name} PID ${child.pid}: ${stopped.status === 0 ? 'stopped' : 'stop not confirmed'}`);
  }
}

function removeContainer() {
  if (!container) return;
  const removed = spawnSync('docker', ['rm', '-f', '-v', container], { timeout: 5000, encoding: 'utf8' });
  log(`container ${container}: ${removed.status === 0 ? 'removed' : 'removal not confirmed'}`);
}

let status = 1;
try {
  const dbPort = await freePort();
  const apiPort = await freePort();
  const webPort = await freePort();
  const dbPassword = randomUUID();
  const adminPassword = randomUUID();
  container = `raptix-stack-${randomUUID().slice(0, 8)}`;
  command('docker', ['run', '-d', '--name', container, '--label', 'raptix.verification=stack', '--tmpfs', '/var/lib/postgresql/data', '-p', `127.0.0.1:${dbPort}:5432`, '-e', `POSTGRES_PASSWORD=${dbPassword}`, '-e', 'POSTGRES_DB=verify', 'postgres:17']);
  let databaseReady = false;
  for (let attempt = 0; attempt < 60 && !databaseReady; attempt++) {
    databaseReady = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres'], { timeout: 3000, stdio: 'ignore' }).status === 0;
    if (!databaseReady) await pause(1000);
  }
  if (!databaseReady) throw new Error(`database container ${container} did not become ready`);
  log(`database ${container} on 127.0.0.1:${dbPort}`);

  let graphAccess = null;
  if (withGraph) {
    const graphHttpPort = await freePort();
    const graphBoltPort = await freePort();
    const graphPassword = randomUUID();
    graphContainer = `raptix-stack-${randomUUID().slice(0, 8)}-graph`;
    command('docker', ['run', '-d', '--name', graphContainer, '--label', 'raptix.verification=stack', '--tmpfs', '/data', '-p', `127.0.0.1:${graphHttpPort}:7474`, '-p', `127.0.0.1:${graphBoltPort}:7687`, '-e', `NEO4J_AUTH=neo4j/${graphPassword}`, '-e', 'NEO4J_server_memory_heap_max__size=512m', '-e', 'NEO4J_server_memory_pagecache_size=128m', 'neo4j:5.26.28-community']);
    await ready(`http://127.0.0.1:${graphHttpPort}`, 'knowledge graph', 180);
    const seeded = spawnSync('docker', ['exec', '-i', graphContainer, 'cypher-shell', '-u', 'neo4j', '-p', graphPassword], { input: readFileSync(graphSeed), encoding: 'utf8', timeout: 900000, maxBuffer: 256 * 1024 * 1024 });
    writeFileSync(path.join(out, 'graph-seed.log'), `${seeded.stdout}${seeded.stderr}`);
    assert.equal(seeded.status, 0, `the skill graph seed failed: ${seeded.stderr.slice(0, 300)}`);
    graphAccess = { httpPort: graphHttpPort, password: graphPassword };
    log(`knowledge graph ${graphContainer} on 127.0.0.1:${graphHttpPort}, seeded from the checked-in skill graph`);
  }

  const api = `http://127.0.0.1:${apiPort}`;
  const app = `http://127.0.0.1:${webPort}`;
  const env = {
    ...process.env,
    DATABASE_URL: `postgresql://postgres:${dbPassword}@127.0.0.1:${dbPort}/verify`,
    WORKSPACE_PATH: path.join(out, 'workspace'),
    PORT: String(apiPort),
    HOST: '127.0.0.1',
    RAPTIX_WEB_AUTH_MODE: 'multi',
    RAPTIX_WEB_ADMIN_USERNAME: 'verifier',
    RAPTIX_WEB_ADMIN_PASSWORD: adminPassword,
    RAPTIX_WEB_BACKEND_URL: api,
    RAPTIX_WEB_SECURE_COOKIES: '0',
  };
  mkdirSync(env.WORKSPACE_PATH, { recursive: true });
  for (const key of Object.keys(env)) if (/^(LANGGRAPH_|NEO4J_|SLIVER_|RAPTIX_RUNTIME_|RAPTIX_ENVIRONMENT_)/.test(key)) delete env[key];
  if (graphAccess) Object.assign(env, { NEO4J_PASSWORD: graphAccess.password, NEO4J_HTTP_PORT: String(graphAccess.httpPort), NEO4J_HTTP_URI: `http://127.0.0.1:${graphAccess.httpPort}` });
  writeFileSync(path.join(out, 'migrations.log'), command(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: path.join(root, 'apps/web/server'), env }));
  start('api', ['--import', 'tsx', 'src/main.ts'], path.join(root, 'apps/web/server'), env);
  await ready(`${api}/api/health`, 'API');
  start('web', [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], web, env);
  await ready(app, 'web');

  const owner = await login(api, 'verifier', adminPassword);
  const fixtures = await seed(api, owner);
  const manifest = path.join(out, 'fixtures.real.json');
  writeFileSync(manifest, JSON.stringify({ project: fixtures.project, finding: fixtures.finding, evidence: fixtures.evidence, report: fixtures.report, asset: fixtures.asset, viewer: fixtures.viewer, knowledgeGraph: fixtures.knowledgeGraph, playbook: fixtures.playbook, technique: fixtures.technique, proposal: fixtures.proposal }, null, 2));
  log(`fixtures written: ${manifest}`);
  const statuses = [];
  const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  if (modes.split(',').includes('mock')) {
    // Mock mode runs on its own dev server whose backend is unreachable: a persona session must not depend on the stack API.
    const mockPort = await freePort();
    const deadBackend = `http://127.0.0.1:${await freePort()}`;
    start('web-mock', [viteBin, '--host', '127.0.0.1', '--port', String(mockPort), '--strictPort'], web, { ...env, RAPTIX_WEB_BACKEND_URL: deadBackend });
    const mockApp = `http://127.0.0.1:${mockPort}`;
    await ready(mockApp, 'mock web');
    statuses.push(await runSmoke({ ...env, RAPTIX_VERIFY_APP: mockApp, RAPTIX_VERIFY_USER: 'verifier', RAPTIX_VERIFY_PASSWORD: adminPassword }, manifest, 'mock', 'smoke-mock'));
    statuses.push(runClick({ ...env, RAPTIX_VERIFY_APP: mockApp }, manifest, 'mock', mockApp));
    statuses.push(runReportsClick({ ...env, RAPTIX_VERIFY_APP: mockApp }, manifest, 'mock', mockApp));
    statuses.push(runSettingsClick({ ...env, RAPTIX_VERIFY_APP: mockApp }, manifest, 'mock', mockApp));
  }
  if (modes.split(',').includes('real')) {
    statuses.push(await runSmoke({ ...env, RAPTIX_VERIFY_APP: app, RAPTIX_VERIFY_USER: 'verifier', RAPTIX_VERIFY_PASSWORD: adminPassword }, manifest, 'real', 'smoke-real'));
    statuses.push(runClick({ ...env, RAPTIX_VERIFY_APP: app, RAPTIX_VERIFY_USER: 'verifier', RAPTIX_VERIFY_PASSWORD: adminPassword, RAPTIX_VERIFY_REVIEWER: 'reviewer', RAPTIX_VERIFY_REVIEWER_PASSWORD: fixtures.reviewer.password }, manifest, 'real', app));
    statuses.push(runReportsClick({ ...env, RAPTIX_VERIFY_APP: app, RAPTIX_VERIFY_USER: 'verifier', RAPTIX_VERIFY_PASSWORD: adminPassword, RAPTIX_VERIFY_REVIEWER: 'reviewer', RAPTIX_VERIFY_REVIEWER_PASSWORD: fixtures.reviewer.password }, manifest, 'real', app));
    statuses.push(runSettingsClick({ ...env, RAPTIX_VERIFY_APP: app, RAPTIX_VERIFY_USER: 'verifier', RAPTIX_VERIFY_PASSWORD: adminPassword }, manifest, 'real', app));
    statuses.push(runFlows({ ...env, RAPTIX_VERIFY_APP: app, RAPTIX_VERIFY_USER: 'verifier', RAPTIX_VERIFY_PASSWORD: adminPassword, RAPTIX_VERIFY_REVIEWER: 'reviewer', RAPTIX_VERIFY_REVIEWER_PASSWORD: fixtures.reviewer.password }, manifest));
  }
  status = statuses.every((code) => code === 0) ? 0 : 1;
} catch (error) {
  console.error(`[stack] ${error.message}`);
  status = 1;
} finally {
  stopChildren();
  removeContainer();
  if (graphContainer) spawnSync('docker', ['rm', '-f', '-v', graphContainer], { timeout: 5000, encoding: 'utf8' });
  log(`output: ${out}`);
}
process.exitCode = status;
