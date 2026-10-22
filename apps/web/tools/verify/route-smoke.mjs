// Route smoke for the web console. For each mode it signs in (mock: a persona from the demo quick picker; real: the login
// form, then the session endpoint) and opens every route in tools/verify/routes.json. A route passes only when the screen
// it declares is shown: a page heading (the h1 inside main) or a visible text. Errors, render-boundary fallbacks and missing
// expectations always count. Failed API responses are listed as information: shell components request runtime services the stack
// may not run (fleet, threads, C2), and those requests fire unevenly across routes. Failures listed in tools/verify/baseline.json
// are reported but do not fail the run.
// Usage: node tools/verify/route-smoke.mjs [--modes mock,real] [--routes a,b] [--fixtures-mock f.json] [--fixtures-real f.json] [--out result.json] [--discover]
//   --discover: records what each route shows in each mode and exits 0; use it to write expectations, not as a gate.
// Env: RAPTIX_VERIFY_APP (default http://127.0.0.1:5273), RAPTIX_VERIFY_USER and RAPTIX_VERIFY_PASSWORD (real mode),
//      RAPTIX_VERIFY_PERSONA (mock mode, default Dana Whitfield), RAPTIX_VERIFY_CHROMIUM (optional browser executable).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = process.env.RAPTIX_VERIFY_APP ?? 'http://127.0.0.1:5273';
const PERSONA = process.env.RAPTIX_VERIFY_PERSONA ?? 'Dana Whitfield';
const BOUNDARY_TEXT = 'This screen failed to render';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const discover = process.argv.includes('--discover');
const modes = arg('--modes', 'mock,real').split(',');
const only = arg('--routes', null)?.split(',') ?? null;
const outFile = arg('--out', null);

const inventory = JSON.parse(readFileSync(arg('--inventory', path.join(here, 'routes.json')), 'utf8'));
const baseline = JSON.parse(readFileSync(arg('--baseline', path.join(here, 'baseline.json')), 'utf8'));
const realFixtures = arg('--fixtures-real', null);
const fixtures = {
  mock: JSON.parse(readFileSync(arg('--fixtures-mock', path.join(here, 'fixtures.mock.json')), 'utf8')),
  real: realFixtures ? JSON.parse(readFileSync(realFixtures, 'utf8')) : {},
};
const selected = inventory.routes.filter((entry) => !only || only.includes(entry.key));

// Path with fixture placeholders filled from the manifest of this mode. Throws when a fixture is missing.
function resolvePath(entry, mode) {
  return entry.path.replace(/\{(\w+)\}/g, (_match, name) => {
    const id = fixtures[mode]?.[name];
    if (!id) throw new Error(`fixture "${name}" is not seeded for ${mode}`);
    return encodeURIComponent(id);
  });
}

const normalize = (text) => text.replace(/\s+/g, ' ').trim();

async function signIn(page, mode) {
  if (mode === 'mock') {
    await page.goto(`${APP}/?dataMode=mock#/login`, { waitUntil: 'domcontentloaded' });
    const picker = page.getByRole('button', { name: new RegExp(`^${PERSONA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first();
    await picker.waitFor({ timeout: 30000 });
    await picker.click();
    await page.locator('[aria-label="Quick role picker (demo)"]').waitFor({ state: 'detached', timeout: 15000 });
    await page.locator('header').getByText(PERSONA).first().waitFor({ timeout: 15000 });
    return { persona: PERSONA };
  }
  const user = process.env.RAPTIX_VERIFY_USER;
  const password = process.env.RAPTIX_VERIFY_PASSWORD;
  if (!user || !password) throw new Error('real mode needs RAPTIX_VERIFY_USER and RAPTIX_VERIFY_PASSWORD');
  await page.goto(`${APP}/?dataMode=real#/projects`, { waitUntil: 'domcontentloaded' });
  await page.locator('#login-username').waitFor({ timeout: 30000 });
  await page.fill('#login-username', user);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('#login-username').waitFor({ state: 'detached', timeout: 15000 });
  const session = await page.request.get(`${APP}/api/auth/session`);
  if (session.status() !== 200) throw new Error(`session endpoint answered ${session.status()} after sign-in`);
  return { session: 'authenticated' };
}

// What the page shows: the heading of main, the visible text and whether the render boundary caught a crash.
async function observe(page, expect) {
  // The expected heading or text is awaited, so a screen that renders after its first paint is judged on its loaded content.
  if (typeof expect === 'string') {
    await page.locator('main h1').getByText(expect, { exact: true }).first().waitFor({ timeout: 10000 }).catch(() => {});
  } else if (expect && typeof expect.text === 'string') {
    const scope = expect.in === 'body' ? page.locator('body') : page.locator('main').first();
    await scope.getByText(expect.text).first().waitFor({ timeout: 10000 }).catch(() => {});
  }
  await Promise.race([
    page.locator('main h1').first().waitFor({ timeout: 8000 }),
    page.getByText(BOUNDARY_TEXT).first().waitFor({ timeout: 8000 }),
    page.locator('[role="status"]').first().waitFor({ timeout: 8000 }),
  ]).catch(() => {});
  // Requests the screen starts after its first paint (a card, a follow-up read) count too, so the judgement waits for them.
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
  const heading = normalize(await page.locator('main h1').first().innerText({ timeout: 1000 }).catch(() => ''));
  const body = normalize(await page.locator('body').innerText().catch(() => ''));
  const main = normalize(await page.locator('main').first().innerText({ timeout: 1000 }).catch(() => ''));
  return { heading, boundary: body.includes(BOUNDARY_TEXT), body, main };
}

// The verdict for one route in one mode. Every route needs an explicit expectation; nothing passes by default.
function judge(expect, observed, pageErrors) {
  if (pageErrors.length > 0) return { ok: false, category: 'page-error', detail: pageErrors[0] };
  if (observed.boundary) return { ok: false, category: 'render-boundary', detail: observed.body.slice(0, 160) };
  if (expect === undefined) return { ok: false, category: 'no-expectation', detail: 'the route declares no expectation for this mode' };
  if (typeof expect === 'string') {
    return observed.heading === expect
      ? { ok: true }
      : { ok: false, category: 'heading', detail: `expected heading "${expect}", saw "${observed.heading}"` };
  }
  if (typeof expect.text === 'string') {
    const scope = expect.in === 'body' ? observed.body : observed.main;
    return scope.includes(expect.text)
      ? { ok: true }
      : { ok: false, category: 'text-missing', detail: `expected text "${expect.text}" on the page` };
  }
  return { ok: false, category: 'no-expectation', detail: 'expectation has neither heading nor text' };
}

async function runMode(browser, mode) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  let pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 600)); });
  let badResponses = [];
  page.on('response', (response) => { if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url().slice(0, 200)}`); });
  const rows = {};
  let signedIn;
  try {
    // The first load of a cold dev server compiles the modules; allow it before the sign-in steps.
    await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    signedIn = await signIn(page, mode);
  } catch (error) {
    await context.close();
    for (const entry of selected) rows[entry.key] = { status: 'fail', category: 'sign-in', detail: error.message };
    return { signIn: { ok: false, detail: error.message }, rows };
  }
  for (const entry of selected) {
    const expect = entry.expect?.[mode];
    let target;
    try {
      target = `${APP}/?dataMode=${mode}#/${resolvePath(entry, mode)}`;
    } catch (error) {
      rows[entry.key] = { status: 'fail', category: 'fixture-missing', detail: error.message, expected: expect ?? null };
      continue;
    }
    pageErrors = [];
    consoleErrors = [];
    badResponses = [];
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    const observed = await observe(page, expect);
    const verdict = discover ? { ok: true } : judge(expect, observed, pageErrors);
    rows[entry.key] = {
      status: verdict.ok ? 'pass' : 'fail',
      category: verdict.category,
      detail: verdict.detail,
      expected: expect ?? null,
      heading: observed.heading,
      sample: observed.main.slice(0, 1500),
      boundary: observed.boundary,
      pageErrors: [...pageErrors],
      consoleErrors: [...consoleErrors],
      badResponses: [...badResponses],
    };
  }
  await context.close();
  return { signIn: { ok: true, ...signedIn }, rows };
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
const report = { app: APP, generatedAt: new Date().toISOString(), discover, modes: {} };
try {
  for (const mode of modes) report.modes[mode] = await runMode(browser, mode);
} finally {
  await browser.close();
}

// Judge against the baseline: a declared failure is reported, an undeclared one fails the run, a declared one that passes is resolved.
const newFailures = [];
const declared = [];
const resolved = [];
for (const [mode, result] of Object.entries(report.modes)) {
  if (!result.signIn.ok) newFailures.push(`${mode}:sign-in`);
  for (const [key, row] of Object.entries(result.rows)) {
    const id = `${mode}:${key}`;
    if (row.status === 'fail') {
      if (id in baseline) declared.push(id);
      else newFailures.push(`${id} [${row.category}]`);
    } else if (id in baseline) resolved.push(id);
  }
}
report.failing = newFailures;
report.declaredFailures = declared;
report.resolvedBaseline = resolved;

if (outFile) writeFileSync(outFile, JSON.stringify(report, null, 2));
const counts = Object.values(report.modes).map((m) => Object.keys(m.rows).length);
console.log(`route-smoke: ${selected.length} routes x ${modes.length} mode(s); new failures: ${newFailures.length}; declared: ${declared.length}; resolved: ${resolved.length}`);
for (const id of newFailures) console.log(`  FAIL ${id}`);
for (const id of declared) console.log(`  declared ${id} (${baseline[id]})`);
for (const id of resolved) console.log(`  resolved ${id}: remove it from tools/verify/baseline.json`);
const apiNotes = Object.entries(report.modes).flatMap(([mode, result]) => Object.entries(result.rows).filter(([, row]) => row.badResponses?.length).map(([key, row]) => `${mode}:${key} ${row.badResponses[0]}`));
for (const note of apiNotes) console.log(`  api response >= 400 (information, not judged): ${note}`);
if (counts.length === 0) console.log('  no mode ran');
if (!discover && newFailures.length > 0) process.exitCode = 1;
