// P06/P07 real-PostgreSQL gate: versioned templates, setup readiness, pinned
// finding snapshots, four-eyes review by the named reviewer, readiness refusal
// on changed evidence, lineage on revision, and a recipient acknowledgement that
// is separate from the delivery. Runs only against the dedicated test database.
import assert from 'node:assert/strict';
import { createDbClient, disconnectDb } from '../src/db/client.js';
import { ReportsService } from '../src/services/reports-service.js';

const database = process.env.P06_TEST_DATABASE_URL ?? '';
assert.match(database, /@127\.0\.0\.1:5433\/raptix_ui_contract_test$/, 'P06_TEST_DATABASE_URL must point at the dedicated raptix_ui_contract_test database');
const db = createDbClient({ connectionString: database });
const reports = new ReportsService(db);

const run = Date.now().toString(36);
const OWNER = `owner-${run}`;
const AUTHOR = `author-${run}`;
const REVIEWER = `reviewer-${run}`;
const VIEWER = `viewer-${run}`;
const DIGEST = 'a'.repeat(64);

async function refused(promise: Promise<unknown>, statusCode: number, pattern?: RegExp): Promise<void> {
  await assert.rejects(promise, (err: unknown) => {
    const candidate = err as { statusCode?: number; message?: string };
    return candidate.statusCode === statusCode && (pattern === undefined || pattern.test(candidate.message ?? ''));
  });
}

async function main(): Promise<void> {
  const engagement = await db.engagement.create({ data: { name: `p06-${run}`, workspaceSlug: `p06-${run}`, userId: OWNER, targetType: 'web_url', targetValue: 'http://p06-lab.invalid', authorizationConfirmed: true } });
  const eid = engagement.id;
  for (const [userId, role] of [[AUTHOR, 'operator'], [REVIEWER, 'reviewer'], [VIEWER, 'viewer']] as const) {
    await db.webMembership.create({ data: { engagementId: eid, userId, role } });
  }
  const read = async (reportId: string) => {
    const list = await reports.list(AUTHOR, eid);
    const found = list.reports.find((report) => report.id === reportId);
    assert.ok(found, 'report is readable by the author');
    return found;
  };

  // Templates are owner-managed; other roles are refused.
  await refused(reports.createTemplate(AUTHOR, eid, { name: 'Pentest', sections: [{ title: 'Summary', required: true }] }), 403);
  const template = await reports.createTemplate(OWNER, eid, { name: 'Pentest', sections: [{ title: 'Summary', required: true }, { title: 'Method', required: false }] });
  assert.equal(template.version, 1);

  // Findings: only confirmed-or-later findings can be pinned.
  const confirmed = await db.findingRecord.create({ data: { engagementId: eid, title: 'Admin panel exposed', severity: 'high', status: 'confirmed', body: { detail: 'Reachable without authentication.' }, expectedVersion: 3, sourceType: 'authored', createdBy: AUTHOR } });
  const draft = await db.findingRecord.create({ data: { engagementId: eid, title: 'Still a draft', severity: 'low', status: 'draft', body: { detail: 'Not reviewed.' }, createdBy: AUTHOR } });
  const capture = await db.retainedCapture.create({ data: { id: `cap-${run}`, engagementId: eid, requestId: `req-${run}`, requestFingerprint: 'f'.repeat(64), path: `captures/${run}.txt`, filename: 'proof.txt', mediaType: 'text/plain', sizeBytes: 3, digest: DIGEST, uploadedBy: AUTHOR, classification: 'standard' } });
  await db.evidenceLink.create({ data: { findingId: confirmed.id, engagementId: eid, captureId: capture.id, kind: 'artifact', artifactPath: null, digest: DIGEST } });

  let report = await reports.create(AUTHOR, eid, { title: 'Q4 assessment', summary: 'Overview' });
  await refused(reports.setFindings(AUTHOR, eid, report.id, { expectedVersion: report.version, findingIds: [draft.id] }), 409, /confirmed or later/);
  report = await reports.setFindings(AUTHOR, eid, report.id, { expectedVersion: report.version, findingIds: [confirmed.id] });
  assert.equal(report.selectedFindings.length, 1);
  assert.equal(report.selectedFindings[0]?.findingVersion, 3, 'the snapshot pins the finding version read at selection');
  assert.equal(report.selectedFindings[0]?.evidence.length, 1, 'the snapshot pins the evidence reference');

  // Setup: the readiness report names each missing requirement instead of passing silently.
  report = await reports.updateSetup(AUTHOR, eid, report.id, { expectedVersion: report.version, templateId: template.id, periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-10-31T00:00:00.000Z', reviewerId: REVIEWER });
  assert.equal(report.readiness.ready, false);
  assert.equal(report.readiness.checks.find((check) => check.id === 'template')?.state, 'fail', 'the required Summary section is empty');
  await refused(reports.updateSetup(AUTHOR, eid, report.id, { expectedVersion: report.version, reviewerId: AUTHOR }), 400, /differ from the report author/);
  await refused(reports.updateSetup(AUTHOR, eid, report.id, { expectedVersion: report.version + 5, periodStart: null }), 409);
  report = await reports.update(AUTHOR, eid, report.id, { expectedVersion: report.version, summary: 'Overview', sections: [{ title: 'Summary', content: 'Scope executed as approved.' }] });
  assert.equal(report.readiness.ready, true, `all checks should pass: ${JSON.stringify(report.readiness.checks)}`);

  // Evidence integrity gates readiness: an unclassified capture blocks review.
  await db.retainedCapture.update({ where: { id: capture.id }, data: { classification: 'unclassified' } });
  assert.equal((await read(report.id)).readiness.checks.find((check) => check.id === 'evidence')?.state, 'fail');
  await db.retainedCapture.update({ where: { id: capture.id }, data: { classification: 'standard' } });

  // A pinned finding edited after selection is reported as changed and blocks review.
  await db.findingRecord.update({ where: { id: confirmed.id }, data: { expectedVersion: 4 } });
  assert.equal((await read(report.id)).readiness.checks.find((check) => check.id === 'findings')?.state, 'fail');
  await refused(reports.submitReview(AUTHOR, eid, report.id), 409, /changed from v3 to v4/);
  await db.findingRecord.update({ where: { id: confirmed.id }, data: { expectedVersion: 3 } });

  // Four-eyes: only the named reviewer decides, and the author cannot.
  report = await reports.submitReview(AUTHOR, eid, report.id);
  assert.equal(report.status, 'in_review');
  await refused(reports.decideReview(AUTHOR, eid, report.id, { decision: 'approved', comment: 'self', expectedVersion: report.version }), 403, /independent actor|named reviewer/);
  report = await reports.decideReview(REVIEWER, eid, report.id, { decision: 'approved', comment: 'Evidence checked.', expectedVersion: report.version });
  assert.equal(report.status, 'approved');
  assert.equal(report.approvedVersion, report.version);

  // Export is a read; delivery requires the approved version and creates its own record.
  const exported = await reports.deliver(AUTHOR, eid, report.id, { kind: 'export', format: 'json', requestId: `exp-${run}` });
  assert.match(exported.artifact.content, /Admin panel exposed/);
  const delivered = await reports.deliver(AUTHOR, eid, report.id, { kind: 'delivery', format: 'json', requestId: `del-${run}`, recipient: 'Client A', receipt: 'signed-42', expectedVersion: report.version });
  assert.equal(delivered.status, 'delivered');
  const deliveryRecord = delivered.deliveries.find((delivery) => delivery.kind === 'delivery');
  assert.ok(deliveryRecord, 'the delivery record is listed');
  assert.equal(deliveryRecord.recordedReceipt?.receipt, 'signed-42', 'the delivery-time receipt is kept as recorded');
  assert.equal(deliveryRecord.acknowledgement, null, 'delivery alone is not an acknowledgement');

  // Acknowledgement: separate, idempotent by request id, and refused for exports or a different receipt.
  const exportRecord = delivered.deliveries.find((delivery) => delivery.kind === 'export');
  assert.ok(exportRecord);
  await refused(reports.acknowledge(VIEWER, eid, report.id, exportRecord.id, { requestId: `ack-x-${run}`, receipt: 'nope' }), 409, /completed delivery/);
  const acked = await reports.acknowledge(VIEWER, eid, report.id, deliveryRecord.id, { requestId: `ack-${run}`, receipt: 'received 2026-10-20' });
  const ack = acked.deliveries.find((delivery) => delivery.id === deliveryRecord.id)?.acknowledgement;
  assert.equal(ack?.actorId, VIEWER);
  const replay = await reports.acknowledge(VIEWER, eid, report.id, deliveryRecord.id, { requestId: `ack-${run}`, receipt: 'received 2026-10-20' });
  assert.equal(replay.deliveries.find((delivery) => delivery.id === deliveryRecord.id)?.acknowledgement?.id, ack?.id, 'a replay returns the stored acknowledgement');
  await refused(reports.acknowledge(VIEWER, eid, report.id, deliveryRecord.id, { requestId: `ack-other-${run}`, receipt: 'different' }), 409, /already has a recorded acknowledgement/);

  // Revision keeps explicit lineage and the pinned snapshots; the approved report stays unchanged.
  const revision = await reports.revise(AUTHOR, eid, report.id, { expectedVersion: report.version });
  assert.equal(revision.parentReportId, report.id);
  assert.equal(revision.rootReportId, report.id);
  assert.equal(revision.selectedFindings.length, 1);
  assert.equal(revision.reviewerId, REVIEWER);
  assert.equal((await read(report.id)).status, 'delivered', 'the approved report is not rewritten by the revision');

  console.log(`P06/P07 real-PostgreSQL gate passed for engagement ${eid}.`);
}

try {
  await main();
} finally {
  await disconnectDb(db);
}
