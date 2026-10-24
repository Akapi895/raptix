// Isolated real-mode verification stack for the web console. It starts a dedicated PostgreSQL container (tmpfs data, random
// password, unique name), applies the server migrations, starts the API from source and Vite, bootstraps one owner from
// the API environment, creates a viewer and fixtures through the API, then runs the route smoke and the flows against it.
// Everything it starts is stopped and removed on exit. Credentials are generated per run, given to child processes through
// the environment and never written to the repository; the fixture manifest holds identifiers only.
// Usage: node tools/verify/stack.mjs [--out <dir>] [--routes a,b] [--prelab-only] [--smoke-only]
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
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
const modes = 'real';
const routes = arg('--routes', null);
// The knowledge graph (Neo4j) backs the library and the observed graph. It runs by default; --no-graph leaves it out.
const withGraph = !process.argv.includes('--no-graph');
const graphSeed = path.join(root, 'packages/raptix/raptix/skills/.graph/skills.cypher');
const out = arg('--out', mkdtempSync(path.join(tmpdir(), 'raptix-stack-')));
// The run writes fixture manifests with test credentials, so those folders must never sit inside the repository.
function assertOutsideRepo(dir, flag) {
  const resolved = path.resolve(dir).toLowerCase();
  const repo = root.toLowerCase();
  if (resolved === repo || resolved.startsWith(repo + path.sep)) throw new Error(`${flag} must be outside the repository`);
}
assertOutsideRepo(out, '--out');
mkdirSync(out, { recursive: true });

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Ends a --hold run after the stack is stopped through the stop file; the cleanup in finally still runs. */
class HoldComplete extends Error {}
const children = [];
let container = null;
let graphContainer = null;
let runtimeContainers = [];
let runtimeNetwork = null;
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

async function seed(api, owner, workspace) {
  const project = await request(api, owner, 'POST', '/api/engagements', { name: 'stack-verify', displayName: 'Stack verification project', targetType: 'web_url', targetValue: 'https://verification.invalid', authorizationConfirmed: true, brief: 'Isolated UI verification only. No target scanning, model calls or offensive execution. All captures are generated fixture bytes.' });
  const prefix = `/api/engagements/${project.id}`;
  const findingsFolder = path.join(workspace, project.workspaceSlug, 'findings');
  mkdirSync(findingsFolder, { recursive: true });
  writeFileSync(path.join(findingsFolder, 'FIND-PRELAB.md'), '# Prelab producer fixture\nSeverity: informational\n## Description\nSynthetic pipeline check, not a vulnerability.\n## Evidence\nGenerated fixture only.\n## Remediation\nPreserve the remediation during curation.\n');
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
  // The author of plans and scope revisions: an operator, separate from the reviewer who decides them.
  const operatorPassword = randomUUID();
  await request(api, owner, 'POST', `${prefix}/members`, { username: 'operator', displayName: 'Stack Operator', password: operatorPassword, role: 'operator' });
  // A confirmed finding is the reporting readiness precondition: the author sends it to review, an independent reviewer confirms it.
  await request(api, owner, 'POST', `${prefix}/curated-findings/${finding.id}/transition`, { to: 'review', expectedVersion: finding.version ?? 1 });
  const reviewerSession = await login(api, 'reviewer', reviewerPassword);
  await request(api, reviewerSession, 'POST', `${prefix}/curated-findings/${finding.id}/transition`, { to: 'confirmed', expectedVersion: (finding.version ?? 1) + 1 });
  // An approved scope revision is the ROE that a plan proposal pins: the operator authors it, the independent reviewer approves it.
  const operatorSession = await login(api, 'operator', operatorPassword);
  const roe = { windows: [{ start: '2026-01-01T00:00:00Z', end: '2027-12-31T23:59:59Z', tz: 'UTC' }], emergencyContacts: ['stack-verification-contact'], restrictions: [] };
  const scopeRevision = await request(api, operatorSession, 'POST', `${prefix}/scope/revisions`, { diff: { added: ['stack-host-01.verify.example.test'], removed: [], rationale: 'Generated verification ROE for the plan proposals.' }, roe });
  await request(api, reviewerSession, 'POST', `${prefix}/scope/revisions/${scopeRevision.id}/decision`, { decision: 'approved', comment: 'Generated verification ROE.' });
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
  return { project: project.id, finding: finding.id, evidence: capture.id, report: report.id, asset: inventory.assets[0].id, knowledgeGraph: probe.status === 200, ...library, viewer: { username: 'viewer', password: viewerPassword }, reviewer: { username: 'reviewer', password: reviewerPassword }, operator: { username: 'operator', password: operatorPassword } };
}

async function runSmoke(env, manifestFile, name) {
  const smokeOut = path.join(out, `${name}.json`);
  const extra = [...(routes ? ['--routes', routes] : []), ...(process.argv.includes('--discover') ? ['--discover'] : [])];
  const result = spawnSync(process.execPath, [path.join(here, 'route-smoke.mjs'), '--fixtures-real', manifestFile, '--out', smokeOut, ...extra], { cwd: web, env, encoding: 'utf8', timeout: 900000 });
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

function runProjectsClick(env, manifestFile, mode, appUrl) {
  const clickOut = path.join(out, `flows-projects-click-${mode}.json`);
  const result = spawnSync(process.execPath, [path.join(here, 'flows', 'projects-click.mjs'), '--mode', mode, '--app', appUrl, '--fixtures', manifestFile, '--out', clickOut], { cwd: web, env, encoding: 'utf8', timeout: 900000 });
  writeFileSync(path.join(out, `flows-projects-click-${mode}.log`), `${result.stdout}${result.stderr}`);
  process.stdout.write(result.stdout);
  return result.status;
}

function runWorkspaceClick(env, manifestFile, appUrl) {
  const clickOut = path.join(out, 'flows-workspace-click.json');
  const result = spawnSync(process.execPath, [path.join(here, 'flows', 'workspace-click.mjs'), '--app', appUrl, '--fixtures', manifestFile, '--out', clickOut, '--shots', out], { cwd: web, env, encoding: 'utf8', timeout: 900000 });
  writeFileSync(path.join(out, 'flows-workspace-click.log'), `${result.stdout}${result.stderr}`);
  process.stdout.write(result.stdout);
  return result.status;
}

function runLayoutCheck(env, manifestFile, appUrl) {
  const clickOut = path.join(out, 'flows-layout-click.json');
  const result = spawnSync(process.execPath, [path.join(here, 'flows', 'layout-click.mjs'), '--app', appUrl, '--fixtures', manifestFile, '--out', clickOut, '--shots', out], { cwd: web, env, encoding: 'utf8', timeout: 900000 });
  writeFileSync(path.join(out, 'flows-layout-click.log'), `${result.stdout}${result.stderr}`);
  process.stdout.write(result.stdout);
  return result.status;
}

function runAnalysisClick(env, manifestFile, mode, appUrl) {
  const clickOut = path.join(out, `flows-analysis-click-${mode}.json`);
  const result = spawnSync(process.execPath, [path.join(here, 'flows', 'analysis-click.mjs'), '--mode', mode, '--app', appUrl, '--fixtures', manifestFile, '--out', clickOut], { cwd: web, env, encoding: 'utf8', timeout: 900000 });
  writeFileSync(path.join(out, `flows-analysis-click-${mode}.log`), `${result.stdout}${result.stderr}`);
  process.stdout.write(result.stdout);
  return result.status;
}

function runGateClick(env, manifestFile) {
  const clickOut = path.join(out, 'flows-runtime-gate-click.json');
  const result = spawnSync(process.execPath, [path.join(here, 'flows', 'runtime-gate-click.mjs'), '--app', env.RAPTIX_VERIFY_APP, '--fixtures', manifestFile, '--out', clickOut], { cwd: web, env, encoding: 'utf8', timeout: 900000 });
  writeFileSync(path.join(out, 'flows-runtime-gate-click.log'), `${result.stdout}${result.stderr}`);
  process.stdout.write(result.stdout);
  return result.status;
}

function runFlows(env, manifestFile) {
  const statuses = [runFlow(env, manifestFile, 'reports.mjs', 'flows-reports'), runFlow(env, manifestFile, 'assets-library.mjs', 'flows-assets-library'), runFlow(env, manifestFile, 'prelab.mjs', 'flows-prelab')];
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

// The agent runtime (LangGraph) and its sandbox, started with --runtime on a network of this run only. No LLM provider key is
// passed in: a chat message fails until one is configured, and nothing from a deployment environment is copied.
const SANDBOX_IMAGE = "ghcr.io/akapi895/raptix-sandbox:stable";
const RUNTIME_IMAGE = "ghcr.io/akapi895/raptix-langgraph:stable";
async function startRuntime(graphAccess) {
  const sandboxPort = await freePort();
  const runtimePort = await freePort();
  const id = randomUUID().slice(0, 8);
  runtimeNetwork = `raptix-stack-${id}-net`;
  command("docker", ["network", "create", "--label", "raptix.verification=stack", runtimeNetwork]);
  const sandbox = `raptix-stack-${id}-sandbox`;
  runtimeContainers.push(sandbox);
  command("docker", ["run", "-d", "--name", sandbox, "--label", "raptix.verification=stack", "--network", runtimeNetwork, "-p", `127.0.0.1:${sandboxPort}:9999`, SANDBOX_IMAGE]);
  const runtime = `raptix-stack-${id}-runtime`;
  runtimeContainers.push(runtime);
  const graphEnv = graphAccess ? ["-e", `RAPTIX_NEO4J_URI=bolt://host.docker.internal:${graphAccess.boltPort}`, "-e", "RAPTIX_NEO4J_USER=neo4j", "-e", `RAPTIX_NEO4J_PASSWORD=${graphAccess.password}`] : [];
  command("docker", ["run", "-d", "--name", runtime, "--label", "raptix.verification=stack", "--network", runtimeNetwork, "--add-host", "host.docker.internal:host-gateway", "-p", `127.0.0.1:${runtimePort}:2024`,
    "-e", `SANDBOX_URL=http://${sandbox}:9999`, "-e", "RAPTIX_HITL__ENABLED=1", "-e", "RAPTIX_HITL__REQUIRE_BASH_APPROVAL=1", "-e", "RAPTIX_USE_SKILLOGY=0", "-e", "RAPTIX_TRANSCRIPT_SIDECAR_PATH=/app/.langgraph_api/transcripts.sqlite", ...graphEnv,
    RUNTIME_IMAGE, "langgraph", "dev", "--host", "0.0.0.0", "--port", "2024", "--no-browser", "--no-reload", "--n-jobs-per-worker", "10", "--allow-blocking"]);
  await ready(`http://127.0.0.1:${runtimePort}/ok`, "agent runtime", 240);
  log(`agent runtime ${runtime} on 127.0.0.1:${runtimePort}, sandbox ${sandbox} on 127.0.0.1:${sandboxPort}`);
  return { LANGGRAPH_API_URL: `http://127.0.0.1:${runtimePort}`, RAPTIX_RUNTIME_WORKSPACE_ROOT: "/workspace", RAPTIX_RUNTIME_SANDBOX_URL: `http://127.0.0.1:${sandboxPort}` };
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
    graphAccess = { httpPort: graphHttpPort, boltPort: graphBoltPort, password: graphPassword };
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
    // The database container of this run, so a flow can read persisted rows with psql. Only this run's container.
    RAPTIX_VERIFY_DB_CONTAINER: container,
  };
  // ADR-0100: one person runs this stack and decides their own items. Off unless --single-operator is passed, because the
  // four-eyes suites expect the rule to hold.
  if (process.argv.includes('--single-operator')) env.RAPTIX_WEB_SINGLE_OPERATOR = '1';
  mkdirSync(env.WORKSPACE_PATH, { recursive: true });
  for (const key of Object.keys(env)) if (/^(LANGGRAPH_|NEO4J_|SLIVER_|RAPTIX_RUNTIME_|RAPTIX_ENVIRONMENT_)/.test(key)) delete env[key];
  if (graphAccess) Object.assign(env, { NEO4J_PASSWORD: graphAccess.password, NEO4J_HTTP_PORT: String(graphAccess.httpPort), NEO4J_HTTP_URI: `http://127.0.0.1:${graphAccess.httpPort}` });
  writeFileSync(path.join(out, 'migrations.log'), command(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: path.join(root, 'apps/web/server'), env }));
  if (process.argv.includes('--runtime')) Object.assign(env, await startRuntime(graphAccess));
  start('api', ['--import', 'tsx', 'src/main.ts'], path.join(root, 'apps/web/server'), env);
  await ready(`${api}/api/health`, 'API');
  start('web', [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], web, env);
  await ready(app, 'web');

  const owner = await login(api, 'verifier', adminPassword);
  const fixtures = await seed(api, owner, env.WORKSPACE_PATH);
  const manifest = path.join(out, 'fixtures.real.json');
  writeFileSync(manifest, JSON.stringify({ project: fixtures.project, finding: fixtures.finding, evidence: fixtures.evidence, report: fixtures.report, asset: fixtures.asset, viewer: fixtures.viewer, reviewer: fixtures.reviewer, operator: fixtures.operator, knowledgeGraph: fixtures.knowledgeGraph, playbook: fixtures.playbook, technique: fixtures.technique, proposal: fixtures.proposal }, null, 2));
  log(`fixtures written: ${manifest}`);
  if (process.argv.includes('--hold')) {
    // Manual acceptance: keep the stack running until a stop file appears. Credentials go only to --hold-dir, which must be
    // outside the repository, and the file is written for the owner of this run; nothing is printed here.
    const holdDir = arg('--hold-dir', null);
    if (holdDir === null) throw new Error('--hold needs --hold-dir, a folder outside the repository');
    assertOutsideRepo(holdDir, '--hold-dir');
    mkdirSync(holdDir, { recursive: true });
    const stopFile = path.join(holdDir, 'STOP');
    const holdFile = path.join(holdDir, 'hold.json');
    writeFileSync(holdFile, JSON.stringify({ app, api, db: container, owner: 'verifier', adminPassword, viewer: fixtures.viewer, reviewer: fixtures.reviewer, operator: fixtures.operator, fixtures: manifest, out, startedAt: new Date().toISOString() }, null, 1));
    log(`holding stack; the connection file is ${holdFile}; create ${stopFile} to stop`);
    const deadline = Date.now() + 12 * 60 * 60 * 1000;
    while (!existsSync(stopFile) && Date.now() < deadline) await pause(2000);
    throw new HoldComplete();
  }
  const statuses = [];
  if (process.argv.includes('--prelab-only')) {
    statuses.push(runFlow({ ...env, RAPTIX_VERIFY_APP: app, RAPTIX_VERIFY_USER: 'verifier', RAPTIX_VERIFY_PASSWORD: adminPassword, RAPTIX_VERIFY_REVIEWER: 'reviewer', RAPTIX_VERIFY_REVIEWER_PASSWORD: fixtures.reviewer.password }, manifest, 'prelab.mjs', 'flows-prelab'));
  }
  const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  if (process.argv.includes('--smoke-only') && modes.split(',').includes('real')) {
    // Route smoke against the real API only: the targeted check for a change to rendered real routes.
    statuses.push(await runSmoke({ ...env, RAPTIX_VERIFY_APP: app, RAPTIX_VERIFY_USER: 'verifier', RAPTIX_VERIFY_PASSWORD: adminPassword }, manifest, 'smoke-real'));
  } else if (!process.argv.includes('--prelab-only') && modes.split(',').includes('real')) {
    statuses.push(await runSmoke({ ...env, RAPTIX_VERIFY_APP: app, RAPTIX_VERIFY_USER: 'verifier', RAPTIX_VERIFY_PASSWORD: adminPassword }, manifest, 'smoke-real'));
    statuses.push(runClick({ ...env, RAPTIX_VERIFY_APP: app, RAPTIX_VERIFY_USER: 'verifier', RAPTIX_VERIFY_PASSWORD: adminPassword, RAPTIX_VERIFY_REVIEWER: 'reviewer', RAPTIX_VERIFY_REVIEWER_PASSWORD: fixtures.reviewer.password }, manifest, 'real', app));
    statuses.push(runReportsClick({ ...env, RAPTIX_VERIFY_APP: app, RAPTIX_VERIFY_USER: 'verifier', RAPTIX_VERIFY_PASSWORD: adminPassword, RAPTIX_VERIFY_REVIEWER: 'reviewer', RAPTIX_VERIFY_REVIEWER_PASSWORD: fixtures.reviewer.password }, manifest, 'real', app));
    statuses.push(runSettingsClick({ ...env, RAPTIX_VERIFY_APP: app, RAPTIX_VERIFY_USER: 'verifier', RAPTIX_VERIFY_PASSWORD: adminPassword }, manifest, 'real', app));
    statuses.push(runProjectsClick({ ...env, RAPTIX_VERIFY_APP: app, RAPTIX_VERIFY_USER: 'verifier', RAPTIX_VERIFY_PASSWORD: adminPassword }, manifest, 'real', app));
    statuses.push(runWorkspaceClick({ ...env, RAPTIX_VERIFY_APP: app, RAPTIX_VERIFY_USER: 'verifier', RAPTIX_VERIFY_PASSWORD: adminPassword }, manifest, app));
    statuses.push(runLayoutCheck({ ...env, RAPTIX_VERIFY_APP: app, RAPTIX_VERIFY_USER: 'verifier', RAPTIX_VERIFY_PASSWORD: adminPassword }, manifest, app));
    statuses.push(runAnalysisClick({ ...env, RAPTIX_VERIFY_APP: app, RAPTIX_VERIFY_USER: 'verifier', RAPTIX_VERIFY_PASSWORD: adminPassword }, manifest, 'real', app));
    statuses.push(runGateClick({ ...env, RAPTIX_VERIFY_APP: app, RAPTIX_VERIFY_USER: 'verifier', RAPTIX_VERIFY_PASSWORD: adminPassword }, manifest));
    statuses.push(runFlows({ ...env, RAPTIX_VERIFY_APP: app, RAPTIX_VERIFY_USER: 'verifier', RAPTIX_VERIFY_PASSWORD: adminPassword, RAPTIX_VERIFY_REVIEWER: 'reviewer', RAPTIX_VERIFY_REVIEWER_PASSWORD: fixtures.reviewer.password }, manifest));
  }
  status = statuses.every((code) => code === 0) ? 0 : 1;
} catch (error) {
  if (error instanceof HoldComplete) {
    status = 0;
  } else {
    console.error(`[stack] ${error.message}`);
    status = 1;
  }
} finally {
  stopChildren();
  removeContainer();
  if (graphContainer) spawnSync('docker', ['rm', '-f', '-v', graphContainer], { timeout: 5000, encoding: 'utf8' });
  for (const name of runtimeContainers.reverse()) spawnSync('docker', ['rm', '-f', '-v', name], { timeout: 5000, encoding: 'utf8' });
  if (runtimeNetwork) spawnSync('docker', ['network', 'rm', runtimeNetwork], { timeout: 5000, encoding: 'utf8' });
  log(`output: ${out}`);
}
process.exitCode = status;
