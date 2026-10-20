import { createHash } from 'node:crypto';
import type { EvidenceLink, FindingRecord, PrismaClient } from '../generated/prisma/client.js';
import { ProjectApiError } from './projects-service.js';
import { requireEngagementAccess, requireIndependentActor, type ActorContext, type MemberRole } from '../auth/membership-policy.js';
import { assertEngagementOpen } from './closure-service.js';
import type { ArtifactsService } from './artifacts-service.js';
import type { LibraryService } from './library-service.js';
import { readFindingActivity, type FindingActivityKind, type FindingActivityPage } from './finding-activity.js';
import { findingReferenceOptions, resolveFindingReferences } from './finding-references.js';
import { writeSuggestionDisposition } from './finding-suggestions.js';
import type { CuratedFindingView, CuratedFindingsView, FindingEvidenceLink, FindingReferenceOptions, FindingRetestRecord, FindingReviewDecision, FindingSuggestionDispositionsView, FindingSuggestionDispositionResult } from '@raptix/web-contracts';

/**
 * Ticket 10: curated finding records with the review/remediation lifecycle and
 * opaque evidence references. Runtime findings stay the evidence producer:
 * draft-import copies the producer lineage reference into a web workflow
 * record without overwriting or relabeling it, and AI claims are never
 * treated as confirmed state. Transitions, role gates, expected-version
 * conflicts and evidence binding are server-enforced.
 */

const MIN_CURATE: MemberRole = 'operator';

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/** Allowed lifecycle transitions; confirmation requires an independent reviewer role. */
const TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  draft: ['review'],
  review: ['confirmed', 'returned'],
  returned: ['review'],
  confirmed: ['remediation'],
  remediation: ['retest'],
  retest: ['remediation'],
  resolved: [],
};

type StoredFindingBody = Record<string, unknown>;

function bodyRecord(value: unknown): StoredFindingBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as StoredFindingBody : {}
}

function payloadHash(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validateContent(input: Record<string, unknown>): void {
  if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 300)) throw new ProjectApiError(400, 'title must contain 1-300 characters.');
  if (input.severity !== undefined && (typeof input.severity !== 'string' || !['critical', 'high', 'medium', 'low', 'informational'].includes(input.severity))) throw new ProjectApiError(400, 'Unknown finding severity.');
  for (const field of ['detail', 'impact', 'recommendation', 'severityRationale', 'scopeNote']) {
    if (input[field] !== undefined && (typeof input[field] !== 'string' || input[field].length > 64000)) throw new ProjectApiError(400, `${field} must be text of at most 64000 characters.`);
  }
}

export type EvidenceView = FindingEvidenceLink;

export class FindingsWorkflowService {
  public constructor(private readonly db: PrismaClient, private readonly artifacts?: Pick<ArtifactsService, 'capture'> & Partial<Pick<ArtifactsService, 'captureById' | 'importWorkspaceEvidence'>>, private readonly library?: Pick<LibraryService, 'techniqueDetail'>) {}

  public async options(actorId: string, engagementId: string): Promise<FindingReferenceOptions> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    return findingReferenceOptions(this.db, engagementId, this.library !== undefined);
  }

  public async activity(actorId: string, engagementId: string, findingId: string, query: unknown): Promise<FindingActivityPage> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const row = await this.findOwned(engagementId, findingId);
    const input = (query ?? {}) as Record<string, unknown>;
    const kind = input.kind as FindingActivityKind;
    if (!['comments', 'history', 'retests'].includes(kind)) throw new ProjectApiError(400, 'kind must be comments, history or retests.');
    const version = input.version === undefined ? row.expectedVersion : Number(input.version);
    const limit = input.limit === undefined ? 20 : Number(input.limit);
    if (!Number.isSafeInteger(version) || version < 1 || version > row.expectedVersion || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ProjectApiError(400, 'Invalid activity version or page limit (1-100).');
    if (input.cursor !== undefined && (typeof input.cursor !== 'string' || input.cursor.length > 256)) throw new ProjectApiError(400, 'Invalid activity cursor.');
    return readFindingActivity(this.db, engagementId, findingId, kind, version, typeof input.cursor === 'string' ? input.cursor : null, limit);
  }

  private ctx(actorId: string): ActorContext {
    return { db: this.db, actorId, multiUser: true };
  }

  public async suggestions(actorId: string, engagementId: string): Promise<FindingSuggestionDispositionsView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const dispositions = await this.db.findingSuggestionDisposition.findMany({ where: { engagementId, actorId }, orderBy: { id: 'asc' } });
    return { engagementId, dispositions: dispositions.map((row) => ({ producerRef: row.producerRef, dismissed: row.dismissed, reason: row.reason, version: row.version })) };
  }

  public async setSuggestion(actorId: string, engagementId: string, input: unknown): Promise<FindingSuggestionDispositionResult> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_CURATE);
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { producerRef?: unknown; dismissed?: unknown };
    const producerRef = body.producerRef;
    if (typeof producerRef !== 'string' || !/^findings\/[A-Za-z0-9._-]+\.md$/.test(producerRef)) throw new ProjectApiError(400, 'A canonical producer findings path is required.');
    const previous = await this.db.findingSuggestionDisposition.findFirst({ where: { engagementId, actorId, producerRef } });
    if (!previous || body.dismissed !== false) {
      if (!this.artifacts) throw new ProjectApiError(503, 'Producer source verification is unavailable.');
      await this.artifacts.capture(actorId, engagementId, producerRef);
    }
    const row = await writeSuggestionDisposition(this.db, actorId, engagementId, input);
    return { engagementId, disposition: { producerRef: row.producerRef, dismissed: row.dismissed, reason: row.reason, version: row.version } };
  }

  public async list(actorId: string, engagementId: string): Promise<CuratedFindingsView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const rows = await this.db.findingRecord.findMany({ where: { engagementId }, orderBy: { createdAt: 'desc' } });
    const findings = await Promise.all(rows.map(async (row) => {
      const evidence = await this.db.evidenceLink.findMany({ where: { findingId: row.id } });
      return this.toView(row, evidence);
    }));
    return { engagementId, findings, transitions: TRANSITIONS, source: 'db' };
  }

  public async create(actorId: string, engagementId: string, input: unknown): Promise<CuratedFindingView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_CURATE);
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { title?: unknown; severity?: unknown; detail?: unknown; impact?: unknown; recommendation?: unknown; severityRationale?: unknown; scopeNote?: unknown; references?: unknown };
    validateContent(body);
    const references = body.references === undefined ? {} : await resolveFindingReferences(this.db, engagementId, body.references, this.library);
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (title.length === 0 || title.length > 300) throw new ProjectApiError(400, 'title (1-300 chars) is required.');
    const severity = typeof body.severity === 'string' && ['critical', 'high', 'medium', 'low', 'informational'].includes(body.severity) ? body.severity : 'medium';
    const detail = typeof body.detail === 'string' ? body.detail : '';
    const createdAt = new Date();
    const row = await this.db.$transaction(async (tx) => {
      const created = await tx.findingRecord.create({
        data: { ...references, engagementId, title, severity, status: 'draft', body: { detail, impact: typeof body.impact === 'string' ? body.impact : '', recommendation: typeof body.recommendation === 'string' ? body.recommendation : '', severityRationale: typeof body.severityRationale === 'string' ? body.severityRationale : '', scopeNote: typeof body.scopeNote === 'string' ? body.scopeNote : '' } as object, sourceType: 'authored', createdBy: actorId, contentUpdatedBy: actorId },
      });
      await tx.findingHistory.create({ data: { findingId: created.id, engagementId, actorId, action: 'created', reason: null, fromStatus: null, toStatus: 'draft', findingVersion: 1, createdAt } });
      await tx.webAuditEntry.create({ data: { engagementId, actorId, action: 'finding.created', targetType: 'finding', targetId: created.id, reason: title } });
      return created;
    });
    return this.toView(row, []);
  }

  /** Draft-import from a runtime/producer reference; never mutates producer evidence. */
  public async importDraft(actorId: string, engagementId: string, input: unknown): Promise<CuratedFindingView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_CURATE);
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { title?: unknown; producerRef?: unknown; detail?: unknown; severity?: unknown; impact?: unknown; recommendation?: unknown; severityRationale?: unknown; scopeNote?: unknown };
    validateContent(body);
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const producerRef = typeof body.producerRef === 'string' ? body.producerRef.trim() : '';
    if (title.length === 0) throw new ProjectApiError(400, 'title is required.');
    if (producerRef.length === 0) throw new ProjectApiError(400, 'producerRef (the runtime evidence reference) is required.');
    // W19: a producer reference is only verified provenance when the retained
    // artifact authority resolves its bytes. A missing source stays an
    // explicitly unverified claim.
    let producerResolved: boolean | undefined;
    let producerDigest: string | null = null;
    if (this.artifacts !== undefined) {
      try {
        const capture = await this.artifacts.capture(actorId, engagementId, producerRef);
        producerDigest = capture.digest;
        producerResolved = true;
      } catch (error) {
        if (!(error instanceof ProjectApiError) || error.statusCode !== 404) throw error;
        producerResolved = false;
      }
    }
    const existing = await this.db.findingRecord.findFirst({ where: { engagementId, producerRef } });
    if (existing !== null) return this.replayProducerImport(actorId, engagementId, producerRef, producerDigest, producerResolved, existing);
    try {
      const row = await this.db.$transaction(async (tx) => {
        const created = await tx.findingRecord.create({
          data: {
            engagementId,
            title,
            severity: typeof body.severity === 'string' ? body.severity : 'medium',
            status: 'draft',
            body: { detail: typeof body.detail === 'string' ? body.detail : '', impact: typeof body.impact === 'string' ? body.impact : '', recommendation: typeof body.recommendation === 'string' ? body.recommendation : '', severityRationale: typeof body.severityRationale === 'string' ? body.severityRationale : '', scopeNote: typeof body.scopeNote === 'string' ? body.scopeNote : '' } as object,
            sourceType: 'imported',
            producerRef,
            producerDigest,
            createdBy: actorId,
            contentUpdatedBy: actorId,
          },
        });
        await tx.findingHistory.create({ data: { findingId: created.id, engagementId, actorId, action: 'imported', reason: producerRef, fromStatus: null, toStatus: 'draft', findingVersion: 1 } });
        await tx.webAuditEntry.create({ data: { engagementId, actorId, action: 'finding.imported', targetType: 'finding', targetId: created.id, reason: `${title} <- ${producerRef}${producerResolved === true ? ' (resolved)' : producerResolved === false ? ' (unverified)' : ''}` } });
        return created;
      });
      await this.attachProducerEvidence(actorId, engagementId, row.id, producerRef);
      const attached = await this.findOwned(engagementId, row.id);
      const links = await this.db.evidenceLink.findMany({ where: { findingId: row.id } });
      return this.toView(attached, links, producerResolved);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await this.db.findingRecord.findFirst({ where: { engagementId, producerRef } });
      if (raced === null) throw error;
      return this.replayProducerImport(actorId, engagementId, producerRef, producerDigest, producerResolved, raced);
    }
  }

  /**
   * Imports the evidence an agent wrote for a producer finding (`findings/FIND-<id>.md` -> `findings/evidence/FIND-<id>_*`)
   * as unclassified captures and attaches each one to the draft that imported it. Evidence that cannot be imported or
   * attached is recorded in the audit log and skipped; the draft itself is kept.
   */
  private async attachProducerEvidence(actorId: string, engagementId: string, findingId: string, producerRef: string): Promise<void> {
    const match = /^findings\/(FIND-[A-Za-z0-9_-]{1,64})\.md$/.exec(producerRef);
    if (match === null || this.artifacts?.importWorkspaceEvidence === undefined) return;
    const skip = (reason: string) => this.db.webAuditEntry.create({ data: { engagementId, actorId, action: 'evidence.skipped', targetType: 'finding', targetId: findingId, reason } });
    let batch;
    try {
      batch = await this.artifacts.importWorkspaceEvidence(actorId, engagementId, match[1]!);
    } catch (error) {
      if (!(error instanceof ProjectApiError)) throw error;
      await skip(error.message);
      return;
    }
    for (const item of batch.skipped) await skip(`${item.path}: ${item.reason}`);
    for (const capture of batch.captures) {
      const current = await this.findOwned(engagementId, findingId);
      try {
        await this.attachEvidence(actorId, engagementId, findingId, { kind: 'artifact', captureId: capture.id, expectedVersion: current.expectedVersion });
      } catch (error) {
        if (!(error instanceof ProjectApiError)) throw error;
        await skip(`${capture.id}: ${error.message}`);
      }
    }
  }

  private async replayProducerImport(
    actorId: string,
    engagementId: string,
    producerRef: string,
    producerDigest: string | null,
    producerResolved: boolean | undefined,
    existing: FindingRecord,
  ): Promise<CuratedFindingView> {
    if (existing.producerDigest !== producerDigest) {
      throw new ProjectApiError(409, `Producer source ${producerRef} changed after it was imported. The existing draft is preserved; import of a changed source requires an explicit revision.`);
    }
    // A draft whose first import ran before its evidence was attached (or whose evidence was written later) gets the
    // evidence on replay. Attaching is idempotent, and only drafts are touched: submitted or resolved findings stay as they are.
    if (existing.status === 'draft') await this.attachProducerEvidence(actorId, engagementId, existing.id, producerRef);
    const current = await this.findOwned(engagementId, existing.id);
    const evidence = await this.db.evidenceLink.findMany({ where: { findingId: existing.id } });
    return this.toView(current, evidence, producerResolved);
  }

  public async update(actorId: string, engagementId: string, findingId: string, input: unknown): Promise<CuratedFindingView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_CURATE);
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { expectedVersion?: unknown; title?: unknown; severity?: unknown; detail?: unknown; impact?: unknown; recommendation?: unknown; severityRationale?: unknown; scopeNote?: unknown; references?: unknown; submit?: unknown };
    validateContent(body);
    const references = body.references === undefined ? {} : await resolveFindingReferences(this.db, engagementId, body.references, this.library);
    const expectedVersion = typeof body.expectedVersion === 'number' ? body.expectedVersion : null;
    if (expectedVersion === null || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new ProjectApiError(400, 'expectedVersion must be a positive integer for concurrent-edit safety.');
    const row = await this.findOwned(engagementId, findingId);
    if (row.expectedVersion !== expectedVersion) {
      throw new ProjectApiError(409, `Concurrent edit: the finding moved to version ${row.expectedVersion} while you edited version ${expectedVersion}. Reload and reapply.`);
    }
    // W19: a terminal finding is immutable; editing a confirmed finding
    // invalidates the confirmation — content changes never keep it.
    if (row.status === 'resolved') throw new ProjectApiError(409, 'The finding is resolved; its content is frozen and cannot be edited.');
    if (body.submit !== undefined && typeof body.submit !== 'boolean') throw new ProjectApiError(400, 'submit must be a boolean.');
    if (body.submit === true) {
      if (!['draft', 'returned'].includes(row.status)) throw new ProjectApiError(409, 'Only a draft or returned finding can be submitted.');
      if (!await this.db.evidenceLink.findFirst({ where: { findingId: row.id, engagementId } })) throw new ProjectApiError(409, 'Attach at least one piece of evidence before submitting for review.');
    }
    const invalidated = row.status === 'confirmed' || row.status === 'remediation' || row.status === 'retest';
    const nextStatus = invalidated || body.submit === true ? 'review' : row.status;
    const previousBody = bodyRecord(row.body);
    const version = row.expectedVersion + 1;
    const reason = invalidated ? 'Confirmation invalidated by content edit.' : null;
    const updated = await this.db.$transaction(async (tx) => {
      const change = await tx.findingRecord.updateMany({
        where: { id: row.id, engagementId, expectedVersion, status: row.status },
        data: {
          ...references,
          title: typeof body.title === 'string' && body.title.trim().length > 0 ? body.title.trim() : row.title,
          severity: typeof body.severity === 'string' ? body.severity : row.severity,
          body: {
            ...previousBody,
            detail: typeof body.detail === 'string' ? body.detail : typeof previousBody.detail === 'string' ? previousBody.detail : '',
            impact: typeof body.impact === 'string' ? body.impact : typeof previousBody.impact === 'string' ? previousBody.impact : '',
            recommendation: typeof body.recommendation === 'string' ? body.recommendation : typeof previousBody.recommendation === 'string' ? previousBody.recommendation : '',
            severityRationale: typeof body.severityRationale === 'string' ? body.severityRationale : typeof previousBody.severityRationale === 'string' ? previousBody.severityRationale : '',
            scopeNote: typeof body.scopeNote === 'string' ? body.scopeNote : typeof previousBody.scopeNote === 'string' ? previousBody.scopeNote : '',
          } as object,
          expectedVersion: { increment: 1 }, status: nextStatus, updatedBy: actorId, contentUpdatedBy: actorId,
        },
      });
      if (change.count !== 1) throw new ProjectApiError(409, 'The finding changed while content was edited. Reload and retry.');
      await tx.findingHistory.create({ data: { findingId: row.id, engagementId, actorId, action: body.submit === true ? 'review' : 'updated', reason, fromStatus: row.status, toStatus: nextStatus, findingVersion: version } });
      await tx.webAuditEntry.create({ data: { engagementId, actorId, action: 'finding.updated', targetType: 'finding', targetId: row.id, reason: `v${row.expectedVersion} -> v${version}${invalidated ? ' (confirmation invalidated, back to review)' : ''}` } });
      return tx.findingRecord.findFirst({ where: { id: row.id, engagementId } });
    });
    if (updated === null) throw new ProjectApiError(404, 'Finding not found.');
    const evidence = await this.db.evidenceLink.findMany({ where: { findingId: row.id } });
    return this.toView(updated, evidence);
  }

  public async transition(actorId: string, engagementId: string, findingId: string, input: unknown): Promise<CuratedFindingView> {
    const body = (input ?? {}) as { to?: unknown; expectedVersion?: unknown; note?: unknown };
    const to = typeof body.to === 'string' ? body.to : '';
    const access = await requireEngagementAccess(this.ctx(actorId), engagementId, to === 'review' ? MIN_CURATE : 'reviewer');
    await assertEngagementOpen(this.db, engagementId);
    const row = await this.findOwned(engagementId, findingId);
    // W19: every transition pins the version the caller actually read -
    // confirmation is a four-eyes act, so it never races a content edit.
    const expectedVersion = typeof body.expectedVersion === 'number' ? body.expectedVersion : null;
    if (expectedVersion === null) throw new ProjectApiError(400, 'expectedVersion is required so a transition pins the reviewed content.');
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) throw new ProjectApiError(400, 'expectedVersion must be a positive integer.');
    if (row.expectedVersion !== expectedVersion) {
      throw new ProjectApiError(409, `Concurrent edit: the finding moved to version ${row.expectedVersion} while you acted on version ${expectedVersion}. Reload and reapply.`);
    }
    const allowed = TRANSITIONS[row.status] ?? [];
    if (!allowed.includes(to)) {
      throw new ProjectApiError(409, `Transition ${row.status} -> ${to} is not allowed; permitted: ${allowed.length > 0 ? allowed.join(', ') : 'none (terminal)'}.`);
    }
    if ((to === 'confirmed' || to === 'returned') && !['owner', 'reviewer'].includes(access.role)) {
      throw new ProjectApiError(403, `Confirming a finding requires the reviewer role; the persisted membership grants ${access.role}.`);
    }
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (to === 'returned' && (!note || note.length > 4000)) throw new ProjectApiError(400, 'A return reason (1-4000 characters) is required.');
    // Review decisions are independent of the finding author.
    if (to === 'confirmed' || to === 'returned') {
      requireIndependentActor(row.createdBy, actorId, 'Finding review decision');
      requireIndependentActor(row.contentUpdatedBy ?? row.createdBy, actorId, 'Finding content review');
    }
    const version = row.expectedVersion + 1;
    const updated = await this.db.$transaction(async (tx) => {
      const change = await tx.findingRecord.updateMany({
        where: { id: row.id, engagementId, expectedVersion: row.expectedVersion, status: row.status },
        data: {
          status: to,
          updatedBy: actorId,
          expectedVersion: { increment: 1 },
        },
      });
      if (change.count !== 1) throw new ProjectApiError(409, 'The finding changed while the review decision was being recorded. Reload and retry.');
      await tx.findingHistory.create({ data: { findingId: row.id, engagementId, actorId, action: to, reason: note || null, fromStatus: row.status, toStatus: to, findingVersion: version } });
      if (to === 'returned') await tx.findingComment.create({ data: { findingId: row.id, engagementId, actorId, text: note, findingVersion: version, requestId: `return-v${version}`, payloadHash: payloadHash({ actorId, text: note }) } });
      const fresh = await tx.findingRecord.findFirst({ where: { id: row.id, engagementId } });
      await tx.webAuditEntry.create({ data: { engagementId, actorId, action: `finding.${to}`, targetType: 'finding', targetId: row.id, reason: note || `${row.status} -> ${to} @ v${row.expectedVersion}` } });
      return fresh;
    });
    if (updated === null) throw new ProjectApiError(404, 'Finding not found.');
    const evidence = await this.db.evidenceLink.findMany({ where: { findingId: row.id } });
    return this.toView(updated, evidence);
  }

  public async addComment(actorId: string, engagementId: string, findingId: string, input: unknown): Promise<CuratedFindingView> {
    const access = await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    if (!['owner', 'operator', 'reviewer'].includes(access.role)) throw new ProjectApiError(403, 'The viewer role cannot comment on findings.');
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { text?: unknown; expectedVersion?: unknown; requestId?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 4000) throw new ProjectApiError(400, 'A comment (1-4000 characters) is required.');
    if (typeof body.expectedVersion !== 'number' || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) throw new ProjectApiError(400, 'expectedVersion is required for comment creation.');
    const expectedVersion = body.expectedVersion;
    const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
    if (!requestId || requestId.length > 128) throw new ProjectApiError(400, 'requestId (1-128 characters) is required for comment idempotency.');
    const row = await this.findOwned(engagementId, findingId);
    const hash = payloadHash({ actorId, text });
    const existing = await this.db.findingComment.findFirst({ where: { findingId: row.id, requestId } });
    if (existing !== null) {
      if (existing.payloadHash !== hash) throw new ProjectApiError(409, 'The comment requestId was already used for different content.');
      const evidence = await this.db.evidenceLink.findMany({ where: { findingId: row.id } });
      return this.toView(row, evidence);
    }
    if (row.expectedVersion !== expectedVersion) throw new ProjectApiError(409, `Concurrent edit: the finding moved to version ${row.expectedVersion}; reload before commenting.`);
    if (row.status === 'resolved') throw new ProjectApiError(409, 'Resolved findings are immutable and cannot receive new comments.');
    const version = row.expectedVersion + 1;
    let updated;
    try {
      updated = await this.db.$transaction(async (tx) => {
        const change = await tx.findingRecord.updateMany({ where: { id: row.id, engagementId, expectedVersion, status: row.status }, data: { expectedVersion: { increment: 1 }, updatedBy: actorId } });
        if (change.count !== 1) throw new ProjectApiError(409, 'The finding changed while the comment was being saved; reload and retry.');
        await tx.findingComment.create({ data: { findingId: row.id, engagementId, actorId, text, findingVersion: version, requestId, payloadHash: hash } });
        await tx.findingHistory.create({ data: { findingId: row.id, engagementId, actorId, action: 'commented', fromStatus: row.status, toStatus: row.status, findingVersion: version } });
        await tx.webAuditEntry.create({ data: { engagementId, actorId, action: 'finding.commented', targetType: 'finding', targetId: row.id, reason: `comment @ v${version}` } });
        return tx.findingRecord.findFirst({ where: { id: row.id, engagementId } });
      });
    } catch (error) {
      const replay = await this.db.findingComment.findFirst({ where: { findingId: row.id, requestId } });
      if (replay === null) throw error;
      if (replay.payloadHash !== hash) throw new ProjectApiError(409, 'The comment requestId was already used for different content.');
      updated = await this.db.findingRecord.findFirst({ where: { id: row.id, engagementId } });
    }
    if (updated === null) throw new ProjectApiError(404, 'Finding not found.');
    const evidence = await this.db.evidenceLink.findMany({ where: { findingId: row.id } });
    return this.toView(updated, evidence);
  }

  public async recordRetest(actorId: string, engagementId: string, findingId: string, input: unknown): Promise<CuratedFindingView> {
    const access = await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { result?: unknown; note?: unknown; expectedVersion?: unknown; requestId?: unknown; captureIds?: unknown };
    const result = typeof body.result === 'string' ? body.result : '';
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!['Resolved', 'Persists', 'Partial'].includes(result)) throw new ProjectApiError(400, 'result must be Resolved, Persists or Partial.');
    if (!note || note.length > 4000) throw new ProjectApiError(400, 'A retest note (1-4000 characters) is required.');
    if (typeof body.expectedVersion !== 'number' || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) throw new ProjectApiError(400, 'expectedVersion is required for retest creation.');
    const expectedVersion = body.expectedVersion;
    const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
    if (!requestId || requestId.length > 128) throw new ProjectApiError(400, 'requestId (1-128 characters) is required for retest idempotency.');
    if (!['owner', 'operator', 'reviewer'].includes(access.role)) throw new ProjectApiError(403, 'The viewer role cannot record retests.');
    const row = await this.findOwned(engagementId, findingId);
    const captureIds = body.captureIds === undefined ? [] : body.captureIds;
    if (!Array.isArray(captureIds) || captureIds.length > 20 || !captureIds.every((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 256) || new Set(captureIds).size !== captureIds.length) throw new ProjectApiError(400, 'captureIds must contain at most 20 distinct capture identities.');
    const evidenceRefs = [...captureIds].sort();
    const hash = payloadHash({ actorId, result, note, evidenceRefs });
    const existing = await this.db.findingRetest.findFirst({ where: { findingId: row.id, requestId } });
    if (existing !== null) {
      if (existing.payloadHash !== hash) throw new ProjectApiError(409, 'The retest requestId was already used for different content.');
      const evidence = await this.db.evidenceLink.findMany({ where: { findingId: row.id } });
      return this.toView(row, evidence);
    }
    if (row.expectedVersion !== expectedVersion) throw new ProjectApiError(409, `Concurrent edit: the finding moved to version ${row.expectedVersion}; reload before recording a retest.`);
    if (!['confirmed', 'remediation', 'retest'].includes(row.status)) throw new ProjectApiError(409, `Retest is not available while the finding is ${row.status}.`);
    if (result === 'Resolved' && (row.status !== 'retest' || evidenceRefs.length === 0)) throw new ProjectApiError(409, 'Resolution requires the retest stage and at least one classified retained capture.');
    for (const captureId of evidenceRefs) {
      if (!this.artifacts?.captureById) throw new ProjectApiError(503, 'Retest evidence verification is unavailable.');
      await this.artifacts.captureById(actorId, engagementId, captureId);
    }
    const nextStatus = result === 'Resolved' ? 'resolved' : 'remediation';
    const version = row.expectedVersion + 1;
    let updated;
    try {
      updated = await this.db.$transaction(async (tx) => {
        const change = await tx.findingRecord.updateMany({ where: { id: row.id, engagementId, expectedVersion, status: row.status }, data: { expectedVersion: { increment: 1 }, status: nextStatus, updatedBy: actorId } });
        if (change.count !== 1) throw new ProjectApiError(409, 'The finding changed while the retest was being saved; reload and retry.');
        await tx.findingRetest.create({ data: { findingId: row.id, engagementId, actorId, result, note, findingVersion: version, evidenceRefs, requestId, payloadHash: hash } });
        await tx.findingHistory.create({ data: { findingId: row.id, engagementId, actorId, action: 'retested', reason: note, fromStatus: row.status, toStatus: nextStatus, findingVersion: version, evidenceRefs } });
        await tx.webAuditEntry.create({ data: { engagementId, actorId, action: 'finding.retested', targetType: 'finding', targetId: row.id, reason: `${result}: ${note}` } });
        return tx.findingRecord.findFirst({ where: { id: row.id, engagementId } });
      });
    } catch (error) {
      const replay = await this.db.findingRetest.findFirst({ where: { findingId: row.id, requestId } });
      if (replay === null) throw error;
      if (replay.payloadHash !== hash) throw new ProjectApiError(409, 'The retest requestId was already used for different content.');
      updated = await this.db.findingRecord.findFirst({ where: { id: row.id, engagementId } });
    }
    if (updated === null) throw new ProjectApiError(404, 'Finding not found.');
    const evidence = await this.db.evidenceLink.findMany({ where: { findingId: row.id } });
    return this.toView(updated, evidence);
  }

  /** Attaches an opaque evidence reference; cross-engagement ids are refused. */
  public async attachEvidence(actorId: string, engagementId: string, findingId: string, input: unknown): Promise<EvidenceView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_CURATE);
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { kind?: unknown; captureId?: unknown; artifactPath?: unknown; digest?: unknown; producer?: unknown; expectedVersion?: unknown };
    const kind = typeof body.kind === 'string' && ['artifact', 'digest'].includes(body.kind) ? body.kind : '';
    if (kind.length === 0) throw new ProjectApiError(400, "kind must be 'artifact' or 'digest'.");
    const captureId = typeof body.captureId === 'string' ? body.captureId.trim() : null;
    let artifactPath = typeof body.artifactPath === 'string' ? body.artifactPath.trim() : null;
    let digest = typeof body.digest === 'string' ? body.digest.trim() : null;
    if (kind === 'artifact' && (captureId === null || captureId.length === 0) && (artifactPath === null || artifactPath.length === 0)) throw new ProjectApiError(400, 'captureId or artifactPath is required for artifact evidence.');
    if (captureId !== null && artifactPath !== null) throw new ProjectApiError(400, 'Supply a captureId or an artifactPath, not both.');
    if (kind === 'digest' && (digest === null || digest.length === 0)) throw new ProjectApiError(400, 'digest is required for digest evidence.');
    if (kind === 'digest' && !/^[a-fA-F0-9]{64}$/.test(digest!)) throw new ProjectApiError(400, 'External digest references require a SHA-256 digest; their bytes are not verified.');
    const expectedVersion = body.expectedVersion;
    if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new ProjectApiError(400, 'expectedVersion is required for evidence attachment.');
    const row = await this.findOwned(engagementId, findingId);
    if (row.status === 'resolved') throw new ProjectApiError(409, 'Resolved findings are immutable; create a new finding to add evidence.');
    let producer = typeof body.producer === 'string' ? body.producer : null;
    if (captureId !== null) {
      if (kind !== 'artifact' || !this.artifacts?.captureById) throw new ProjectApiError(503, 'Retained capture lookup is unavailable.');
      const capture = await this.artifacts.captureById(actorId, engagementId, captureId, { requireReadable: false });
      artifactPath = capture.path;
      digest = capture.digest;
      producer = capture.producer;
      const existing = await this.db.evidenceLink.findFirst({ where: { findingId: row.id, captureId } });
      if (existing !== null) return this.toEvidenceView(existing);
    }
    if (row.expectedVersion !== expectedVersion) throw new ProjectApiError(409, `Concurrent edit: the finding moved to version ${row.expectedVersion} while you attached evidence at version ${expectedVersion}. Reload and reapply.`);
    // A retained capture was already resolved and integrity-checked above; only a bare workspace path is retained here.
    if (kind === 'artifact' && captureId === null) {
      if (!this.artifacts) throw new ProjectApiError(503, 'The retained artifact authority is unavailable.');
      const capture = await this.artifacts.capture(actorId, engagementId, artifactPath!);
      if (digest !== null && digest !== capture.digest) throw new ProjectApiError(409, 'The claimed digest does not match the retained capture bytes.');
      digest = capture.digest;
      producer = capture.producer;
    }
    const invalidated = ['confirmed', 'remediation', 'retest'].includes(row.status);
    const nextStatus = invalidated ? 'review' : row.status;
    try {
      const link = await this.db.$transaction(async (tx) => {
        const created = await tx.evidenceLink.create({ data: { findingId: row.id, engagementId, captureId, kind, artifactPath, digest, producer } });
        const updated = await tx.findingRecord.updateMany({
          where: { id: row.id, engagementId, expectedVersion, status: row.status },
          data: { expectedVersion: { increment: 1 }, status: nextStatus, updatedBy: actorId, contentUpdatedBy: actorId },
        });
        if (updated.count !== 1) throw new ProjectApiError(409, 'The finding changed while evidence was attached; reload and retry.');
        await tx.findingHistory.create({ data: { findingId: row.id, engagementId, actorId, action: 'evidence_attached', reason: `${kind} evidence linked`, fromStatus: row.status, toStatus: nextStatus, findingVersion: expectedVersion + 1, evidenceRefs: [created.id] } });
        await tx.webAuditEntry.create({ data: { engagementId, actorId, action: 'evidence.attached', targetType: 'evidence', targetId: created.id, reason: `${kind} on ${row.id} @ v${row.expectedVersion}${invalidated ? ' (confirmation invalidated)' : ''}` } });
        return created;
      });
      return this.toEvidenceView(link);
    } catch (error) {
      if (!isUniqueConstraintError(error) || captureId === null) throw error;
      const replay = await this.db.evidenceLink.findFirst({ where: { findingId: row.id, captureId } });
      if (replay === null) throw error;
      return this.toEvidenceView(replay);
    }
  }

  private async findOwned(engagementId: string, findingId: string): Promise<FindingRecord> {
    const row = await this.db.findingRecord.findFirst({ where: { id: findingId, engagementId } });
    if (row === null) throw new ProjectApiError(404, 'Finding not found');
    return row;
  }

  private async toView(row: FindingRecord, evidence: EvidenceLink[], producerResolved?: boolean): Promise<CuratedFindingView> {
    const body = bodyRecord(row.body);
    const [comments, history, retests, decision] = await Promise.all([
      readFindingActivity(this.db, row.engagementId, row.id, 'comments', row.expectedVersion),
      readFindingActivity(this.db, row.engagementId, row.id, 'history', row.expectedVersion),
      readFindingActivity(this.db, row.engagementId, row.id, 'retests', row.expectedVersion),
      this.db.findingHistory.findFirst({ where: { findingId: row.id, engagementId: row.engagementId, action: { in: ['confirmed', 'returned'] }, findingVersion: { lte: row.expectedVersion } }, orderBy: { findingVersion: 'desc' } }),
    ]);
    return {
      id: row.id,
      engagementId: row.engagementId,
      title: row.title,
      severity: row.severity as CuratedFindingView['severity'],
      status: row.status as CuratedFindingView['status'],
      body: {
        detail: typeof body.detail === 'string' ? body.detail : '',
        impact: typeof body.impact === 'string' ? body.impact : '',
        recommendation: typeof body.recommendation === 'string' ? body.recommendation : '',
        severityRationale: typeof body.severityRationale === 'string' ? body.severityRationale : '',
        scopeNote: typeof body.scopeNote === 'string' ? body.scopeNote : '',
      },
      expectedVersion: row.expectedVersion,
      sourceType: row.sourceType as CuratedFindingView['sourceType'],
      producerRef: row.producerRef,
      producerDigest: row.producerDigest ?? null,
      ...(row.sourceType === 'imported' ? { producerResolved } : {}),
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      evidence: evidence.map((e) => this.toEvidenceView(e)),
      references: { assetId: row.assetId ?? null, bindingId: row.bindingId ?? null, threadId: row.threadId ?? null, runId: row.runId ?? null, techniqueId: row.techniqueId ?? null },
      activityCursors: { comments: comments.nextCursor, history: history.nextCursor, retests: retests.nextCursor },
      lastReviewDecision: decision ? { action: decision.action as FindingReviewDecision['action'], actorId: decision.actorId, createdAt: decision.createdAt.toISOString(), reason: decision.reason, version: decision.findingVersion } : null,
      comments: comments.items.reverse().map((item) => ({ ...item })),
      history: history.items.reverse().map((item) => ({ ...item, version: item.findingVersion })),
      retests: retests.items.reverse().map((item) => ({ ...item, result: item.result! as FindingRetestRecord['result'], note: item.note! })),
    };
  }

  private toEvidenceView(row: { id: string; engagementId: string; captureId?: string | null; kind: string; artifactPath: string | null; digest: string | null; producer: string | null; createdAt: Date }): EvidenceView {
    return {
      id: row.id,
      engagementId: row.engagementId,
      captureId: row.captureId ?? null,
      kind: row.kind as EvidenceView['kind'],
      artifactPath: row.artifactPath,
      digest: row.digest,
      producer: row.producer,
      createdAt: row.createdAt.toISOString(),
    };
  }

}
