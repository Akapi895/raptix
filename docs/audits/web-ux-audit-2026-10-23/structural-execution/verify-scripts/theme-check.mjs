// Real theme check for the mock Overview (scratchpad only). The app keeps the theme in memory and defaults to light;
// it switches through the account menu, so the check uses that control. Usage: node theme-check.mjs <app-url> <out-dir>
import { chromium } from 'file:///D:/.VTNet/redteam/raptix/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const [, , APP, OUT] = process.argv;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
await page.waitForTimeout(600);

async function sample(label) {
  const info = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const h1 = document.querySelector('h1');
    return {
      htmlClassDark: document.documentElement.classList.contains('dark'),
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      bodyBackground: body.backgroundColor,
      bodyColor: body.color,
      h1Color: h1 ? getComputedStyle(h1).color : null,
    };
  });
  await page.screenshot({ path: path.join(OUT, `theme-${label}.png`), fullPage: true });
  return info;
}

const light = await sample('light');

// Open the account menu in the header, choose Dark, close the menu.
await page.getByRole('button', { name: 'Account menu' }).click();
const menu = page.getByRole('menu');
await menu.waitFor({ timeout: 10000 });
await menu.getByText('Dark', { exact: true }).first().click();
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

const dark = await sample('dark');
await browser.close();
console.log(JSON.stringify({ light, dark, errors }, null, 1));
