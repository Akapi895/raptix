// Team & Approvals tab on the held verification stack (scratchpad only). Owner and viewer; screenshots in light and dark.
// Credentials come from hold.json and are never printed. Usage: node team-check.mjs <hold.json> <out-dir>
import { chromium } from 'file:///D:/.VTNet/redteam/raptix/node_modules/playwright/index.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [, , holdFile, OUT] = process.argv;
mkdirSync(OUT, { recursive: true });
const hold = JSON.parse(readFileSync(holdFile, 'utf8'));
const fixtures = JSON.parse(readFileSync(path.join(path.dirname(holdFile), 'fixtures.real.json'), 'utf8'));
const TEAM = `${hold.app}/?dataMode=real#/project/${fixtures.project}?tab=team`;
const results = {};
const browser = await chromium.launch({ headless: true });

async function signIn(page, who) {
  await page.goto(`${hold.app}/?dataMode=real#/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#login-username').waitFor({ timeout: 30000 });
  await page.locator('#login-username').fill(who.username);
  await page.locator('#login-password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).waitFor({ timeout: 30000 });
}

async function inspect(name, who, theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error.message)));
  await signIn(page, who);
  await page.goto(TEAM, { waitUntil: 'domcontentloaded' });
  await page.getByRole('region', { name: 'Decisions' }).or(page.getByText('Nothing is waiting')).first().waitFor({ timeout: 30000 }).catch(() => {});
  await page.getByText('Waiting for a decision').first().waitFor({ timeout: 30000 });
  if (theme === 'dark') {
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menu').getByText('Dark', { exact: true }).first().click();
    const heading = await page.getByText('Waiting for a decision').first().boundingBox();
    await page.mouse.click(heading.x + 2, heading.y + 2);
  }
  await page.waitForTimeout(700);
  const facts = await page.evaluate(() => {
    const text = document.body.innerText;
    const buttons = [...document.querySelectorAll('button')].map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim());
    return {
      waitingHeading: text.includes('Waiting for a decision'),
      membersHeading: text.includes('Members'),
      aiWorkspaceFooter: text.includes('Runtime tool approvals wait in the AI Workspace'),
      inviteControls: buttons.filter((label) => /^(Add Member|Invite member|Add to project)$/i.test(label)).length,
      roleText: text.includes('Full control of the engagement') || text.includes('View only'),
      htmlDark: document.documentElement.classList.contains('dark'),
    };
  });
  await page.screenshot({ path: path.join(OUT, `team-${name}-${theme}.png`), fullPage: true });
  results[`${name}-${theme}`] = { ...facts, overflowPx: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), errors };
  await context.close();
}

await inspect('owner', { username: hold.owner, password: hold.adminPassword }, 'light');
await inspect('owner', { username: hold.owner, password: hold.adminPassword }, 'dark');
await inspect('viewer', hold.viewer, 'light');
await browser.close();
writeFileSync(path.join(OUT, 'team-check.json'), JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
