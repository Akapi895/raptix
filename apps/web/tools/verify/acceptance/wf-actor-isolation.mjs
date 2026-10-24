// WF-01 · Authentication and actor isolation: the owner's project data never reaches another signed-in actor in the same
// browser. The owner creates an owner-only project through the API; the owner and the viewer then sign in and out on one
// browser, and the viewer's list, API read and browser storage are checked for that project's name and id. Test stack only.
// Usage: node tools/verify/acceptance/wf-actor-isolation.mjs --fixtures <manifest.json> --hold <hold.json> --out <result.json>
import { chromium } from 'playwright';
import { loadConnection, parseArgs, ApiSession, Recorder } from './lib.mjs';

const args = parseArgs(process.argv);
const conn = loadConnection({ fixtures: args.fixtures, holdFile: args.hold, app: args.app, api: args.api });
const recorder = new Recorder('WF-01 authentication and actor isolation', args.out ?? 'wf-actor-isolation.json');
const stamp = Date.now().toString(36);
const OWNER_ONLY_NAME = `Acceptance owner-only project ${stamp}`;
const SHARED_NAME = 'Stack verification project';

const owner = await new ApiSession(conn.api, 'owner').login(conn.owner.username, conn.owner.password);
const created = await owner.call('POST', '/api/engagements', {
  name: `owner-only-${stamp}`, displayName: OWNER_ONLY_NAME, targetType: 'web_url', targetValue: `https://owner-only-${stamp}.verification.invalid`,
  authorizationConfirmed: true, brief: 'Generated fixture visible to the owner only. No target contact.',
});
const ownerOnlyId = created.json?.id;
if (!ownerOnlyId) throw new Error(`owner-only project create HTTP ${created.status}`);

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error.message)));

async function signIn(target, who) {
  await target.goto(`${conn.app}/?dataMode=real#/login`, { waitUntil: 'domcontentloaded' });
  await target.locator('#login-username').waitFor({ timeout: 60000 });
  await target.locator('#login-username').fill(who.username);
  await target.locator('#login-password').fill(who.password);
  await target.getByRole('button', { name: 'Sign in' }).click();
  await target.getByRole('navigation', { name: 'Main navigation' }).waitFor({ timeout: 60000 });
}

// Real mode: the account menu opens the sign-in route, which holds the Sign out button for an authenticated session.
async function signOut(target) {
  await target.getByRole('button', { name: 'Account menu' }).click();
  await target.getByRole('menuitem', { name: /Account \/ sign out/ }).click();
  await target.getByRole('button', { name: 'Sign out', exact: true }).click();
  await target.locator('#login-username').waitFor({ timeout: 60000 });
}

async function openProjects(target) {
  await target.goto(`${conn.app}/?dataMode=real#/projects`, { waitUntil: 'domcontentloaded' });
  await target.getByText(SHARED_NAME).first().waitFor({ timeout: 60000 });
}

const bodyText = (target) => target.evaluate(() => document.body.innerText);

// Storage keys and values that name the owner-only project, read from both storages of the browser.
async function leaksOf(target, needles) {
  return target.evaluate((list) => {
    const keys = [];
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        const value = store.getItem(key) ?? '';
        if (list.some((needle) => key.includes(needle) || value.includes(needle))) keys.push(key);
      }
    }
    return keys;
  }, needles);
}

try {
  // Positive control: the owner sees the owner-only project.
  await signIn(page, conn.owner);
  await openProjects(page);
  const ownerSees = (await bodyText(page)).includes(OWNER_ONLY_NAME);
  recorder.note('owner.sees-owner-only', ownerSees ? 'PASS' : 'FAIL', 'owner project list contains the owner-only project');

  await signOut(page);
  const afterOwnerLogout = await leaksOf(page, [ownerOnlyId]);
  recorder.note('owner.logout-clears-project-data', afterOwnerLogout.length === 0 ? 'PASS' : 'FAIL', `storage keys naming the owner-only project after logout: ${afterOwnerLogout.length}`);

  // The viewer signs in on the same browser: the owner-only name must not appear at any sample during four seconds.
  await signIn(page, conn.viewer);
  const flashes = await page.evaluate(() => new Promise((resolve) => {
    const seen = [];
    const started = Date.now();
    const timer = setInterval(() => {
      if (document.body.innerText.includes('Acceptance owner-only project')) seen.push(Date.now() - started);
      if (Date.now() - started > 4000) { clearInterval(timer); resolve(seen); }
    }, 25);
  }));
  recorder.note('viewer.no-owner-only-flash', flashes.length === 0 ? 'PASS' : 'FAIL', `samples showing the owner-only name in 4 s after viewer sign-in: ${flashes.length}`);

  await openProjects(page);
  const viewerText = await bodyText(page);
  recorder.note('viewer.sees-shared', viewerText.includes(SHARED_NAME) ? 'PASS' : 'FAIL', 'viewer project list contains the shared project');
  recorder.note('viewer.list-excludes-owner-only', viewerText.includes(OWNER_ONLY_NAME) ? 'FAIL' : 'PASS', 'viewer project list has no owner-only project');

  // The server scope agrees with the client: the viewer's own API read does not name the owner-only project.
  const viewerList = await page.evaluate(async () => (await fetch('/api/engagements', { credentials: 'include' })).json());
  recorder.note('viewer.server-scope', JSON.stringify(viewerList).includes(ownerOnlyId) ? 'FAIL' : 'PASS', 'GET /api/engagements as the viewer does not name the owner-only project');

  const viewerLeaks = await leaksOf(page, [ownerOnlyId, conn.owner.username]);
  recorder.note('viewer.storage-clean', viewerLeaks.length === 0 ? 'PASS' : 'FAIL', `viewer storage keys naming the owner or the owner-only project: ${viewerLeaks.length}`);

  // Re-login restores the owner's own view.
  await signOut(page);
  await signIn(page, conn.owner);
  await openProjects(page);
  recorder.note('owner.re-login-sees-owner-only', (await bodyText(page)).includes(OWNER_ONLY_NAME) ? 'PASS' : 'FAIL', 'owner project list after re-login');
  await signOut(page);

  // Session replacement in a second tab: the first tab drops the previous actor's data once the viewer signs in elsewhere.
  await signIn(page, conn.owner);
  await openProjects(page);
  const second = await context.newPage();
  second.on('pageerror', (error) => pageErrors.push(String(error.message)));
  await second.goto(`${conn.app}/?dataMode=real#/login`, { waitUntil: 'domcontentloaded' });
  await second.getByRole('button', { name: 'Sign out', exact: true }).click();
  await second.locator('#login-username').waitFor({ timeout: 60000 });
  await signIn(second, conn.viewer);
  await page.bringToFront();
  const replaced = await page.waitForFunction(() => !document.body.innerText.includes('Acceptance owner-only project'), null, { timeout: 20000 }).then(() => true, () => false);
  recorder.note('replacement.first-tab-drops-owner-data', replaced ? 'PASS' : 'FAIL', 'owner-only name gone from the first tab after the viewer signed in on the second tab');
  await second.close();
  await signOut(page).catch(() => {});
} finally {
  await browser.close();
}

recorder.note('page-errors', pageErrors.length === 0 ? 'PASS' : 'FAIL', `uncaught page errors during the run: ${pageErrors.length}`);
const counts = recorder.save();
console.log(JSON.stringify(counts));
process.exitCode = (counts.FAIL ?? 0) > 0 ? 1 : 0;
