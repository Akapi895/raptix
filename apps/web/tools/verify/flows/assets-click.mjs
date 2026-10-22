// Assets click-through against the running app: a manager adds an asset through the form, reads it back in the list, and requests a
// scope approval; a role without editScope finds the request control locked with its reason. Each step checks what the screen shows
// after the action. A step that fails records what the page showed at that moment, so a failure can be read without a rerun. A step that
// cannot run is recorded as failed and the next steps still run. Runs in one mode per invocation.
// Usage: node tools/verify/flows/assets-click.mjs --mode mock|real --app <url> --fixtures <manifest.json> --out <result.json>
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
const assetName = `click-host-${stamp}`;
const assetIdent = `${assetName}.verify.example.test`;
const LOCKED_REASON = 'Only Red Team Managers and Admins can request scope approval.';
const results = [];

// What the main region and the open dialogs show, kept with a failed step.
async function shown(page) {
  const main = (await page.locator('main').first().innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ');
  const dialogs = await page.getByRole('dialog').count().catch(() => 0);
  return `main: "${main.slice(0, 400)}" | dialogs: ${dialogs}`;
}

// A step passes when its check holds. A step that throws or fails records the page at that moment.
async function step(name, page, run) {
  try {
    const verdict = await run();
    results.push({ step: name, matches: verdict.ok, detail: verdict.ok ? verdict.detail : `${verdict.detail} :: ${await shown(page)}` });
  } catch (error) {
    results.push({ step: name, matches: false, detail: `could not run: ${error.message.split('\n')[0]} :: ${await shown(page)}` });
  }
}

// The request control reads its state from the loaded scope; wait for it to be enabled instead of reading it during the first paint.
async function waitForRequestControl(page) {
  await page.waitForFunction(() => {
    const control = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Request Scope Approval');
    return Boolean(control) && !control.disabled;
  }, null, { timeout: 30000 });
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
const mainText = async (page) => (await page.locator('main').first().innerText({ timeout: 10000 })).replace(/\s+/g, ' ');

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
let fatal = null;
try {
  const managerContext = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  const manager = await managerContext.newPage();
  manager.setDefaultTimeout(30000);
  if (mode === 'mock') await signInMock(manager, 'Alex Morgan');
  else await signInReal(manager, process.env.RAPTIX_VERIFY_USER, process.env.RAPTIX_VERIFY_PASSWORD);

  await step('add asset through the form shows the saved banner', manager, async () => {
    await route(manager, `asset-new?engagement=${encodeURIComponent(project)}`);
    await manager.getByRole('heading', { name: 'Add Asset' }).first().waitFor({ timeout: 30000 });
    await manager.getByLabel('Asset name').fill(assetName);
    await manager.getByLabel('Hostname').fill(assetIdent);
    await manager.getByLabel('Owner').fill('Ops Team');
    await manager.getByRole('button', { name: 'Save as Pending Review' }).click();
    // A project with an approved ROE reports the add as a scope change (Pending Approval); the others as Pending Review.
    const banner = await manager.getByText(/(saved as Pending Review|added as Pending Approval)/).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
    return { ok: banner, detail: banner ? 'banner shown' : 'no saved banner after Save' };
  });

  await step('the added asset is listed with its identifier', manager, async () => {
    await route(manager, `assets?engagement=${encodeURIComponent(project)}`);
    // The list shows ten rows a page; the search narrows it to the asset this run added.
    await manager.getByPlaceholder(/^Search/).first().fill(assetName);
    await manager.getByText(assetIdent).first().waitFor({ timeout: 20000 }).catch(() => {});
    const listed = (await mainText(manager)).includes(assetIdent);
    return { ok: listed, detail: listed ? `${assetIdent} in the list` : 'identifier not in the list' };
  });

  await step('the request control is enabled for the manager with a pending asset', manager, async () => {
    await route(manager, `asset-scope?engagement=${encodeURIComponent(project)}`);
    await waitForRequestControl(manager);
    return { ok: true, detail: 'enabled once the scope loaded' };
  });

  if (mode === 'mock') {
    await step('the mock request reports the existing pending scope request instead of success', manager, async () => {
      await manager.getByRole('button', { name: 'Request Scope Approval' }).click();
      await manager.getByText('Request scope approval?').first().waitFor({ timeout: 15000 });
      await manager.locator('textarea').last().fill(`Bring ${assetName} into scope`);
      await manager.getByRole('button', { name: 'Submit request' }).click();
      // Adding an asset under this fixture's approved ROE already creates the pending scope request.
      const expected = `${project} already has a pending “Scope change” request. Wait for its decision or withdraw it first.`;
      const toast = manager.locator('div[aria-atomic="true"][aria-live="polite"]').first();
      await manager.waitForFunction((message) => [...document.querySelectorAll('[aria-atomic="true"][aria-live="polite"]')].some((node) => node.textContent?.includes(message)), expected, { timeout: 15000 });
      const text = await toast.innerText({ timeout: 15000 }).catch(() => '');
      return { ok: text.includes(expected) && !text.includes('Scope approval requested.'), detail: `toast "${text.replace(/\s+/g, ' ')}"` };
    });
  } else {
    await step('the real request is redirected to the Scope revisions panel, with no dialog', manager, async () => {
      await manager.getByRole('button', { name: 'Request Scope Approval' }).click();
      const redirected = await manager.getByText('Scope change requests are raised from the Scope revisions panel in real mode.').first().waitFor({ timeout: 15000 }).then(() => true, () => false);
      const dialogs = await manager.getByText('Request scope approval?').count();
      return { ok: redirected && dialogs === 0, detail: redirected ? `redirect message shown, ${dialogs} dialogs` : 'no redirect message' };
    });
  }
  await managerContext.close();

  const refusalContext = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  const refusal = await refusalContext.newPage();
  refusal.setDefaultTimeout(30000);
  await step('a role without editScope finds the request control disabled, with its reason on the screen', refusal, async () => {
    if (mode === 'mock') await signInMock(refusal, 'Riley Brooks');
    else await signInReal(refusal, process.env.RAPTIX_VERIFY_REVIEWER, process.env.RAPTIX_VERIFY_REVIEWER_PASSWORD);
    await route(refusal, `asset-scope?engagement=${encodeURIComponent(project)}`);
    const control = refusal.getByRole('button', { name: 'Request Scope Approval' });
    await control.waitFor({ timeout: 30000 });
    await refusal.getByRole('heading', { name: 'Scope Map & Review' }).first().waitFor({ timeout: 30000 });
    const disabled = await control.isDisabled();
    const shown = (await mainText(refusal)).includes(LOCKED_REASON);
    return { ok: disabled && shown, detail: `${disabled ? 'disabled' : 'enabled'}; reason ${shown ? 'shown' : 'not shown'}` };
  });
  await refusalContext.close();
} catch (error) {
  fatal = error.message.split('\n')[0];
} finally {
  await browser.close();
}
const mismatches = results.filter((row) => !row.matches).length;
if (outFile) writeFileSync(outFile, JSON.stringify({ mode, app, generatedAt: new Date().toISOString(), steps: results, fatal, mismatches }, null, 2));
for (const row of results) console.log(`${row.matches ? 'PASS' : 'FAIL'} ${row.step} :: ${row.detail}`);
if (fatal) console.log(`CLICK-THROUGH STOPPED: ${fatal}`);
console.log(`assets click-through (${mode}): ${results.length - mismatches} of ${results.length} steps matched`);
process.exitCode = mismatches > 0 || fatal ? 1 : 0;
