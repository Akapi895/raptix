// WF-05 · Decisions and notifications: a scope revision from the operator becomes a pending decision that the Overview, the
// team tab and the task endpoint all count the same way; dismissing a notice does not resolve it; the reviewer's decision
// removes it; a capped inbox is shown as a lower bound. Tool approvals and emergency stops are not decision kinds of this
// inbox (checked against the kinds the endpoint returns). Test stack only.
// Usage: node tools/verify/acceptance/wf-decisions.mjs --fixtures <manifest.json> --hold <hold.json> --out <result.json>
import { chromium } from 'playwright';
import { loadConnection, parseArgs, ApiSession, dbScalar, Recorder } from './lib.mjs';

const args = parseArgs(process.argv);
const conn = loadConnection({ fixtures: args.fixtures, holdFile: args.hold, app: args.app, api: args.api });
const recorder = new Recorder('WF-05 decisions and notifications', args.out ?? 'wf-decisions.json');
const stamp = Date.now().toString(36);
const project = conn.project;

const sessions = {
  owner: await new ApiSession(conn.api, 'owner').login(conn.owner.username, conn.owner.password),
  operator: await new ApiSession(conn.api, 'operator').login(conn.operator.username, conn.operator.password),
  reviewer: await new ApiSession(conn.api, 'reviewer').login(conn.reviewer.username, conn.reviewer.password),
  viewer: await new ApiSession(conn.api, 'viewer').login(conn.viewer.username, conn.viewer.password),
};

/** Decision items of the inbox: every kind except emergency stops, which are attention items. */
function decisionsOf(view) {
  return (view.tasks ?? []).filter((task) => task.kind !== 'active-stop');
}

async function countFor(who, engagement) {
  const view = (await sessions[who].call('GET', '/api/tasks')).json ?? {};
  return decisionsOf(view).filter((task) => (engagement ? task.engagementId === engagement : true)).length;
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
const reviewerContext = await browser.newContext({ viewport: { width: 1360, height: 960 } });
const reviewerPage = await reviewerContext.newPage();
reviewerPage.setDefaultTimeout(30000);

/** The Overview's "Awaiting decisions" figure as shown on screen (a number, a number with a plus, or a state word). */
// The Overview's figure as shown on screen. It reads the same task endpoint as the checks, unscoped, so it is a lower bound when capped.
async function awaitingValue() {
  // A hash-only change keeps the app's query cache (30 s stale time), so the page is left first and loaded again.
  await reviewerPage.goto('about:blank');
  await reviewerPage.goto(`${conn.app}/#/overview`, { waitUntil: 'domcontentloaded' });
  const card = reviewerPage.getByRole('button', { name: /Awaiting decisions/ }).first();
  await card.waitFor({ timeout: 60000 });
  await reviewerPage.waitForTimeout(600);
  const lines = (await card.innerText()).split('\n').map((line) => line.trim());
  return lines.find((line) => /^(\d+\+?|Pending|Unavailable|Not recorded)$/.test(line)) ?? '';
}

try {
  await reviewerPage.goto(`${conn.app}/#/login`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await reviewerPage.locator('#login-username').waitFor({ timeout: 60000 });
  await reviewerPage.fill('#login-username', conn.reviewer.username);
  await reviewerPage.fill('#login-password', conn.reviewer.password);
  await reviewerPage.getByRole('button', { name: 'Sign in' }).click();
  await reviewerPage.getByRole('navigation', { name: 'Main navigation' }).waitFor({ timeout: 60000 });

  const before = { reviewer: await countFor('reviewer', project), viewer: await countFor('viewer', project), operator: await countFor('operator', project) };
  let revisionId = null;

  await recorder.check('the operator submits a scope revision and the database holds it as pending', async () => {
    // The revision carries the stack's ROE window: an approved revision without windows becomes the ROE in force (see OPEN-ISSUES).
    const roe = { windows: [{ start: '2026-01-01T00:00:00Z', end: '2027-12-31T23:59:59Z', tz: 'UTC' }], emergencyContacts: ['stack-verification-contact'], restrictions: [] };
    const response = await sessions.operator.call('POST', `/api/engagements/${project}/scope/revisions`, { diff: { added: [`wp-${stamp}.verify.example.test`], removed: [], rationale: 'Acceptance scope change for the decisions check.' }, roe });
    revisionId = response.json?.id ?? null;
    const status = revisionId ? dbScalar(conn.db, `select status from "ScopeRevision" where id='${revisionId}'`) : 'none';
    return { ok: response.status < 300 && status === 'pending', detail: `HTTP ${response.status}; database status ${status}` };
  });

  await recorder.check('every role that sees the project counts the new decision, and the counts move by one', async () => {
    const after = { reviewer: await countFor('reviewer', project), viewer: await countFor('viewer', project), operator: await countFor('operator', project) };
    const moved = ['reviewer', 'viewer', 'operator'].every((who) => after[who] === before[who] + 1);
    return { ok: moved, detail: `before ${JSON.stringify(before)}, after ${JSON.stringify(after)}` };
  });

  await recorder.check('the Overview "Awaiting decisions" figure matches the task endpoint for the reviewer', async () => {
    // The Overview counts every authorized project, as the endpoint does: both are compared unscoped.
    const apiCount = await countFor('reviewer');
    const shown = await awaitingValue();
    return { ok: shown === String(apiCount) || shown === `${apiCount}+`, detail: `Overview shows "${shown}", the endpoint counts ${apiCount}` };
  });

  await recorder.check('the team tab lists the decision, and its Open link points to the project', async () => {
    await reviewerPage.goto(`${conn.app}/#/project/${project}?tab=team`, { waitUntil: 'domcontentloaded' });
    const region = reviewerPage.getByRole('region', { name: 'Decisions' });
    await region.waitFor({ timeout: 60000 });
    const text = await region.innerText();
    const href = await region.getByRole('link', { name: 'Open' }).first().getAttribute('href');
    return { ok: /scope revision/i.test(text) && String(href).includes(project), detail: `lists the revision: ${/scope revision/i.test(text)}; Open link ${href}` };
  });

  // Notices reach the author of a decided item (the plan decision of WF-04 notifies the operator), so the operator is the reader here.
  await recorder.check('dismissing a notice does not resolve a decision', async () => {
    const notices = (await sessions.operator.call('GET', '/api/notices')).json;
    const list = Array.isArray(notices) ? notices : (notices?.notices ?? []);
    const first = list[0];
    if (!first) return { status: 'NV', detail: 'no notice exists for the operator in this stack (run WF-04 first)' };
    const beforeDismiss = await countFor('operator', project);
    await sessions.operator.call('POST', `/api/notices/${first.id}/dismiss`);
    const afterDismiss = await countFor('operator', project);
    const stillPending = dbScalar(conn.db, `select status from "ScopeRevision" where id='${revisionId}'`) === 'pending';
    return { ok: afterDismiss === beforeDismiss && stillPending, detail: `operator decisions before the dismiss ${beforeDismiss}, after ${afterDismiss}; revision still pending: ${stillPending}` };
  });

  await recorder.check('the reviewer approves the revision; the database and the count return to the baseline', async () => {
    const decision = await sessions.reviewer.call('POST', `/api/engagements/${project}/scope/revisions/${revisionId}/decision`, { decision: 'approved', comment: 'Acceptance decision' });
    const status = dbScalar(conn.db, `select status from "ScopeRevision" where id='${revisionId}'`);
    const after = await countFor('reviewer', project);
    return { ok: decision.status < 300 && status === 'approved' && after === before.reviewer, detail: `HTTP ${decision.status}; database ${status}; reviewer count ${after} (baseline ${before.reviewer})` };
  });

  await recorder.check('the Overview figure follows the approval', async () => {
    const apiCount = await countFor('reviewer');
    const shown = await awaitingValue();
    return { ok: shown === String(apiCount) || shown === `${apiCount}+`, detail: `Overview shows "${shown}"; the endpoint counts ${apiCount} after the approval` };
  });

  await recorder.check('the author cannot approve their own revision (refused by the server, nothing changes)', async () => {
    const created = await sessions.operator.call('POST', `/api/engagements/${project}/scope/revisions`, { diff: { added: [`self-${stamp}.verify.example.test`], removed: [], rationale: 'Acceptance self-decision check.' } });
    const id = created.json?.id;
    const self = await sessions.operator.call('POST', `/api/engagements/${project}/scope/revisions/${id}/decision`, { decision: 'approved' });
    const status = dbScalar(conn.db, `select status from "ScopeRevision" where id='${id}'`);
    return { ok: self.status === 403 && status === 'pending', detail: `author decision HTTP ${self.status}; database ${status}` };
  });

  await recorder.check('tool approvals are not a kind of this inbox', async () => {
    const view = (await sessions.reviewer.call('GET', '/api/tasks')).json ?? {};
    const kinds = [...new Set((view.tasks ?? []).map((task) => task.kind))];
    const ok = !kinds.some((kind) => /tool/i.test(kind));
    return { ok, detail: `kinds present: ${kinds.join(', ') || 'none'}` };
  });

  await recorder.check('a capped inbox is shown with a plus rather than as an exact number', async () => {
    // A second project with 26 pending scope revisions: the endpoint returns at most 25 per kind, so the read is limited.
    const capStamp = `${stamp}c`;
    const created = await sessions.owner.call('POST', '/api/engagements', {
      name: `cap-${capStamp}`, displayName: `Capped inbox ${capStamp}`, targetType: 'web_url',
      targetValue: `https://cap-${capStamp}.verification.invalid`, authorizationConfirmed: true, brief: 'Generated fixture for the capped inbox. No target contact.',
    });
    const capProject = created.json?.id;
    if (!capProject) throw new Error(`project create HTTP ${created.status}`);
    await sessions.owner.call('POST', `/api/engagements/${capProject}/members`, { username: conn.reviewer.username, displayName: 'Reviewer', password: conn.reviewer.password, role: 'reviewer' });
    await sessions.owner.call('POST', `/api/engagements/${capProject}/members`, { username: conn.operator.username, displayName: 'Operator', password: conn.operator.password, role: 'operator' });
    for (let i = 0; i < 26; i += 1) {
      const submitted = await sessions.operator.call('POST', `/api/engagements/${capProject}/scope/revisions`, { diff: { added: [`cap${i}-${capStamp}.verify.example.test`], removed: [], rationale: 'Acceptance capped inbox fixture.' } });
      if (submitted.status >= 300) throw new Error(`revision ${i} HTTP ${submitted.status}`);
    }
    const view = (await sessions.reviewer.call('GET', '/api/tasks')).json ?? {};
    const rows = (view.tasks ?? []).filter((task) => task.engagementId === capProject && task.kind === 'scope-revision').length;
    const shown = await awaitingValue();
    const limited = Array.isArray(view.limitedKinds) && view.limitedKinds.includes('scope-revision');
    return { ok: rows === 25 && limited && shown.endsWith('+'), detail: `endpoint returns ${rows} scope rows; limitedKinds ${JSON.stringify(view.limitedKinds)}; Overview shows "${shown}"` };
  });
} finally {
  await reviewerContext.close();
  await browser.close();
}

const counts = recorder.save();
console.log(JSON.stringify(counts));
process.exitCode = (counts.FAIL ?? 0) > 0 ? 1 : 0;
