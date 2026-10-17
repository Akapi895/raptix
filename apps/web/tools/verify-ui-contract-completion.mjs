#!/usr/bin/env node
/**
 * UI contract completion acceptance harness (implementation plan §10.2).
 *
 * Phases run one at a time and read the state file before any side effect:
 *   --prepare            create the acceptance engagement scoped to one host
 *   --findings-evidence  finding, retained capture upload/classify/download, attach
 *   --assets             managed inventory import, classification at a read version and a stale refusal
 *   --target-flow        bounded read-only observation of the scoped host, only when
 *                        WEB_ACCEPTANCE_NETWORK_PROBES=1
 *
 * Credentials come from RAPTIX_WEB_ADMIN_USERNAME and RAPTIX_WEB_ADMIN_PASSWORD in the
 * environment; they are never written to the state file or to output.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const BASE = process.env.WEB_ACCEPTANCE_BASE_URL ?? 'http://127.0.0.1:3101';
const TARGET_HOST = process.env.WEB_ACCEPTANCE_TARGET_HOST ?? '10.129.227.140';
const TARGET_CIDR = process.env.WEB_ACCEPTANCE_TARGET_CIDR ?? `${TARGET_HOST}/32`;
const PROBES = process.env.WEB_ACCEPTANCE_NETWORK_PROBES === '1';
const SANDBOX = process.env.WEB_ACCEPTANCE_SANDBOX ?? 'raptix-sandbox';
const PORTS = [22, 80, 443, 445, 3389, 8080];

const args = new Set(process.argv.slice(2));
const stateFlag = process.argv.indexOf('--state');
const statePath = stateFlag >= 0 ? process.argv[stateFlag + 1] : null;
if (!statePath) fail('--state <path> is required');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function readState() {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { runId: null, steps: {} };
    throw error;
  }
}

async function writeState(state) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

/** Minimal session client: cookie from login, CSRF on unsafe methods. */
function client() {
  let cookie = '';
  let csrf = '';
  const request = async (method, path, body, extraHeaders = {}) => {
    const headers = { accept: 'application/json', ...extraHeaders };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (csrf && !['GET', 'HEAD'].includes(method)) headers['x-csrf-token'] = csrf;
    const response = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return response;
  };
  return {
    async login(credentials) {
      const username = credentials?.username ?? process.env.RAPTIX_WEB_ADMIN_USERNAME;
      const password = credentials?.password ?? process.env.RAPTIX_WEB_ADMIN_PASSWORD;
      if (!username || !password) fail('RAPTIX_WEB_ADMIN_USERNAME and RAPTIX_WEB_ADMIN_PASSWORD must be set');
      const response = await request('POST', '/api/auth/login', { username, password });
      if (response.status !== 200) fail(`login refused with status ${response.status}`);
      const session = await response.json();
      csrf = session.csrfToken;
      return session;
    },
    request,
    json: async (response) => ({ status: response.status, body: await response.json().catch(() => null) }),
  };
}

async function prepare(state) {
  const api = client();
  await api.login();
  const runId = state.runId ?? `ui-contract-${randomUUID().slice(0, 8)}`;
  if (state.steps.prepare?.engagementId) {
    process.stdout.write(`prepare already done for ${state.runId}; reusing engagement ${state.steps.prepare.engagementId}\n`);
    return { ...state, runId: state.runId };
  }
  const created = await api.json(await api.request('POST', '/api/engagements', {
    name: runId,
    targetType: 'ip_range',
    targetValue: TARGET_CIDR,
    authorizationConfirmed: true,
    brief: 'UI contract acceptance, scoped to one host.',
  }));
  if (created.status !== 201 && created.status !== 200) fail(`engagement create refused with status ${created.status}`);
  const engagementId = created.body.id;
  return { ...state, runId, steps: { ...state.steps, prepare: { engagementId, targetCidr: TARGET_CIDR, createdAt: new Date().toISOString() } } };
}

async function findingsEvidence(state) {
  const prepared = state.steps.prepare;
  if (!prepared) fail('run --prepare first');
  const { engagementId } = prepared;
  const api = client();
  await api.login();
  const base = `/api/engagements/${engagementId}`;

  const finding = await api.json(await api.request('POST', `${base}/curated-findings`, { title: `Acceptance finding ${state.runId}`, severity: 'high', detail: 'Acceptance evidence case.' }));
  if (finding.status !== 200 && finding.status !== 201) fail(`finding create refused with status ${finding.status}`);
  const findingId = finding.body.id;

  // A fresh capture per invocation: the bytes and the request id both carry this key.
  const key = randomUUID().slice(0, 8);
  const bytes = Buffer.from(`evidence ${state.runId} ${key}
line two: café
`, 'utf8');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const upload = { requestId: `up-${state.runId}-${key}`, filename: 'proof.txt', mediaType: 'text/plain', base64: bytes.toString('base64') };
  const first = await api.json(await api.request('POST', `${base}/artifacts/captures`, upload));
  if (first.status !== 200) fail(`capture upload refused with status ${first.status}`);
  const captureId = first.body.id;
  const replay = await api.json(await api.request('POST', `${base}/artifacts/captures`, upload));
  const beforeClassification = await api.request('GET', `${base}/artifacts/captures/${captureId}/content`);
  const classified = await api.json(await api.request('PATCH', `${base}/artifacts/captures/${captureId}/classification`, { classification: 'standard', expectedVersion: 1, reason: 'acceptance evidence' }));
  const content = await api.request('GET', `${base}/artifacts/captures/${captureId}/content`);
  const served = Buffer.from(await content.arrayBuffer());
  const attached = await api.json(await api.request('POST', `${base}/curated-findings/${findingId}/evidence`, { kind: 'artifact', captureId, expectedVersion: finding.body.expectedVersion }));
  const attachedAgain = await api.json(await api.request('POST', `${base}/curated-findings/${findingId}/evidence`, { kind: 'artifact', captureId, expectedVersion: attached.body.expectedVersion ?? finding.body.expectedVersion }));
  // A second, unlinked capture: a repeated link of an already-linked capture replays the stored link by design.
  const second = Buffer.from(`second ${state.runId} ${key}`, 'utf8');
  const secondUpload = await api.json(await api.request('POST', `${base}/artifacts/captures`, { requestId: `up2-${state.runId}-${key}`, filename: 'second.txt', mediaType: 'text/plain', base64: second.toString('base64') }));
  const staleAttach = await api.json(await api.request('POST', `${base}/curated-findings/${findingId}/evidence`, { kind: 'artifact', captureId: secondUpload.body.id, expectedVersion: finding.body.expectedVersion + 5 }));

  const result = {
    findingId,
    captureId,
    uploadReplaySameId: replay.body?.id === captureId,
    originalBeforeClassification: beforeClassification.status,
    classification: classified.body?.classification ?? null,
    downloadStatus: content.status,
    downloadedBytesEqualUploaded: served.equals(bytes),
    digestExpected: digest,
    digestServedHeader: content.headers.get('x-content-sha256'),
    digestMatches: content.headers.get('x-content-sha256') === digest,
    attachStatus: attached.status,
    attachReplayStatus: attachedAgain.status,
    staleAttachStatus: staleAttach.status,
    replayedLinkStatus: attachedAgain.status,
    recordedAt: new Date().toISOString(),
  };
  const verdict = result.uploadReplaySameId && result.originalBeforeClassification === 409 && result.downloadStatus === 200
    && result.downloadedBytesEqualUploaded && result.digestMatches && result.attachStatus === 200 && result.staleAttachStatus === 409;
  return { ...state, steps: { ...state.steps, findingsEvidence: { ...result, passed: verdict } } };
}

async function observe(command, commandArgs) {
  try {
    const { stdout } = await run(command, commandArgs, { timeout: 15000, windowsHide: true });
    return { ok: true, stdout: stdout.trim() };
  } catch (error) {
    return { ok: false, stdout: String(error.stdout ?? '').trim(), error: String(error.code ?? error.message).slice(0, 120) };
  }
}

async function assetsPhase(state) {
  const prepared = state.steps.prepare;
  if (!prepared) fail('run --prepare first');
  const { engagementId } = prepared;
  const api = client();
  await api.login();
  const base = `/api/engagements/${engagementId}`;
  // The imported identifier is the declared target host, so it stays inside the engagement scope.
  const imported = await api.json(await api.request('POST', `${base}/assets/inventory/import`, { identifiers: [TARGET_HOST], kind: 'host' }));
  if (imported.status !== 200) fail(`asset import refused with status ${imported.status}`);
  const inventory = await api.json(await api.request('GET', `${base}/assets/inventory`));
  const row = inventory.body.assets.find((asset) => asset.identifier === TARGET_HOST);
  if (!row) fail('the imported target host is not in the inventory');
  // Marking a target in scope needs an approved scope revision that adds it; that governed refusal is part of the check.
  const governed = await api.json(await api.request('PATCH', `${base}/assets/inventory/${row.id}`, { classification: 'in_scope', expectedVersion: row.version }));
  const changed = await api.json(await api.request('PATCH', `${base}/assets/inventory/${row.id}`, { classification: 'out_of_scope', expectedVersion: row.version }));
  const stale = await api.json(await api.request('PATCH', `${base}/assets/inventory/${row.id}`, { classification: 'pending', expectedVersion: row.version }));
  const after = await api.json(await api.request('GET', `${base}/assets/inventory`));
  const afterRow = after.body.assets.find((asset) => asset.id === row.id);
  const graph = await api.json(await api.request('GET', `${base}/graph`));
  const result = {
    assetId: row.id,
    importStatus: imported.status,
    importedRows: imported.body.imported,
    inScopeWithoutApprovalStatus: governed.status,
    classifyStatus: changed.status,
    staleClassifyStatus: stale.status,
    classificationAfter: afterRow?.classification ?? null,
    versionAdvanced: (afterRow?.version ?? 0) > row.version,
    graphStatus: graph.status,
    recordedAt: new Date().toISOString(),
  };
  const passed = result.inScopeWithoutApprovalStatus === 409 && result.classifyStatus === 200 && result.staleClassifyStatus === 409 && result.classificationAfter === 'out_of_scope' && result.versionAdvanced;
  return { ...state, steps: { ...state.steps, assets: { ...result, passed } } };
}

async function libraryPhase(state) {
  const prepared = state.steps.prepare;
  if (!prepared) fail('run --prepare first');
  const { engagementId } = prepared;
  const owner = client();
  await owner.login();
  const base = `/api/engagements/${engagementId}`;
  const corpus = await owner.json(await owner.request('GET', '/api/library'));
  // One open proposal per skill is a server rule, so pick a skill no draft or review already holds.
  const open = await owner.json(await owner.request('GET', `${base}/library-proposals`));
  const openSkills = new Set((open.body?.proposals ?? []).filter((p) => p.status === 'draft' || p.status === 'proposed').map((p) => p.skillName));
  const skill = corpus.body?.skills?.find((s) => !openSkills.has(s.name));
  if (!skill) fail('every corpus skill already has an open proposal');
  const detail = await owner.json(await owner.request('GET', `/api/library/skills/${encodeURIComponent(skill.name)}`));
  // A reviewer is a second member; its credentials exist only for this run and are not written to state.
  const reviewerName = `reviewer-${randomUUID().slice(0, 8)}`;
  const reviewerPassword = `${randomUUID()}-Aa1`;
  const invited = await owner.json(await owner.request('POST', `${base}/members`, { username: reviewerName, displayName: 'Acceptance reviewer', password: reviewerPassword, role: 'reviewer' }));
  const reviewer = client();
  await reviewer.login({ username: reviewerName, password: reviewerPassword });
  const created = await owner.json(await owner.request('POST', `${base}/library-proposals`, { skillName: skill.name, proposedBody: `${detail.body ?? ''}

Acceptance note ${state.runId}.` }));
  const proposalId = created.body?.id;
  const amended = await owner.json(await owner.request('POST', `${base}/library-proposals/${proposalId}/amendments`, { proposedBody: `${detail.body ?? ''}

Amended ${state.runId}.`, expectedVersion: created.body?.version }));
  const staleAmend = await owner.json(await owner.request('POST', `${base}/library-proposals/${proposalId}/amendments`, { proposedBody: 'stale', expectedVersion: 1 }));
  const proposed = await owner.json(await owner.request('POST', `${base}/library-proposals/${proposalId}/propose`, {}));
  const ownDecision = await owner.json(await owner.request('POST', `${base}/library-proposals/${proposalId}/decision`, { decision: 'approved', expectedVersion: proposed.body?.version }));
  const decided = await reviewer.json(await reviewer.request('POST', `${base}/library-proposals/${proposalId}/decision`, { decision: 'approved', expectedVersion: proposed.body?.version, comment: 'Acceptance review.' }));
  const exported = await owner.json(await owner.request('GET', `${base}/library-proposals/${proposalId}/export`));
  const result = {
    corpusStatus: corpus.status,
    corpusSkills: corpus.body.counts.skills,
    skillName: skill.name,
    fingerprintIsSha256: /^sha256:[0-9a-f]{64}$/.test(detail.body?.contentSha256 ?? ''),
    invitedReviewerStatus: invited.status,
    proposalId,
    draftStatus: created.body?.status ?? null,
    amendStatus: amended.status,
    amendedVersion: amended.body?.version ?? null,
    staleAmendStatus: staleAmend.status,
    proposedStatus: proposed.body?.status ?? null,
    authorDecisionStatus: ownDecision.status,
    reviewerDecisionStatus: decided.status,
    decidedStatus: decided.body?.status ?? null,
    exportStatus: exported.status,
    exportKind: exported.body?.kind ?? null,
    recordedAt: new Date().toISOString(),
  };
  const passed = result.corpusStatus === 200 && result.corpusSkills > 0 && result.fingerprintIsSha256 && result.draftStatus === 'draft'
    && result.amendStatus === 200 && result.amendedVersion === 2 && result.staleAmendStatus === 409 && result.proposedStatus === 'proposed'
    && result.authorDecisionStatus === 403 && result.reviewerDecisionStatus === 200 && result.decidedStatus === 'approved' && result.exportStatus === 200;
  return { ...state, steps: { ...state.steps, library: { ...result, passed } } };
}

async function targetFlow(state) {
  const prepared = state.steps.prepare;
  if (!prepared) fail('run --prepare first');
  if (!PROBES) fail('WEB_ACCEPTANCE_NETWORK_PROBES=1 is required for --target-flow');
  if (prepared.targetCidr !== `${TARGET_HOST}/32`) fail('engagement scope does not match the target host');
  const sandbox = ['exec', SANDBOX, 'sh', '-c'];
  const ping = await observe('docker', [...sandbox, `ping -c 2 -W 3 ${TARGET_HOST} >/dev/null 2>&1 && echo up || echo down`]);
  const ports = {};
  for (const port of PORTS) {
    const probe = await observe('docker', [...sandbox, `nc -z -w 3 ${TARGET_HOST} ${port} >/dev/null 2>&1 && echo open || echo closed`]);
    ports[port] = probe.stdout || 'unknown';
  }
  const banner = await observe('docker', [...sandbox, `timeout 5 nc -w 3 ${TARGET_HOST} 22 </dev/null 2>/dev/null | head -n 1 | tr -d '\\r' | cut -c1-120`]);
  const http = await observe('docker', [...sandbox, `curl -sS -m 6 -o /dev/null -w '%{http_code}' http://${TARGET_HOST}/ 2>/dev/null || echo error`]);
  const observation = {
    host: TARGET_HOST,
    vantage: `container ${SANDBOX}`,
    readOnly: true,
    icmp: ping.stdout || 'unknown',
    tcpConnect: ports,
    sshBanner: banner.stdout || null,
    httpRootStatus: http.stdout || 'unknown',
    observedAt: new Date().toISOString(),
  };
  return { ...state, steps: { ...state.steps, targetFlow: observation } };
}

const state = await readState();
let next = state;
if (args.has('--prepare')) next = await prepare(state);
if (args.has('--findings-evidence')) next = await findingsEvidence(next);
if (args.has('--assets')) next = await assetsPhase(next);
if (args.has('--library')) next = await libraryPhase(next);
if (args.has('--target-flow')) next = await targetFlow(next);
await writeState(next);
process.stdout.write(`${JSON.stringify(next.steps, null, 2)}\n`);
