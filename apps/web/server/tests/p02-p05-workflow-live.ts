// P02-P05 real-PostgreSQL gate: producer import idempotency under concurrent
// retries and changed bytes, retained capture upload/classification/download
// with a verified digest, evidence attach, the retest-gated resolution path,
// per-actor suggestion dismissal, activity paging and resolved-record freezing.
// Uses the real artifact filesystem authority and the real database. Runs only
// against the dedicated test database and a workspace under tests/local/artifacts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { createDbClient, disconnectDb } from '../src/db/client.js';
import { ArtifactsService } from '../src/services/artifacts-service.js';
import { LocalProjectFiles } from './support/local-project-files.js';
import { FindingsWorkflowService } from '../src/services/findings-workflow-service.js';
import { writeSuggestionDisposition } from '../src/services/finding-suggestions.js';
import { ProjectApiError } from '../src/services/projects-service.js';

const database = process.env.P06_TEST_DATABASE_URL ?? process.env.P02_TEST_DATABASE_URL ?? '';
assert.match(database, /@127\.0\.0\.1:5433\/raptix_ui_contract_test$/, 'the test database must be the dedicated raptix_ui_contract_test database');
const db = createDbClient({ connectionString: database });

const run = Date.now().toString(36);
const OWNER = `owner-${run}`;
const AUTHOR = `author-${run}`;
const REVIEWER = `reviewer-${run}`;
const VIEWER = `viewer-${run}`;
const OTHER = `other-${run}`;
const workspaceRoot = path.resolve('../../../tests/local/artifacts', `p02-p05-${run}`);

async function refused(promise: Promise<unknown>, statusCode: number, pattern?: RegExp): Promise<void> {
  await assert.rejects(promise, (err: unknown) => {
    const candidate = err as { statusCode?: number; message?: string };
    return candidate instanceof ProjectApiError && candidate.statusCode === statusCode && (pattern === undefined || pattern.test(candidate.message ?? ''));
  });
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

async function main(): Promise<void> {
  const engagement = await db.engagement.create({ data: { name: `p02-${run}`, workspaceSlug: `p02-${run}`, userId: OWNER, targetType: 'web_url', targetValue: 'http://p02-lab.invalid', authorizationConfirmed: true } });
  const eid = engagement.id;
  for (const [userId, role] of [[AUTHOR, 'operator'], [REVIEWER, 'reviewer'], [VIEWER, 'viewer'], [OTHER, 'operator']] as const) {
    await db.webMembership.create({ data: { engagementId: eid, userId, role } });
  }

  // Producer output lives in the engagement workspace, exactly where the runtime writes it.
  const findingsDir = path.join(workspaceRoot, `p02-${run}`, 'findings');
  await mkdir(findingsDir, { recursive: true });
  const producerFile = path.join(findingsDir, 'FIND-1.md');
  await writeFile(producerFile, '# Exposed admin\n\nThe admin panel answers without authentication.\n', 'utf8');

  const artifacts = new ArtifactsService(db, new LocalProjectFiles(workspaceRoot));
  const workflow = new FindingsWorkflowService(db, artifacts);

  // P02: one producer path yields one curated draft, even when retries race.
  const imported = await Promise.all(Array.from({ length: 4 }, () => workflow.importDraft(AUTHOR, eid, { title: 'Exposed admin', producerRef: 'findings/FIND-1.md', detail: 'From the producer.' })));
  const findingId = imported[0]!.id;
  assert.ok(imported.every((finding) => finding.id === findingId), 'concurrent imports return the same draft');
  assert.equal(await db.findingRecord.count({ where: { engagementId: eid, producerRef: 'findings/FIND-1.md' } }), 1, 'exactly one draft row exists');
  assert.equal(imported[0]!.sourceType, 'imported');
  assert.equal(imported[0]!.producerDigest, sha256(Buffer.from(await readFile(producerFile))), 'the draft records the source digest');
  await writeFile(producerFile, '# Exposed admin, revised source\n', 'utf8');
  await refused(workflow.importDraft(AUTHOR, eid, { title: 'Exposed admin', producerRef: 'findings/FIND-1.md', detail: 'Changed bytes.' }), 409);
  await writeFile(producerFile, '# Exposed admin\n\nThe admin panel answers without authentication.\n', 'utf8');

  // P03/P04: upload is retained once per request id; original bytes are gated by classification.
  const bytes = Buffer.from('reproduction steps\nstep 1: open /admin\n', 'utf8');
  const upload = { requestId: `up-${run}`, filename: 'proof.txt', base64: bytes.toString('base64'), mediaType: 'text/plain' };
  const capture = await artifacts.upload(AUTHOR, eid, upload);
  assert.equal(capture.classification, 'unclassified');
  assert.equal((await artifacts.upload(AUTHOR, eid, upload)).id, capture.id, 'the same request id returns the same capture');
  await refused(artifacts.upload(AUTHOR, eid, { ...upload, base64: Buffer.from('different').toString('base64') }), 409);
  await refused(artifacts.downloadCapture(VIEWER, eid, capture.id), 409, /until an owner or reviewer classifies/);

  // Attaching an unclassified capture is allowed; it does not expose bytes.
  const attached = await workflow.attachEvidence(AUTHOR, eid, findingId, { kind: 'artifact', captureId: capture.id, expectedVersion: imported[0]!.expectedVersion });
  assert.equal(attached.captureId, capture.id);

  // Classification is owner/reviewer only, versioned and reasoned.
  await refused(artifacts.classifyCapture(AUTHOR, eid, capture.id, { classification: 'standard', expectedVersion: 1, reason: 'lab' }), 403);
  const standard = await artifacts.classifyCapture(OWNER, eid, capture.id, { classification: 'standard', expectedVersion: 1, reason: 'lab proof' });
  assert.equal(standard.classification, 'standard');
  const download = await artifacts.downloadCapture(VIEWER, eid, capture.id);
  assert.ok(download.bytes.equals(bytes), 'the downloaded bytes are the uploaded bytes');
  assert.equal(download.capture.digest, sha256(bytes), 'the digest identifies the retained bytes');

  // P05: a finding reaches resolved only through a retest that cites classified evidence.
  let finding = await workflow.list(OWNER, eid).then((view) => view.findings.find((f) => f.id === findingId)!);
  finding = await workflow.transition(OWNER, eid, findingId, { to: 'review', expectedVersion: finding.expectedVersion });
  finding = await workflow.transition(REVIEWER, eid, findingId, { to: 'confirmed', expectedVersion: finding.expectedVersion });
  finding = await workflow.transition(OWNER, eid, findingId, { to: 'remediation', expectedVersion: finding.expectedVersion });
  finding = await workflow.transition(OWNER, eid, findingId, { to: 'retest', expectedVersion: finding.expectedVersion });
  await refused(workflow.transition(OWNER, eid, findingId, { to: 'resolved', expectedVersion: finding.expectedVersion }), 409);
  await refused(workflow.recordRetest(OWNER, eid, findingId, { result: 'Resolved', note: 'Fixed.', expectedVersion: finding.expectedVersion, requestId: `rt-none-${run}` }), 409);
  finding = await workflow.recordRetest(OWNER, eid, findingId, { result: 'Resolved', note: 'Verified against the fixed build.', expectedVersion: finding.expectedVersion, requestId: `rt-${run}`, captureIds: [capture.id] });
  assert.equal(finding.status, 'resolved');
  assert.equal(finding.retests.at(-1)?.result, 'Resolved');

  // P05: resolved records are frozen for comments; comments never change status.
  await refused(workflow.addComment(OWNER, eid, findingId, { text: 'after resolution', expectedVersion: finding.expectedVersion, requestId: `c-late-${run}` }), 409);

  // P05 activity paging: stable cursors pin the requested finding version.
  const second = await db.findingRecord.create({ data: { engagementId: eid, title: 'Commented', severity: 'low', status: 'draft', body: { detail: 'x' }, createdBy: AUTHOR, sourceType: 'authored' } });
  let commented = await workflow.list(AUTHOR, eid).then((view) => view.findings.find((f) => f.id === second.id)!);
  for (const n of [1, 2, 3]) {
    commented = await workflow.addComment(AUTHOR, eid, second.id, { text: `note ${n}`, expectedVersion: commented.expectedVersion, requestId: `c-${n}-${run}` });
  }
  const firstPage = await workflow.activity(AUTHOR, eid, second.id, { kind: 'comments', version: commented.expectedVersion, limit: 2 });
  assert.equal(firstPage.items.length, 2);
  assert.ok(firstPage.nextCursor, 'a full page offers a continuation cursor');
  const nextPage = await workflow.activity(AUTHOR, eid, second.id, { kind: 'comments', version: commented.expectedVersion, limit: 2, cursor: firstPage.nextCursor });
  assert.equal(nextPage.items.length, 1);
  assert.equal(nextPage.nextCursor, null);
  const seen = new Set([...firstPage.items, ...nextPage.items].map((item) => item.id));
  assert.equal(seen.size, 3, 'pages do not overlap and cover every comment');

  // P02: dismissals are per actor and per producer path; another actor's queue is unchanged.
  await writeSuggestionDisposition(db, AUTHOR, eid, { producerRef: 'findings/FIND-1.md', dismissed: true, reason: 'known noise', expectedVersion: 0 });
  const authorQueue = await workflow.suggestions(AUTHOR, eid);
  assert.equal(authorQueue.dispositions.find((d) => d.producerRef === 'findings/FIND-1.md')?.dismissed, true);
  const otherQueue = await workflow.suggestions(OTHER, eid);
  assert.equal(otherQueue.dispositions.find((d) => d.producerRef === 'findings/FIND-1.md'), undefined, 'another actor still sees the suggestion');

  // Restart persistence: fresh service instances read the same records.
  const restarted = new FindingsWorkflowService(db, new ArtifactsService(db, new LocalProjectFiles(workspaceRoot)));
  const reread = await restarted.list(OWNER, eid);
  const persisted = reread.findings.find((f) => f.id === findingId)!;
  assert.equal(persisted.status, 'resolved');
  assert.equal(persisted.evidence.length, 1);
  assert.equal(persisted.retests.length, 1);

  console.log(`P02-P05 real-PostgreSQL gate passed for engagement ${eid}.`);
}

try {
  await main();
} finally {
  await disconnectDb(db);
}
