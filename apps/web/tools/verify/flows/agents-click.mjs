// Agents click-through against the running mock app. The project's agents list shows the agent assigned to the fixture operation; its
// detail opens with the agent's own id; the same agent opened under another project is refused with the reason and shows no detail.
// Each step checks what the screen shows; a step that cannot run is recorded as failed and the rest run.
// Usage: node tools/verify/flows/agents-click.mjs --mode mock --app <url> --fixtures <manifest.json> --out <result.json>
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
const project = fixtures.project;
const agent = fixtures.agent;
const otherProject = 'RT-2026-015';
const results = [];

if (mode !== 'mock') {
  console.error('agents-click runs in mock mode only; the real fleet needs runtime and host connectivity the verification stack does not start.');
  process.exit(2);
}

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

const route = (page, hash) => page.goto(`${app}/?dataMode=${mode}#/${hash}`, { waitUntil: 'domcontentloaded' });

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
let fatal = null;
try {
  const context = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await signInMock(page, 'Dana Whitfield');

  await step('the project agents list shows the agent assigned to the project', page, async () => {
    await route(page, `agents?engagement=${encodeURIComponent(project)}`);
    const heading = await page.getByRole('heading', { name: 'Agents' }).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    const row = await page.getByText(agent, { exact: true }).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    return { ok: heading && row, detail: `${heading ? 'heading shown' : 'no heading'}; ${row ? `${agent} listed` : `${agent} not listed`}` };
  });

  await step('the agent opens its detail under its own id', page, async () => {
    await page.getByText(agent, { exact: true }).first().click();
    const opened = page.url().includes(`#/agent/${agent}`);
    const content = await page.getByText('Connection vs assignment').first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    return { ok: opened && content, detail: `${opened ? 'route opened' : 'route not opened'}; ${content ? 'detail content shown' : 'no detail content'}` };
  });

  await step('the same agent under another project is refused with the reason and no detail', page, async () => {
    await route(page, `agent/${agent}?engagement=${encodeURIComponent(otherProject)}`);
    const refused = await page.getByText('Agent belongs to a different project').first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    const detail = await page.getByText('Connection vs assignment').count();
    return { ok: refused && detail === 0, detail: `${refused ? 'refusal with the reason shown' : 'no refusal'}; ${detail === 0 ? 'no agent detail shown' : 'agent detail shown'}` };
  });

  await context.close();
} catch (error) {
  fatal = error.message.split('\n')[0];
} finally {
  await browser.close();
}
const mismatches = results.filter((row) => !row.matches).length;
if (outFile) writeFileSync(outFile, JSON.stringify({ mode, app, generatedAt: new Date().toISOString(), steps: results, fatal, mismatches }, null, 2));
for (const row of results) console.log(`${row.matches ? 'PASS' : 'FAIL'} ${row.step} :: ${row.detail}`);
if (fatal) console.log(`AGENTS CLICK-THROUGH STOPPED: ${fatal}`);
console.log(`agents click-through (${mode}): ${results.length - mismatches} of ${results.length} steps matched`);
process.exitCode = mismatches > 0 || fatal ? 1 : 0;
