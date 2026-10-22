// Assets and library capability checklist against the live stack. It runs the operations of the asset and library ports through
// the real adapters (features/assets/remote.ts, features/library/remote.ts) inside the running app, so each call uses the same
// transport, session and CSRF handling as the screens. The author signs in as the owner of the fixtures; the reviewer signs in
// for the proposal decision (the adapter refuses a reviewer who is the author). Each operation states the outcome it expects:
// an operation the port declares refused (for example a scope approval in real mode) is recorded as a match when it is refused.
// The exit code is 1 when an outcome differs from the expectation or the flow itself fails.
// Usage: node tools/verify/flows/assets-library.mjs --app <url> --fixtures <manifest.json> --out <result.json>
// Env: RAPTIX_VERIFY_USER, RAPTIX_VERIFY_PASSWORD (author), RAPTIX_VERIFY_REVIEWER, RAPTIX_VERIFY_REVIEWER_PASSWORD (reviewer).
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const app = arg('--app');
const fixtures = JSON.parse(readFileSync(arg('--fixtures'), 'utf8'));
const outFile = arg('--out');
const importIdent = `stack-host-${Date.now().toString(36)}.verify.example.test`;

async function signIn(page, username, password) {
  await page.goto(`${app}/?dataMode=real#/projects`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.locator('#login-username').waitFor({ timeout: 60000 });
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('#login-username').waitFor({ state: 'detached', timeout: 30000 });
}

// Everything below runs inside the page with the page's own module instances.
async function runAssets({ projectId, assetId, ident, knowledgeGraph }) {
  const remote = await import('/src/features/assets/remote.ts');
  const auth = await import('/src/platform/auth-api.ts');
  const session = await auth.fetchAuthSession();
  if (!session?.actor) return { fatal: 'no authenticated actor for the author context', rows: [] };
  const ctx = { actor: { id: session.actor.id, role: 'admin' }, projectId, corr: `flow-assets-${Date.now()}` };
  const svc = remote.createRealAssetService();
  const rows = [];
  const shape = (data) => {
    if (data === null || data === undefined) return String(data);
    if (Array.isArray(data)) return `array(${data.length})`;
    if (typeof data === 'object') return `{${Object.keys(data).slice(0, 12).join(',')}}`;
    return String(data);
  };
  const attempt = async (op, expect, run) => {
    try {
      const res = await run();
      const outcome = res.ok ? 'ok' : 'refused';
      rows.push({ op, expect, outcome, matches: outcome === expect, detail: res.ok ? shape(res.data) : `${res.failure.kind}: ${res.failure.message}` });
      return res;
    } catch (error) {
      rows.push({ op, expect, outcome: 'threw', matches: false, detail: `threw: ${error.message}` });
      return { ok: false };
    }
  };
  rows.push({ op: 'capabilities', expect: 'ok', outcome: 'ok', matches: svc.capabilities.scopeApprovalRequests === false && svc.capabilities.observedGraph === true, detail: JSON.stringify(svc.capabilities) });
  await attempt('list', 'ok', () => svc.list(ctx, { page: 1, pageSize: 10 }));
  await attempt('get', 'ok', () => svc.get(ctx, assetId));
  await attempt('scope', 'ok', () => svc.scope(ctx));
  await attempt(knowledgeGraph ? 'observedGraph' : 'observedGraph (no knowledge graph in this stack)', knowledgeGraph ? 'ok' : 'refused', () => svc.observedGraph(ctx));
  const row = { name: 'stack-host-imported', ident, type: 'Host', os: 'Linux', owner: 'Ops Team', scope: 'in', source: 'CSV import' };
  await attempt('importRows (new host)', 'ok', () => svc.importRows(ctx, [row]));
  await attempt('importRows (same host again, server skips it)', 'ok', () => svc.importRows(ctx, [row]));
  await attempt('importRows (unknown type refused)', 'refused', () => svc.importRows(ctx, [{ ...row, name: 'stack-mobile', ident: 'stack-mobile.verify.example.test', type: 'Mobile' }]));
  await attempt('importRows (empty batch refused)', 'refused', () => svc.importRows(ctx, []));
  const found = await svc.list(ctx, { q: ident, page: 1, pageSize: 10 });
  const importedId = found.ok ? found.data.items[0]?.asset.id : undefined;
  if (!importedId) rows.push({ op: 'lookup imported asset', expect: 'ok', outcome: 'refused', matches: false, detail: 'the imported host is not in the list' });
  if (importedId) {
    await attempt('changeScope (to in scope without an approved revision refused)', 'refused', () => svc.changeScope(ctx, importedId, 'in'));
    await attempt('changeScope (unclassified refused)', 'refused', () => svc.changeScope(ctx, importedId, 'unclassified'));
  }
  await attempt('requestScopeApproval (real mode refuses here)', 'refused', () => svc.requestScopeApproval(ctx, { note: 'checklist', diff: 'checklist' }));
  return { fatal: null, rows };
}

async function runLibrary({ projectId, skillName, techniqueId, proposalId }) {
  const remote = await import('/src/features/library/remote.ts');
  const auth = await import('/src/platform/auth-api.ts');
  const session = await auth.fetchAuthSession();
  if (!session?.actor) return { fatal: 'no authenticated actor for the author context', rows: [] };
  const ctx = { actor: { id: session.actor.id, role: 'admin' }, projectId, corr: `flow-library-${Date.now()}` };
  const svc = remote.createRealLibraryService();
  const rows = [];
  const shape = (data) => {
    if (data === null || data === undefined) return String(data);
    if (Array.isArray(data)) return `array(${data.length})`;
    if (typeof data === 'object') return `{${Object.keys(data).slice(0, 12).join(',')}}`;
    return String(data);
  };
  const attempt = async (op, expect, run) => {
    try {
      const res = await run();
      const outcome = res.ok ? 'ok' : 'refused';
      rows.push({ op, expect, outcome, matches: outcome === expect, detail: res.ok ? shape(res.data) : `${res.failure.kind}: ${res.failure.message}` });
      return res;
    } catch (error) {
      rows.push({ op, expect, outcome: 'threw', matches: false, detail: `threw: ${error.message}` });
      return { ok: false };
    }
  };
  await attempt('corpus', 'ok', () => svc.corpus(ctx, {}));
  await attempt('skill', 'ok', () => svc.skill(ctx, skillName));
  await attempt('technique', 'ok', () => svc.technique(ctx, techniqueId));
  await attempt('proposals', 'ok', () => svc.proposals(ctx));
  const current = await attempt('proposal', 'ok', () => svc.proposal(ctx, proposalId));
  if (!current.ok) return { fatal: 'the proposal fixture cannot be read', rows };
  const amended = await attempt('amend (author, draft)', 'ok', () => svc.amend(ctx, proposalId, { proposedBody: `${current.data.proposedBody}\n<!-- amended by the checklist -->\n`, expectedVersion: current.data.version, rationale: 'checklist' }));
  if (!amended.ok) return { fatal: 'the amend step refused, so the review cannot continue', rows };
  const proposed = await attempt('propose (draft to proposed)', 'ok', () => svc.propose(ctx, proposalId));
  if (!proposed.ok) return { fatal: 'the propose step refused, so the review cannot continue', rows };
  await attempt('decide (author refused)', 'refused', () => svc.decide(ctx, proposalId, { decision: 'approved', expectedVersion: proposed.data.version, comment: 'author' }));
  return { fatal: null, rows, expectedVersion: proposed.data.version };
}

async function runReview({ projectId, proposalId, expectedVersion }) {
  const remote = await import('/src/features/library/remote.ts');
  const auth = await import('/src/platform/auth-api.ts');
  const session = await auth.fetchAuthSession();
  if (!session?.actor) return { fatal: 'no authenticated actor for the reviewer context', rows: [] };
  const ctx = { actor: { id: session.actor.id, role: 'reviewer' }, projectId, corr: `flow-review-${Date.now()}` };
  const svc = remote.createRealLibraryService();
  const rows = [];
  const attempt = async (op, expect, run) => {
    try {
      const res = await run();
      const outcome = res.ok ? 'ok' : 'refused';
      rows.push({ op, expect, outcome, matches: outcome === expect, detail: res.ok ? `status ${res.data.status}` : `${res.failure.kind}: ${res.failure.message}` });
      return res;
    } catch (error) {
      rows.push({ op, expect, outcome: 'threw', matches: false, detail: `threw: ${error.message}` });
      return { ok: false };
    }
  };
  const decided = await attempt('decide (reviewer approves)', 'ok', () => svc.decide(ctx, proposalId, { decision: 'approved', expectedVersion, comment: 'checklist' }));
  if (!decided.ok) return { fatal: 'the reviewer decision refused, so the export cannot run', rows };
  await attempt('export (approved proposal)', 'ok', () => svc.exportProposal(ctx, proposalId));
  return { fatal: null, rows };
}

async function runLibraryLate({ projectId, proposalId, skillName }) {
  const remote = await import('/src/features/library/remote.ts');
  const auth = await import('/src/platform/auth-api.ts');
  const session = await auth.fetchAuthSession();
  if (!session?.actor) return { fatal: 'no authenticated actor for the author context', rows: [] };
  const ctx = { actor: { id: session.actor.id, role: 'admin' }, projectId, corr: `flow-library-late-${Date.now()}` };
  const svc = remote.createRealLibraryService();
  const rows = [];
  const attempt = async (op, expect, run) => {
    try {
      const res = await run();
      const outcome = res.ok ? 'ok' : 'refused';
      rows.push({ op, expect, outcome, matches: outcome === expect, detail: res.ok ? `status ${res.data.status ?? 'exported'}` : `${res.failure.kind}: ${res.failure.message}` });
      return res;
    } catch (error) {
      rows.push({ op, expect, outcome: 'threw', matches: false, detail: `threw: ${error.message}` });
      return { ok: false };
    }
  };
  await attempt('export (author reads the approved proposal)', 'ok', () => svc.exportProposal(ctx, proposalId));
  await attempt('amend (approved proposal refused)', 'refused', () => svc.amend(ctx, proposalId, { proposedBody: 'late edit', expectedVersion: 99, rationale: 'checklist' }));
  await attempt('submit (new draft for the same skill)', 'ok', () => svc.submit(ctx, { skillName, proposedBody: `# ${skillName}\n\nNew draft from the checklist.\n`, rationale: 'checklist' }));
  return { fatal: null, rows };
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
const results = [];
const fatal = [];
const notRun = [];
try {
  const authorContext = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  const authorPage = await authorContext.newPage();
  authorPage.setDefaultTimeout(60000);
  await signIn(authorPage, process.env.RAPTIX_VERIFY_USER, process.env.RAPTIX_VERIFY_PASSWORD);
  const assets = await authorPage.evaluate(runAssets, { projectId: fixtures.project, assetId: fixtures.asset, ident: importIdent, knowledgeGraph: fixtures.knowledgeGraph === true });
  results.push(...assets.rows);
  if (assets.fatal) fatal.push(assets.fatal);
  // Without a seeded proposal the library routes are not registered (no knowledge graph), so the library operations are not run.
  const library = fixtures.proposal ? await authorPage.evaluate(runLibrary, { projectId: fixtures.project, skillName: fixtures.playbook, techniqueId: fixtures.technique, proposalId: fixtures.proposal }) : { fatal: null, rows: [] };
  results.push(...library.rows);
  if (library.fatal) fatal.push(library.fatal);
  if (!fixtures.proposal) notRun.push('library operations: the knowledge graph is not running in this stack, so the corpus and proposal routes are not registered');
  if (fixtures.proposal && !library.fatal) {
    const reviewerContext = await browser.newContext({ viewport: { width: 1360, height: 960 } });
    const reviewerPage = await reviewerContext.newPage();
    reviewerPage.setDefaultTimeout(60000);
    await signIn(reviewerPage, process.env.RAPTIX_VERIFY_REVIEWER, process.env.RAPTIX_VERIFY_REVIEWER_PASSWORD);
    const review = await reviewerPage.evaluate(runReview, { projectId: fixtures.project, proposalId: fixtures.proposal, expectedVersion: library.expectedVersion });
    results.push(...review.rows);
    if (review.fatal) fatal.push(review.fatal);
    await reviewerContext.close();
    const late = await authorPage.evaluate(runLibraryLate, { projectId: fixtures.project, proposalId: fixtures.proposal, skillName: fixtures.playbook });
    results.push(...late.rows);
    if (late.fatal) fatal.push(late.fatal);
  }
} catch (error) {
  fatal.push(error.message);
} finally {
  await browser.close();
}
const mismatches = results.filter((row) => !row.matches).length;
if (outFile) writeFileSync(outFile, JSON.stringify({ app, generatedAt: new Date().toISOString(), rows: results, fatal, notRun, mismatches }, null, 2));
for (const row of results) console.log(`${row.matches ? 'PASS' : 'MISMATCH'} ${row.op} [expect ${row.expect}, got ${row.outcome}] :: ${row.detail}`);
for (const reason of fatal) console.log(`FLOW STOPPED: ${reason}`);
for (const reason of notRun) console.log(`NOT RUN: ${reason}`);
console.log(`assets and library checklist: ${results.length - mismatches} of ${results.length} operations matched their expectation`);
process.exitCode = mismatches > 0 || fatal.length > 0 ? 1 : 0;
