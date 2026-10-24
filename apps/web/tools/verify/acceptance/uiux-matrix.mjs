// UI/UX matrix (test stack only): the key real routes at four widths. Each page must render without an uncaught error,
// without horizontal page scroll, and with its main heading in view; a screenshot per page and width is kept in the run's
// output folder. Light and dark are checked by the workflow flows, not here. Usage:
// node tools/verify/acceptance/uiux-matrix.mjs --fixtures <manifest.json> --hold <hold.json> --out <result.json>
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadConnection, parseArgs, Recorder } from './lib.mjs';

const args = parseArgs(process.argv);
const conn = loadConnection({ fixtures: args.fixtures, holdFile: args.hold, app: args.app, api: args.api });
const outFile = args.out ?? 'uiux-matrix.json';
const recorder = new Recorder('UI/UX matrix (real routes, four widths)', outFile);
const shots = path.join(path.dirname(path.resolve(outFile)), 'uiux-shots');
mkdirSync(shots, { recursive: true });

const WIDTHS = [
  { id: '1440', width: 1440, height: 900 },
  { id: '1024', width: 1024, height: 768 },
  { id: '834', width: 834, height: 1112 },
  { id: '390', width: 390, height: 844 },
];
const PAGES = [
  { id: 'overview', hash: 'overview' },
  { id: 'projects', hash: 'projects' },
  { id: 'team', hash: `project/${conn.project}?tab=team` },
  { id: 'governance', hash: `project/${conn.project}?tab=governance` },
  { id: 'findings', hash: `project/${conn.project}?tab=findings` },
  { id: 'reports', hash: `project/${conn.project}?tab=reports` },
  { id: 'infrastructure', hash: `infrastructure?engagement=${conn.project}&tab=sessions` },
];

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
try {
  for (const size of WIDTHS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height } });
    const page = await context.newPage();
    const errors = [];
    page.setDefaultTimeout(60000);
    page.on('pageerror', (error) => errors.push(String(error.message)));
    await page.goto(`${conn.app}/#/login`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.locator('#login-username').waitFor({ timeout: 60000 });
    await page.fill('#login-username', conn.owner.username);
    await page.fill('#login-password', conn.owner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // Narrow widths collapse the navigation into a drawer, so the sign-in form leaving the page is the signal.
    await page.locator('#login-username').waitFor({ state: 'detached', timeout: 60000 });

    for (const target of PAGES) {
      const label = `${target.id} at ${size.id}px`;
      await recorder.check(label, async () => {
        const before = errors.length;
        await page.goto(`${conn.app}/#/${target.hash}`, { waitUntil: 'domcontentloaded' });
        await page.locator('main h1, main [role="heading"][aria-level="1"], h1').first().waitFor({ timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(800);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const heading = await page.evaluate(() => (document.querySelector('main h1') ?? document.querySelector('h1'))?.innerText?.trim() ?? '');
        await page.screenshot({ path: path.join(shots, `${target.id}-${size.id}.png`), fullPage: false });
        const newErrors = errors.slice(before);
        const ok = overflow <= 1 && heading.length > 0 && newErrors.length === 0;
        return { ok, detail: `heading "${heading.slice(0, 60)}"; horizontal overflow ${overflow}px; uncaught errors ${newErrors.length}` };
      });
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const counts = recorder.save();
console.log(JSON.stringify(counts));
process.exitCode = (counts.FAIL ?? 0) > 0 ? 1 : 0;
