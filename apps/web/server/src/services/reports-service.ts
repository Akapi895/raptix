import type { FindingRecord, PrismaClient, ReportAcknowledgement, ReportDelivery, ReportFindingSnapshot, ReportRecord, ReportTemplate } from '../generated/prisma/client.js';
import { createHash } from 'node:crypto';
import { renderReportDocx, renderReportPdf } from './report-render.js';
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
 *
 * P06/P07: a report carries a versioned template, a reporting period, a named
 * reviewer and exact finding snapshots. Readiness is computed here on every
 * read and re-checked before submit, approval and delivery. A recipient
 * acknowledgement is a separate fact from the delivery record.
 */

const MIN_EDIT: MemberRole = 'operator';
const MIN_REVIEW: MemberRole = 'reviewer';
/** Findings that may enter a report: confirmed-or-later lifecycle stages. */
const REPORTABLE_STATUSES: readonly string[] = ['confirmed', 'remediation', 'retest', 'resolved'];
const EDITABLE_STATUSES: string[] = ['draft', 'changes_requested'];

export interface ReportTemplateSection { readonly title: string; readonly required: boolean }

export interface ReportTemplateView {
  readonly id: string;
  readonly engagementId: string;
  readonly name: string;
  readonly version: number;
  readonly sections: readonly ReportTemplateSection[];
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface ReportSnapshotEvidence {
  readonly id: string;
  readonly captureId: string | null;
  readonly kind: string;
  readonly artifactPath: string | null;
  readonly digest: string | null;
  readonly producer: string | null;
}

export interface ReportFindingSnapshotView {
  readonly id: string;
  readonly findingId: string;
  readonly findingVersion: number;
  readonly position: number;
  readonly title: string;
  readonly severity: string;
  readonly status: string;
  readonly body: { readonly detail: string; readonly impact: string; readonly recommendation: string; readonly severityRationale: string; readonly scopeNote: string };
  readonly evidence: readonly ReportSnapshotEvidence[];
}

export interface ReportReadinessCheck {
  readonly id: 'findings' | 'evidence' | 'template' | 'period' | 'reviewer';
  readonly label: string;
  readonly state: 'pass' | 'fail' | 'unavailable';
  readonly detail: string;
}

export interface ReportReadinessView { readonly ready: boolean; readonly checks: readonly ReportReadinessCheck[] }

export interface ReportDeliveryView {
  readonly id: string;
  readonly kind: string;
  readonly format: string;
  readonly status: string;
  readonly createdAt: string;
  /** Receipt recorded at delivery time by the legacy manual flow; not a recipient acknowledgement. */
  readonly recordedReceipt: { readonly recipient: string; readonly receipt: string; readonly actorId: string | null } | null;
  readonly acknowledgement: { readonly id: string; readonly actorId: string; readonly receipt: string; readonly createdAt: string } | null;
}

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
  readonly templateId: string | null;
  readonly templateVersion: number | null;
  readonly period: { readonly start: string; readonly end: string } | null;
  readonly reviewerId: string | null;
  readonly parentReportId: string | null;
  readonly rootReportId: string | null;
  readonly selectedFindings: readonly ReportFindingSnapshotView[];
  readonly readiness: ReportReadinessView;
  readonly deliveries: readonly ReportDeliveryView[];
}

export interface ReportsView {
  readonly engagementId: string;
  readonly reports: ReportView[];
  readonly templates: readonly ReportTemplateView[];
  readonly exportFormats: readonly string[];
  readonly source: 'db';
}

export type ReportFormat = 'json' | 'markdown' | 'pdf' | 'docx';

export interface ReportArtifactView {
  readonly engagementId: string;
  readonly reportId: string;
  readonly version: number;
  readonly format: ReportFormat;
  readonly mediaType: string;
  /** UTF-8 text for json and markdown; base64 bytes for pdf and docx. Always a string so a recorded delivery can replay. */
  readonly content: string;
  readonly encoding: 'utf8' | 'base64';
  readonly digest: string;
}

function templateView(row: ReportTemplate): ReportTemplateView {
  return {
    id: row.id,
    engagementId: row.engagementId,
    name: row.name,
    version: row.version,
    sections: sectionsOf(row.sections),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function sectionsOf(value: unknown): ReportTemplateSection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const section = (item ?? {}) as { title?: unknown; required?: unknown };
    return typeof section.title === 'string' ? [{ title: section.title, required: section.required === true }] : [];
  });
}

function evidenceOf(snapshot: ReportFindingSnapshot): ReportSnapshotEvidence[] {
  return Array.isArray(snapshot.evidence) ? snapshot.evidence as unknown as ReportSnapshotEvidence[] : [];
}

const REPORT_FORMATS: readonly ReportFormat[] = ['json', 'markdown', 'pdf', 'docx'];
function isReportFormat(value: string): value is ReportFormat {
  return (REPORT_FORMATS as readonly string[]).includes(value);
}

function snapshotView(snapshot: ReportFindingSnapshot): ReportFindingSnapshotView {
  const body = (snapshot.body ?? {}) as Record<string, unknown>;
  const text = (key: string): string => typeof body[key] === 'string' ? body[key] as string : '';
  return {
    id: snapshot.id,
    findingId: snapshot.findingId,
    findingVersion: snapshot.findingVersion,
    position: snapshot.position,
    title: snapshot.title,
    severity: snapshot.severity,
    status: snapshot.status,
    body: { detail: text('detail'), impact: text('impact'), recommendation: text('recommendation'), severityRationale: text('severityRationale'), scopeNote: text('scopeNote') },
    evidence: evidenceOf(snapshot),
  };
}

function deliveryView(row: ReportDelivery & { acknowledgement: ReportAcknowledgement | null }): ReportDeliveryView {
  const detail = (row.detail ?? null) as { recipient?: unknown; receipt?: unknown; acknowledgedBy?: unknown } | null;
  return {
    id: row.id,
    kind: row.kind,
    format: row.format,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    recordedReceipt: detail !== null && typeof detail.receipt === 'string'
      ? { recipient: typeof detail.recipient === 'string' ? detail.recipient : '', receipt: detail.receipt, actorId: typeof detail.acknowledgedBy === 'string' ? detail.acknowledgedBy : null }
      : null,
    acknowledgement: !row.acknowledgement ? null : {
      id: row.acknowledgement.id,
      actorId: row.acknowledgement.actorId,
      receipt: row.acknowledgement.receipt,
      createdAt: row.acknowledgement.createdAt.toISOString(),
    },
  };
}

export class ReportsService {
  public constructor(private readonly db: PrismaClient) {}

  private ctx(actorId: string): ActorContext {
    return { db: this.db, actorId, multiUser: true };
  }

  public async list(actorId: string, engagementId: string): Promise<ReportsView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const rows = await this.db.reportRecord.findMany({ where: { engagementId }, orderBy: { createdAt: 'desc' } });
    const templates = await this.db.reportTemplate.findMany({ where: { engagementId }, orderBy: [{ name: 'asc' }, { version: 'desc' }] });
    const reports: ReportView[] = [];
    for (const row of rows) reports.push(await this.load(row));
    // Only the formats the existing export service actually supports.
    return { engagementId, reports, templates: templates.map(templateView), exportFormats: ['json', 'markdown'], source: 'db' };
  }

  public async listTemplates(actorId: string, engagementId: string): Promise<{ engagementId: string; templates: ReportTemplateView[] }> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const templates = await this.db.reportTemplate.findMany({ where: { engagementId }, orderBy: [{ name: 'asc' }, { version: 'desc' }] });
    return { engagementId, templates: templates.map(templateView) };
  }

  /** Templates are managed by the engagement owner (admin and manager); other roles only read them. */
  public async createTemplate(actorId: string, engagementId: string, input: unknown): Promise<ReportTemplateView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'owner');
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { name?: unknown; sections?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length === 0 || name.length > 120) throw new ProjectApiError(400, 'name (1-120 chars) is required.');
    const sections = sectionsOf(body.sections).map((section) => ({ title: section.title.trim(), required: section.required }));
    if (sections.length === 0 || sections.length > 30) throw new ProjectApiError(400, 'A template needs 1-30 sections.');
    if (sections.some((section) => section.title.length === 0 || section.title.length > 200)) throw new ProjectApiError(400, 'Each section title needs 1-200 characters.');
    if (new Set(sections.map((section) => section.title)).size !== sections.length) throw new ProjectApiError(400, 'Section titles must be unique within a template.');
    const latest = await this.db.reportTemplate.findFirst({ where: { engagementId, name }, orderBy: { version: 'desc' } });
    const row = await this.db.reportTemplate.create({
      data: { engagementId, name, version: (latest?.version ?? 0) + 1, sections: sections as object[], createdBy: actorId },
    });
    await this.audit(engagementId, actorId, 'report.template_created', 'report_template', row.id, `${name} v${row.version}`);
    return templateView(row);
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
    return this.load(row);
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
    return this.load(updated);
  }

  /**
   * P06: the template, reporting period and named reviewer are versioned report
   * fields. A named reviewer only narrows who may decide; membership and
   * four-eyes independence are still checked at decision time.
   */
  public async updateSetup(actorId: string, engagementId: string, reportId: string, input: unknown): Promise<ReportView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_EDIT);
    await assertEngagementOpen(this.db, engagementId);
    const row = await this.findOwned(engagementId, reportId);
    const body = (input ?? {}) as { expectedVersion?: unknown; templateId?: unknown; periodStart?: unknown; periodEnd?: unknown; reviewerId?: unknown };
    this.requireEditable(row, body.expectedVersion, 'changing the report setup');

    const data: { templateId?: string | null; templateVersion?: number | null; periodStart?: Date | null; periodEnd?: Date | null; reviewerId?: string | null } = {};
    let seedSections: ReportTemplateSection[] | null = null;
    if (body.templateId !== undefined) {
      if (body.templateId === null) {
        data.templateId = null;
        data.templateVersion = null;
      } else {
        if (typeof body.templateId !== 'string') throw new ProjectApiError(400, 'templateId must be a template identity or null.');
        const template = await this.db.reportTemplate.findFirst({ where: { id: body.templateId, engagementId } });
        if (template === null) throw new ProjectApiError(404, 'Template not found in this engagement.');
        data.templateId = template.id;
        data.templateVersion = template.version;
        seedSections = sectionsOf(template.sections);
      }
    }
    if (body.periodStart !== undefined || body.periodEnd !== undefined) {
      const start = body.periodStart === null || body.periodStart === undefined ? null : parseTimestamp(body.periodStart, 'periodStart');
      const end = body.periodEnd === null || body.periodEnd === undefined ? null : parseTimestamp(body.periodEnd, 'periodEnd');
      if (start !== null && end !== null && start > end) throw new ProjectApiError(400, 'periodStart must not be after periodEnd.');
      data.periodStart = start;
      data.periodEnd = end;
    }
    if (body.reviewerId !== undefined) {
      if (body.reviewerId === null) {
        data.reviewerId = null;
      } else {
        if (typeof body.reviewerId !== 'string' || body.reviewerId.length === 0) throw new ProjectApiError(400, 'reviewerId must be a member identity or null.');
        if (body.reviewerId === row.createdBy) throw new ProjectApiError(400, 'The named reviewer must differ from the report author.');
        const membership = await this.db.webMembership.findUnique({ where: { engagementId_userId: { engagementId, userId: body.reviewerId } } });
        if (membership === null || (membership.role !== 'owner' && membership.role !== 'reviewer')) {
          throw new ProjectApiError(400, 'The named reviewer must be an engagement member with the owner or reviewer role.');
        }
        data.reviewerId = body.reviewerId;
      }
    }
    // A template's sections become the report's empty sections once, so the required ones show as missing until written.
    const current = (row.body as { sections?: unknown }).sections;
    const seed = seedSections !== null && (!Array.isArray(current) || current.length === 0)
      ? { body: { ...(row.body as object), sections: seedSections.map((section) => ({ title: section.title, content: '' })) } as object }
      : {};
    const updated = await this.db.$transaction(async (tx) => {
      const bumped = await tx.reportRecord.updateMany({ where: { id: row.id, version: row.version, status: { in: EDITABLE_STATUSES } }, data: { ...data, ...seed, version: { increment: 1 } } });
      if (bumped.count !== 1) throw new ProjectApiError(409, 'Concurrent edit: the report changed while you edited its setup. Reload and reapply.');
      await tx.webAuditEntry.create({ data: { engagementId, actorId, action: 'report.setup_updated', targetType: 'report', targetId: row.id, reason: `v${row.version} -> v${row.version + 1}` } });
      return tx.reportRecord.findFirstOrThrow({ where: { id: row.id } });
    });
    return this.load(updated);
  }

  /**
   * P06: exact finding snapshots. Selection is replaced only while the report is
   * editable; each snapshot pins the finding version, content and evidence refs.
   */
  public async setFindings(actorId: string, engagementId: string, reportId: string, input: unknown): Promise<ReportView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_EDIT);
    await assertEngagementOpen(this.db, engagementId);
    const row = await this.findOwned(engagementId, reportId);
    const body = (input ?? {}) as { expectedVersion?: unknown; findingIds?: unknown };
    this.requireEditable(row, body.expectedVersion, 'selecting findings');
    const ids = Array.isArray(body.findingIds) && body.findingIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 128)
      ? [...new Set(body.findingIds as string[])]
      : null;
    if (ids === null || ids.length === 0 || ids.length > 100) throw new ProjectApiError(400, 'findingIds must list 1-100 finding identities.');
    const findings = await this.db.findingRecord.findMany({ where: { engagementId, id: { in: ids } } });
    if (findings.length !== ids.length) throw new ProjectApiError(404, 'One or more findings were not found in this engagement.');
    const refused = findings.filter((finding) => !REPORTABLE_STATUSES.includes(finding.status));
    if (refused.length > 0) {
      throw new ProjectApiError(409, `Only confirmed or later findings can be reported; not reportable: ${refused.map((finding) => finding.title).join(', ')}.`);
    }
    const byId = new Map(findings.map((finding) => [finding.id, finding]));
    const ordered = ids.flatMap((id) => {
      const finding = byId.get(id);
      return finding === undefined ? [] : [finding];
    });
    const snapshots: { finding: FindingRecord; evidence: ReportSnapshotEvidence[] }[] = [];
    for (const finding of ordered) {
      const links = await this.db.evidenceLink.findMany({ where: { findingId: finding.id }, orderBy: { createdAt: 'asc' } });
      snapshots.push({ finding, evidence: links.map((link) => ({ id: link.id, captureId: link.captureId, kind: link.kind, artifactPath: link.artifactPath, digest: link.digest, producer: link.producer })) });
    }
    const updated = await this.db.$transaction(async (tx) => {
      const bumped = await tx.reportRecord.updateMany({ where: { id: row.id, version: row.version, status: { in: EDITABLE_STATUSES } }, data: { version: { increment: 1 } } });
      if (bumped.count !== 1) throw new ProjectApiError(409, 'Concurrent edit: the report changed while you selected findings. Reload and reapply.');
      await tx.reportFindingSnapshot.deleteMany({ where: { reportId: row.id } });
      await tx.reportFindingSnapshot.createMany({
        data: snapshots.map(({ finding, evidence }, position) => ({
          reportId: row.id,
          engagementId,
          findingId: finding.id,
          findingVersion: finding.expectedVersion,
          title: finding.title,
          severity: finding.severity,
          status: finding.status,
          body: finding.body as object,
          evidence: evidence as object[],
          position,
          selectedBy: actorId,
        })),
      });
      await tx.webAuditEntry.create({ data: { engagementId, actorId, action: 'report.findings_selected', targetType: 'report', targetId: row.id, reason: `${snapshots.length} finding(s) at v${row.version + 1}` } });
      return tx.reportRecord.findFirstOrThrow({ where: { id: row.id } });
    });
    return this.load(updated);
  }

  public async submitReview(actorId: string, engagementId: string, reportId: string): Promise<ReportView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_EDIT);
    await assertEngagementOpen(this.db, engagementId);
    const row = await this.findOwned(engagementId, reportId);
    if (row.status !== 'draft' && row.status !== 'changes_requested') {
      throw new ProjectApiError(409, `The report is ${row.status}; only drafts or change-requests can enter review.`);
    }
    const readiness = await this.readinessOf(row);
    if (!readiness.ready) throw new ProjectApiError(409, notReadyMessage('submitted for review', readiness));
    const updated = await this.db.reportRecord.update({ where: { id: row.id }, data: { status: 'in_review' } });
    await this.audit(engagementId, actorId, 'report.review_requested', 'report', row.id, `v${row.version}`);
    return this.load(updated);
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
    if (row.reviewerId !== null && row.reviewerId !== actorId) throw new ProjectApiError(403, 'Only the named reviewer of this report can decide its review.');
    if (body.expectedVersion !== row.version) throw new ProjectApiError(409, 'The reviewed version changed; reload the report before deciding.');
    if (decision === 'approved') {
      const readiness = await this.readinessOf(row);
      if (!readiness.ready) throw new ProjectApiError(409, notReadyMessage('approved', readiness));
    }
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
    return this.load(updated);
  }

  public async exportReport(actorId: string, engagementId: string, reportId: string, format: string): Promise<ReportArtifactView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    if (!isReportFormat(format)) throw new ProjectApiError(400, 'format must be json, markdown, pdf or docx.');
    const row = await this.findOwned(engagementId, reportId);
    return this.artifact(row, format);
  }

  /** The export bytes come from the stored report row and its snapshots, never from live finding state. */
  private async artifact(row: ReportRecord, format: ReportFormat): Promise<ReportArtifactView> {
    const snapshots = await this.db.reportFindingSnapshot.findMany({ where: { reportId: row.id }, orderBy: { position: 'asc' } });
    const view = { ...await this.toBase(row), selectedFindings: snapshots.map(snapshotView) };
    const period = view.period === null ? null : { start: view.period.start, end: view.period.end };
    if (format === 'pdf' || format === 'docx') {
      const renderable = {
        title: row.title, reportId: row.id, version: row.version, summary: view.body.summary,
        sections: view.body.sections.map((s) => ({ title: s.title, content: s.content })),
        findings: view.selectedFindings.map((f) => ({ title: f.title, severity: f.severity, status: f.status, findingVersion: f.findingVersion, detail: f.body.detail })),
      };
      const bytes = format === 'pdf' ? await renderReportPdf(renderable) : await renderReportDocx(renderable);
      const mediaType = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      return { engagementId: row.engagementId, reportId: row.id, version: row.version, format, mediaType, content: bytes.toString('base64'), encoding: 'base64', digest: createHash('sha256').update(bytes).digest('hex') };
    }
    const content = format === 'json'
      ? JSON.stringify({ reportId: row.id, engagementId: row.engagementId, version: row.version, title: row.title, body: view.body, approvedVersion: row.approvedVersion, templateId: row.templateId, templateVersion: row.templateVersion, period, reviewerId: row.reviewerId, findings: view.selectedFindings }, null, 2)
      : `# ${row.title}\n\nReport ${row.id}, version ${row.version}\n\n${view.body.summary}\n\n${view.body.sections.map((s) => `## ${s.title}\n\n${s.content}`).join('\n\n')}\n\n${view.selectedFindings.map((f) => `### ${f.title} (${f.severity}, ${f.status}, finding v${f.findingVersion})\n\n${f.body.detail}`).join('\n\n')}\n`;
    return { engagementId: row.engagementId, reportId: row.id, version: row.version, format, mediaType: format === 'json' ? 'application/json' : 'text/markdown', content, encoding: 'utf8', digest: createHash('sha256').update(content).digest('hex') };
  }

  /** Export/delivery as separate audited records with truthful outcomes. */
  public async deliver(actorId: string, engagementId: string, reportId: string, input: unknown): Promise<ReportView & { artifact: ReportArtifactView }> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_EDIT);
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { kind?: unknown; format?: unknown; requestId?: unknown; recipient?: unknown; receipt?: unknown; expectedVersion?: unknown };
    const kind = typeof body.kind === 'string' && ['export', 'delivery'].includes(body.kind) ? body.kind : '';
    const format = typeof body.format === 'string' && isReportFormat(body.format) ? body.format : '';
    const requestId = typeof body.requestId === 'string' && body.requestId.trim().length > 0 ? body.requestId.trim() : '';
    if (kind.length === 0 || format.length === 0) throw new ProjectApiError(400, "kind ('export'|'delivery') and format ('json'|'markdown'|'pdf'|'docx') are required.");
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
      if (replayArtifact === undefined || typeof replayArtifact.content !== 'string' || replayArtifact.encoding === undefined) {
        throw new ProjectApiError(503, 'The recorded delivery is missing its artifact; a new requestId is required.');
      }
      // Same request id: replay of an already-processed request returns the
      // recorded outcome — never a duplicate dispatch or a state re-check.
      return { ...await this.load(row), artifact: replayArtifact };
    }
    if (kind === 'delivery' && (row.status !== 'approved' || row.approvedVersion !== row.version)) {
      throw new ProjectApiError(409, `Delivery requires an approved report; the report is ${row.status}. An export is not a reviewed deliverable.`);
    }
    const recipient = typeof body.recipient === 'string' ? body.recipient.trim() : '';
    const receipt = typeof body.receipt === 'string' ? body.receipt.trim() : '';
    if (kind === 'delivery' && (!recipient || !receipt)) throw new ProjectApiError(400, 'Manual delivery requires a recipient and an acknowledgement receipt; export alone is not delivery.');
    if (kind === 'delivery' && body.expectedVersion !== row.approvedVersion) throw new ProjectApiError(409, 'Delivery must acknowledge the exact approved version.');
    if (kind === 'delivery') {
      // Approved content stays immutable, but a delivery is refused when a pinned
      // finding or evidence source no longer matches what was approved.
      const readiness = await this.readinessOf(row);
      if (!readiness.ready) throw new ProjectApiError(409, notReadyMessage('delivered', readiness));
    }
    const artifact = await this.artifact(row, format as ReportFormat);
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
    // W20: the response carries the exact artifact this request produced —
    // the client never re-reads a possibly-changed report.
    return { ...await this.load(fresh), artifact };
  }

  /**
   * P07: a recipient acknowledges a completed delivery. The acknowledgement is a
   * separate fact: it never edits the approved report or the delivery record,
   * and a replay of the same request returns the stored acknowledgement.
   */
  public async acknowledge(actorId: string, engagementId: string, reportId: string, deliveryId: string, input: unknown): Promise<ReportView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const row = await this.findOwned(engagementId, reportId);
    const body = (input ?? {}) as { requestId?: unknown; receipt?: unknown };
    const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
    const receipt = typeof body.receipt === 'string' ? body.receipt.trim() : '';
    if (requestId.length === 0 || requestId.length > 128) throw new ProjectApiError(400, 'requestId (1-128 characters) is required.');
    if (receipt.length === 0 || receipt.length > 500) throw new ProjectApiError(400, 'receipt (1-500 characters) is required.');
    const delivery = await this.db.reportDelivery.findFirst({ where: { id: deliveryId, reportId: row.id, engagementId } });
    if (delivery === null) throw new ProjectApiError(404, 'Delivery not found for this report.');
    if (delivery.kind !== 'delivery' || delivery.status !== 'completed') {
      throw new ProjectApiError(409, 'Only a completed delivery can be acknowledged; an export is not a delivery.');
    }
    const existing = await this.db.reportAcknowledgement.findUnique({ where: { deliveryId } });
    if (existing !== null) {
      if (existing.requestId === requestId && existing.receipt === receipt) return this.load(row);
      throw new ProjectApiError(409, 'This delivery already has a recorded acknowledgement; a different acknowledgement cannot replace it.');
    }
    await this.db.$transaction(async (tx) => {
      const ack = await tx.reportAcknowledgement.create({ data: { deliveryId, reportId: row.id, engagementId, actorId, receipt, requestId } });
      await tx.webAuditEntry.create({ data: { engagementId, actorId, action: 'report.acknowledged', targetType: 'report_delivery', targetId: ack.deliveryId, reason: receipt.slice(0, 200) } });
    });
    return this.load(row);
  }

  /**
   * W20: after approval/delivery the reviewed snapshot is immutable; a
   * revision is a fresh draft record carrying the reviewed content that must
   * re-enter independent review before it can be exported as a deliverable.
   * P06: the revision keeps explicit lineage and its pinned finding snapshots.
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
    const snapshots = await this.db.reportFindingSnapshot.findMany({ where: { reportId: row.id }, orderBy: { position: 'asc' } });
    const revised = await this.db.$transaction(async (tx) => {
      const created = await tx.reportRecord.create({
        data: {
          engagementId,
          title: row.title,
          version: 1,
          status: 'draft',
          body: row.body as object,
          createdBy: actorId,
          templateId: row.templateId,
          templateVersion: row.templateVersion,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          reviewerId: row.reviewerId,
          parentReportId: row.id,
          rootReportId: row.rootReportId ?? row.id,
        },
      });
      if (snapshots.length > 0) {
        await tx.reportFindingSnapshot.createMany({
          data: snapshots.map((snapshot) => ({
            reportId: created.id,
            engagementId,
            findingId: snapshot.findingId,
            findingVersion: snapshot.findingVersion,
            title: snapshot.title,
            severity: snapshot.severity,
            status: snapshot.status,
            body: snapshot.body as object,
            evidence: snapshot.evidence as object,
            position: snapshot.position,
            selectedBy: snapshot.selectedBy,
          })),
        });
      }
      await tx.webAuditEntry.create({ data: { engagementId, actorId, action: 'report.revised', targetType: 'report', targetId: created.id, reason: `revision of ${row.id} v${row.version}` } });
      return created;
    });
    await createNotice(this.db, { engagementId, actorId: row.reviewedBy ?? row.createdBy, kind: 'report.revision_created', title: `Report "${row.title}" has a new draft revision from ${row.createdBy}`, detail: { reportId: revised.id, revisionOf: row.id } });
    return this.load(revised);
  }

  private requireEditable(row: ReportRecord, expectedVersion: unknown, what: string): void {
    if (!EDITABLE_STATUSES.includes(row.status)) {
      throw new ProjectApiError(409, `The report is ${row.status}; ${what} requires a draft. Draft a new version instead.`);
    }
    if (typeof expectedVersion !== 'number' || expectedVersion !== row.version) {
      throw new ProjectApiError(409, `Concurrent edit: the report moved to version ${row.version}. Your draft is preserved — reload and reapply.`);
    }
  }

  private async findOwned(engagementId: string, reportId: string): Promise<ReportRecord> {
    const row = await this.db.reportRecord.findFirst({ where: { id: reportId, engagementId } });
    if (row === null) throw new ProjectApiError(404, 'Report not found');
    return row;
  }

  private async readinessOf(row: ReportRecord): Promise<ReportReadinessView> {
    const snapshots = await this.db.reportFindingSnapshot.findMany({ where: { reportId: row.id }, orderBy: { position: 'asc' } });
    return this.readiness(row, snapshots);
  }

  /** Server-side readiness: a missing or unverifiable source is a failure or unavailable, never a silent pass. */
  private async readiness(row: ReportRecord, snapshots: ReportFindingSnapshot[]): Promise<ReportReadinessView> {
    const checks: ReportReadinessCheck[] = [
      await this.findingsCheck(row, snapshots),
      await this.evidenceCheck(row, snapshots),
      await this.templateCheck(row),
      this.periodCheck(row),
      await this.reviewerCheck(row),
    ];
    return { ready: checks.every((check) => check.state === 'pass'), checks };
  }

  private async findingsCheck(row: ReportRecord, snapshots: ReportFindingSnapshot[]): Promise<ReportReadinessCheck> {
    const label = 'Reported findings';
    if (snapshots.length === 0) return { id: 'findings', label, state: 'fail', detail: 'Select at least one confirmed or later finding.' };
    const current = await this.db.findingRecord.findMany({ where: { engagementId: row.engagementId, id: { in: snapshots.map((s) => s.findingId) } }, select: { id: true, status: true, expectedVersion: true } });
    const byId = new Map(current.map((finding) => [finding.id, finding]));
    const problems = snapshots.flatMap((snapshot) => {
      const finding = byId.get(snapshot.findingId);
      if (finding === undefined) return [`${snapshot.title}: no longer exists`];
      if (finding.expectedVersion !== snapshot.findingVersion) return [`${snapshot.title}: changed from v${snapshot.findingVersion} to v${finding.expectedVersion}; reselect it`];
      if (!REPORTABLE_STATUSES.includes(finding.status)) return [`${snapshot.title}: is ${finding.status}, not confirmed or later`];
      return [];
    });
    if (problems.length > 0) return { id: 'findings', label, state: 'fail', detail: problems.join('; ') };
    return { id: 'findings', label, state: 'pass', detail: `${snapshots.length} selected finding(s) match their pinned versions.` };
  }

  private async evidenceCheck(row: ReportRecord, snapshots: ReportFindingSnapshot[]): Promise<ReportReadinessCheck> {
    const label = 'Evidence integrity';
    const refs = snapshots.flatMap((snapshot) => evidenceOf(snapshot).map((ref) => ({ finding: snapshot.title, ref })));
    if (refs.length === 0) return { id: 'evidence', label, state: 'pass', detail: 'No evidence is linked to the selected findings.' };
    const captureIds = refs.flatMap(({ ref }) => ref.captureId === null ? [] : [ref.captureId]);
    const captures = captureIds.length === 0 ? [] : await this.db.retainedCapture.findMany({ where: { engagementId: row.engagementId, id: { in: captureIds } }, select: { id: true, classification: true, digest: true } });
    const byId = new Map(captures.map((capture) => [capture.id, capture]));
    const failures: string[] = [];
    let unverified = 0;
    for (const { finding, ref } of refs) {
      if (ref.captureId === null) {
        unverified += 1;
        continue;
      }
      const capture = byId.get(ref.captureId);
      if (capture === undefined) failures.push(`${finding}: retained capture is missing`);
      else if (capture.classification === 'unclassified') failures.push(`${finding}: capture is unclassified`);
      else if (ref.digest !== null && ref.digest !== capture.digest) failures.push(`${finding}: capture digest no longer matches`);
    }
    if (failures.length > 0) return { id: 'evidence', label, state: 'fail', detail: failures.join('; ') };
    if (unverified > 0) return { id: 'evidence', label, state: 'unavailable', detail: `${unverified} legacy reference(s) have no retained capture, so their integrity is not verified.` };
    return { id: 'evidence', label, state: 'pass', detail: `${refs.length} evidence reference(s) are classified and match their digests.` };
  }

  private async templateCheck(row: ReportRecord): Promise<ReportReadinessCheck> {
    const label = 'Template sections';
    if (!row.templateId) return { id: 'template', label, state: 'fail', detail: 'Choose a report template.' };
    const template = await this.db.reportTemplate.findFirst({ where: { id: row.templateId, engagementId: row.engagementId } });
    if (template === null) return { id: 'template', label, state: 'fail', detail: 'The selected template no longer exists.' };
    const content = new Map(readSections(row.body).map((section) => [section.title, section.content.trim()]));
    const empty = sectionsOf(template.sections).filter((section) => section.required && (content.get(section.title) ?? '').length === 0).map((section) => section.title);
    if (empty.length > 0) return { id: 'template', label, state: 'fail', detail: `Required sections are empty: ${empty.join(', ')}.` };
    return { id: 'template', label, state: 'pass', detail: `Template "${template.name}" v${template.version} required sections are filled.` };
  }

  private periodCheck(row: ReportRecord): ReportReadinessCheck {
    const label = 'Reporting period';
    if (!row.periodStart || !row.periodEnd) return { id: 'period', label, state: 'fail', detail: 'Set the reporting period.' };
    if (row.periodStart > row.periodEnd) return { id: 'period', label, state: 'fail', detail: 'The reporting period starts after it ends.' };
    return { id: 'period', label, state: 'pass', detail: 'The reporting period is set.' };
  }

  private async reviewerCheck(row: ReportRecord): Promise<ReportReadinessCheck> {
    const label = 'Named reviewer';
    if (!row.reviewerId) return { id: 'reviewer', label, state: 'fail', detail: 'Assign a named reviewer.' };
    if (row.reviewerId === row.createdBy) return { id: 'reviewer', label, state: 'fail', detail: 'The named reviewer must differ from the report author.' };
    const membership = await this.db.webMembership.findUnique({ where: { engagementId_userId: { engagementId: row.engagementId, userId: row.reviewerId } } });
    if (membership === null) return { id: 'reviewer', label, state: 'fail', detail: 'The named reviewer is no longer a member of this engagement.' };
    if (membership.role !== 'owner' && membership.role !== 'reviewer') return { id: 'reviewer', label, state: 'fail', detail: 'The named reviewer no longer has a reviewer role.' };
    return { id: 'reviewer', label, state: 'pass', detail: 'The named reviewer is an eligible member other than the author.' };
  }

  private async toBase(row: ReportRecord): Promise<Omit<ReportView, 'selectedFindings' | 'readiness' | 'deliveries'>> {
    const body = row.body as { summary?: unknown; sections?: unknown };
    return {
      id: row.id,
      engagementId: row.engagementId,
      title: row.title,
      version: row.version,
      status: row.status as ReportView['status'],
      body: {
        summary: typeof body.summary === 'string' ? body.summary : '',
        sections: readSections(row.body),
      },
      createdBy: row.createdBy,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewComment: row.reviewComment,
      approvedVersion: row.approvedVersion,
      updatedAt: row.updatedAt.toISOString(),
      templateId: row.templateId,
      templateVersion: row.templateVersion,
      period: !row.periodStart || !row.periodEnd ? null : { start: row.periodStart.toISOString(), end: row.periodEnd.toISOString() },
      reviewerId: row.reviewerId,
      parentReportId: row.parentReportId,
      rootReportId: row.rootReportId,
    };
  }

  /** Loads the full report view: snapshots, deliveries with acknowledgements, and readiness. */
  private async load(row: ReportRecord): Promise<ReportView> {
    const [deliveries, snapshots] = await Promise.all([
      this.db.reportDelivery.findMany({ where: { reportId: row.id }, include: { acknowledgement: true }, orderBy: { createdAt: 'desc' } }),
      this.db.reportFindingSnapshot.findMany({ where: { reportId: row.id }, orderBy: { position: 'asc' } }),
    ]);
    const readiness = await this.readiness(row, snapshots);
    return {
      ...await this.toBase(row),
      selectedFindings: snapshots.map(snapshotView),
      readiness,
      deliveries: deliveries.map(deliveryView),
    };
  }

  private async audit(engagementId: string, actorId: string, action: string, targetType: string, targetId: string, reason: string): Promise<void> {
    await this.db.webAuditEntry.create({ data: { engagementId, actorId, action, targetType, targetId, reason } });
  }
}

function readSections(body: unknown): { title: string; content: string }[] {
  const sections = (body as { sections?: unknown } | null)?.sections;
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((item: unknown) => {
    const section = (item ?? {}) as { title?: unknown; content?: unknown };
    return typeof section.title === 'string' ? [{ title: section.title, content: typeof section.content === 'string' ? section.content : '' }] : [];
  });
}

function parseTimestamp(value: unknown, field: string): Date {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(time)) throw new ProjectApiError(400, `${field} must be an ISO timestamp.`);
  return new Date(time);
}

function notReadyMessage(action: string, readiness: ReportReadinessView): string {
  const failing = readiness.checks.filter((check) => check.state !== 'pass').map((check) => `${check.label}: ${check.detail}`);
  return `The report cannot be ${action} until its readiness checks pass. ${failing.join(' ')}`;
}
