// Light and dark captures of the mock Overview at desktop and mobile widths, with the theme switched through the account menu.
// The menu closes on a click on its overlay, which is what a user does. Usage: node theme-shots.mjs <app-url> <out-dir> <tag>
import { chromium } from 'file:///D:/.VTNet/redteam/raptix/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const [, , APP, OUT, TAG] = process.argv;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = {};

async function capture(viewport, name, theme) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error.message)));
  await page.goto(`${APP}/?dataMode=mock#/login`, { waitUntil: 'domcontentloaded' });
  const picker = page.getByRole('button', { name: /^Dana Whitfield/ }).first();
  await picker.waitFor({ timeout: 30000 });
  await picker.click();
  await page.locator('[aria-label="Quick role picker (demo)"]').waitFor({ state: 'detached', timeout: 15000 });
  await page.goto(`${APP}/?dataMode=mock#/overview`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'System Overview' }).waitFor({ timeout: 30000 });
  if (theme === 'dark') {
    await page.getByRole('button', { name: 'Account menu' }).click();
    const menu = page.getByRole('menu');
    await menu.waitFor({ timeout: 10000 });
    await menu.getByText('Dark', { exact: true }).first().click();
    const heading = await page.getByRole('heading', { name: 'System Overview' }).boundingBox();
    await page.mouse.click(heading.x + 2, heading.y + 2);
  }
  await page.waitForTimeout(700);
  const info = await page.evaluate(() => ({
    htmlDark: document.documentElement.classList.contains('dark'),
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    menuOpen: !!document.querySelector('[role="menu"]'),
    overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  await page.screenshot({ path: path.join(OUT, `${TAG}-${name}-${theme}.png`), fullPage: true });
  results[`${name}-${theme}`] = { ...info, errors };
  await context.close();
}

await capture({ width: 1440, height: 900 }, 'desktop', 'light');
await capture({ width: 1440, height: 900 }, 'desktop', 'dark');
await capture({ width: 390, height: 844 }, 'mobile', 'light');
await capture({ width: 390, height: 844 }, 'mobile', 'dark');
await browser.close();
console.log(JSON.stringify(results, null, 1));
