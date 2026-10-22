// Analysis click-through against the running app. Real mode: an admin opens the analysis of the project; the observed technique coverage
// shows either its records or an explicit missing-source state, never an inferred value. Then an unknown project is opened; the screen
// refuses it with the reason, and no analysis is shown. Mock mode: the demo analysis screen renders for the project. Each step checks what
// the screen shows; a step that cannot run is recorded as failed and the rest run.
// Usage: node tools/verify/flows/analysis-click.mjs --mode mock|real --app <url> --fixtures <manifest.json> --out <result.json>
// Env (real): RAPTIX_VERIFY_USER and RAPTIX_VERIFY_PASSWORD (an admin).
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const mode = arg('--mode');
const app = arg('--app');
const fixtures = JSON.parse(readFileSync(arg('--fixtures'), 'utf8'));
const outFile = arg('--out');
const project = mode === 'mock' ? 'RT-2026-014' : fixtures.project;
const results = [];

async function shown(page) {
  const main = (await page.locator('main').first().innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ');
  return `main: "${main.slice(0, 260)}"`;
}

async function step(name, page, run) {
  try {
    const verdict = await run();
    results.push({ step: name, matches: verdict.ok, detail: verdict.ok ? verdict.detail : `${verdict.detail} :: ${await shown(page)}` });
  } catch (error) {
    results.push({ step: name, matches: false, detail: `could not run: ${error.message.split('\n')[0]} :: ${await shown(page)}` });
  }
}

async function signInMock(page, persona) {
  await page.goto(`${app}/?dataMode=mock#/login`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const button = page.getByRole('button', { name: new RegExp(`^${persona}`) }).first();
  await button.waitFor({ timeout: 60000 });
  await button.click();
  await page.locator('[aria-label="Quick role picker (demo)"]').waitFor({ state: 'detached', timeout: 30000 });
}

async function signInReal(page, username, password) {
  await page.goto(`${app}/?dataMode=real#/projects`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.locator('#login-username').waitFor({ timeout: 60000 });
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('#login-username').waitFor({ state: 'detached', timeout: 30000 });
}

const route = (page, hash) => page.goto(`${app}/?dataMode=${mode}#/${hash}`, { waitUntil: 'domcontentloaded' });

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
let fatal = null;
try {
  const context = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  if (mode === 'mock') await signInMock(page, 'Dana Whitfield');
  else await signInReal(page, process.env.RAPTIX_VERIFY_USER, process.env.RAPTIX_VERIFY_PASSWORD);

  if (mode === 'mock') {
    await step('the demo analysis renders for the project', page, async () => {
      await route(page, `analysis?engagement=${encodeURIComponent(project)}`);
      const heading = await page.getByRole('heading', { name: 'Attack Analysis' }).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
      return { ok: heading, detail: heading ? 'Attack Analysis shown' : 'no analysis heading' };
    });
  } else {
    await step('the analysis of the project shows its observed coverage or an explicit missing-source state', page, async () => {
      await route(page, `analysis?engagement=${encodeURIComponent(project)}`);
      await page.getByText('Observed technique coverage').first().waitFor({ timeout: 30000 });
      const text = (await page.locator('main').first().innerText()).replace(/\s+/g, ' ');
      const explicitEmpty = text.includes('no technique coverage is inferred') || text.includes('No observed record carries a technique id yet');
      const table = await page.getByRole('table').count();
      const sourced = text.includes('(source:');
      return { ok: sourced && (explicitEmpty || table > 0), detail: `${table > 0 ? 'coverage table shown' : explicitEmpty ? 'explicit missing-source state shown' : 'neither data nor the missing state'}; ${sourced ? 'source named' : 'no source named'}` };
    });

    await step('an unknown project is refused: the analysis is unavailable and nothing is inferred', page, async () => {
      const unknown = '00000000-0000-4000-8000-000000000000';
      await route(page, `analysis?engagement=${encodeURIComponent(unknown)}`);
      const unavailable = await page.getByText('Analysis data is unavailable').first().waitFor({ timeout: 30000 }).then(() => true, () => false);
      const coverage = await page.getByText('Observed technique coverage').count();
      return { ok: unavailable && coverage === 0, detail: `${unavailable ? 'unavailable state with the reason' : 'no unavailable state'}; ${coverage === 0 ? 'no coverage shown' : 'coverage shown'}` };
    });
  }
  await context.close();
} catch (error) {
  fatal = error.message.split('\n')[0];
} finally {
  await browser.close();
}
const mismatches = results.filter((row) => !row.matches).length;
if (outFile) writeFileSync(outFile, JSON.stringify({ mode, app, generatedAt: new Date().toISOString(), steps: results, fatal, mismatches }, null, 2));
for (const row of results) console.log(`${row.matches ? 'PASS' : 'FAIL'} ${row.step} :: ${row.detail}`);
if (fatal) console.log(`ANALYSIS CLICK-THROUGH STOPPED: ${fatal}`);
console.log(`analysis click-through (${mode}): ${results.length - mismatches} of ${results.length} steps matched`);
process.exitCode = mismatches > 0 || fatal ? 1 : 0;
