// Runtime-gated surfaces click-through (real mode). The verification stack runs no agent runtime, no assistant runtime and no C2 server, so
// the operations, fleet, AI workspace and C2 surfaces cannot execute. This flow checks that each surface states its gate explicitly with the
// server's reason, and shows no substitute data. Execution, submit, pause, resume, cancel, conversation send/stream and C2 command dispatch
// are NOT verified here and are reported as config-gated. Each step checks the screen; a step that cannot run is recorded as failed.
// Usage: node tools/verify/flows/runtime-gate-click.mjs --app <url> --fixtures <manifest.json> --out <result.json>
// Env: RAPTIX_VERIFY_USER and RAPTIX_VERIFY_PASSWORD (an admin).
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const app = arg('--app');
const fixtures = JSON.parse(readFileSync(arg('--fixtures'), 'utf8'));
const outFile = arg('--out');
const results = [];

// The gate texts each surface shows when its runtime is absent, as the verification stack observed them.
const SURFACES = [
  { name: 'operations list shows its execution threads section', route: `operations?engagement=${encodeURIComponent(fixtures.project)}`, need: ['Execution threads'] },
  { name: 'fleet states that its runtime is not available, with the server reason', route: `agents?engagement=${encodeURIComponent(fixtures.project)}`, need: ['Fleet data is unavailable', 'Runtime operations are not available on this server'] },
  { name: 'AI workspace states that the assistant runtime is not available', route: `ai-operator?engagement=${encodeURIComponent(fixtures.project)}`, need: ['Assistant runtime is not available on this server'] },
  { name: 'AI trace states the threads source is unavailable and shows no substitute trace', route: `ai-trace?engagement=${encodeURIComponent(fixtures.project)}`, need: ['Threads source unavailable', 'No substitute trace is shown'] },
  { name: 'C2 lists its session grants and states that dispatch needs a live grant', route: `c2?engagement=${encodeURIComponent(fixtures.project)}`, need: ['C2 session grants', 'Command dispatch requires a live approved grant'] },
];

async function signInReal(page, username, password) {
  await page.goto(`${app}/?dataMode=real#/projects`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.locator('#login-username').waitFor({ timeout: 60000 });
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('#login-username').waitFor({ state: 'detached', timeout: 30000 });
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
let fatal = null;
try {
  const context = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await signInReal(page, process.env.RAPTIX_VERIFY_USER, process.env.RAPTIX_VERIFY_PASSWORD);
  for (const surface of SURFACES) {
    try {
      await page.goto(`${app}/?dataMode=real#/${surface.route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      // A gate can render after the network is idle: wait for each stated gate text, up to a bound, before reading the screen.
      for (const needle of surface.need) await page.getByText(needle, { exact: false }).first().waitFor({ timeout: 20000 }).catch(() => {});
      const text = (await page.locator('main').first().innerText({ timeout: 10000 })).replace(/\s+/g, ' ');
      const missing = surface.need.filter((needle) => !text.includes(needle));
      results.push({ step: surface.name, matches: missing.length === 0, detail: missing.length === 0 ? `shows ${surface.need.join(' / ')}` : `missing: ${missing.join(' / ')} :: main "${text.slice(0, 200)}"` });
    } catch (error) {
      results.push({ step: surface.name, matches: false, detail: `could not run: ${error.message.split('\n')[0]}` });
    }
  }
  await context.close();
} catch (error) {
  fatal = error.message.split('\n')[0];
} finally {
  await browser.close();
}
const mismatches = results.filter((row) => !row.matches).length;
const notVerified = ['execute / submit / pause / resume / cancel of operations', 'AI conversation send and stream', 'C2 command dispatch and session console', 'agent detail and branches'];
if (outFile) writeFileSync(outFile, JSON.stringify({ app, generatedAt: new Date().toISOString(), steps: results, fatal, mismatches, notVerified }, null, 2));
for (const row of results) console.log(`${row.matches ? 'PASS' : 'FAIL'} ${row.step} :: ${row.detail}`);
for (const item of notVerified) console.log(`NOT VERIFIED (config-gated: no runtime or C2 server in the stack): ${item}`);
if (fatal) console.log(`RUNTIME GATE CLICK-THROUGH STOPPED: ${fatal}`);
console.log(`runtime gate click-through (real): ${results.length - mismatches} of ${results.length} surfaces state their gate`);
process.exitCode = mismatches > 0 || fatal ? 1 : 0;
