// Reports capability checklist against the live stack. It runs the operations of the reports port through the real adapter
// (features/reports/remote.ts) inside the running app, so each call uses the same transport, session and CSRF handling as the
// screens. The author signs in as the owner of the fixtures; the reviewer signs in in a second browser context for the review
// decision (the adapter refuses a reviewer who is the author). Each operation is recorded with its outcome and the shape of the
// data it returned. The exit code is 1 when an operation is refused or throws, or when the flow itself fails.
// Usage: node tools/verify/flows/reports.mjs --app <url> --fixtures <manifest.json> --out <result.json>
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

async function signIn(page, username, password) {
  await page.goto(`${app}/#/projects`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.locator('#login-username').waitFor({ timeout: 60000 });
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('#login-username').waitFor({ state: 'detached', timeout: 30000 });
}

// Everything below runs inside the page with the page's own module instances.
async function runAuthor({ projectId, reportId, reviewerName, findingId }) {
  const remote = await import('/src/features/reports/remote.ts');
  const auth = await import('/src/platform/auth-api.ts');
  const session = await auth.fetchAuthSession();
  if (!session?.actor) return { fatal: 'no authenticated actor for the author context', rows: [] };
  const ctx = { actor: { id: session.actor.id, role: 'admin' }, projectId, corr: `flow-author-${Date.now()}` };
  const svc = remote.createRealReportService();
  const rows = [];
  const shape = (data) => {
    if (data === null || data === undefined) return String(data);
    if (Array.isArray(data)) return `array(${data.length})`;
    if (typeof data === 'object') return `{${Object.keys(data).slice(0, 12).join(',')}}`;
    return typeof data;
  };
  const attempt = async (op, run) => {
    try {
      const res = await run();
      rows.push({ op, ok: res.ok, detail: res.ok ? shape(res.data) : `${res.failure.kind}: ${res.failure.message}` });
      return res;
    } catch (error) {
      rows.push({ op, ok: false, detail: `threw: ${error.message}` });
      return { ok: false, failure: { kind: 'exception', message: error.message } };
    }
  };
  rows.push({ op: 'capabilities', ok: true, detail: JSON.stringify(svc.capabilities) });
  await attempt('list', () => svc.list(ctx, {}));
  await attempt('templates', () => svc.templates(ctx));
  await attempt('deliveries', () => svc.deliveries(ctx, {}));
  await attempt('draftOptions', () => svc.draftOptions(ctx));
  await attempt('editor (fixture report)', () => svc.editor(ctx, reportId));
  await attempt('review (fixture report)', () => svc.review(ctx, reportId));
  const templateName = `Flow template ${Date.now()}`;
  // The report summary is fixed; the template adds its own required section, which the readiness check fills below.
  await attempt('createTemplate', () => svc.createTemplate(ctx, { name: templateName, sections: [{ title: 'Scope and method', required: true }, { title: 'Findings', required: false }] }));
  await attempt('templates (after createTemplate)', () => svc.templates(ctx));
  const draft = await attempt('createDraft', () => svc.createDraft(ctx, { title: 'Flow draft', template: templateName, kind: 'Red team assessment', reviewer: reviewerName, findings: [], period: '2026-10-01/2026-10-13' }));
  if (!draft.ok) return { fatal: null, rows, reportId: null };
  const id = draft.data.id;
  const editor = await attempt('editor (new draft)', () => svc.editor(ctx, id));
  // An editor read nests the report: { report: { sections }, ... }; a write returns the report itself.
  const sectionsOf = (res) => {
    const report = res.ok ? (res.data?.report ?? res.data) : null;
    return report && Array.isArray(report.sections) ? report.sections : [];
  };
  const sections = sectionsOf(editor);
  // The report summary is the section with the fixed id the adapter uses; a template section can share its title.
  const summary = sections.find((s) => s.id === 'summary') ?? sections.find((s) => /executive summary/i.test(s.title)) ?? sections[0];
  // Every section gets a body: the readiness check refuses an empty required section.
  for (const section of sections) await attempt(`saveSection (${section.title})`, () => svc.saveSection(ctx, id, section.id, `Flow body for ${section.title}.`));
  const added = await attempt('addSection', () => svc.addSection(ctx, id, 'Flow section'));
  const withExtra = sectionsOf(await svc.editor(ctx, id));
  const extra = withExtra.find((s) => s.title === 'Flow section');
  if (extra) await attempt('removeSection', () => svc.removeSection(ctx, id, extra.id));
  const beforeReorder = sectionsOf(await svc.editor(ctx, id));
  // The summary stays first: the server refuses an order that moves it.
  const ordered = [summary?.id, ...beforeReorder.map((s) => s.id).filter((sid) => sid !== summary?.id).reverse()].filter(Boolean);
  if (beforeReorder.length > 1 && summary) await attempt('reorderSections', () => svc.reorderSections(ctx, id, ordered));
  const current = await svc.editor(ctx, id);
  const reportVersion = current.ok ? Number(String(current.data?.report?.version ?? '1').replace(/^v/, '')) : 1;
  await attempt('setFindings (confirmed finding)', () => svc.setFindings(ctx, id, [findingId], reportVersion));
  const bodies = Object.fromEntries(sectionsOf(await svc.editor(ctx, id)).map((s) => [s.id, s.body]));
  await attempt('submit', () => svc.submit(ctx, id, { bodies }));
  await attempt('review (in review)', () => svc.review(ctx, id));
  void added;
  return { fatal: null, rows, reportId: id, template: templateName };
}

async function runReviewer({ projectId, reportId }) {
  const remote = await import('/src/features/reports/remote.ts');
  const auth = await import('/src/platform/auth-api.ts');
  const session = await auth.fetchAuthSession();
  if (!session?.actor) return { fatal: 'no authenticated actor for the reviewer context', rows: [] };
  const ctx = { actor: { id: session.actor.id, role: 'reviewer' }, projectId, corr: `flow-reviewer-${Date.now()}` };
  const svc = remote.createRealReportService();
  try {
    const decided = await svc.decide(ctx, reportId, 'approve', 'Flow approval after the checklist review.');
    return { fatal: null, rows: [{ op: 'decide (approve, reviewer)', ok: decided.ok, detail: decided.ok ? 'approved' : `${decided.failure.kind}: ${decided.failure.message}` }] };
  } catch (error) {
    return { fatal: null, rows: [{ op: 'decide (approve, reviewer)', ok: false, detail: `threw: ${error.message}` }] };
  }
}

async function runAfterReview({ projectId, reportId }) {
  const remote = await import('/src/features/reports/remote.ts');
  const auth = await import('/src/platform/auth-api.ts');
  const session = await auth.fetchAuthSession();
  const ctx = { actor: { id: session.actor.id, role: 'admin' }, projectId, corr: `flow-author-late-${Date.now()}` };
  const svc = remote.createRealReportService();
  const rows = [];
  const attempt = async (op, run) => {
    try {
      const res = await run();
      rows.push({ op, ok: res.ok, detail: res.ok ? (res.data && typeof res.data === 'object' ? `{${Object.keys(res.data).slice(0, 10).join(',')}}` : String(res.data)) : `${res.failure.kind}: ${res.failure.message}` });
      return res;
    } catch (error) {
      rows.push({ op, ok: false, detail: `threw: ${error.message}` });
      return { ok: false, failure: { kind: 'exception', message: error.message } };
    }
  };
  await attempt('exportVersion (PDF)', () => svc.exportVersion(ctx, reportId, 'PDF'));
  await attempt('exportArtifact (markdown)', () => svc.exportArtifact(ctx, reportId, 'markdown'));
  await attempt('deliver', () => svc.deliver(ctx, reportId, { recipient: 'Client lead', channel: 'portal', notes: 'Flow delivery.', confirm: true }));
  const history = await attempt('deliveries (after deliver)', () => svc.deliveries(ctx, {}));
  const items = history.ok && Array.isArray(history.data?.items) ? history.data.items : [];
  const mine = items.find((d) => d.rec?.reportId === reportId);
  if (mine?.rec?.id) await attempt('acknowledge', () => svc.acknowledge(ctx, reportId, { deliveryId: mine.rec.id, receipt: 'flow-receipt', requestId: crypto.randomUUID() }));
  else rows.push({ op: 'acknowledge', ok: false, detail: 'no delivery record for this report to acknowledge' });
  const latest = await svc.editor(ctx, reportId);
  const latestVersion = latest.ok ? Number(String(latest.data?.report?.version ?? '1').replace(/^v/, '')) : 1;
  await attempt('revise', () => svc.revise(ctx, reportId, latestVersion));
  return { fatal: null, rows };
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
const results = [];
try {
  const authorContext = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  const authorPage = await authorContext.newPage();
  authorPage.setDefaultTimeout(60000);
  await signIn(authorPage, process.env.RAPTIX_VERIFY_USER, process.env.RAPTIX_VERIFY_PASSWORD);
  const reviewerName = process.env.RAPTIX_VERIFY_REVIEWER_DISPLAY ?? 'Stack Reviewer';
  const first = await authorPage.evaluate(runAuthor, { projectId: fixtures.project, reportId: fixtures.report, reviewerName, findingId: fixtures.finding });
  results.push(...first.rows);
  if (first.fatal) throw new Error(first.fatal);
  if (first.reportId) {
    const reviewerContext = await browser.newContext({ viewport: { width: 1360, height: 960 } });
    const reviewerPage = await reviewerContext.newPage();
    reviewerPage.setDefaultTimeout(60000);
    await signIn(reviewerPage, process.env.RAPTIX_VERIFY_REVIEWER, process.env.RAPTIX_VERIFY_REVIEWER_PASSWORD);
    const decision = await reviewerPage.evaluate(runReviewer, { projectId: fixtures.project, reportId: first.reportId });
    results.push(...decision.rows);
    await reviewerContext.close();
    const late = await authorPage.evaluate(runAfterReview, { projectId: fixtures.project, reportId: first.reportId });
    results.push(...late.rows);
  }
} catch (error) {
  results.push({ op: 'flow', ok: false, detail: error.message });
} finally {
  await browser.close();
}
const failures = results.filter((row) => !row.ok).length;
if (outFile) writeFileSync(outFile, JSON.stringify({ app, generatedAt: new Date().toISOString(), rows: results, refused: failures }, null, 2));
for (const row of results) console.log(`${row.ok ? 'PASS' : 'REFUSED'} ${row.op} :: ${row.detail}`);
console.log(`reports checklist: ${results.length - failures} of ${results.length} operations succeeded`);
process.exitCode = failures > 0 ? 1 : 0;
