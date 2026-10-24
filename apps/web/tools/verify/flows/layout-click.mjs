// Readability and operability of the shell on the real app: text contrast of the sidebar and the breadcrumb in light and dark
// themes, the top bar at phone width (its controls must not overlap and must stay on screen), and whether the project switcher
// opens inside the viewport. Measurements come from the rendered page, not from a background colour alone.
// Usage: node tools/verify/flows/layout-click.mjs --app <url> --fixtures <manifest.json> --out <result.json> [--shots <dir>]
// Env: RAPTIX_VERIFY_USER and RAPTIX_VERIFY_PASSWORD (an admin).
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
const MIN_CONTRAST = 4.5;
const results = [];

async function step(name, run) {
  try {
    const verdict = await run();
    results.push({ step: name, matches: verdict.ok, detail: verdict.detail });
  } catch (error) {
    results.push({ step: name, matches: false, detail: `could not run: ${error.message.split('\n')[0]}` });
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

/** Contrast of the text of `selector` (first match) against its nearest opaque background, measured in the rendered page. */
async function contrastOf(page, selector) {
  return page.evaluate((sel) => {
    const parse = (value) => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = '1'] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const luminance = ({ r, g, b }) => {
      const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const fg = parse(getComputedStyle(el).color);
    let node = el;
    let bg = null;
    while (node && !bg) {
      const parsed = parse(getComputedStyle(node).backgroundColor);
      if (parsed && parsed.a > 0.5) bg = parsed;
      node = node.parentElement;
    }
    if (!bg) bg = parse(getComputedStyle(document.body).backgroundColor);
    const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
    return { found: true, ratio: Number(((l1 + 0.05) / (l2 + 0.05)).toFixed(2)), text: (el.textContent || '').trim().slice(0, 40) };
  }, selector);
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
try {
  const context = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await signInReal(page, process.env.RAPTIX_VERIFY_USER, process.env.RAPTIX_VERIFY_PASSWORD);

  await page.goto(`${app}/#/project/${fixtures.project}?tab=overview`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Next step', { exact: true }).waitFor();

  // Sidebar: the inactive project item, the section label and the breadcrumb, in both themes.
  const inactiveItem = 'nav[aria-label="Main navigation"] button[data-nav]:not([aria-current]) span.truncate';
  const sectionLabel = 'nav[aria-label="Main navigation"] div.text-neutral';
  const crumb = 'nav[aria-label="Breadcrumb"] button';
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.classList.toggle('dark', t === 'dark'), theme);
    // Colours transition for 150 ms when the theme changes; measure the settled colour, not the one in between.
    await page.waitForTimeout(600);
    await step(`${theme}: sidebar inactive item text is readable (4.5:1)`, async () => {
      const c = await contrastOf(page, inactiveItem);
      return { ok: c.found && c.ratio >= MIN_CONTRAST, detail: `${c.found ? `${c.ratio}:1 on "${c.text}"` : 'not found'}` };
    });
    await step(`${theme}: sidebar section label is readable (4.5:1)`, async () => {
      const c = await contrastOf(page, sectionLabel);
      return { ok: c.found && c.ratio >= MIN_CONTRAST, detail: `${c.found ? `${c.ratio}:1 on "${c.text}"` : 'not found'}` };
    });
    await step(`${theme}: breadcrumb link is readable (4.5:1)`, async () => {
      const c = await contrastOf(page, crumb);
      return { ok: c.found && c.ratio >= MIN_CONTRAST, detail: `${c.found ? `${c.ratio}:1 on "${c.text}"` : 'not found'}` };
    });
    await page.screenshot({ path: path.join(shots, `layout-${theme}-1360.png`) });
  }

  // Phone width: the top bar's direct controls must stay on screen, must not overlap, and must be large enough to press.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.goto(`${app}/#/project/${fixtures.project}?tab=overview`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Next step', { exact: true }).waitFor();
  const topbar = await page.evaluate(() => {
    const header = document.querySelector('header');
    if (!header) return null;
    const controls = [...header.querySelectorAll('button, input, [role="button"]')].filter((el) => el.offsetParent !== null);
    const boxes = controls.map((el) => {
      const r = el.getBoundingClientRect();
      return { label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40), left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height, width: r.width };
    });
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]; const b = boxes[j];
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 2 && y > 2) overlaps.push(`${a.label} / ${b.label}`);
      }
    }
    const offscreen = boxes.filter((b) => b.left < -1 || b.right > window.innerWidth + 1).map((b) => b.label);
    const small = boxes.filter((b) => b.height < 36).map((b) => `${b.label} (${Math.round(b.height)}px)`);
    return { overlaps, offscreen, small, count: boxes.length, scrollOverflow: document.documentElement.scrollWidth - window.innerWidth };
  });
  await step('390px top bar: controls do not overlap', async () => ({ ok: !!topbar && topbar.overlaps.length === 0, detail: topbar ? `${topbar.count} controls; overlaps: ${JSON.stringify(topbar.overlaps)}` : 'no header' }));
  await step('390px top bar: controls stay on screen', async () => ({ ok: !!topbar && topbar.offscreen.length === 0, detail: topbar ? `offscreen: ${JSON.stringify(topbar.offscreen)}` : 'no header' }));
  await step('390px top bar: controls are at least 36px tall', async () => ({ ok: !!topbar && topbar.small.length === 0, detail: topbar ? `small: ${JSON.stringify(topbar.small)}` : 'no header' }));
  await step('390px page has no horizontal scroll', async () => ({ ok: !!topbar && topbar.scrollOverflow <= 0, detail: `overflow ${topbar ? topbar.scrollOverflow : 'n/a'}px` }));
  await page.screenshot({ path: path.join(shots, 'layout-light-390.png') });

  await step('390px: the project switcher opens inside the viewport and lists the project', async () => {
    await page.getByRole('button', { name: /^Project:/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Select project' });
    await dialog.waitFor();
    const box = await dialog.boundingBox();
    const inside = !!box && box.x >= 0 && box.x + box.width <= 390 + 1 && box.y >= 0 && box.y + box.height <= 844 + 1;
    const listed = await dialog.getByText(projectName, { exact: false }).count();
    await page.screenshot({ path: path.join(shots, 'layout-switcher-390.png') });
    await page.keyboard.press('Escape');
    return { ok: inside && listed > 0, detail: `dialog ${box ? `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}` : 'missing'}; project listed: ${listed > 0}` };
  });

  await context.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.matches);
writeFileSync(outFile, JSON.stringify({ results, failed: failed.length }, null, 2));
for (const r of results) console.log(`${r.matches ? 'PASS' : 'FAIL'} ${r.step} — ${r.detail}`);
console.log(`layout check: ${results.length - failed.length}/${results.length} checks matched`);
process.exit(failed.length === 0 ? 0 : 1);
