import { createHash } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectApiError } from './projects-service.js';
import { requireEngagementAccess, requireIndependentActor, type ActorContext, type MemberRole } from '../auth/membership-policy.js';
import { assertEngagementOpen } from './closure-service.js';
import type { LibraryService } from './library-service.js';

/**
 * ADR-0070: engagement-scoped library review proposals. A proposal references
 * the canonical corpus skill by name/path and pins a snapshot revision (the
 * SHA-256 of the canonical detail projection, including commit, body and
 * metadata). Base/proposed bodies are retained solely for independent review
 * and export; these records are never read by the runtime skill loader or
 * graph builder, so no second executable corpus exists. Only the original
 * author can amend; every amendment increments the version and resets
 * approval. Canonical drift blocks amendment, review and export — a changed
 * corpus requires a fresh proposal based on current canonical content.
 */

const MIN_SUBMIT: MemberRole = 'operator';
const MIN_DECIDE: MemberRole = 'reviewer';
const MAX_BODY_BYTES = 256 * 1024;

const bodyTooLarge = (): ProjectApiError => new ProjectApiError(400, 'proposedBody exceeds the 256 KiB bound.');

const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8');

export interface LibraryProposalReviewView {
  readonly id: string;
  readonly proposalVersion: number;
  readonly decision: 'approved' | 'rejected';
  readonly comment: string | null;
  readonly reviewerId: string;
  readonly createdAt: string;
}

export interface LibraryProposalView {
  readonly id: string;
  readonly engagementId: string;
  readonly skillName: string;
  readonly skillPath: string;
  readonly baseRevision: string;
  readonly status: 'draft' | 'proposed' | 'approved' | 'rejected';
  readonly version: number;
  readonly proposedBody: string;
  readonly baseBody: string;
  readonly rationale: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly reviews: readonly LibraryProposalReviewView[];
  /** Present only on the detail read: true when the pinned snapshot still matches the canonical corpus. */
  readonly canonicalCurrent: boolean | undefined;
}

export interface LibraryProposalExportView {
  readonly kind: 'library-body-replacement-proposal';
  readonly proposal: {
    readonly id: string;
    readonly engagementId: string;
    readonly skillName: string;
    readonly skillPath: string;
    readonly baseRevision: string;
    readonly status: string;
    readonly version: number;
    readonly createdBy: string;
  };
  readonly base: {
    readonly body: string;
    readonly revision: string;
  };
  readonly proposed: {
    readonly body: string;
  };
  readonly diff: {
    readonly before: string;
    readonly after: string;
  };
  readonly reviews: readonly LibraryProposalReviewView[];
  readonly publicationContract: readonly string[];
}

interface ProposalRow {
  id: string; engagementId: string; skillName: string; skillPath: string; baseRevision: string;
  baseBody: string; proposedBody: string; rationale: string | null;
  status: string; version: number; createdBy: string; createdAt: Date; updatedAt: Date;
}

type ReviewRow = {
  id: string; proposalVersion: number; decision: string; comment: string | null; reviewerId: string; createdAt: Date;
};

export class LibraryReviewService {
  public constructor(private readonly db: PrismaClient, private readonly library: Pick<LibraryService, 'skillDetail'>) {}

  private ctx(actorId: string): ActorContext {
    return { db: this.db, actorId, multiUser: true };
  }

  public async list(actorId: string, engagementId: string): Promise<{ engagementId: string; proposals: LibraryProposalView[]; source: 'db' }> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const rows = await this.db.libraryReviewProposal.findMany({ where: { engagementId }, orderBy: { updatedAt: 'desc' } });
    const proposals: LibraryProposalView[] = [];
    for (const row of rows) proposals.push(this.toView(row as never as ProposalRow, await this.reviewsOf(row.id, (row as { version: number }).version)));
    return { engagementId, proposals, source: 'db' };
  }

  public async get(actorId: string, engagementId: string, proposalId: string): Promise<LibraryProposalView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const row = await this.findOwned(engagementId, proposalId);
    return this.toView(row, await this.reviewsOf(proposalId, row.version), await this.canonicalCurrent(row));
  }

  /** Submits a body-replacement proposal pinned to the CURRENT canonical snapshot. */
  public async submit(actorId: string, engagementId: string, input: unknown): Promise<LibraryProposalView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_SUBMIT);
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { skillName?: unknown; proposedBody?: unknown; rationale?: unknown };
    const skillName = typeof body.skillName === 'string' ? body.skillName.trim() : '';
    const proposedBody = typeof body.proposedBody === 'string' ? body.proposedBody : '';
    if (skillName.length === 0) throw new ProjectApiError(400, 'skillName (the canonical corpus skill) is required.');
    if (proposedBody.trim().length === 0) throw new ProjectApiError(400, 'proposedBody (the replacement SKILL.md body) is required.');
    if (byteLength(proposedBody) > MAX_BODY_BYTES) throw bodyTooLarge();
    const canonical = await this.canonical(skillName);
    const existing = await this.db.libraryReviewProposal.findFirst({ where: { engagementId, skillName, status: 'proposed' } });
    if (existing !== null) throw new ProjectApiError(409, `A proposal for ${skillName} is already in independent review.`);
    let row;
    try {
      row = await this.db.libraryReviewProposal.create({
        data: {
          engagementId,
          skillName: canonical.name,
          skillPath: canonical.path ?? '',
          baseRevision: canonical.revision,
          baseBody: canonical.body,
          proposedBody,
          rationale: typeof body.rationale === 'string' && body.rationale.trim().length > 0 ? body.rationale.trim() : null,
          status: 'draft',
          version: 1,
          createdBy: actorId,
        },
      });
    } catch (error) {
      // W17: the partial DB index is the race-proof authority for one
      // in-review proposal per (engagement, skill); find-before-create only
      // gives the friendly fast path.
      if ((error as { code?: string }).code === 'P2002') throw new ProjectApiError(409, `A proposal for ${skillName} is already in independent review.`);
      throw error;
    }
    await this.audit(engagementId, actorId, 'library.proposal_submitted', 'library_proposal', row.id, `${canonical.name} @ ${canonical.revision.slice(0, 12)}`);
    return this.toView(row as never as ProposalRow, []);
  }

  /**
   * Author-only amendment: increments the version and resets approval. W17
   * (ADR-0070): the pinned canonical snapshot is never re-pinned here — a
   * drifted corpus refuses the amendment and demands a fresh proposal.
   */
  public async amend(actorId: string, engagementId: string, proposalId: string, input: unknown): Promise<LibraryProposalView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_SUBMIT);
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { proposedBody?: unknown; expectedVersion?: unknown; rationale?: unknown };
    const proposedBody = typeof body.proposedBody === 'string' ? body.proposedBody : '';
    const expectedVersion = typeof body.expectedVersion === 'number' ? body.expectedVersion : null;
    if (expectedVersion === null) throw new ProjectApiError(400, 'expectedVersion is required for concurrent-edit safety.');
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) throw new ProjectApiError(400, 'expectedVersion must be a positive integer.');
    if (proposedBody.trim().length === 0) throw new ProjectApiError(400, 'proposedBody (the replacement SKILL.md body) is required.');
    if (byteLength(proposedBody) > MAX_BODY_BYTES) throw bodyTooLarge();
    const row = await this.findOwned(engagementId, proposalId);
    if (row.createdBy !== actorId) throw new ProjectApiError(403, 'Only the original author can amend a library proposal.');
    if (row.version !== expectedVersion) throw new ProjectApiError(409, `Concurrent edit: the proposal moved to version ${row.version} while you edited version ${expectedVersion}.`);
    await this.assertCanonicalCurrent(row);
    const updated = await this.db.libraryReviewProposal.updateMany({
      where: { id: row.id, version: row.version },
      data: {
        proposedBody,
        ...(typeof body.rationale === 'string' && body.rationale.trim().length > 0 ? { rationale: body.rationale.trim() } : {}),
        version: row.version + 1,
        status: 'draft',
      },
    });
    if (updated.count !== 1) throw new ProjectApiError(409, 'The proposal changed concurrently; reload and retry.');
    await this.audit(engagementId, actorId, 'library.proposal_amended', 'library_proposal', row.id, `v${row.version} -> v${row.version + 1}`);
    const fresh = await this.findOwned(engagementId, proposalId);
    return this.toView(fresh, await this.reviewsOf(proposalId, fresh.version));
  }

  /** Moves a draft into independent review against the pinned canonical snapshot. */
  public async propose(actorId: string, engagementId: string, proposalId: string): Promise<LibraryProposalView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_SUBMIT);
    await assertEngagementOpen(this.db, engagementId);
    const row = await this.findOwned(engagementId, proposalId);
    if (row.status !== 'draft') throw new ProjectApiError(409, `Proposal is already ${row.status}.`);
    await this.assertCanonicalCurrent(row);
    const updated = await this.db.libraryReviewProposal.updateMany({ where: { id: row.id, version: row.version, status: 'draft' }, data: { status: 'proposed' } });
    if (updated.count !== 1) throw new ProjectApiError(409, 'The proposal changed concurrently; reload and retry.');
    await this.audit(engagementId, actorId, 'library.proposal_proposed', 'library_proposal', row.id, `v${row.version} into review`);
    const fresh = await this.findOwned(engagementId, proposalId);
    return this.toView(fresh, await this.reviewsOf(proposalId, fresh.version));
  }

  /** Independent reviewer decision, atomically pinned to the proposal version. */
  public async decide(actorId: string, engagementId: string, proposalId: string, input: unknown): Promise<LibraryProposalView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_DECIDE);
    const body = (input ?? {}) as { decision?: unknown; comment?: unknown; expectedVersion?: unknown };
    const decision = typeof body.decision === 'string' ? body.decision : '';
    if (decision !== 'approved' && decision !== 'rejected') throw new ProjectApiError(400, "decision must be 'approved' or 'rejected'.");
    const expectedVersion = typeof body.expectedVersion === 'number' ? body.expectedVersion : null;
    if (expectedVersion === null) throw new ProjectApiError(400, 'expectedVersion is required so the decision pins one proposal version.');
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) throw new ProjectApiError(400, 'expectedVersion must be a positive integer.');
    const row = await this.findOwned(engagementId, proposalId);
    if (row.status !== 'proposed') throw new ProjectApiError(409, `Proposal is ${row.status}, not in review.`);
    requireIndependentActor(row.createdBy, actorId, 'The library proposal decision');
    await this.assertCanonicalCurrent(row);
    await this.db.$transaction(async (tx) => {
      await tx.libraryProposalReview.create({
        data: { proposalId: row.id, proposalVersion: row.version, decision, comment: typeof body.comment === 'string' && body.comment.trim().length > 0 ? body.comment.trim() : null, reviewerId: actorId },
      });
      const updated = await tx.libraryReviewProposal.updateMany({
        where: { id: row.id, version: expectedVersion, status: 'proposed' },
        data: { status: decision },
      });
      if (updated.count !== 1) throw new ProjectApiError(409, 'The proposal changed concurrently; the decision was not recorded.');
    });
    await this.audit(engagementId, actorId, `library.proposal_${decision}`, 'library_proposal', row.id, `v${row.version} by ${actorId}`);
    const fresh = await this.findOwned(engagementId, proposalId);
    return this.toView(fresh, await this.reviewsOf(proposalId, fresh.version));
  }

  /** Reviewed JSON export for the existing git publication workflow (never an automatic publication). */
  public async export(actorId: string, engagementId: string, proposalId: string): Promise<LibraryProposalExportView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const row = await this.findOwned(engagementId, proposalId);
    if (row.status !== 'approved') throw new ProjectApiError(409, 'Only an approved proposal can be exported for the git publication workflow.');
    await this.assertCanonicalCurrent(row);
    const reviews = await this.reviewsOf(proposalId, row.version);
    return {
      kind: 'library-body-replacement-proposal',
      proposal: { id: row.id, engagementId: row.engagementId, skillName: row.skillName, skillPath: row.skillPath, baseRevision: row.baseRevision, status: row.status, version: row.version, createdBy: row.createdBy },
      base: { body: row.baseBody, revision: row.baseRevision },
      proposed: { body: row.proposedBody },
      diff: { before: row.baseBody, after: row.proposedBody },
      reviews: reviews.map((r) => this.toReviewView(r)),
      publicationContract: [
        'Preserve the SKILL.md frontmatter; this export replaces the body only.',
        'Publication still requires the existing corpus audit, graph and OPSEC review gates.',
        'Approved means the proposed change was reviewed — canonical content is never mutated from here.',
      ],
    };
  }

  private async canonical(skillName: string): Promise<{ name: string; path: string | null; body: string; revision: string }> {
    const detail = await this.library.skillDetail(skillName);
    const revision = createHash('sha256').update(JSON.stringify(detail)).digest('hex');
    return { name: detail.name, path: detail.path, body: detail.body, revision };
  }

  private async canonicalCurrent(row: ProposalRow): Promise<boolean> {
    try {
      const canonical = await this.canonical(row.skillName);
      return canonical.revision === row.baseRevision;
    } catch (error) {
      // W17: a canonical source outage is unavailable, never "drifted".
      if (error instanceof ProjectApiError && error.statusCode === 404) return false;
      throw error;
    }
  }

  private async assertCanonicalCurrent(row: ProposalRow): Promise<void> {
    if (!(await this.canonicalCurrent(row))) {
      throw new ProjectApiError(409, `The canonical corpus changed since proposal v${row.version} was pinned; amend the proposal against the current content before review.`);
    }
  }

  private async findOwned(engagementId: string, proposalId: string): Promise<ProposalRow> {
    const row = await this.db.libraryReviewProposal.findFirst({ where: { id: proposalId, engagementId } });
    if (row === null) throw new ProjectApiError(404, 'Library proposal not found');
    return row as never as ProposalRow;
  }

  /** Reviews are version-pinned: W17 reads never expose prior-version history. */
  private async reviewsOf(proposalId: string, version?: number): Promise<ReviewRow[]> {
    const rows = (await this.db.libraryProposalReview.findMany({ where: { proposalId }, orderBy: { createdAt: 'desc' } })) as never as ReviewRow[];
    return version === undefined ? rows : rows.filter((r) => r.proposalVersion === version);
  }

  private toReviewView(r: ReviewRow): LibraryProposalReviewView {
    return {
      id: r.id,
      proposalVersion: r.proposalVersion,
      decision: r.decision as LibraryProposalReviewView['decision'],
      comment: r.comment,
      reviewerId: r.reviewerId,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private toView(row: ProposalRow, reviews: ReviewRow[], canonicalCurrent?: boolean): LibraryProposalView {
    return {
      id: row.id,
      engagementId: row.engagementId,
      skillName: row.skillName,
      skillPath: row.skillPath,
      baseRevision: row.baseRevision,
      status: row.status as LibraryProposalView['status'],
      version: row.version,
      proposedBody: row.proposedBody,
      baseBody: row.baseBody,
      rationale: row.rationale,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      reviews: reviews.map((r) => this.toReviewView(r)),
      canonicalCurrent,
    };
  }

  private async audit(engagementId: string, actorId: string, action: string, targetType: string, targetId: string, reason: string): Promise<void> {
    await this.db.webAuditEntry.create({ data: { engagementId, actorId, action, targetType, targetId, reason } });
  }
}
