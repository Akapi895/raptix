// Disposable-stack acceptance: real finding/evidence persistence and a browser C2 fixture.
// The C2 responses are intercepted explicitly; this does not certify a live provider or model.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const app = arg('--app');
const fixtures = JSON.parse(readFileSync(arg('--fixtures'), 'utf8'));
const checks = [];
const check = (name, verdict) => {
  assert.ok(verdict, name);
  checks.push(name);
  console.log(`PASS ${name}`);
};

async function signIn(page, username, password) {
  await page.goto(`${app}/?dataMode=real#/projects`);
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('#login-username').waitFor({ state: 'detached' });
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
let failure = null;
try {
  const owner = await browser.newPage();
  const reviewer = await browser.newPage();
  owner.setDefaultTimeout(15000);
  reviewer.setDefaultTimeout(15000);
  await signIn(owner, process.env.RAPTIX_VERIFY_USER, process.env.RAPTIX_VERIFY_PASSWORD);
  await signIn(reviewer, process.env.RAPTIX_VERIFY_REVIEWER, process.env.RAPTIX_VERIFY_REVIEWER_PASSWORD);
  const finding = await owner.evaluate(async (projectId) => {
    const { createRealFindingService } = await import('/src/features/findings/remote.ts');
    const { fetchAuthSession } = await import('/src/platform/auth-api.ts');
    const session = await fetchAuthSession();
    const ctx = { actor: { id: session.actor.id, role: 'admin' }, projectId, corr: 'prelab' };
    const svc = createRealFindingService();
    const unwrap = (res) => { if (!res.ok) throw Error(res.failure.message); return res.data; };
    const imported = unwrap(await svc.importSuggestion(ctx, 'FIND-PRELAB'));
    if (imported.rec !== 'Preserve the remediation during curation.' || imported.status !== 'draft') throw Error('Producer import lost its remediation or bypassed draft review');
    const draft = unwrap(await svc.save(ctx, null, { title: 'Prelab retained evidence', severity: 'info', asset: '', desc: 'Synthetic workflow check, not a vulnerability.', impact: 'None', rec: 'None', evidence: [], owner: session.actor.id }));
    const capture = unwrap(await svc.uploadEvidence(ctx, { findingId: draft.id, name: 'prelab.txt', kind: 'text', source: 'verification', sensitive: false, bytes: new TextEncoder().encode('PRELAB_RETAINED_BYTES\r\n'), mediaType: 'text/plain' }));
    const refused = await svc.downloadEvidence(ctx, capture.id);
    if (refused.ok || refused.failure.kind !== 'forbidden') throw Error('Unclassified original was not refused');
    unwrap(await svc.classifyCapture(ctx, capture.id, 'standard', 1, 'Generated verification bytes.'));
    unwrap(await svc.attachEvidence(ctx, draft.id, capture.id));
    unwrap(await svc.transition(ctx, draft.id, 'review'));
    const selfDecision = await svc.transition(ctx, draft.id, 'confirmed');
    if (selfDecision.ok || selfDecision.failure.kind !== 'forbidden') throw Error('Author was allowed to confirm their finding');
    return { id: draft.id, capture: capture.id };
  }, fixtures.project);
  check('real producer import preserves remediation and stays a draft', !!finding.id);
  check('real capture upload, classification, linking and self-review refusal', !!finding.capture);
  const confirmed = await reviewer.evaluate(async ({ projectId, id }) => {
    const { createRealFindingService } = await import('/src/features/findings/remote.ts');
    const { fetchAuthSession } = await import('/src/platform/auth-api.ts');
    const session = await fetchAuthSession();
    return createRealFindingService().transition({ actor: { id: session.actor.id, role: 'reviewer' }, projectId, corr: 'prelab-review' }, id, 'confirmed');
  }, { projectId: fixtures.project, id: finding.id });
  check('independent reviewer confirms the evidence-backed finding', confirmed.ok && confirmed.data.status === 'confirmed');
  await owner.reload();
  const retained = await owner.evaluate(async ({ projectId, id, capture }) => {
    const { createRealFindingService } = await import('/src/features/findings/remote.ts');
    const { fetchAuthSession } = await import('/src/platform/auth-api.ts');
    const session = await fetchAuthSession();
    const ctx = { actor: { id: session.actor.id, role: 'admin' }, projectId, corr: 'prelab-restore' };
    const svc = createRealFindingService();
    const detail = await svc.get(ctx, id);
    const bytes = await svc.downloadEvidence(ctx, capture);
    return { confirmed: detail.ok && detail.data.finding.status === 'confirmed', text: bytes.ok ? new TextDecoder().decode(bytes.data.bytes) : null };
  }, { projectId: fixtures.project, id: finding.id, capture: finding.capture });
  check('refresh retains confirmed finding and verified original bytes', retained.confirmed && retained.text === 'PRELAB_RETAINED_BYTES\r\n');
  await owner.goto(`${app}/?dataMode=real#/finding/${finding.id}?engagement=${fixtures.project}`);
  await owner.getByRole('heading', { name: 'Prelab retained evidence', exact: true }).waitFor();
  check('the real finding detail renders after curation', true);

  const stdout = `${'retained-output '.repeat(20)}END_OF_STDOUT`;
  const commands = [];
  await owner.route('**/api/engagements/*/c2/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let body;
    if (pathname.endsWith('/grants')) body = { engagementId: fixtures.project, grants: [], minGrantHours: 1, maxGrantHours: 24, source: 'db' };
    else if (pathname.endsWith('/sessions')) body = { engagementId: fixtures.project, source: 'sliver', listeners: [], profiles: [], sessions: [{ id: 'prelab-session', name: 'fixture', hostname: 'fixture-host', username: 'fixture', os: 'linux', arch: 'amd64', transport: 'http', remoteAddress: '127.0.0.1:443', activeC2: 'http', version: 'fixture', pid: 1, listenerPort: 18081, lastCheckin: Math.floor(Date.now() / 1000), isDead: false }] };
    else if (request.method() === 'POST' && pathname.endsWith('/commands')) {
      const input = request.postDataJSON();
      body = { ...input, id: 'prelab-command', engagementId: fixtures.project, sessionId: 'prelab-session', status: 'failed', exitCode: 1, pid: 2, stdout, stderr: 'PRELAB_STDERR', stdoutTruncated: false, stderrTruncated: true, createdAt: new Date().toISOString() };
      commands.push(body);
    } else if (pathname.endsWith('/commands')) body = commands;
    else throw Error(`Unexpected C2 fixture path: ${pathname}`);
    await route.fulfill({ json: body });
  });
  await owner.goto(`${app}/?dataMode=real#/c2-console?engagement=${fixtures.project}`);
  await owner.locator('#c2-console-session').fill('prelab-session');
  await owner.getByLabel('Absolute binary path').fill('/usr/bin/printf');
  await owner.getByLabel('Arguments (JSON array)').fill('[1]');
  await owner.getByRole('button', { name: 'Dispatch command', exact: true }).click();
  await owner.getByRole('alert').filter({ hasText: 'Arguments must be a JSON array of strings' }).waitFor();
  check('C2 browser rejects malformed argv before HTTP dispatch (fixture)', commands.length === 0);
  const argv = ['hello world', '', 'C:\\Program Files\\Lab'];
  await owner.getByLabel('Arguments (JSON array)').fill(JSON.stringify(argv));
  await owner.getByRole('button', { name: 'Dispatch command', exact: true }).click();
  await owner.getByText('View output · prelab-command', { exact: true }).click();
  await owner.getByText(stdout, { exact: true }).waitFor();
  await owner.getByText('PRELAB_STDERR', { exact: true }).waitFor();
  await owner.getByText('stderr truncated by provider', { exact: true }).waitFor();
  check('C2 browser preserves argv and displays full retained stdout/stderr (fixture)', JSON.stringify(commands[0].args) === JSON.stringify(argv));
  await owner.reload();
  await owner.getByText('View output · prelab-command', { exact: true }).click();
  await owner.getByText(stdout, { exact: true }).waitFor();
  check('C2 reload reads the command audit without dispatching (fixture)', commands.length === 1);
} catch (error) {
  failure = error.message;
  console.error(`FAIL prelab: ${failure}`);
} finally {
  await browser.close();
  writeFileSync(arg('--out'), JSON.stringify({ checks, failure, notVerified: ['model inference', 'live C2 provider', 'target lab execution'] }, null, 2));
}
process.exitCode = failure ? 1 : 0;
