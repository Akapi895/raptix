// Operations click-through against the running mock app. The operations list shows the project's operations; a row opens its detail
// with the operation's own name; the same operation opened under another project is refused with the reason and shows no detail.
// Each step checks what the screen shows; a step that cannot run is recorded as failed and the rest run.
// Usage: node tools/verify/flows/operations-click.mjs --mode mock --app <url> --fixtures <manifest.json> --out <result.json>
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
const operation = 'OP-014';
const otherProject = 'RT-2026-015';
const results = [];

if (mode !== 'mock') {
  console.error('operations-click runs in mock mode only; real operations need a runtime the verification stack does not start.');
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

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
let fatal = null;
try {
  const context = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await signInMock(page, 'Dana Whitfield');

  await step('the operations list shows the project operations', page, async () => {
    await route(page, `operations?engagement=${encodeURIComponent(project)}`);
    const heading = await page.getByRole('heading', { name: 'Operations' }).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    const row = await page.getByText(operation, { exact: true }).first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    return { ok: heading && row, detail: `${heading ? 'heading shown' : 'no heading'}; ${row ? `${operation} listed` : `${operation} not listed`}` };
  });

  await step('a row opens the operation detail with its own name', page, async () => {
    await page.getByText(operation, { exact: true }).first().click();
    const name = await page.getByText('Internal environment discovery').first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    const id = await page.getByText(operation, { exact: true }).first().isVisible().catch(() => false);
    return { ok: name && id, detail: `${name ? 'operation name shown' : 'no operation name'}; ${id ? 'operation id shown' : 'no operation id'}` };
  });

  await step('the same operation under another project is refused with the reason and no detail', page, async () => {
    await route(page, `operation/${operation}?tab=overview&engagement=${encodeURIComponent(otherProject)}`);
    const refused = await page.getByText('Operation belongs to a different project').first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    const detail = await page.getByText('Internal environment discovery').count();
    return { ok: refused && detail === 0, detail: `${refused ? 'refusal with the reason shown' : 'no refusal'}; ${detail === 0 ? 'no operation detail shown' : 'operation detail shown'}` };
  });

  // Write paths run as the operator of the project (Taylor Chen can control the operation; Dana Whitfield, the admin, cannot).
  // The steps share one page: a route change reloads the mock dataset, so each step reads what the previous step left.
  const operatorContext = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  try {
    const operator = await operatorContext.newPage();
    operator.setDefaultTimeout(30000);
    await signInMock(operator, 'Taylor Chen');
    await route(operator, `operation/${operation}?tab=overview&engagement=${encodeURIComponent(project)}`);

    await step('pausing a running operation with a reason reports the pause and offers Resume', operator, async () => {
      await operator.getByRole('button', { name: 'Pause', exact: true }).first().click();
      await operator.getByLabel(/Reason for pausing/).fill('Flow pause check');
      await operator.getByRole('button', { name: 'Pause operation', exact: true }).click();
      const reported = await operator.getByText('Operation paused.', { exact: true }).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
      const resume = await operator.getByRole('button', { name: 'Resume', exact: true }).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
      return { ok: reported && resume, detail: `${reported ? 'pause reported' : 'no pause report'}; ${resume ? 'Resume offered' : 'Resume not offered'}` };
    });

    await step('resuming the paused operation rechecks it and reports it resumed', operator, async () => {
      await operator.getByRole('button', { name: 'Resume', exact: true }).first().click();
      await operator.getByRole('button', { name: 'Resume operation', exact: true }).click();
      const reported = await operator.getByText('Rechecks passed. Operation resumed.', { exact: true }).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
      const pause = await operator.getByRole('button', { name: 'Pause', exact: true }).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
      return { ok: reported && pause, detail: `${reported ? 'resume reported' : 'no resume report'}; ${pause ? 'Pause offered again' : 'Pause not offered'}` };
    });

    await step('stopping the operation with a reason reports the stop and then that it stopped', operator, async () => {
      await operator.getByRole('button', { name: 'Stop', exact: true }).first().click();
      await operator.getByLabel(/Reason for stopping/).fill('Flow stop check');
      await operator.getByRole('button', { name: 'Stop operation', exact: true }).click();
      const requested = await operator.getByText('Stop requested. Stopping…', { exact: true }).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
      const stopped = await operator.getByText('Operation stopped.', { exact: true }).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
      return { ok: requested && stopped, detail: `${requested ? 'stop requested reported' : 'no stop request report'}; ${stopped ? 'operation stopped reported' : 'no stopped report'}` };
    });
  } finally {
    await operatorContext.close();
  }

  await step('a viewer sees the pause control locked with its reason and gets no dialog or success report', page, async () => {
    const viewerContext = await browser.newContext({ viewport: { width: 1360, height: 960 } });
    try {
      const viewer = await viewerContext.newPage();
      viewer.setDefaultTimeout(30000);
      await signInMock(viewer, 'Casey Nguyen');
      await route(viewer, `operation/${operation}?tab=overview&engagement=${encodeURIComponent(project)}`);
      const gate = viewer.locator('[aria-disabled="true"]').filter({ hasText: 'Pause' }).first();
      const locked = await gate.waitFor({ timeout: 20000 }).then(() => true, () => false);
      if (locked) await gate.hover();
      const reason = locked && await viewer.getByText('Why is this disabled?').first().waitFor({ timeout: 5000 }).then(() => true, () => false);
      const dialogs = await viewer.getByLabel(/Reason for pausing/).count();
      const reports = await viewer.getByText('Operation paused.', { exact: true }).count();
      return { ok: locked && reason && dialogs === 0 && reports === 0, detail: `${locked ? 'Pause locked' : 'no locked Pause control'}; ${reason ? 'reason shown' : 'no reason'}; ${dialogs === 0 ? 'no dialog' : 'dialog opened'}; ${reports === 0 ? 'no success report' : 'success reported'}` };
    } finally {
      await viewerContext.close();
    }
  });

  await context.close();
} catch (error) {
  fatal = error.message.split('\n')[0];
} finally {
  await browser.close();
}
const mismatches = results.filter((row) => !row.matches).length;
if (outFile) writeFileSync(outFile, JSON.stringify({ mode, app, generatedAt: new Date().toISOString(), steps: results, fatal, mismatches }, null, 2));
for (const row of results) console.log(`${row.matches ? 'PASS' : 'FAIL'} ${row.step} :: ${row.detail}`);
if (fatal) console.log(`OPERATIONS CLICK-THROUGH STOPPED: ${fatal}`);
console.log(`operations click-through (${mode}): ${results.length - mismatches} of ${results.length} steps matched`);
process.exitCode = mismatches > 0 || fatal ? 1 : 0;
