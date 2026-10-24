// Screenshot and overflow check for the mock Overview (scratchpad only). Usage: node shots.mjs <app-url> <out-dir> <tag>
import { chromium } from 'file:///D:/.VTNet/redteam/raptix/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const [, , APP, OUT, TAG] = process.argv;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = {};

async function run(name, viewport, scheme) {
  const context = await browser.newContext({ viewport, colorScheme: scheme });
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
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const regions = await page.evaluate(() => [...document.querySelectorAll('main section[aria-label], main h2, main h3')].map((el) => el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 60)));
  await page.screenshot({ path: path.join(OUT, `${TAG}-${name}.png`), fullPage: true });
  results[name] = { overflowPx: overflow, errors, regions };
  await context.close();
}

await run('desktop-light', { width: 1440, height: 900 }, 'light');
await run('desktop-dark', { width: 1440, height: 900 }, 'dark');
await run('tablet-light', { width: 834, height: 1112 }, 'light');
await run('mobile-light', { width: 390, height: 844 }, 'light');
await browser.close();
console.log(JSON.stringify(results, null, 1));
