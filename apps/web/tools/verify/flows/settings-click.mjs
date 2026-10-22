// Organization settings click-through against the running app. Real mode: an admin changes a workspace policy value with a reason, saves it,
// reloads and reads the new value back, then finds the change in the workspace audit. A viewer attempts the same save and the server
// refuses it; the refusal is shown. Mock mode: the organization page renders for an admin, and an analyst finds the user list locked
// with its reason. Each step checks what the screen shows after the action; a step that cannot run is recorded as failed and the rest run.
// Usage: node tools/verify/flows/settings-click.mjs --mode mock|real --app <url> --fixtures <manifest.json> --out <result.json>
// Env (real): RAPTIX_VERIFY_USER and RAPTIX_VERIFY_PASSWORD (an admin); the viewer comes from the fixture manifest.
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
// The reason this run writes with the save; the audit view shows reasons, so the check finds the entry by it.
const AUDIT_REASON = `settings click-through ${Date.now().toString(36)}`;

async function shown(page) {
  const main = (await page.locator('main').first().innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ');
  const status = (await page.locator('[role="status"], [role="alert"]').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').slice(0, 160));
  return `main: "${main.slice(0, 300)}" | status: ${JSON.stringify(status)}`;
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

  if (mode === 'mock') {
    await step('the organization settings page renders for an admin', admin, async () => {
      await route(admin, `settings?engagement=${encodeURIComponent(project)}`);
      const heading = await admin.getByRole('heading', { name: 'Organization Settings' }).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
      return { ok: heading, detail: heading ? 'heading shown' : 'no heading' };
    });
  } else {
    let key = '';
    let before = 0;
    const url = `settings?engagement=${encodeURIComponent(project)}&tab=policies`;
    await step('the policies read shows the workspace values with their versions', admin, async () => {
      await route(admin, url);
      const first = admin.locator('input[id^="value-"]').first();
      await first.waitFor({ timeout: 30000 });
      key = (await first.getAttribute('id')).slice('value-'.length);
      before = Number(await first.inputValue());
      return { ok: Number.isInteger(before), detail: `${key} = ${before}` };
    });

    // Stay inside the setting bounds: the server refuses values outside them, and that refusal would not test the save.
    const next = before > 1 ? before - 1 : before + 1;
    await step('an admin saves a changed policy value with its reason, and sees the save confirmed', admin, async () => {
      await admin.locator(`#value-${CSS(key)}`).fill(String(next));
      await admin.locator(`#reason-${CSS(key)}`).fill(AUDIT_REASON);
      await admin.getByRole('button', { name: /^Save \(version/ }).first().click();
      const saved = await admin.getByText(/saved; the new version applies/).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
      return { ok: saved, detail: saved ? `${key} saved as ${next}` : 'no save confirmation' };
    });

    await step('after a reload the saved value reads back', admin, async () => {
      await admin.reload({ waitUntil: 'domcontentloaded' });
      const value = Number(await admin.locator(`#value-${CSS(key)}`).inputValue({ timeout: 30000 }));
      return { ok: value === next, detail: `reads ${value}, expected ${next}` };
    });

    await step('the workspace audit records the change', admin, async () => {
      await route(admin, `settings?engagement=${encodeURIComponent(project)}&tab=audit`);
      await admin.getByLabel('Search audit entries').fill(AUDIT_REASON);
      await admin.getByText('Workspace audit').first().waitFor({ timeout: 20000 });
      const found = await admin.waitForFunction((k) => {
        const text = document.querySelector('main')?.innerText || '';
        return text.includes(k) && text.includes('workspace.setting_updated') && !text.includes('No audit entries match.');
      }, AUDIT_REASON, { timeout: 15000 }).then(() => true, () => false);
      const text = (await admin.locator('main').first().innerText()).replace(/\s+/g, ' ');
      return { ok: found, detail: found ? `a workspace.setting_updated entry with the reason "${AUDIT_REASON}"` : `no workspace.setting_updated entry with the reason "${AUDIT_REASON}"` };
    });
  }
  await adminContext.close();

  const denialContext = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  const denied = await denialContext.newPage();
  denied.setDefaultTimeout(30000);
  if (mode === 'mock') {
    await step('an analyst finds the user list locked, with its reason on the screen', denied, async () => {
      await signInMock(denied, 'Riley Brooks');
      await route(denied, `settings?engagement=${encodeURIComponent(project)}&tab=users`);
      const reason = 'The user list is visible to Organization Admins, Red Team Managers and Reviewers.';
      const shownReason = await denied.getByText(reason).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
      return { ok: shownReason, detail: shownReason ? 'reason shown' : 'no refusal reason' };
    });
  } else {
    await step('a viewer saves a policy change and the server refuses it, with the refusal shown', denied, async () => {
      await signInReal(denied, fixtures.viewer.username, fixtures.viewer.password);
      await route(denied, `settings?engagement=${encodeURIComponent(project)}&tab=policies`);
      const first = denied.locator('input[id^="value-"]').first();
      await first.waitFor({ timeout: 30000 });
      const id = (await first.getAttribute('id')).slice('value-'.length);
      const current = Number(await first.inputValue());
      await denied.locator(`#value-${CSS(id)}`).fill(String(current > 1 ? current - 1 : current + 1));
      await denied.locator(`#reason-${CSS(id)}`).fill('viewer attempt');
      await denied.getByRole('button', { name: /^Save \(version/ }).first().click();
      const refusal = await denied.getByRole('alert').first().waitFor({ timeout: 20000 }).then(() => true, () => false);
      const refusalText = refusal ? (await denied.getByRole('alert').first().innerText()).replace(/\s+/g, ' ') : '';
      const notSaved = !(await denied.getByText(/saved; the new version applies/).count());
      return { ok: refusal && notSaved, detail: `${refusal ? `refusal shown: "${refusalText.slice(0, 160)}"` : 'no refusal'}; ${notSaved ? 'nothing saved' : 'a save was confirmed'}` };
    });
  }
  await denialContext.close();
} catch (error) {
  fatal = error.message.split('\n')[0];
} finally {
  await browser.close();
}

// The setting keys are dotted identifiers (policy.c2_grant_max_hours); the id selector escapes the dots.
function CSS(value) {
  return value.replace(/([.:/])/g, '\\$1');
}

const mismatches = results.filter((row) => !row.matches).length;
if (outFile) writeFileSync(outFile, JSON.stringify({ mode, app, generatedAt: new Date().toISOString(), steps: results, fatal, mismatches }, null, 2));
for (const row of results) console.log(`${row.matches ? 'PASS' : 'FAIL'} ${row.step} :: ${row.detail}`);
if (fatal) console.log(`SETTINGS CLICK-THROUGH STOPPED: ${fatal}`);
console.log(`settings click-through (${mode}): ${results.length - mismatches} of ${results.length} steps matched`);
process.exitCode = mismatches > 0 || fatal ? 1 : 0;
