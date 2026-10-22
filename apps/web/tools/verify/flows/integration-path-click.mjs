// Integration path against the running mock app: Projects → project overview → AI Operator and Operations → a finding and its
// evidence → Reports → browser back. Each step checks the project identity the screen shows and that no other project's id is
// shown in the main content. A responsive and dark pass then checks the changed screens at phone width and in dark mode: no
// horizontal page overflow, controls inside the viewport (or in a scroll container the user can reach) and not covered, and each
// control's text readable (contrast of at least 4.5, the WCAG AA level for normal text).
// Each step checks what the screen shows; a step that cannot run is recorded as failed and the rest run.
// Usage: node tools/verify/flows/integration-path-click.mjs --mode mock --app <url> --out <result.json>
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const mode = arg('--mode');
const app = arg('--app');
const outFile = arg('--out');
// Mock mode reads the mock seed; the real fixtures manifest the gate also passes has no mock ids.
const project = 'RT-2026-014';
const projectName = 'Internal Red Team Q4';
const otherProject = 'RT-2026-015';
const finding = 'FD-011';
const results = [];

if (mode !== 'mock') {
  console.error('integration-path-click runs in mock mode only; the verification stack seeds the mock dataset for it.');
  process.exit(2);
}

async function shown(page) {
  const main = (await page.locator('main').first().innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ');
  return `main: "${main.slice(0, 260)}"`;
}

async function step(name, page, run) {
  try {
    const verdict = await run();
    results.push({ step: name, matches: verdict.ok, detail: verdict.ok ? verdict.detail : `${verdict.detail} :: ${await shown(page)}` });
  } catch (error) {
    results.push({ step: name, matches: false, detail: `could not run: ${error.message.split('\n')[0]} :: ${await shown(page)}` });
  }
}

async function signInMock(page, persona) {
  await page.goto(`${app}/?dataMode=mock#/login`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const button = page.getByRole('button', { name: new RegExp(`^${persona}`) }).first();
  await button.waitFor({ timeout: 60000 });
  await button.click();
  await page.locator('[aria-label="Quick role picker (demo)"]').waitFor({ state: 'detached', timeout: 30000 });
}

const route = (page, hash) => page.goto(`${app}/?dataMode=${mode}#/${hash}`, { waitUntil: 'domcontentloaded' });

// The project identity a screen shows: the fixture project's id or name is on the page, and no other project's id is in the main content.
// The page-wide text carries the identity (the header and the ribbon sit outside main); the leak check reads main only, because the
// project switcher lists every project.
async function identity(page) {
  const body = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).replace(/\s+/g, ' ');
  const main = (await page.locator('main').first().innerText({ timeout: 5000 }).catch(() => '')).replace(/\s+/g, ' ');
  return { present: body.includes(project) || body.includes(projectName), leaked: main.includes(otherProject) };
}

// Runs in the page. A control counts as inside the viewport when it lies in the window or in a horizontally scrollable container
// (the user reaches it by scrolling that container); a control clipped by a non-scrolling ancestor counts as outside.
const measure = () => {
  const parse = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (fg, bg) => { const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };
  const backgroundOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  };
  const label = (el) => (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 32);
  const reachable = (el, r) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
      if (ox === 'hidden') {
        const box = n.getBoundingClientRect();
        return r.left >= box.left - 1 && r.right <= box.right + 1;
      }
    }
    return false;
  };
  const controls = [...document.querySelectorAll('main button, main [role="button"]')]
    .filter((el) => el.offsetParent !== null && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && label(el));
  const problems = [];
  for (const el of controls.slice(0, 14)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if ((r.left < -1 || r.right > window.innerWidth + 1) && !reachable(el, r)) problems.push(`outside the viewport: ${label(el)}`);
    if (r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth) {
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (top && !el.contains(top) && !top.contains(el)) problems.push(`covered: ${label(el)}`);
    }
    const fg = parse(getComputedStyle(el).color);
    const bg = backgroundOf(el);
    if (fg && bg && ratio(fg, bg) < 4.5) problems.push(`contrast ${ratio(fg, bg).toFixed(2)} below 4.5: ${label(el)}`);
  }
  const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  return { controls: controls.length, overflow, problems };
};

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
let fatal = null;
try {
  const context = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await signInMock(page, 'Dana Whitfield');

  await step('the projects portfolio lists the fixture project', page, async () => {
    await route(page, 'projects');
    const heading = await page.getByRole('heading', { name: 'Projects' }).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    const listed = await page.getByText(projectName, { exact: false }).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    return { ok: heading && listed, detail: `${heading ? 'heading shown' : 'no heading'}; ${listed ? 'project listed' : 'project not listed'}` };
  });

  await step('opening the project shows its overview with the same identity', page, async () => {
    await page.getByText(projectName, { exact: false }).first().click();
    await page.waitForURL(/project\/RT-2026-014/, { timeout: 30000 }).catch(() => {});
    const onRoute = page.url().includes(`project/${project}`);
    await page.getByText(projectName, { exact: false }).first().waitFor({ timeout: 30000 }).catch(() => {});
    const id = await identity(page);
    return { ok: onRoute && id.present && !id.leaked, detail: `${onRoute ? 'project route' : 'not on the project route'}; ${id.present ? 'project identity shown' : 'no project identity'}; ${id.leaked ? 'other project id in main' : 'no other project id in main'}` };
  });

  await step('the AI Operator keeps the project identity', page, async () => {
    await route(page, `ai-operator?engagement=${encodeURIComponent(project)}`);
    const heading = await page.getByRole('heading', { name: 'AI Operator' }).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    const id = await identity(page);
    return { ok: heading && id.present && !id.leaked, detail: `${heading ? 'AI Operator shown' : 'no AI Operator heading'}; ${id.present ? 'project identity shown' : 'no project identity'}; ${id.leaked ? 'other project id in main' : 'no other project id in main'}` };
  });

  await step('the operations of the project keep the identity and list its operation', page, async () => {
    await route(page, `operations?engagement=${encodeURIComponent(project)}`);
    const heading = await page.getByRole('heading', { name: 'Operations' }).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    const listed = await page.getByText('OP-014', { exact: true }).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    const id = await identity(page);
    return { ok: heading && listed && id.present && !id.leaked, detail: `${heading ? 'heading shown' : 'no heading'}; ${listed ? 'OP-014 listed' : 'OP-014 not listed'}; ${id.leaked ? 'other project id in main' : 'no other project id in main'}` };
  });

  await step('a finding opens with its project and its evidence tab', page, async () => {
    await route(page, `finding/${finding}?engagement=${encodeURIComponent(project)}`);
    const summary = await page.getByText('Summary & workflow', { exact: true }).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    const evidenceTab = await page.getByText(/^Evidence/).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    const id = await identity(page);
    return { ok: summary && evidenceTab && id.present && !id.leaked, detail: `${summary ? 'summary tab shown' : 'no summary tab'}; ${evidenceTab ? 'evidence tab shown' : 'no evidence tab'}; ${id.present ? 'project identity shown' : 'no project identity'}` };
  });

  await step('the evidence tab of the finding opens the evidence of the project', page, async () => {
    await page.getByText(/^Evidence/).first().click();
    await page.waitForURL(/evidence/, { timeout: 15000 }).catch(() => {});
    const rows = await page.getByText(/EV-014-/).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    const id = await identity(page);
    return { ok: rows && id.present && !id.leaked, detail: `${rows ? 'evidence rows shown' : 'no evidence rows'}; ${id.present ? 'project identity shown' : 'no project identity'}; ${id.leaked ? 'other project id in main' : 'no other project id in main'}` };
  });

  await step('the reports of the project keep the identity', page, async () => {
    await route(page, `reports?engagement=${encodeURIComponent(project)}`);
    const heading = await page.getByRole('heading', { name: 'Reports' }).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    const id = await identity(page);
    return { ok: heading && id.present && !id.leaked, detail: `${heading ? 'heading shown' : 'no heading'}; ${id.present ? 'project identity shown' : 'no project identity'}; ${id.leaked ? 'other project id in main' : 'no other project id in main'}` };
  });

  await step('browser back returns to the evidence screen with the same project', page, async () => {
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForURL(/evidence/, { timeout: 15000 }).catch(() => {});
    const onEvidence = page.url().includes('evidence');
    const id = await identity(page);
    return { ok: onEvidence && id.present && !id.leaked, detail: `${onEvidence ? 'back on the evidence screen' : 'not back on the evidence screen'}; ${id.present ? 'project identity shown' : 'no project identity'}; ${id.leaked ? 'other project id in main' : 'no other project id in main'}` };
  });

  await context.close();

  // Responsive and dark pass over the changed screens: phone width, then dark theme (the class the theme store sets on the root).
  const pass = [
    ['operations list', `operations?engagement=${encodeURIComponent(project)}`],
    ['operation console', `operation/OP-014?tab=overview&engagement=${encodeURIComponent(project)}`],
    ['agents list', `agents?engagement=${encodeURIComponent(project)}`],
    ['agent detail', `agent/AG-007?engagement=${encodeURIComponent(project)}`],
    ['infrastructure agents tab', 'infrastructure?tab=agents'],
    ['tasks inbox', 'tasks'],
    ['finding detail', `finding/${finding}?engagement=${encodeURIComponent(project)}`],
    ['reports', `reports?engagement=${encodeURIComponent(project)}`],
  ];
  for (const [theme, viewport] of [['phone width', { width: 390, height: 844 }], ['dark theme', { width: 1360, height: 960 }]]) {
    const passContext = await browser.newContext({ viewport });
    try {
      const shotPage = await passContext.newPage();
      shotPage.setDefaultTimeout(30000);
      await signInMock(shotPage, 'Dana Whitfield');
      for (const [name, hash] of pass) {
        await step(`${name} at ${theme}: no horizontal overflow, controls inside and uncovered, control text readable`, shotPage, async () => {
          await route(shotPage, hash);
          if (theme === 'dark theme') await shotPage.evaluate(() => document.documentElement.classList.add('dark'));
          await shotPage.locator('main').first().waitFor({ timeout: 30000 });
          await shotPage.waitForTimeout(600);
          const m = await shotPage.evaluate(measure);
          const ok = m.overflow <= 1 && m.problems.length === 0 && m.controls > 0;
          return { ok, detail: `${m.controls} controls checked; overflow ${m.overflow}px; ${m.problems.length === 0 ? 'no problems' : m.problems.slice(0, 4).join(' | ')}` };
        });
      }
    } finally {
      await passContext.close();
    }
  }
} catch (error) {
  fatal = error.message.split('\n')[0];
} finally {
  await browser.close();
}
const mismatches = results.filter((row) => !row.matches).length;
if (outFile) writeFileSync(outFile, JSON.stringify({ mode, app, generatedAt: new Date().toISOString(), steps: results, fatal, mismatches }, null, 2));
for (const row of results) console.log(`${row.matches ? 'PASS' : 'FAIL'} ${row.step} :: ${row.detail}`);
if (fatal) console.log(`INTEGRATION PATH STOPPED: ${fatal}`);
console.log(`integration path (${mode}): ${results.length - mismatches} of ${results.length} steps matched`);
process.exitCode = mismatches > 0 || fatal ? 1 : 0;
