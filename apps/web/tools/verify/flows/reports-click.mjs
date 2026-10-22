// Reports click-through against the running app. Real mode: an admin creates a stored template through the templates form and sees
// it listed; an admin inserts the effective scope into a report section; a reviewer finds the create control locked with its reason.
// Mock mode: the simulated template gallery, which is loaded apart from the real path, renders its template actions. Each step checks
// what the screen shows after the action; a step that cannot run is recorded as failed and the next steps still run.
// Usage: node tools/verify/flows/reports-click.mjs --mode mock|real --app <url> --fixtures <manifest.json> --out <result.json>
// Env (real): RAPTIX_VERIFY_USER and RAPTIX_VERIFY_PASSWORD (an admin), RAPTIX_VERIFY_REVIEWER and RAPTIX_VERIFY_REVIEWER_PASSWORD.
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
const stamp = Date.now().toString(36);
const templateName = `Click template ${stamp}`;
const LOCKED_REASON = 'Only organization admins and managers can create report templates.';
const results = [];

async function shown(page) {
  const main = (await page.locator('main').first().innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ');
  return `main: "${main.slice(0, 300)}"`;
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
  const adminContext = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  const admin = await adminContext.newPage();
  admin.setDefaultTimeout(30000);
  if (mode === 'mock') await signInMock(admin, 'Dana Whitfield');
  else await signInReal(admin, process.env.RAPTIX_VERIFY_USER, process.env.RAPTIX_VERIFY_PASSWORD);

  await step(mode === 'mock' ? 'the simulated gallery renders its template actions' : 'the stored template list shows the create control enabled for an admin', admin, async () => {
    await route(admin, `reports?engagement=${encodeURIComponent(project)}&tab=templates`);
    if (mode === 'mock') {
      const actions = await admin.getByRole('button', { name: /^(Details|Use template|Try in Draft|Preview Draft)$/ }).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
      return { ok: actions, detail: actions ? 'template actions shown' : 'no template actions' };
    }
    const enabled = await admin.getByRole('button', { name: 'New template' }).isEnabled({ timeout: 20000 });
    return { ok: enabled, detail: enabled ? 'enabled' : 'disabled' };
  });

  if (mode === 'real') {
    await step('an admin creates a stored template through the form and sees it listed', admin, async () => {
      await admin.getByRole('button', { name: 'New template' }).click();
      await admin.getByLabel('Template name').fill(templateName);
      await admin.getByLabel('Sections').fill('Scope and method\nFindings');
      await admin.getByRole('button', { name: 'Create template' }).click();
      const listed = await admin.getByText(templateName).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
      return { ok: listed, detail: listed ? `${templateName} listed` : 'template not listed after create' };
    });

    await step('an admin inserts the effective scope into a report section', admin, async () => {
      await route(admin, `report/${encodeURIComponent(fixtures.report)}?engagement=${encodeURIComponent(project)}`);
      await admin.getByRole('button', { name: 'Insert project info' }).first().waitFor({ timeout: 30000 });
      await admin.getByRole('button', { name: 'Insert project info' }).first().click();
      const inserted = await admin.waitForFunction(() => [...document.querySelectorAll('textarea')].some((area) => area.value.includes('Scope:')), null, { timeout: 15000 }).then(() => true, () => false);
      return { ok: inserted, detail: inserted ? 'the section now contains the Scope line' : 'no Scope line inserted' };
    });
  }
  await adminContext.close();

  if (mode === 'real') {
    const reviewerContext = await browser.newContext({ viewport: { width: 1360, height: 960 } });
    const reviewer = await reviewerContext.newPage();
    reviewer.setDefaultTimeout(30000);
    await step('a reviewer finds the create control locked, with its reason on the screen', reviewer, async () => {
      await signInReal(reviewer, process.env.RAPTIX_VERIFY_REVIEWER, process.env.RAPTIX_VERIFY_REVIEWER_PASSWORD);
      await route(reviewer, `reports?engagement=${encodeURIComponent(project)}&tab=templates`);
      const control = reviewer.getByRole('button', { name: 'New template' });
      await control.waitFor({ timeout: 30000 });
      const disabled = await control.isDisabled();
      const reason = (await reviewer.locator('main').first().innerText()).includes(LOCKED_REASON);
      return { ok: disabled && reason, detail: `${disabled ? 'disabled' : 'enabled'}; reason ${reason ? 'shown' : 'not shown'}` };
    });
    await reviewerContext.close();
  }
} catch (error) {
  fatal = error.message.split('\n')[0];
} finally {
  await browser.close();
}
const mismatches = results.filter((row) => !row.matches).length;
if (outFile) writeFileSync(outFile, JSON.stringify({ mode, app, generatedAt: new Date().toISOString(), steps: results, fatal, mismatches }, null, 2));
for (const row of results) console.log(`${row.matches ? 'PASS' : 'FAIL'} ${row.step} :: ${row.detail}`);
if (fatal) console.log(`REPORTS CLICK-THROUGH STOPPED: ${fatal}`);
console.log(`reports click-through (${mode}): ${results.length - mismatches} of ${results.length} steps matched`);
process.exitCode = mismatches > 0 || fatal ? 1 : 0;
