// Operations click-through against the running mock app. The operations list shows the project's operations; a row opens its detail
// with the operation's own name; the same operation opened under another project is refused with the reason and shows no detail.
// Each step checks what the screen shows; a step that cannot run is recorded as failed and the rest run.
// Usage: node tools/verify/flows/operations-click.mjs --mode mock --app <url> --fixtures <manifest.json> --out <result.json>
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const mode = arg('--mode');
const app = arg('--app');
const outFile = arg('--out');
// Mock mode reads the mock seed; the real fixtures manifest the gate also passes has no mock ids.
const project = 'RT-2026-014';
const operation = 'OP-014';
const otherProject = 'RT-2026-015';
const results = [];

if (mode !== 'mock') {
  console.error('operations-click runs in mock mode only; real operations need a runtime the verification stack does not start.');
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

  await step('the operations list shows the project operations', page, async () => {
    await route(page, `operations?engagement=${encodeURIComponent(project)}`);
    const heading = await page.getByRole('heading', { name: 'Operations' }).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    const row = await page.getByText(operation, { exact: true }).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    return { ok: heading && row, detail: `${heading ? 'heading shown' : 'no heading'}; ${row ? `${operation} listed` : `${operation} not listed`}` };
  });

  await step('a row opens the operation detail with its own name', page, async () => {
    await page.getByText(operation, { exact: true }).first().click();
    const name = await page.getByText('Internal environment discovery').first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    const id = await page.getByText(operation, { exact: true }).first().isVisible().catch(() => false);
    return { ok: name && id, detail: `${name ? 'operation name shown' : 'no operation name'}; ${id ? 'operation id shown' : 'no operation id'}` };
  });

  await step('the same operation under another project is refused with the reason and no detail', page, async () => {
    await route(page, `operation/${operation}?tab=overview&engagement=${encodeURIComponent(otherProject)}`);
    const refused = await page.getByText('Operation belongs to a different project').first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    const detail = await page.getByText('Internal environment discovery').count();
    return { ok: refused && detail === 0, detail: `${refused ? 'refusal with the reason shown' : 'no refusal'}; ${detail === 0 ? 'no operation detail shown' : 'operation detail shown'}` };
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
if (fatal) console.log(`OPERATIONS CLICK-THROUGH STOPPED: ${fatal}`);
console.log(`operations click-through (${mode}): ${results.length - mismatches} of ${results.length} steps matched`);
process.exitCode = mismatches > 0 || fatal ? 1 : 0;
