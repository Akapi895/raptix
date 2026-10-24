// WF-04 · Business plan: an operator drafts and proposes it, the operator cannot approve their own plan, an independent reviewer
// approves it, and a viewer reads the result without decision controls. Each write is read back in the browser after a reload
// and checked in the test database. Test stack only. Usage: node tools/verify/acceptance/wf-plan-approval.mjs --fixtures <f> --hold <h> --out <r>
import { chromium } from 'playwright';
import { loadConnection, parseArgs, dbScalar, Recorder } from './lib.mjs';

const args = parseArgs(process.argv);
const conn = loadConnection({ fixtures: args.fixtures, holdFile: args.hold, app: args.app, api: args.api });
const recorder = new Recorder('WF-04 business plan approval', args.out ?? 'wf-plan-approval.json');
const stamp = Date.now().toString(36);
const objective = `Acceptance plan ${stamp}`;
const project = conn.project;

async function signIn(page, who) {
  await page.goto(`${conn.app}/#/projects`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.locator('#login-username').waitFor({ timeout: 60000 });
  await page.fill('#login-username', who.username);
  await page.fill('#login-password', who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('#login-username').waitFor({ state: 'detached', timeout: 30000 });
}

async function openGovernance(page) {
  await page.goto(`${conn.app}/#/project/${project}?tab=governance`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Business plans').first().waitFor({ timeout: 60000 });
}

const row = (page) => page.locator('tr', { hasText: objective });
const dbStatus = () => dbScalar(conn.db, `select status from "BusinessPlan" where "engagementId"='${project}' and body->>'objective'='${objective}' order by version desc limit 1`);

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
const contexts = {};
const pages = {};
for (const who of ['operator', 'reviewer', 'viewer']) {
  contexts[who] = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  pages[who] = await contexts[who].newPage();
  pages[who].setDefaultTimeout(30000);
}

try {
  await signIn(pages.operator, conn.operator);
  await openGovernance(pages.operator);

  await recorder.check('operator drafts a plan through the form and sees it as draft', async () => {
    await pages.operator.fill('#plan-objective', objective);
    await pages.operator.getByRole('button', { name: 'Draft plan' }).click();
    await row(pages.operator).first().waitFor({ timeout: 30000 });
    const text = await row(pages.operator).first().innerText();
    const status = await dbStatus();
    return { ok: /draft/i.test(text) && status === 'draft', detail: `row shows draft: ${/draft/i.test(text)}; database status ${status}` };
  });

  await recorder.check('operator proposes the plan; the row and the database show proposed', async () => {
    await row(pages.operator).first().getByRole('button', { name: 'Propose' }).click();
    await pages.operator.reload({ waitUntil: 'domcontentloaded' });
    await pages.operator.getByText('Business plans').first().waitFor({ timeout: 60000 });
    await row(pages.operator).first().getByText('proposed', { exact: false }).waitFor({ timeout: 30000 });
    const status = await dbStatus();
    return { ok: status === 'proposed', detail: `database status ${status} after reload` };
  });

  await recorder.check('the author cannot approve their own proposal (the control is absent or refused, and nothing changes)', async () => {
    const approve = row(pages.operator).first().getByRole('button', { name: 'Approve' });
    const visible = await approve.count();
    if (visible > 0) {
      await approve.first().click();
      const refusal = await pages.operator.getByRole('alert').first().innerText({ timeout: 15000 }).catch(() => '');
      const status = await dbStatus();
      return { ok: status === 'proposed' && /independent/i.test(refusal), detail: `control shown; refusal "${refusal.slice(0, 120)}"; database ${status}` };
    }
    const status = await dbStatus();
    return { ok: status === 'proposed', detail: `no approve control for the author; database ${status}` };
  });

  await signIn(pages.reviewer, conn.reviewer);
  await openGovernance(pages.reviewer);

  await recorder.check('an independent reviewer approves the plan and the database records approved', async () => {
    await row(pages.reviewer).first().getByRole('button', { name: 'Approve' }).click();
    await pages.reviewer.reload({ waitUntil: 'domcontentloaded' });
    await pages.reviewer.getByText('Business plans').first().waitFor({ timeout: 60000 });
    await row(pages.reviewer).first().getByText('approved', { exact: false }).waitFor({ timeout: 30000 });
    const status = await dbStatus();
    const decided = dbScalar(conn.db, `select "decidedBy" from "BusinessPlan" where "engagementId"='${project}' and body->>'objective'='${objective}' order by version desc limit 1`);
    return { ok: status === 'approved' && decided.length > 0, detail: `database status ${status}; decidedBy recorded: ${decided.length > 0}` };
  });

  await signIn(pages.viewer, conn.viewer);
  await openGovernance(pages.viewer);

  await recorder.check('a viewer reads the approved plan and has no approve, reject or propose control', async () => {
    const text = await row(pages.viewer).first().innerText({ timeout: 30000 });
    const controls = await row(pages.viewer).first().getByRole('button', { name: /^(Approve|Reject|Propose)$/ }).count();
    const revise = await row(pages.viewer).first().getByRole('button', { name: 'Revise' }).count();
    return {
      ok: /approved/i.test(text) && controls === 0,
      detail: `shows approved: ${/approved/i.test(text)}; decision controls: ${controls}; Revise control visible: ${revise > 0}`,
      evidence: { reviseVisibleToViewer: revise > 0 },
    };
  });

} finally {
  await browser.close();
}

const counts = recorder.save();
console.log(JSON.stringify(counts));
process.exitCode = (counts.FAIL ?? 0) > 0 ? 1 : 0;
