/** Isolated PostgreSQL/API/browser check of reproduction bytes and the moved Evidence Inspector. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const output = mkdtempSync(path.join(tmpdir(), 'raptix-findings-final-'));
const workspace = path.join(output, 'workspace');
mkdirSync(workspace);
const apiPort = Number(process.env.FINDINGS_VERIFY_API_PORT ?? 5290);
const webPort = Number(process.env.FINDINGS_VERIFY_WEB_PORT ?? 5293);
const dbPort = Number(process.env.FINDINGS_VERIFY_DB_PORT ?? 55444);
const api = `http://127.0.0.1:${apiPort}`;
const web = `http://127.0.0.1:${webPort}`;
const container = `raptix-findings-final-${randomUUID().slice(0, 8)}`;
const password = randomUUID();
const results = [];
const children = [];
let ownsContainer = false;
let browser;
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', timeout: 120000, ...options });
  if (result.status !== 0) throw new Error(`${executable} ${args[0]} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}

function start(name, script, args, cwd, env) {
  const log = openSync(path.join(output, `${name}.log`), 'w');
  const child = spawn(process.execPath, [script, ...args], { cwd, env, stdio: ['ignore', log, log], windowsHide: true });
  children.push({ name, child });
  console.log(`Started ${name}: PID ${child.pid}, cwd=${cwd}`);
  return child;
}

async function freePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

async function ready(url) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; }
    catch { /* A server that is still starting has no response yet. */ }
    const ended = children.find(({ child }) => child.exitCode !== null);
    if (ended) throw new Error(`${ended.name} exited; inspect ${output}`);
    await pause(500);
  }
  throw new Error(`Server did not become ready: ${url}`);
}

function check(name, condition) {
  assert.ok(condition, name);
  results.push(name);
  console.log(`PASS ${name}`);
}

async function login(username, secret) {
  const response = await fetch(`${api}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: secret }) });
  assert.equal(response.status, 200);
  return { cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '), csrf: (await response.json()).csrfToken };
}

async function request(session, method, endpoint, body) {
  const response = await fetch(api + endpoint, { method, headers: { cookie: session.cookie, 'x-csrf-token': session.csrf, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  assert.ok([200, 201].includes(response.status), `${method} ${endpoint}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}

try {
  await Promise.all([apiPort, webPort, dbPort].map(freePort));
  command('docker', ['run', '-d', '--name', container, '--label', 'raptix.verification=findings-final', '--tmpfs', '/var/lib/postgresql/data', '-p', `127.0.0.1:${dbPort}:5432`, '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=verify', 'postgres:17']);
  ownsContainer = true;
  let databaseReady = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const probe = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres'], { timeout: 2000, stdio: 'ignore' });
    if (probe.status === 0) { databaseReady = true; break; }
    await pause(500);
  }
  assert.ok(databaseReady, 'Isolated database starts');
  const env = { ...process.env, DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${dbPort}/verify`, WORKSPACE_PATH: workspace, PORT: String(apiPort), HOST: '127.0.0.1', RAPTIX_WEB_AUTH_MODE: 'multi', RAPTIX_WEB_ADMIN_USERNAME: 'verifier', RAPTIX_WEB_ADMIN_PASSWORD: password, RAPTIX_WEB_BACKEND_URL: api, RAPTIX_WEB_SECURE_COOKIES: '0' };
  for (const key of Object.keys(env)) if (/^(LANGGRAPH_|NEO4J_|SLIVER_|RAPTIX_RUNTIME_|RAPTIX_ENVIRONMENT_)/.test(key)) delete env[key];
  const migration = command(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: path.join(root, 'apps/web/server'), env });
  writeFileSync(path.join(output, 'migrations.log'), migration);
  start('api', '--import', ['tsx', 'src/main.ts'], path.join(root, 'apps/web/server'), env);
  await ready(`${api}/api/health`);
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  start('web', vite, ['--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], path.join(root, 'apps/web'), env);
  await ready(web);

  const owner = await login('verifier', password);
  const project = await request(owner, 'POST', '/api/engagements', { name: 'findings-final-check', displayName: 'Findings final verification', targetType: 'web_url', targetValue: 'https://verification.invalid', authorizationConfirmed: true, brief: 'Isolated UI verification only. No target scanning, model calls or offensive execution. All captures are generated fixture bytes.' });
  const prefix = `/api/engagements/${project.id}`;
  const bytes = Buffer.from('\ufeffprint("retained fixture")\r\n', 'utf8');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const capture = await request(owner, 'POST', `${prefix}/artifacts/captures`, { requestId: randomUUID(), filename: 'reproduction-bom.txt', mediaType: 'text/plain', base64: bytes.toString('base64') });
  const standard = await request(owner, 'PATCH', `${prefix}/artifacts/captures/${capture.id}/classification`, { classification: 'standard', expectedVersion: 1, reason: 'Generated verification fixture.' });
  const finding = await request(owner, 'POST', `${prefix}/curated-findings`, { title: 'Finding reproduction fixture', severity: 'medium', detail: 'Generated fixture for testing retained reproduction exports.', reproduction: { prerequisites: 'Generated fixture only', inputs: 'No target', steps: ['Read the retained fixture'], expectedObservation: 'Exact original bytes', limitations: 'No exploitation attempted', artifact: { captureId: capture.id, digest } } });
  await request(owner, 'POST', `${prefix}/members`, { username: 'viewer', displayName: 'Verification Viewer', password, role: 'viewer' });

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const signIn = async (name) => {
    await page.goto(`${web}/?dataMode=real#/projects`);
    await page.locator('#login-username').fill(name);
    await page.locator('#login-password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByText('Findings final verification').first().waitFor();
  };
  await signIn('verifier');
  await page.goto(`${web}/?dataMode=real#/finding/${finding.id}?engagement=${project.id}&tab=reproduce`);
  await page.getByRole('button', { name: 'Download original', exact: true }).waitFor();
  check('Reproduce is reachable through the Findings feature route', await page.getByText('Not verified', { exact: true }).isVisible());
  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download original', exact: true }).click();
  const downloaded = await downloadWait;
  const file = path.join(output, 'downloaded-bom.txt');
  await downloaded.saveAs(file);
  check('BOM and CRLF download are byte-exact', readFileSync(file).equals(bytes));
  await page.getByRole('button', { name: 'Copy text', exact: true }).click();
  await page.getByText('Copied the verified text.').waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check('Copy preserves BOM and text (clipboard line endings normalized)', copied.replace(/\r\n/g, '\n') === bytes.toString('utf8').replace(/\r\n/g, '\n'));
  await page.screenshot({ path: path.join(output, 'reproduce.png') });

  await page.goto(`${web}/?dataMode=real#/evidence/${capture.id}?engagement=${project.id}`);
  await page.getByRole('button', { name: 'View Original', exact: true }).waitFor();
  check('Evidence Inspector is reachable through the feature route', await page.getByText('reproduction-bom.txt', { exact: true }).first().isVisible());
  await page.getByRole('button', { name: 'View Original', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'View original', exact: true }).click();
  await page.getByText(/Capture integrity verified/).first().waitFor();
  check('Evidence Inspector reads and verifies the retained capture', await page.getByText('print("retained fixture")', { exact: false }).first().isVisible());
  await page.screenshot({ path: path.join(output, 'inspector.png') });

  await context.clearCookies();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await signIn('viewer');
  await page.goto(`${web}/?dataMode=real#/evidence/${capture.id}?engagement=${project.id}`);
  await page.getByRole('button', { name: 'View Original', exact: true }).waitFor();
  check('Viewer cannot open or download original evidence', await page.getByRole('button', { name: 'View Original', exact: true }).isDisabled() && await page.getByRole('button', { name: 'Download original', exact: true }).isDisabled());
  await request(owner, 'PATCH', `${prefix}/artifacts/captures/${capture.id}/classification`, { classification: 'sensitive', expectedVersion: standard.classificationVersion, reason: 'Verify the current classification projection.' });
  await page.reload();
  await page.getByRole('heading', { name: new RegExp(capture.id) }).waitFor();
  check('Sensitive capture filename is masked in the Inspector', await page.getByText('reproduction-bom.txt', { exact: true }).count() === 0);

  await context.clearCookies();
  await page.goto(`${web}/?dataMode=mock#/projects`);
  const persona = page.getByRole('button', { name: /Alex Morgan/ });
  await persona.click();
  await persona.waitFor({ state: 'detached' });
  await page.goto(`${web}/?dataMode=mock#/evidence/EV-014-02?engagement=RT-2026-014`);
  await page.getByRole('button', { name: 'View Original', exact: true }).waitFor();
  await page.getByRole('button', { name: 'View Original', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'View original', exact: true }).click();
  await page.getByText(/viewed original content/).first().waitFor();
  check('Mock Inspector uses the scoped audit facade and reveals its simulated view', await page.getByRole('button', { name: 'Mask content', exact: true }).isVisible());
  check('No uncaught browser errors', errors.length === 0);
  writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(`${results.length}/${results.length} checks passed. Evidence: ${output}`);
} finally {
  if (browser) await browser.close();
  for (const { name, child } of children.reverse()) {
    if (child.exitCode !== null) continue;
    if (process.platform === 'win32') {
      const stopped = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 4000, encoding: 'utf8' });
      console.log(`${name} PID ${child.pid}: ${stopped.status === 0 ? 'stopped' : 'cleanup not confirmed'}`);
    } else child.kill('SIGTERM');
  }
  if (ownsContainer) {
    try { command('docker', ['rm', '-f', '-v', container], { timeout: 4000 }); }
    catch { console.error(`Cleanup not confirmed for this verification container: ${container}`); }
  }
  console.log(`Verification output: ${output}`);
}
