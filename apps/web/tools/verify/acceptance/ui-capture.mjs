// UI capture (test stack only): every global page and every project tab of the real console, in light and dark theme at
// 1440 px, and in light theme at 390 px. Writes one folder that holds a PNG per capture, an index.html gallery to open in a
// browser, and a manifest.json with each page's heading, horizontal overflow, uncaught errors and text-contrast failures.
// A previous capture in the same folder moves to history/<its label>, so the folder always shows the latest run.
// Usage: node tools/verify/acceptance/ui-capture.mjs --hold <hold.json> --out <folder> [--label <name>] [--fixtures <f>]
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadConnection, parseArgs } from './lib.mjs';

const args = parseArgs(process.argv);
if (!args.hold || !args.out) throw new Error('--hold and --out are required');
const hold = JSON.parse(readFileSync(args.hold, 'utf8'));
const conn = loadConnection({ fixtures: args.fixtures ?? hold.fixtures, holdFile: args.hold });
const out = path.resolve(args.out);
const label = args.label ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const project = conn.project;

const GLOBAL_PAGES = [
  ['global-overview', 'overview'],
  ['global-projects', 'projects'],
  ['global-assets', 'assets'],
  ['global-findings', 'findings'],
  ['global-capabilities', 'capabilities'],
  ['global-infrastructure', `infrastructure?engagement=${project}&tab=sessions`],
  ['global-settings', 'settings'],
];
const PROJECT_TABS = ['overview', 'scope', 'assets', 'planning', 'ai-workspace', 'operations', 'c2', 'findings', 'evidence', 'analysis', 'reports', 'team', 'fleet', 'audit', 'governance', 'vault', 'settings', 'close'];
const PAGES = [...GLOBAL_PAGES, ...PROJECT_TABS.map((tab) => [`project-${tab}`, `project/${project}?tab=${tab}`])];

// Runs in the page: text contrast. Text on a gradient is measured against each colour stop (the worst case).
const CONTRAST = () => {
  const parse = (c) => {
    const m = c && c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a) });
  const bodyBg = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  const bgOf = (el) => {
    const layers = [];
    for (let cur = el; cur && cur !== document.documentElement; cur = cur.parentElement) {
      const c = parse(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let o = { r: bodyBg.r, g: bodyBg.g, b: bodyBg.b, a: 1 };
    for (const c of layers.reverse()) o = { ...over(c, o), a: 1 };
    return o;
  };
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
  let checked = 0;
  const failing = [];
  for (const el of document.querySelectorAll('body *')) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
    if (!own || !visible(el) || el.closest('[aria-hidden="true"]')) continue;
    const cs = getComputedStyle(el);
    const fg0 = parse(cs.color);
    if (!fg0) continue;
    const bg = bgOf(el);
    const fg = { ...over(fg0, bg), a: 1 };
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    let r = ratio(fg, bg);
    for (let cur = el; cur && cur !== document.documentElement; cur = cur.parentElement) {
      const img = getComputedStyle(cur).backgroundImage;
      if (img && img.includes('gradient')) {
        for (const m of img.matchAll(/rgba?\([^)]*\)/g)) { const c = parse(m[0]); if (c && c.a > 0) r = Math.min(r, ratio(fg, over(c, bg))); }
        break;
      }
    }
    checked++;
    if (r < need) failing.push({ text: own.slice(0, 50), ratio: Math.round(r * 100) / 100, need });
  }
  return { checked, failing: failing.length, worst: failing.sort((a, b) => a.ratio - b.ratio).slice(0, 3) };
};

const slug = (name) => name.replace(/[^a-z0-9-]+/gi, '-');

// Moves the previous capture (flat files and manifest) into history/<its label>, so the folder shows only the latest run.
function archivePrevious() {
  if (!existsSync(out)) return null;
  const manifestPath = path.join(out, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  const previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const dest = path.join(out, 'history', slug(previous.label ?? 'previous'));
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(out)) {
    if (name === 'history') continue;
    renameSync(path.join(out, name), path.join(dest, name));
  }
  return previous.label ?? 'previous';
}

mkdirSync(out, { recursive: true });
const archived = archivePrevious();

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(60000);
let uncaught = [];
page.on('pageerror', (error) => uncaught.push(String(error.message)));

await page.goto(`${conn.app}/#/login`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.locator('#login-username').waitFor();
await page.fill('#login-username', conn.owner.username);
await page.fill('#login-password', conn.owner.password);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.locator('#login-username').waitFor({ state: 'detached', timeout: 60000 });

// Closes an open account menu so no overlay is in the capture.
async function closeMenu() {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const account = page.getByRole('button', { name: 'Account menu' });
  if ((await account.getAttribute('aria-expanded')) === 'true') await page.locator('h1').first().click({ force: true });
  await page.waitForTimeout(200);
}

// The theme is kept in memory by the app: a same-document hash change keeps it.
async function setTheme(theme) {
  await page.goto(`${conn.app}/#/overview`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Account menu' }).waitFor({ timeout: 60000 });
  await closeMenu();
  const account = page.getByRole('button', { name: 'Account menu' });
  await account.click();
  await page.getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).first().click();
  await closeMenu();
}

const results = [];
let index = 0;
async function capture(name, hash, theme, width, height) {
  index += 1;
  const file = `${String(index).padStart(3, '0')}-${slug(name)}-${theme}-${width}.png`;
  const entry = { page: name, theme, width, file, heading: '', overflowPx: 0, uncaughtErrors: 0, contrast: null, error: null };
  try {
    await page.setViewportSize({ width, height });
    await page.goto(`${conn.app}/#/${hash}`, { waitUntil: 'domcontentloaded' });
    await page.locator('main').first().waitFor({ timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await closeMenu();
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
    const before = uncaught.length;
    entry.heading = await page.evaluate(() => (document.querySelector('main h1') ?? document.querySelector('h1'))?.innerText?.trim() ?? '');
    entry.overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    entry.contrast = await page.evaluate(CONTRAST);
    entry.uncaughtErrors = uncaught.length - before;
    await page.screenshot({ path: path.join(out, file) });
  } catch (error) {
    entry.error = String(error.message).split('\n')[0];
  }
  results.push(entry);
  console.log(`${entry.error ? 'ERROR' : 'OK   '} ${file} ${entry.heading.slice(0, 40)}`);
}

for (const [name, hash] of PAGES) await capture(name, hash, 'light', 1440, 900);
await setTheme('dark');
for (const [name, hash] of PAGES) await capture(name, hash, 'dark', 1440, 900);
await setTheme('light');
for (const [name, hash] of PAGES) await capture(name, hash, 'light', 390, 844);
await browser.close();

const manifest = {
  label,
  generatedAt: new Date().toISOString(),
  app: conn.app,
  previousArchivedAs: archived,
  pages: PAGES.length,
  captures: results.length,
  failed: results.filter((r) => r.error).length,
  overflowing: results.filter((r) => r.overflowPx > 1).map((r) => `${r.page} ${r.theme} ${r.width}`),
  contrastFailing: results.filter((r) => r.contrast && r.contrast.failing > 0).map((r) => ({ page: r.page, theme: r.theme, width: r.width, failing: r.contrast.failing })),
  results,
};
writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));

// The gallery: one row per page, light and dark side by side, mobile below.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const byPage = new Map();
for (const r of results) {
  if (!byPage.has(r.page)) byPage.set(r.page, {});
  byPage.get(r.page)[`${r.theme}-${r.width}`] = r;
}
const cell = (r, title) => {
  if (!r) return `<div class="cell missing"><b>${esc(title)}</b><span>not captured</span></div>`;
  if (r.error) return `<div class="cell missing"><b>${esc(title)}</b><span>${esc(r.error)}</span></div>`;
  const flags = [];
  if (r.overflowPx > 1) flags.push(`horizontal scroll ${r.overflowPx}px`);
  if (r.uncaughtErrors) flags.push(`${r.uncaughtErrors} uncaught error(s)`);
  if (r.contrast && r.contrast.failing) flags.push(`${r.contrast.failing} text(s) below contrast`);
  return `<figure class="cell"><a href="${esc(r.file)}"><img loading="lazy" src="${esc(r.file)}" alt="${esc(r.page)} ${esc(title)}"></a><figcaption><b>${esc(title)}</b> ${esc(r.heading)}${flags.length ? `<em>${esc(flags.join(', '))}</em>` : ''}</figcaption></figure>`;
};
const sections = [...byPage.entries()].map(([name, set]) => `
  <section><h2>${esc(name)}</h2>
    <div class="row">${cell(set['light-1440'], 'light 1440')}${cell(set['dark-1440'], 'dark 1440')}</div>
    <div class="row mobile">${cell(set['light-390'], 'light 390')}</div>
  </section>`).join('');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Raptix UI capture ${esc(label)}</title>
<style>
  body { margin: 0; font: 14px/1.4 Inter, Arial, sans-serif; background: #F6F7F9; color: #111827; }
  header { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #E5E7EB; padding: 12px 20px; z-index: 1; }
  header h1 { margin: 0; font-size: 18px; }
  header p { margin: 4px 0 0; color: #374151; font-size: 13px; }
  main { padding: 16px 20px 40px; }
  section { background: #fff; border: 1px solid #E5E7EB; border-radius: 12px; padding: 14px; margin-bottom: 18px; }
  section h2 { margin: 0 0 10px; font-size: 16px; font-family: ui-monospace, monospace; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .row.mobile { grid-template-columns: 390px; margin-top: 12px; }
  .cell { margin: 0; border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden; background: #fff; }
  .cell img { display: block; width: 100%; height: auto; }
  .cell figcaption { padding: 8px 10px; font-size: 12px; color: #374151; border-top: 1px solid #E5E7EB; }
  .cell figcaption em { display: block; color: #B91C1C; font-style: normal; margin-top: 3px; }
  .missing { padding: 16px; color: #B91C1C; display: flex; flex-direction: column; gap: 4px; min-height: 80px; }
  .missing b { color: #111827; }
  @media (prefers-color-scheme: dark) { body { background: #0B1120; color: #E5E7EB; } header, section, .cell { background: #111827; border-color: #263244; } .cell figcaption { color: #D1D5DB; border-color: #263244; } }
</style></head>
<body>
<header><h1>Raptix web console: capture ${esc(label)}</h1>
<p>${results.length} captures of ${PAGES.length} pages (light and dark at 1440 px, light at 390 px). Failed: ${manifest.failed}. Horizontal scroll: ${manifest.overflowing.length}. Pages with text below contrast: ${manifest.contrastFailing.length}. Generated ${esc(manifest.generatedAt)}.${archived ? ` Previous capture: history/${esc(slug(archived))}.` : ''}</p></header>
<main>${sections}</main>
</body></html>`;
writeFileSync(path.join(out, 'index.html'), html);
console.log(JSON.stringify({ label, captures: results.length, failed: manifest.failed, overflowing: manifest.overflowing.length, contrastFailingPages: manifest.contrastFailing.length, out }));
process.exitCode = manifest.failed > 0 ? 1 : 0;
