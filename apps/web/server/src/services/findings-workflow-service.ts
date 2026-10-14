import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectApiError } from './projects-service.js';
import { requireEngagementAccess, type ActorContext, type MemberRole } from '../auth/membership-policy.js';

/**
 * Ticket 10: curated finding records with the review/remediation lifecycle and
 * opaque evidence references. Runtime findings stay the evidence producer:
 * draft-import copies the producer lineage reference into a web workflow
 * record without overwriting or relabeling it, and AI claims are never
 * treated as confirmed state. Transitions, role gates, expected-version
 * conflicts and evidence binding are server-enforced.
 */

const MIN_CURATE: MemberRole = 'operator';

/** Allowed lifecycle transitions; confirmation requires an independent reviewer role. */
const TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  draft: ['review'],
  review: ['confirmed', 'draft'],
  confirmed: ['remediation'],
  remediation: ['retest'],
  retest: ['resolved', 'remediation'],
  resolved: [],
};

export interface CuratedFindingView {
  readonly id: string;
  readonly engagementId: string;
  readonly title: string;
  readonly severity: string;
  readonly status: string;
  readonly body: { readonly detail: string };
  readonly expectedVersion: number;
  readonly sourceType: 'authored' | 'imported';
  readonly producerRef: string | null;
  readonly createdBy: string;
  readonly updatedBy: string | null;
  readonly updatedAt: string;
  readonly evidence: readonly EvidenceView[];
}

export interface EvidenceView {
  readonly id: string;
  readonly kind: 'artifact' | 'digest';
  readonly artifactPath: string | null;
  readonly digest: string | null;
  readonly producer: string | null;
  readonly createdAt: string;
}

export interface CuratedFindingsView {
  readonly engagementId: string;
  readonly findings: CuratedFindingView[];
  readonly transitions: Readonly<Record<string, readonly string[]>>;
  readonly source: 'db';
}

export class FindingsWorkflowService {
  public constructor(private readonly db: PrismaClient) {}

  private ctx(actorId: string): ActorContext {
    return { db: this.db, actorId, multiUser: true };
  }

  public async list(actorId: string, engagementId: string): Promise<CuratedFindingsView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const rows = await this.db.findingRecord.findMany({ where: { engagementId }, orderBy: { createdAt: 'desc' } });
    const findings: CuratedFindingView[] = [];
    for (const row of rows) {
      const evidence = await this.db.evidenceLink.findMany({ where: { findingId: row.id } });
      findings.push(this.toView(row as never, evidence as never[]));
    }
    return { engagementId, findings, transitions: TRANSITIONS, source: 'db' };
  }

  public async create(actorId: string, engagementId: string, input: unknown): Promise<CuratedFindingView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_CURATE);
    const body = (input ?? {}) as { title?: unknown; severity?: unknown; detail?: unknown };
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (title.length === 0 || title.length > 300) throw new ProjectApiError(400, 'title (1-300 chars) is required.');
    const severity = typeof body.severity === 'string' && ['critical', 'high', 'medium', 'low', 'informational'].includes(body.severity) ? body.severity : 'medium';
    const detail = typeof body.detail === 'string' ? body.detail : '';
    const row = await this.db.findingRecord.create({
      data: { engagementId, title, severity, status: 'draft', body: { detail } as object, sourceType: 'authored', createdBy: actorId },
    });
    await this.audit(engagementId, actorId, 'finding.created', 'finding', row.id, title);
    return this.toView(row as never, []);
  }

  /** Draft-import from a runtime/producer reference; never mutates producer evidence. */
  public async importDraft(actorId: string, engagementId: string, input: unknown): Promise<CuratedFindingView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_CURATE);
    const body = (input ?? {}) as { title?: unknown; producerRef?: unknown; detail?: unknown; severity?: unknown };
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const producerRef = typeof body.producerRef === 'string' ? body.producerRef.trim() : '';
    if (title.length === 0) throw new ProjectApiError(400, 'title is required.');
    if (producerRef.length === 0) throw new ProjectApiError(400, 'producerRef (the runtime evidence reference) is required.');
    const row = await this.db.findingRecord.create({
      data: {
        engagementId,
        title,
        severity: typeof body.severity === 'string' ? body.severity : 'medium',
        status: 'draft',
        body: { detail: typeof body.detail === 'string' ? body.detail : '' } as object,
        sourceType: 'imported',
        producerRef,
        createdBy: actorId,
      },
    });
    await this.audit(engagementId, actorId, 'finding.imported', 'finding', row.id, `${title} <- ${producerRef}`);
    return this.toView(row as never, []);
  }

  public async update(actorId: string, engagementId: string, findingId: string, input: unknown): Promise<CuratedFindingView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_CURATE);
    const body = (input ?? {}) as { expectedVersion?: unknown; title?: unknown; severity?: unknown; detail?: unknown };
    const expectedVersion = typeof body.expectedVersion === 'number' ? body.expectedVersion : null;
    if (expectedVersion === null) throw new ProjectApiError(400, 'expectedVersion is required for concurrent-edit safety.');
    const row = await this.findOwned(engagementId, findingId);
    if (row.expectedVersion !== expectedVersion) {
      throw new ProjectApiError(409, `Concurrent edit: the finding moved to version ${row.expectedVersion} while you edited version ${expectedVersion}. Reload and reapply.`);
    }
    const updated = await this.db.findingRecord.update({
      where: { id: row.id },
      data: {
        title: typeof body.title === 'string' && body.title.trim().length > 0 ? body.title.trim() : row.title,
        severity: typeof body.severity === 'string' ? body.severity : row.severity,
        body: typeof body.detail === 'string' ? ({ detail: body.detail } as object) : (row.body as object),
        expectedVersion: { increment: 1 },
        updatedBy: actorId,
      },
    });
    await this.audit(engagementId, actorId, 'finding.updated', 'finding', row.id, `v${row.expectedVersion} -> v${row.expectedVersion + 1}`);
    const evidence = await this.db.evidenceLink.findMany({ where: { findingId: row.id } });
    return this.toView(updated as never, evidence as never[]);
  }

  public async transition(actorId: string, engagementId: string, findingId: string, input: unknown): Promise<CuratedFindingView> {
    const body = (input ?? {}) as { to?: unknown };
    const to = typeof body.to === 'string' ? body.to : '';
    const access = await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_CURATE);
    const row = await this.findOwned(engagementId, findingId);
    const allowed = TRANSITIONS[row.status] ?? [];
    if (!allowed.includes(to)) {
      throw new ProjectApiError(409, `Transition ${row.status} -> ${to} is not allowed; permitted: ${allowed.length > 0 ? allowed.join(', ') : 'none (terminal)'}.`);
    }
    if (to === 'confirmed' && !['owner', 'reviewer'].includes(access.role)) {
      throw new ProjectApiError(403, `Confirming a finding requires the reviewer role; the persisted membership grants ${access.role}.`);
    }
    const updated = await this.db.findingRecord.update({ where: { id: row.id }, data: { status: to, updatedBy: actorId } });
    await this.audit(engagementId, actorId, 'finding.transitioned', 'finding', row.id, `${row.status} -> ${to}`);
    const evidence = await this.db.evidenceLink.findMany({ where: { findingId: row.id } });
    return this.toView(updated as never, evidence as never[]);
  }

  /** Attaches an opaque evidence reference; cross-engagement ids are refused. */
  public async attachEvidence(actorId: string, engagementId: string, findingId: string, input: unknown): Promise<EvidenceView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_CURATE);
    const body = (input ?? {}) as { kind?: unknown; artifactPath?: unknown; digest?: unknown; producer?: unknown };
    const kind = typeof body.kind === 'string' && ['artifact', 'digest'].includes(body.kind) ? body.kind : '';
    if (kind.length === 0) throw new ProjectApiError(400, "kind must be 'artifact' or 'digest'.");
    const artifactPath = typeof body.artifactPath === 'string' ? body.artifactPath.trim() : null;
    const digest = typeof body.digest === 'string' ? body.digest.trim() : null;
    if (kind === 'artifact' && (artifactPath === null || artifactPath.length === 0)) throw new ProjectApiError(400, 'artifactPath is required for artifact evidence.');
    if (kind === 'digest' && (digest === null || digest.length === 0)) throw new ProjectApiError(400, 'digest is required for digest evidence.');
    const row = await this.findOwned(engagementId, findingId);
    // A finding id is not a substitute for an evidence reference: the link
    // stores the opaque identity/digest/producer lineage verbatim.
    const link = await this.db.evidenceLink.create({
      data: {
        findingId: row.id,
        engagementId,
        kind,
        artifactPath,
        digest,
        producer: typeof body.producer === 'string' ? body.producer : null,
      },
    });
    await this.audit(engagementId, actorId, 'evidence.attached', 'evidence', link.id, `${kind} on ${row.id}`);
    return this.toEvidenceView(link as never);
  }

  private async findOwned(engagementId: string, findingId: string) {
    const row = await this.db.findingRecord.findFirst({ where: { id: findingId, engagementId } });
    if (row === null) throw new ProjectApiError(404, 'Finding not found');
    return row as never as { id: string; expectedVersion: number; title: string; severity: string; status: string; body: unknown };
  }

  private toView(row: { id: string; engagementId: string; title: string; severity: string; status: string; body: unknown; expectedVersion: number; sourceType: string; producerRef: string | null; createdBy: string; updatedBy: string | null; updatedAt: Date }, evidence: { id: string; kind: string; artifactPath: string | null; digest: string | null; producer: string | null; createdAt: Date }[]): CuratedFindingView {
    const body = row.body as { detail?: unknown };
    return {
      id: row.id,
      engagementId: row.engagementId,
      title: row.title,
      severity: row.severity,
      status: row.status,
      body: { detail: typeof body.detail === 'string' ? body.detail : '' },
      expectedVersion: row.expectedVersion,
      sourceType: row.sourceType as CuratedFindingView['sourceType'],
      producerRef: row.producerRef,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt.toISOString(),
      evidence: evidence.map((e) => this.toEvidenceView(e as never)),
    };
  }

  private toEvidenceView(row: { id: string; kind: string; artifactPath: string | null; digest: string | null; producer: string | null; createdAt: Date }): EvidenceView {
    return {
      id: row.id,
      kind: row.kind as EvidenceView['kind'],
      artifactPath: row.artifactPath,
      digest: row.digest,
      producer: row.producer,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async audit(engagementId: string, actorId: string, action: string, targetType: string, targetId: string, reason: string): Promise<void> {
    await this.db.webAuditEntry.create({ data: { engagementId, actorId, action, targetType, targetId, reason } });
  }
}
