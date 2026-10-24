// Projects click-through against the running app. Real mode: an admin opens a project from the list and reads its overview; creates a new
// project through the form, and after the create the project opens from the list again. A viewer attempts the same create and the server
// refuses it; the refusal is shown and no project is created. Each step checks
// what the screen shows after the action; a step that cannot run is recorded as failed and the rest run.
// Usage: node tools/verify/flows/projects-click.mjs --mode real --app <url> --fixtures <manifest.json> --out <result.json>
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
const stamp = Date.now().toString(36);
const projectName = `Click project ${stamp}`;
const slug = `click-${stamp}`;
const results = [];

async function shown(page) {
  const main = (await page.locator('main').first().innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ');
  const status = (await page.locator('[role="status"], [role="alert"]').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').slice(0, 160));
  return `main: "${main.slice(0, 260)}" | status: ${JSON.stringify(status)}`;
}

async function step(name, page, run) {
  try {
    const verdict = await run();
    results.push({ step: name, matches: verdict.ok, detail: verdict.ok ? verdict.detail : `${verdict.detail} :: ${await shown(page)}` });
  } catch (error) {
    results.push({ step: name, matches: false, detail: `could not run: ${error.message.split('\n')[0]} :: ${await shown(page)}` });
  }
}

async function signInReal(page, username, password) {
  await page.goto(`${app}/#/projects`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.locator('#login-username').waitFor({ timeout: 60000 });
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('#login-username').waitFor({ state: 'detached', timeout: 30000 });
}

const route = (page, hash) => page.goto(`${app}/#/${hash}`, { waitUntil: 'domcontentloaded' });

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
let fatal = null;
try {
  const adminContext = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  const admin = await adminContext.newPage();
  admin.setDefaultTimeout(30000);
  await signInReal(admin, process.env.RAPTIX_VERIFY_USER, process.env.RAPTIX_VERIFY_PASSWORD);

  const seedName = 'Stack verification project';
  await step('the project list shows the engagements and opens one with its overview', admin, async () => {
    await route(admin, 'projects');
    const row = admin.getByText(seedName, { exact: false }).first();
    await row.waitFor({ timeout: 30000 });
    await row.click();
    const overview = await admin.getByText(seedName, { exact: false }).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    return { ok: overview, detail: overview ? `${seedName} overview open` : 'overview not shown' };
  });

  await step('an admin creates a project through the form and the new project opens', admin, async () => {
    await route(admin, 'project-new');
    await admin.getByLabel('Display name').fill(projectName);
    await admin.getByLabel('Workspace slug').fill(slug);
    await admin.getByLabel('Target value').fill(`https://${slug}.verify.invalid`);
    await admin.getByLabel('Operator brief').fill('Click-through project created by the projects checklist.');
    await admin.getByLabel('I confirm this engagement is authorized against the target above.').check();
    await admin.getByRole('button', { name: /^Create/ }).first().click();
    const opened = await admin.getByText(projectName, { exact: false }).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    return { ok: opened, detail: opened ? `${projectName} opened` : 'the new project did not open' };
  });

  await step('the created project opens again from the list', admin, async () => {
    await route(admin, 'projects');
    const row = admin.getByText(projectName, { exact: false }).first();
    await row.waitFor({ timeout: 30000 });
    await row.click();
    const reopened = await admin.getByText(projectName, { exact: false }).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    return { ok: reopened, detail: reopened ? `${projectName} reopened from the list` : 'not reopened' };
  });
  await adminContext.close();

  const viewerContext = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  const viewer = await viewerContext.newPage();
  viewer.setDefaultTimeout(30000);
  const refusedName = `Refused project ${stamp}`;
  await step('a viewer is refused the create route, and no project is created', viewer, async () => {
    await signInReal(viewer, fixtures.viewer.username, fixtures.viewer.password);
    await route(viewer, 'project-new');
    await viewer.waitForTimeout(1500);
    // The create route is closed to the viewer: the page leaves it (the form may render for an instant before the gate moves the page).
    const formShown = await viewer.getByLabel('Display name').count();
    const stillOnRoute = viewer.url().includes('#/project-new');
    await route(viewer, 'projects');
    const created = await viewer.getByText(refusedName, { exact: false }).count();
    return {
      ok: !stillOnRoute && created === 0,
      detail: `${formShown ? 'form shown' : 'form not shown'}; ${stillOnRoute ? 'route kept' : 'route left'}; ${created === 0 ? 'no project created' : 'a project was created'}`,
    };
  });
  await viewerContext.close();
} catch (error) {
  fatal = error.message.split('\n')[0];
} finally {
  await browser.close();
}
const mismatches = results.filter((row) => !row.matches).length;
if (outFile) writeFileSync(outFile, JSON.stringify({ mode, app, generatedAt: new Date().toISOString(), steps: results, fatal, mismatches }, null, 2));
for (const row of results) console.log(`${row.matches ? 'PASS' : 'FAIL'} ${row.step} :: ${row.detail}`);
if (fatal) console.log(`PROJECTS CLICK-THROUGH STOPPED: ${fatal}`);
console.log(`projects click-through (${mode}): ${results.length - mismatches} of ${results.length} steps matched`);
process.exitCode = mismatches > 0 || fatal ? 1 : 0;
