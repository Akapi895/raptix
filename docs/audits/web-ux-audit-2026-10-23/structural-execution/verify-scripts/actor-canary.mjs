// Actor isolation canary on the held verification stack (scratchpad only). Owner and viewer share one browser context.
// Usage: node actor-canary.mjs <hold.json> <out-dir>. Credentials are read from hold.json and never printed or written out.
import { chromium } from 'file:///D:/.VTNet/redteam/raptix/node_modules/playwright/index.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [, , holdFile, OUT] = process.argv;
mkdirSync(OUT, { recursive: true });
const hold = JSON.parse(readFileSync(holdFile, 'utf8'));
const APP = hold.app;
const API = hold.api;
const OWNER = { username: hold.owner, password: hold.adminPassword };
const VIEWER = { username: hold.viewer.username, password: hold.viewer.password };
const OWNER_ONLY_NAME = 'Canary owner-only project';
const RUN = Date.now().toString(36);
const OWNER_ONLY_TARGET = 'https://canary-owner-only.verification.invalid';
const SHARED_NAME = 'Stack verification project';
const checks = [];
const record = (id, ok, detail) => { checks.push({ id, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${detail ?? ''}`); };

// Owner-only fixture through the API, as the owner; the viewer is never added as a member.
async function apiLogin({ username, password }) {
  const response = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  if (response.status !== 200) throw new Error(`api login ${username}: ${response.status}`);
  return { cookie: response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; '), csrf: (await response.json()).csrfToken };
}
const ownerApi = await apiLogin(OWNER);
const created = await fetch(`${API}/api/engagements`, {
  method: 'POST',
  headers: { cookie: ownerApi.cookie, 'x-csrf-token': ownerApi.csrf, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'canary-owner-only-' + RUN, displayName: OWNER_ONLY_NAME + ' ' + RUN, targetType: 'web_url', targetValue: OWNER_ONLY_TARGET, authorizationConfirmed: true, brief: 'Canary fixture visible to the owner only. Generated; no target contact.' }),
});
if (created.status !== 201 && created.status !== 200) throw new Error(`create owner-only project: ${created.status}`);
const ownerOnly = await created.json();
record('fixture.owner-only-created', !!ownerOnly.id, ownerOnly.id);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error.message)));

async function signIn(target, who) {
  await target.goto(`${APP}/?dataMode=real#/login`, { waitUntil: 'domcontentloaded' });
  await target.locator('#login-username').waitFor({ timeout: 30000 });
  await target.locator('#login-username').fill(who.username);
  await target.locator('#login-password').fill(who.password);
  await target.getByRole('button', { name: 'Sign in' }).click();
  await target.getByRole('navigation', { name: 'Main navigation' }).waitFor({ timeout: 30000 });
}

// Real mode: the account menu opens the sign-in route, which holds the Sign out button for an authenticated session.
async function signOut(target) {
  await target.getByRole('button', { name: 'Account menu' }).click();
  await target.getByRole('menuitem', { name: /Account \/ sign out/ }).click();
  await target.getByRole('button', { name: 'Sign out', exact: true }).click();
  await target.locator('#login-username').waitFor({ timeout: 30000 });
}

async function openProjects(target) {
  await target.goto(`${APP}/?dataMode=real#/projects`, { waitUntil: 'domcontentloaded' });
  await target.getByText(SHARED_NAME).first().waitFor({ timeout: 30000 });
}

async function visibleNames(target) {
  return target.evaluate(() => document.body.innerText);
}

// Storage that belongs to the signed-in session: real-mode recovery keys and any key naming the owner-only project.
async function sessionStorageLeaks(target, needles) {
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

// 1. Owner sees the owner-only project (positive control).
await signIn(page, OWNER);
await openProjects(page);
const ownerText = await visibleNames(page);
record('owner.sees-owner-only', ownerText.includes(OWNER_ONLY_NAME), 'owner list contains the owner-only project');
const ownerRecoveryBefore = await sessionStorageLeaks(page, [ownerOnly.id, OWNER.username]);
console.log(`info owner.storage-before-logout keys naming owner or project: ${ownerRecoveryBefore.length}`);

// 2. Owner signs out: the login form returns and nothing owner-only remains in browser storage.
await signOut(page);
const leaksAfterOwnerLogout = await sessionStorageLeaks(page, [ownerOnly.id]);
record('owner.logout-clears-project-data', leaksAfterOwnerLogout.length === 0, `keys naming owner-only project after logout: ${leaksAfterOwnerLogout.join(', ') || 'none'}`);

// 3. Viewer signs in on the same browser. The owner-only name must never appear, not even for an instant from a stale cache.
const flashes = [];
await signIn(page, VIEWER);
const watch = await page.evaluate(() => new Promise((resolve) => {
  const seen = [];
  const started = Date.now();
  const timer = setInterval(() => {
    if (document.body.innerText.includes('Canary owner-only project')) seen.push(Date.now() - started);
    if (Date.now() - started > 4000) { clearInterval(timer); resolve(seen); }
  }, 25);
}));
flashes.push(...watch);
record('viewer.no-owner-only-flash', flashes.length === 0, `samples showing owner-only name in 4 s after viewer sign-in: ${flashes.length}`);
await openProjects(page);
const viewerText = await visibleNames(page);
record('viewer.sees-shared', viewerText.includes(SHARED_NAME), 'viewer list contains the shared project');
record('viewer.list-excludes-owner-only', !viewerText.includes(OWNER_ONLY_NAME), 'viewer list has no owner-only project');

// 4. Server scope agrees with the client: the viewer's own API read does not return the owner-only project.
const viewerApiList = await page.evaluate(async () => (await fetch('/api/engagements', { credentials: 'include' })).json());
const viewerIds = JSON.stringify(viewerApiList);
record('viewer.server-scope', !viewerIds.includes(ownerOnly.id), 'GET /api/engagements as viewer does not name the owner-only project');

// 5. Viewer's own storage holds no owner-only data.
const viewerLeaks = await sessionStorageLeaks(page, [ownerOnly.id, OWNER.username]);
record('viewer.storage-clean', viewerLeaks.length === 0, `keys naming owner or owner-only project for viewer: ${viewerLeaks.join(', ') || 'none'}`);

// 6. Viewer signs out; owner signs in again and sees the owner-only project (re-login restores the owner's own data).
await signOut(page);
await signIn(page, OWNER);
await openProjects(page);
const ownerAgain = await visibleNames(page);
record('owner.re-login-sees-owner-only', ownerAgain.includes(OWNER_ONLY_NAME), 'owner list after re-login');
await signOut(page);

// 7. Session replacement in a second tab: the first tab must drop the previous actor's data when the session changes.
await signIn(page, OWNER);
await openProjects(page);
const second = await context.newPage();
second.on('pageerror', (error) => errors.push(String(error.message)));
// The second tab shares the browser session: it signs the owner out there first, then the viewer signs in.
await second.goto(`${APP}/?dataMode=real#/login`, { waitUntil: 'domcontentloaded' });
await second.getByRole('button', { name: 'Sign out', exact: true }).click();
await second.locator('#login-username').waitFor({ timeout: 30000 });
await signIn(second, VIEWER);
await page.bringToFront();
const replaced = await page.waitForFunction(() => !document.body.innerText.includes('Canary owner-only project'), null, { timeout: 15000 }).then(() => true).catch(() => false);
record('replacement.first-tab-drops-owner-data', replaced, 'owner-only name gone from the first tab after the viewer signed in on the second tab');
await second.close();
await signOut(page).catch(() => {});

await browser.close();
const failed = checks.filter((c) => !c.ok).length;
const report = { app: APP, generatedAt: new Date().toISOString(), checks, failed, pageErrors: errors, ownerOnlyProjectId: ownerOnly.id };
writeFileSync(path.join(OUT, 'actor-canary.json'), JSON.stringify(report, null, 1));
console.log(`checks=${checks.length} failed=${failed} pageErrors=${errors.length}`);
