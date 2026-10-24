// Project workspace click-through against the running real app (page-details proposal, MVP 2026-10-22). An admin walks
// Projects → project overview → AI Workspace → Operations → Findings → a finding (Reproduce, Evidence) → back → Reports → report → back.
// Each step checks the URL, the project identity in the sidebar (the project scope must survive every step) and the back link.
// A final pass checks the overview on a phone-width viewport (no horizontal page scroll) and in dark mode (screenshot kept as evidence).
// Usage: node tools/verify/flows/workspace-click.mjs --app <url> --fixtures <manifest.json> --out <result.json> [--shots <dir>]
// Env: RAPTIX_VERIFY_USER and RAPTIX_VERIFY_PASSWORD (an admin). Mock mode is not covered by this flow.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const app = arg('--app');
const fixtures = JSON.parse(readFileSync(arg('--fixtures'), 'utf8'));
const outFile = arg('--out');
const shots = arg('--shots') ?? path.dirname(outFile);
mkdirSync(shots, { recursive: true });

const projectName = 'Stack verification project';
const findingTitle = 'Stack verification finding';
const reportTitle = 'Stack verification report';
const results = [];

const hash = (page) => new URL(page.url()).hash;
const sidebar = (page) => page.locator('nav[aria-label="Main navigation"]').innerText({ timeout: 5000 }).then((t) => t.replace(/\s+/g, ' '), () => '');

async function shown(page) {
  const main = (await page.locator('main').first().innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ');
  return `hash: ${hash(page)} | main: "${main.slice(0, 200)}"`;
}

async function step(name, page, run) {
  try {
    const verdict = await run();
    results.push({ step: name, matches: verdict.ok, detail: verdict.ok ? verdict.detail : `${verdict.detail} :: ${await shown(page)}` });
  } catch (error) {
    results.push({ step: name, matches: false, detail: `could not run: ${error.message.split('\n')[0]} :: ${await shown(page)}` });
  }
}

/** The step keeps the project: the sidebar shows the project identity. It waits up to 5 s, so a page still loading is not read as a lost scope. */
async function scopeKept(page, label) {
  const deadline = Date.now() + 5000;
  let named = false;
  while (!named && Date.now() < deadline) {
    named = (await sidebar(page)).includes(projectName);
    if (!named) await page.waitForTimeout(250);
  }
  return { ok: named, detail: `${label}: sidebar ${named ? 'names' : 'lost'} ${projectName}` };
}

async function signInReal(page, username, password) {
  await page.goto(`${app}/?dataMode=real#/projects`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.locator('#login-username').waitFor({ timeout: 60000 });
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('#login-username').waitFor({ state: 'detached', timeout: 30000 });
}

const route = (page, target) => page.goto(`${app}/?dataMode=real#/${target}`, { waitUntil: 'domcontentloaded' });
const navItem = (page, label) => page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: label, exact: true }).first();

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
try {
  const context = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await signInReal(page, process.env.RAPTIX_VERIFY_USER, process.env.RAPTIX_VERIFY_PASSWORD);

  await step('Projects opens the project overview with a next step and the project scope', page, async () => {
    await route(page, 'projects');
    await page.getByText(projectName, { exact: false }).first().click();
    await page.getByText('Next step', { exact: true }).waitFor();
    const onOverview = hash(page).startsWith(`#/project/${fixtures.project}`) && !/tab=(?!overview)/.test(hash(page));
    const scope = await scopeKept(page, 'overview');
    return { ok: onOverview && scope.ok, detail: `${onOverview ? 'overview route' : `route ${hash(page)}`}; ${scope.detail}` };
  });

  await step('the project sidebar keeps every section the proposal names', page, async () => {
    const side = await sidebar(page);
    const sections = ['Scope & ROE', 'Planning', 'AI Workspace', 'Operations', 'C2 Sessions', 'Findings', 'Evidence', 'Analysis', 'Reports', 'Team & Approvals', 'Fleet', 'Activity & Audit', 'Vault', 'Closeout'];
    const missing = sections.filter((label) => !side.includes(label));
    return { ok: missing.length === 0, detail: missing.length === 0 ? `all ${sections.length} sections listed` : `missing: ${missing.join(', ')}` };
  });

  await step('the sidebar opens AI Workspace inside the same project', page, async () => {
    await navItem(page, 'AI Workspace').click();
    await page.waitForURL(/tab=ai-workspace/);
    const scope = await scopeKept(page, 'AI Workspace');
    return { ok: scope.ok && hash(page).includes(fixtures.project), detail: scope.detail };
  });

  await step('Operations opens the operations tab of the same project', page, async () => {
    await navItem(page, 'Operations').click();
    await page.waitForURL(/tab=operations/);
    const scope = await scopeKept(page, 'Operations');
    return { ok: scope.ok, detail: scope.detail };
  });

  await step('Findings lists the project finding and opens it with the project attached', page, async () => {
    await navItem(page, 'Findings').click();
    await page.waitForURL(/tab=findings/);
    await page.getByText(findingTitle, { exact: false }).first().click();
    await page.waitForURL(new RegExp(`#/finding/${fixtures.finding}`));
    const scope = await scopeKept(page, 'finding');
    const attached = hash(page).includes(`engagement=${fixtures.project}`);
    return { ok: scope.ok && attached, detail: `${scope.detail}; ${attached ? 'engagement carried in the URL' : 'engagement missing from the URL'}` };
  });

  await step('the finding keeps Reproduce and Evidence inside the project', page, async () => {
    await page.getByRole('tab', { name: /^Reproduce/ }).first().click();
    await page.waitForURL(/tab=reproduce/);
    await page.getByRole('tab', { name: /^Evidence/ }).first().click();
    await page.waitForURL(/tab=evidence/);
    const scope = await scopeKept(page, 'Evidence tab');
    return { ok: scope.ok && hash(page).includes(`engagement=${fixtures.project}`), detail: scope.detail };
  });

  await step('the finding back link returns to the project findings', page, async () => {
    await page.locator('main').getByRole('button', { name: 'Findings', exact: true }).first().click();
    await page.waitForURL(/#\/findings/);
    const scope = await scopeKept(page, 'back to Findings');
    return { ok: scope.ok, detail: scope.detail };
  });

  await step('Reports opens the report list of the project', page, async () => {
    await navItem(page, 'Reports').click();
    await page.waitForURL(/tab=reports/);
    const scope = await scopeKept(page, 'Reports');
    return { ok: scope.ok, detail: scope.detail };
  });

  await step('a report opens with the project attached and its back link returns to Reports', page, async () => {
    await page.getByText(reportTitle, { exact: false }).first().click();
    await page.waitForURL(new RegExp(`#/report/${fixtures.report}`));
    const scope = await scopeKept(page, 'report');
    await page.locator('main').getByRole('button', { name: 'Reports', exact: true }).first().click();
    await page.waitForURL(/#\/reports/);
    const back = await scopeKept(page, 'back to Reports');
    return { ok: scope.ok && back.ok, detail: `${scope.detail}; ${back.detail}` };
  });

  await step('the browser back button returns to the report of the project', page, async () => {
    await page.goBack();
    await page.waitForURL(new RegExp(`#/report/${fixtures.report}`));
    await page.locator('main').getByText(reportTitle, { exact: false }).first().waitFor();
    const scope = await scopeKept(page, 'browser back');
    return { ok: scope.ok, detail: scope.detail };
  });

  await step('a phone-width overview has no horizontal page scroll', page, async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await route(page, `project/${fixtures.project}?tab=overview`);
    await page.getByText('Next step', { exact: true }).waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: path.join(shots, 'overview-mobile.png'), fullPage: true });
    return { ok: overflow <= 0, detail: `horizontal overflow ${overflow}px at 390px` };
  });

  await step('the overview renders in dark mode with the sidebar and the next step', page, async () => {
    await page.setViewportSize({ width: 1360, height: 960 });
    await route(page, `project/${fixtures.project}?tab=overview`);
    await page.getByText('Next step', { exact: true }).waitFor();
    // The console has no real-mode theme control and its store starts light: the dark theme is the `dark` class on <html>, which the store sets.
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const [r, g, b] = (background.match(/\d+(\.\d+)?/g) ?? [255, 255, 255]).map(Number);
    const dark = (r * 0.299 + g * 0.587 + b * 0.114) / 255 < 0.25;
    const scope = await scopeKept(page, 'dark overview');
    await page.screenshot({ path: path.join(shots, 'overview-dark.png'), fullPage: true });
    return { ok: scope.ok && dark, detail: `${scope.detail}; body background ${background} is ${dark ? 'dark' : 'not dark'}` };
  });

  await context.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.matches);
writeFileSync(outFile, JSON.stringify({ results, failed: failed.length }, null, 2));
for (const r of results) console.log(`${r.matches ? 'PASS' : 'FAIL'} ${r.step} — ${r.detail}`);
console.log(`workspace click-through: ${results.length - failed.length}/${results.length} steps matched`);
process.exit(failed.length === 0 ? 0 : 1);
