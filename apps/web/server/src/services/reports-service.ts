import type { PrismaClient } from '../generated/prisma/client.js';
import { createHash } from 'node:crypto';
import { ProjectApiError } from './projects-service.js';
import { createNotice } from './inbox-service.js';
import { requireEngagementAccess, requireIndependentActor, type ActorContext, type MemberRole } from '../auth/membership-policy.js';
import { assertEngagementOpen } from './closure-service.js';

/**
 * Ticket 11: report lifecycle with independent version-pinned review and
 * separate audited export/delivery records. Reviewers must differ from the
 * author (four-eyes); approval pins the exact version, later edits require
 * re-review. Export reuses the engagement export path but is recorded as a
 * report delivery action with truthful completion/failure — never relabeled
 * as a reviewed deliverable by itself.
 */

const MIN_EDIT: MemberRole = 'operator';
const MIN_REVIEW: MemberRole = 'reviewer';

export interface ReportView {
  readonly id: string;
  readonly engagementId: string;
  readonly title: string;
  readonly version: number;
  readonly status: 'draft' | 'in_review' | 'approved' | 'changes_requested' | 'delivered';
  readonly body: { readonly summary: string; readonly sections: readonly { title: string; content: string }[] };
  readonly createdBy: string;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly reviewComment: string | null;
  readonly approvedVersion: number | null;
  readonly updatedAt: string;
  readonly deliveries: readonly { id: string; kind: string; format: string; status: string; createdAt: string }[];
}

export interface ReportsView {
  readonly engagementId: string;
  readonly reports: ReportView[];
  readonly exportFormats: readonly string[];
  readonly source: 'db';
}

export interface ReportArtifactView {
  readonly engagementId: string;
  readonly reportId: string;
  readonly version: number;
  readonly format: 'json' | 'markdown';
  readonly mediaType: string;
  readonly content: string;
  readonly digest: string;
}

export class ReportsService {
  public constructor(private readonly db: PrismaClient) {}

  private ctx(actorId: string): ActorContext {
    return { db: this.db, actorId, multiUser: true };
  }

  public async list(actorId: string, engagementId: string): Promise<ReportsView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const rows = await this.db.reportRecord.findMany({ where: { engagementId }, orderBy: { createdAt: 'desc' } });
    const reports: ReportView[] = [];
    for (const row of rows) {
      const deliveries = await this.db.reportDelivery.findMany({ where: { reportId: row.id }, orderBy: { createdAt: 'desc' } });
      reports.push(this.toView(row as never, deliveries as never[]));
    }
    // Only the formats the existing export service actually supports.
    return { engagementId, reports, exportFormats: ['json', 'markdown'], source: 'db' };
  }

  public async create(actorId: string, engagementId: string, input: unknown): Promise<ReportView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_EDIT);
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { title?: unknown; summary?: unknown };
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (title.length === 0 || title.length > 300) throw new ProjectApiError(400, 'title (1-300 chars) is required.');
    const row = await this.db.reportRecord.create({
      data: {
        engagementId,
        title,
        version: 1,
        status: 'draft',
        body: { summary: typeof body.summary === 'string' ? body.summary : '', sections: [] } as object,
        createdBy: actorId,
      },
    });
    await this.audit(engagementId, actorId, 'report.created', 'report', row.id, title);
    return this.toView(row as never, []);
  }

  public async update(actorId: string, engagementId: string, reportId: string, input: unknown): Promise<ReportView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_EDIT);
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { expectedVersion?: unknown; title?: unknown; summary?: unknown; sections?: unknown };
    const expectedVersion = typeof body.expectedVersion === 'number' ? body.expectedVersion : null;
    if (expectedVersion === null) throw new ProjectApiError(400, 'expectedVersion is required for concurrent-edit safety.');
    const row = await this.findOwned(engagementId, reportId);
    if (row.version !== expectedVersion) {
      throw new ProjectApiError(409, `Concurrent edit: the report moved to version ${row.version} while you edited version ${expectedVersion}. Your draft is preserved — reload and reapply.`);
    }
    if (row.status === 'approved' || row.status === 'delivered') {
      throw new ProjectApiError(409, `The report is ${row.status}; editing it invalidates the pinned review. Draft a new version instead.`);
    }
    const sections = Array.isArray(body.sections)
      ? body.sections.map((s) => {
        const item = (s ?? {}) as { title?: unknown; content?: unknown };
        return { title: typeof item.title === 'string' ? item.title : '', content: typeof item.content === 'string' ? item.content : '' };
      })
      : undefined;
    const updated = await this.db.reportRecord.update({
      where: { id: row.id, version: expectedVersion, status: row.status },
      data: {
        status: row.status === 'in_review' ? 'draft' : row.status,
        title: typeof body.title === 'string' && body.title.trim().length > 0 ? body.title.trim() : row.title,
        body: {
          summary: typeof body.summary === 'string' ? body.summary : (row.body as { summary?: string }).summary ?? '',
          sections: sections ?? (row.body as { sections?: unknown }).sections ?? [],
        } as object,
        version: { increment: 1 },
      },
    });
    await this.audit(engagementId, actorId, 'report.updated', 'report', row.id, `v${row.version} -> v${row.version + 1}`);
    return this.toView(updated as never, []);
  }

  public async submitReview(actorId: string, engagementId: string, reportId: string): Promise<ReportView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_EDIT);
    await assertEngagementOpen(this.db, engagementId);
    const row = await this.findOwned(engagementId, reportId);
    if (row.status !== 'draft' && row.status !== 'changes_requested') {
      throw new ProjectApiError(409, `The report is ${row.status}; only drafts or change-requests can enter review.`);
    }
    const updated = await this.db.reportRecord.update({ where: { id: row.id }, data: { status: 'in_review' } });
    await this.audit(engagementId, actorId, 'report.review_requested', 'report', row.id, `v${row.version}`);
    return this.toView(updated as never, []);
  }

  public async decideReview(actorId: string, engagementId: string, reportId: string, input: unknown): Promise<ReportView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_REVIEW);
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { decision?: unknown; comment?: unknown; expectedVersion?: unknown };
    const decision = typeof body.decision === 'string' ? body.decision : '';
    const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
    if (decision !== 'approved' && decision !== 'changes_requested') throw new ProjectApiError(400, "decision must be 'approved' or 'changes_requested'.");
    if (comment.length === 0) throw new ProjectApiError(400, 'A review comment is mandatory.');
    const row = await this.findOwned(engagementId, reportId);
    if (row.status !== 'in_review') throw new ProjectApiError(409, `The report is ${row.status}, not in review.`);
    requireIndependentActor(row.createdBy, actorId, 'The report review');
    if (body.expectedVersion !== row.version) throw new ProjectApiError(409, 'The reviewed version changed; reload the report before deciding.');
    const updated = await this.db.reportRecord.update({
      where: { id: row.id, version: row.version, status: 'in_review' },
      data: {
        status: decision === 'approved' ? 'approved' : 'changes_requested',
        reviewedBy: actorId,
        reviewedAt: new Date(),
        reviewComment: comment,
        approvedVersion: decision === 'approved' ? row.version : null,
      },
    });
    await this.audit(engagementId, actorId, `report.review_${decision}`, 'report', row.id, `v${row.version}: ${comment}`);
    await createNotice(this.db, { engagementId, actorId: row.createdBy, kind: 'report.review_decided', title: `Report "${row.title}" v${row.version} was ${decision === 'approved' ? 'approved' : 'sent back with comments'}`, detail: { reportId: row.id, decision, reviewedBy: actorId } });
    return this.toView(updated as never, []);
  }

  public async exportReport(actorId: string, engagementId: string, reportId: string, format: string): Promise<ReportArtifactView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    if (format !== 'json' && format !== 'markdown') throw new ProjectApiError(400, 'format must be json or markdown.');
    const row = await this.findOwned(engagementId, reportId);
    return this.artifact(this.toView(row, []), format);
  }

  private artifact(report: ReportView, format: 'json' | 'markdown'): ReportArtifactView {
    const content = format === 'json' ? JSON.stringify({ reportId: report.id, engagementId: report.engagementId, version: report.version, title: report.title, body: report.body, approvedVersion: report.approvedVersion }, null, 2)
      : `# ${report.title}\n\nReport ${report.id}, version ${report.version}\n\n${report.body.summary}\n\n${report.body.sections.map((s) => `## ${s.title}\n\n${s.content}`).join('\n\n')}\n`;
    return { engagementId: report.engagementId, reportId: report.id, version: report.version, format, mediaType: format === 'json' ? 'application/json' : 'text/markdown', content, digest: createHash('sha256').update(content).digest('hex') };
  }

  /** Export/delivery as separate audited records with truthful outcomes. */
  public async deliver(actorId: string, engagementId: string, reportId: string, input: unknown): Promise<ReportView & { artifact: ReportArtifactView }> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_EDIT);
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { kind?: unknown; format?: unknown; requestId?: unknown; recipient?: unknown; receipt?: unknown; expectedVersion?: unknown };
    const kind = typeof body.kind === 'string' && ['export', 'delivery'].includes(body.kind) ? body.kind : '';
    const format = typeof body.format === 'string' && ['json', 'markdown'].includes(body.format) ? body.format : '';
    const requestId = typeof body.requestId === 'string' && body.requestId.trim().length > 0 ? body.requestId.trim() : '';
    if (kind.length === 0 || format.length === 0) throw new ProjectApiError(400, "kind ('export'|'delivery') and format ('json'|'markdown') are required.");
    if (requestId.length === 0) throw new ProjectApiError(400, 'requestId is required so a retry cannot duplicate a delivery.');
    const row = await this.findOwned(engagementId, reportId);
    const existing = await this.db.reportDelivery.findFirst({ where: { reportId: row.id, requestId } });
    // W20: the replay fingerprint covers the meaningful delivery input — a
    // reused request id with a different payload is a conflict, not a replay.
    const fingerprint = createHash('sha256').update(JSON.stringify({
      kind,
      format,
      recipient: kind === 'delivery' ? (typeof body.recipient === 'string' ? body.recipient.trim() : '') : '',
      receipt: kind === 'delivery' ? (typeof body.receipt === 'string' ? body.receipt.trim() : '') : '',
      expectedVersion: kind === 'delivery' ? body.expectedVersion : null,
    })).digest('hex');
    if (existing !== null) {
      const replayDetail = existing.detail as { fingerprint?: unknown; artifact?: unknown } | null;
      if (replayDetail?.fingerprint !== undefined && replayDetail.fingerprint !== fingerprint) {
        throw new ProjectApiError(409, 'This request id was already used with a different payload; a new requestId is required.');
      }
      const replayArtifact = replayDetail?.artifact as ReportArtifactView | undefined;
      if (replayArtifact === undefined || typeof replayArtifact.content !== 'string') {
        throw new ProjectApiError(503, 'The recorded delivery is missing its artifact; a new requestId is required.');
      }
      // Same request id: replay of an already-processed request returns the
      // recorded outcome — never a duplicate dispatch or a state re-check.
      return { ...this.toView(row as never, [existing as never]), artifact: replayArtifact };
    }
    if (kind === 'delivery' && (row.status !== 'approved' || row.approvedVersion !== row.version)) {
      throw new ProjectApiError(409, `Delivery requires an approved report; the report is ${row.status}. An export is not a reviewed deliverable.`);
    }
    const recipient = typeof body.recipient === 'string' ? body.recipient.trim() : '';
    const receipt = typeof body.receipt === 'string' ? body.receipt.trim() : '';
    if (kind === 'delivery' && (!recipient || !receipt)) throw new ProjectApiError(400, 'Manual delivery requires a recipient and an acknowledgement receipt; export alone is not delivery.');
    if (kind === 'delivery' && body.expectedVersion !== row.approvedVersion) throw new ProjectApiError(409, 'Delivery must acknowledge the exact approved version.');
    const artifact = this.artifact(this.toView(row, []), format as 'json' | 'markdown');
    const status = 'completed';
    const detail = { artifact, fingerprint, ...(kind === 'delivery' ? { channel: 'manual-acknowledgement', recipient, receipt, acknowledgedBy: actorId } : {}) };
    // W20: the delivery record, the report status transition and the audit
    // entry commit together — no orphan "completed" delivery without its
    // state change, and no state change without its audit trail.
    await this.db.$transaction(async (tx) => {
      const delivery = await tx.reportDelivery.create({
        data: { reportId: row.id, engagementId, kind, format, status, requestId, detail: detail as object },
      });
      if (kind === 'delivery' && status === 'completed' && row.status === 'approved') {
        await tx.reportRecord.update({ where: { id: row.id, version: row.version, approvedVersion: row.version, status: 'approved' }, data: { status: 'delivered' } });
      }
      await tx.webAuditEntry.create({ data: { engagementId, actorId, action: `report.${kind}`, targetType: 'report_delivery', targetId: delivery.id, reason: `${format} ${status}` } });
    });
    const fresh = await this.findOwned(engagementId, reportId);
    const deliveries = await this.db.reportDelivery.findMany({ where: { reportId: row.id }, orderBy: { createdAt: 'desc' } });
    // W20: the response carries the exact artifact this request produced —
    // the client never re-reads a possibly-changed report.
    return { ...this.toView(fresh as never, deliveries as never[]), artifact };
  }

  /**
   * W20: after approval/delivery the reviewed snapshot is immutable; a
   * revision is a fresh draft record carrying the reviewed content that must
   * re-enter independent review before it can be exported as a deliverable.
   */
  public async revise(actorId: string, engagementId: string, reportId: string, input: unknown): Promise<ReportView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_EDIT);
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { expectedVersion?: unknown };
    const row = await this.findOwned(engagementId, reportId);
    if (row.status !== 'approved' && row.status !== 'delivered') {
      throw new ProjectApiError(409, `The report is ${row.status}; only an approved or delivered report gets a revision — edit the draft instead.`);
    }
    if (body.expectedVersion !== row.version) throw new ProjectApiError(409, `Concurrent edit: the report moved to version ${row.version}. Reload and retry.`);
    const revised = await this.db.$transaction(async (tx) => {
      const created = await tx.reportRecord.create({
        data: {
          engagementId,
          title: row.title,
          version: 1,
          status: 'draft',
          body: row.body as object,
          createdBy: actorId,
        },
      });
      await tx.webAuditEntry.create({ data: { engagementId, actorId, action: 'report.revised', targetType: 'report', targetId: created.id, reason: `revision of ${row.id} v${row.version}` } });
      return created;
    });
    await createNotice(this.db, { engagementId, actorId: row.reviewedBy ?? row.createdBy, kind: 'report.revision_created', title: `Report "${row.title}" has a new draft revision from ${row.createdBy}`, detail: { reportId: revised.id, revisionOf: row.id } });
    return this.toView(revised as never, []);
  }

  private async findOwned(engagementId: string, reportId: string) {
    const row = await this.db.reportRecord.findFirst({ where: { id: reportId, engagementId } });
    if (row === null) throw new ProjectApiError(404, 'Report not found');
    return row as never as { id: string; engagementId: string; title: string; version: number; status: string; body: unknown; createdBy: string; reviewedBy: string | null; reviewedAt: Date | null; reviewComment: string | null; approvedVersion: number | null; updatedAt: Date };
  }

  private toView(row: { id: string; engagementId: string; title: string; version: number; status: string; body: unknown; createdBy: string; reviewedBy: string | null; reviewedAt: Date | null; reviewComment: string | null; approvedVersion: number | null; updatedAt: Date }, deliveries: { id: string; kind: string; format: string; status: string; createdAt: Date }[]): ReportView {
    const body = row.body as { summary?: unknown; sections?: unknown };
    return {
      id: row.id,
      engagementId: row.engagementId,
      title: row.title,
      version: row.version,
      status: row.status as ReportView['status'],
      body: {
        summary: typeof body.summary === 'string' ? body.summary : '',
        sections: Array.isArray(body.sections) ? body.sections : [],
      },
      createdBy: row.createdBy,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewComment: row.reviewComment,
      approvedVersion: row.approvedVersion,
      updatedAt: row.updatedAt.toISOString(),
      deliveries: deliveries.map((d) => ({ id: d.id, kind: d.kind, format: d.format, status: d.status, createdAt: d.createdAt.toISOString() })),
    };
  }

  private async audit(engagementId: string, actorId: string, action: string, targetType: string, targetId: string, reason: string): Promise<void> {
    await this.db.webAuditEntry.create({ data: { engagementId, actorId, action, targetType, targetId, reason } });
  }
}
