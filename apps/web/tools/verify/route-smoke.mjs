// Opens every route key of the web console in mock and real mode and reports page errors and render-boundary failures.
// Needs the dev server (default http://127.0.0.1:5273) and, for real mode, the API server (default http://127.0.0.1:5280).
// Real mode signs in through the login form with RAPTIX_VERIFY_USER and RAPTIX_VERIFY_PASSWORD.
// Usage: node tools/verify/route-smoke.mjs [--out <file.json>] [--modes mock,real]
// Optional: RAPTIX_VERIFY_CHROMIUM=<path to a chromium executable> when the bundled browser is not installed.
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const APP = process.env.RAPTIX_VERIFY_APP ?? 'http://127.0.0.1:5273';
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const outFile = arg('--out', null);
const modes = arg('--modes', 'mock,real').split(',');
const onlyRoutes = arg('--routes', null)?.split(',') ?? null;

// The 55 route keys of the route inventory (.scratch/web-improve-refactor/route-inventory-reconciled.md).
const ROUTES = ['login', 'forbidden', 'notfound', 'error', 'offline', 'session-expired', 'states', 'overview', 'command-center', 'tasks',
  'projects', 'project-new', 'project', 'operations', 'operation-new', 'preflight', 'operation-schedule', 'operation', 'infrastructure', 'agents',
  'agent', 'assets', 'asset-new', 'asset-scope', 'asset', 'playbooks', 'playbook', 'technique', 'playbook-review', 'analysis', 'findings',
  'finding-new', 'finding', 'evidence', 'evidence-inspector', 'reports', 'report-new', 'report', 'report-preview', 'report-review', 'settings',
  'ai-operator', 'ai-plan', 'ai-plan-review', 'ai-plan-compare', 'ai-trace', 'ai-history', 'ai-fanout', 'ai-branch', 'c2', 'c2-channel',
  'c2-session', 'c2-console', 'scenarios', 'workspaces'];

const BOUNDARY_TEXT = 'This screen failed to render';

async function signIn(page) {
  const user = process.env.RAPTIX_VERIFY_USER;
  const password = process.env.RAPTIX_VERIFY_PASSWORD;
  if (!user || !password) throw new Error('real mode needs RAPTIX_VERIFY_USER and RAPTIX_VERIFY_PASSWORD');
  await page.goto(`${APP}/?dataMode=real#/projects`, { waitUntil: 'domcontentloaded' });
  await page.locator('#login-username').waitFor({ timeout: 30000 });
  await page.fill('#login-username', user);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(1500);
}

async function runMode(browser, mode) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const results = {};
  let pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  if (mode === 'real') await signIn(page);
  for (const key of ROUTES.filter((k) => !onlyRoutes || onlyRoutes.includes(k))) {
    pageErrors = [];
    await page.goto(`${APP}/?dataMode=${mode}#/${key}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    const body = await page.locator('body').innerText().catch(() => '');
    const heading = await page.locator('h1').first().innerText({ timeout: 1000 }).catch(() => '');
    results[key] = {
      boundary: body.includes(BOUNDARY_TEXT),
      pageErrors: [...pageErrors],
      heading: heading.slice(0, 80),
      detail: body.includes(BOUNDARY_TEXT) ? body.slice(body.indexOf("failed to render"), body.indexOf("failed to render") + 300) : undefined,
    };
  }
  await context.close();
  return results;
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
const report = { app: APP, generatedAt: new Date().toISOString(), modes: {} };
try {
  for (const mode of modes) report.modes[mode] = await runMode(browser, mode);
} finally {
  await browser.close();
}
const failing = [];
for (const [mode, rows] of Object.entries(report.modes)) {
  for (const [key, row] of Object.entries(rows)) if (row.boundary || row.pageErrors.length > 0) failing.push(`${mode}:${key}`);
}
report.failing = failing;
const text = JSON.stringify(report, null, 2);
if (outFile) writeFileSync(outFile, text);
console.log(`route-smoke: ${ROUTES.length} routes x ${modes.length} mode(s); failing: ${failing.length}`);
if (failing.length > 0) console.log('  ' + failing.join(', '));
