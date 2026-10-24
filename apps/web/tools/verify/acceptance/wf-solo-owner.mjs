// WF-solo · One person runs the whole flow with the owner account on a single-operator deployment (ADR-0100): a plan is
// approved from the Governance page, a scope revision is approved, a finding is captured, reviewed and confirmed, and a
// report with that finding is submitted, approved and exported as DOCX. Every write is read back from the test database.
// Test stack only. Usage: node tools/verify/acceptance/wf-solo-owner.mjs --fixtures <manifest.json> --hold <hold.json> --out <result.json>
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { loadConnection, parseArgs, ApiSession, dbScalar, Recorder } from './lib.mjs';

const args = parseArgs(process.argv);
const conn = loadConnection({ fixtures: args.fixtures, holdFile: args.hold, app: args.app, api: args.api });
const outFile = args.out ?? 'wf-solo-owner.json';
const recorder = new Recorder('WF-solo one person, owner account (ADR-0100)', outFile);
const stamp = Date.now().toString(36);
const project = conn.project;
const prefix = `/api/engagements/${project}`;
const scratch = path.join(path.dirname(path.resolve(outFile)), `wf-solo-${stamp}`);
mkdirSync(scratch, { recursive: true });
// Windows' bsdtar reads zip archives; a Git-for-Windows tar on the PATH does not.
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

const owner = await new ApiSession(conn.api, 'owner').login(conn.owner.username, conn.owner.password);
const ok = (response) => response.status >= 200 && response.status < 300;

const capabilities = (await owner.call('GET', '/api/capabilities')).json ?? {};
recorder.note(
  'the capabilities document advertises single-operator review',
  capabilities.independentReview === 'single-operator' ? 'PASS' : 'FAIL',
  `independentReview ${JSON.stringify(capabilities.independentReview)}`,
);

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1360, height: 960 } });
page.setDefaultTimeout(60000);

try {
  // 1. Plan: the owner drafts, proposes and approves it from the Governance page.
  const draft = await owner.call('POST', `${prefix}/plans`, { objective: `Solo plan ${stamp}`, methods: ['web'] });
  const planId = draft.json?.id;
  const proposed = planId ? await owner.call('POST', `${prefix}/plans/${planId}/propose`) : { status: 0 };
  await recorder.check('the owner proposes their own plan', async () => ({
    ok: ok(proposed),
    detail: `propose HTTP ${proposed.status}; database ${dbScalar(conn.db, `select status from "BusinessPlan" where id='${planId}'`)}`,
  }));

  await page.goto(`${conn.app}/?dataMode=real#/login`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.locator('#login-username').waitFor({ timeout: 60000 });
  await page.fill('#login-username', conn.owner.username);
  await page.fill('#login-password', conn.owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('#login-username').waitFor({ state: 'detached', timeout: 60000 });
  await page.goto(`${conn.app}/?dataMode=real#/project/${project}?tab=governance`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Business plans').first().waitFor({ timeout: 60000 });
  const row = page.locator('tr', { hasText: `Solo plan ${stamp}` }).first();
  await recorder.check('the Governance page offers the owner an Approve control on their own plan', async () => {
    await row.waitFor({ timeout: 30000 });
    const visible = await row.getByRole('button', { name: 'Approve' }).count();
    return { ok: visible > 0, detail: `Approve controls on the owner's proposed plan: ${visible}` };
  });
  await recorder.check('the owner approves the plan from the page; the database records approved and the decider', async () => {
    await row.getByRole('button', { name: 'Approve' }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Business plans').first().waitFor({ timeout: 60000 });
    await page.locator('tr', { hasText: `Solo plan ${stamp}` }).first().getByText('approved', { exact: false }).waitFor({ timeout: 30000 });
    const status = dbScalar(conn.db, `select status from "BusinessPlan" where id='${planId}'`);
    const decidedBy = dbScalar(conn.db, `select "decidedBy" from "BusinessPlan" where id='${planId}'`);
    const requestedBy = dbScalar(conn.db, `select "requestedBy" from "BusinessPlan" where id='${planId}'`);
    return { ok: status === 'approved' && decidedBy.length > 0 && decidedBy === requestedBy, detail: `database status ${status}; decidedBy is the author: ${decidedBy === requestedBy}` };
  });

  // 2. Scope revision: the owner submits a change with its ROE window and approves it.
  const roe = { windows: [{ start: '2026-01-01T00:00:00Z', end: '2027-12-31T23:59:59Z', tz: 'UTC' }], emergencyContacts: ['stack-verification-contact'], restrictions: [] };
  const revision = await owner.call('POST', `${prefix}/scope/revisions`, { diff: { added: [`solo-${stamp}.verify.example.test`], removed: [], rationale: 'Single-operator scope change.' }, roe });
  const revisionId = revision.json?.id;
  const decided = revisionId ? await owner.call('POST', `${prefix}/scope/revisions/${revisionId}/decision`, { decision: 'approved', comment: 'Single-operator ROE.' }) : { status: 0 };
  await recorder.check('the owner approves their own scope revision', async () => ({
    ok: ok(revision) && ok(decided) && dbScalar(conn.db, `select status from "ScopeRevision" where id='${revisionId}'`) === 'approved',
    detail: `submit HTTP ${revision.status}; approve HTTP ${decided.status}; database ${revisionId ? dbScalar(conn.db, `select status from "ScopeRevision" where id='${revisionId}'`) : 'none'}`,
  }));

  // 3. Finding: capture the evidence, classify it, create the finding, send it to review and confirm it.
  const bytes = Buffer.from(`solo evidence ${stamp}\n`, 'utf8');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const capture = await owner.call('POST', `${prefix}/artifacts/captures`, { requestId: randomUUID(), filename: `solo-${stamp}.txt`, mediaType: 'text/plain', base64: bytes.toString('base64') });
  const captureId = capture.json?.id;
  if (captureId) await owner.call('PATCH', `${prefix}/artifacts/captures/${captureId}/classification`, { classification: 'standard', expectedVersion: 1, reason: 'Single-operator fixture.' });
  const finding = await owner.call('POST', `${prefix}/curated-findings`, {
    title: `Solo finding ${stamp}`, severity: 'medium', detail: 'Single-operator fixture finding.',
    reproduction: { prerequisites: 'Generated fixture only', inputs: 'No target', steps: ['Read the captured evidence'], expectedObservation: 'Exact bytes', limitations: 'No exploitation attempted', artifact: { captureId, digest } },
  });
  const findingId = finding.json?.id;
  const toReview = findingId ? await owner.call('POST', `${prefix}/curated-findings/${findingId}/transition`, { to: 'review', expectedVersion: finding.json.version ?? 1 }) : { status: 0 };
  const confirmed = findingId && ok(toReview) ? await owner.call('POST', `${prefix}/curated-findings/${findingId}/transition`, { to: 'confirmed', expectedVersion: (toReview.json?.version ?? (finding.json.version ?? 1) + 1) }) : { status: 0 };
  await recorder.check('the owner captures, creates, reviews and confirms a finding', async () => ({
    ok: ok(confirmed) && dbScalar(conn.db, `select status from "FindingRecord" where id='${findingId}'`) === 'confirmed',
    detail: `capture HTTP ${capture.status}; create HTTP ${finding.status}; review HTTP ${toReview.status}; confirm HTTP ${confirmed.status}; database ${findingId ? dbScalar(conn.db, `select status from "FindingRecord" where id='${findingId}'`) : 'none'}`,
  }));

  // 4. Report: a template, the reporting period and the owner as named reviewer; the finding is selected, the report is
  // submitted for review, approved by the owner, and exported as DOCX.
  const me = (await owner.call('GET', '/api/auth/session')).json?.actor?.id;
  const template = await owner.call('POST', `${prefix}/report-templates`, { name: `Solo template ${stamp}`, sections: [{ title: 'Summary', required: true }] });
  const templateId = template.json?.id;
  const report = await owner.call('POST', `${prefix}/report-records`, { title: `Solo report ${stamp}`, summary: `Solo summary ${stamp}.` });
  const reportId = report.json?.id;
  const setup = reportId && templateId && me ? await owner.call('PATCH', `${prefix}/report-records/${reportId}/setup`, { expectedVersion: report.json.version, templateId, periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-10-31T23:59:59.000Z', reviewerId: me }) : { status: 0 };
  // The template's required section must have content before submission.
  const written = ok(setup) ? await owner.call('PATCH', `${prefix}/report-records/${reportId}`, { expectedVersion: setup.json.version, sections: [{ title: 'Summary', content: `Single-operator summary ${stamp}.` }] }) : { status: 0 };
  const selected = ok(written) ? await owner.call('PUT', `${prefix}/report-records/${reportId}/findings`, { expectedVersion: written.json.version, findingIds: [findingId] }) : { status: 0 };
  const submitted = ok(selected) ? await owner.call('POST', `${prefix}/report-records/${reportId}/review`, { action: 'submit' }) : { status: 0 };
  const approved = ok(submitted) ? await owner.call('POST', `${prefix}/report-records/${reportId}/review`, { decision: 'approved', comment: 'Single-operator review.', expectedVersion: submitted.json?.version }) : { status: 0 };
  await recorder.check('the owner sets up, selects the finding, submits the report and approves it', async () => ({
    ok: ok(template) && ok(setup) && ok(selected) && ok(submitted) && ok(approved) && dbScalar(conn.db, `select status from "ReportRecord" where id='${reportId}'`) === 'approved',
    detail: `template HTTP ${template.status}; setup HTTP ${setup.status}; select HTTP ${selected.status}; submit HTTP ${submitted.status}; approve HTTP ${approved.status}; database ${reportId ? dbScalar(conn.db, `select status from "ReportRecord" where id='${reportId}'`) : 'none'}`,
  }));

  await recorder.check('the approved report exports as DOCX, with its title and the finding title', async () => {
    const exported = await owner.call('GET', `${prefix}/report-records/${reportId}/export?format=docx`);
    if (!ok(exported)) return { ok: false, detail: `export HTTP ${exported.status}` };
    const file = path.join(scratch, `report-${stamp}.docx`);
    writeFileSync(file, Buffer.from(exported.json.content, 'base64'));
    const xml = spawnSync(TAR, ['-xOf', file, 'word/document.xml'], { encoding: 'utf8' });
    rmSync(file, { force: true });
    const hasTitle = xml.stdout.includes(`Solo report ${stamp}`);
    const hasFinding = xml.stdout.includes(`Solo finding ${stamp}`);
    return { ok: xml.status === 0 && hasTitle && hasFinding, detail: `HTTP ${exported.status}; title ${hasTitle}; finding ${hasFinding}` };
  });
} finally {
  await browser.close();
  rmSync(scratch, { recursive: true, force: true });
}

const counts = recorder.save();
console.log(JSON.stringify(counts));
process.exitCode = (counts.FAIL ?? 0) > 0 ? 1 : 0;
