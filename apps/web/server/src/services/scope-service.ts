import type { PrismaClient, ScopeRevision, WebAsset } from '../generated/prisma/client.js';
import { ProjectApiError } from './projects-service.js';
import { createNotice } from './inbox-service.js';
import { assertNotExpired, requireEngagementAccess, requireIndependentActor, type ActorContext, type MemberRole } from '../auth/membership-policy.js';

/**
 * Ticket 08: operator-managed scope/ROE revisions with persisted independent
 * review. A revision carries a version, diff, requester and decision; the
 * latest approved revision is the authoritative scope version that downstream
 * plans/operations (ticket 09) pin. Submission immediately supersedes the
 * previously approved revision â€” dependent approvals go stale through the
 * version contract, not by editing frontend state. Newly added targets stay
 * pending until the approved governance path accepts them; runtime/graph
 * evidence is never overwritten by Web edits.
 */

export interface RoeWindows {
  readonly windows: readonly { start: string; end: string; tz: string }[];
  readonly emergencyContacts: readonly string[];
  readonly restrictions: readonly string[];
}

export interface ScopeDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly rationale: string;
}

export interface RevisionView {
  readonly id: string;
  readonly engagementId: string;
  readonly version: number;
  readonly status: 'pending' | 'approved' | 'rejected' | 'superseded';
  readonly diff: ScopeDiff;
  readonly roe: RoeWindows;
  readonly requestedBy: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decisionComment: string | null;
  readonly createdAt: string;
}

export interface AssetView {
  readonly id: string;
  readonly engagementId: string;
  readonly identifier: string;
  readonly kind: string;
  readonly classification: 'pending' | 'in_scope' | 'out_of_scope';
  readonly observed: boolean;
  readonly version: number;
  readonly updatedAt: string;
}

export interface ScopeRevisionsView {
  readonly engagementId: string;
  readonly revisions: RevisionView[];
  readonly latestApprovedVersion: number | null;
  readonly submitSupported: true;
  readonly source: 'db';
}

export interface AssetsInventoryView {
  readonly engagementId: string;
  readonly assets: AssetView[];
  readonly latestApprovedVersion: number | null;
  readonly source: 'db';
}

const MIN_WRITE: MemberRole = 'operator';
const MIN_REVIEW: MemberRole = 'reviewer';

function toRevisionView(row: ScopeRevision): RevisionView {
  return {
    id: row.id,
    engagementId: row.engagementId,
    version: row.version,
    status: row.status as RevisionView['status'],
    diff: row.diff as unknown as ScopeDiff,
    roe: row.roe as unknown as RoeWindows,
    requestedBy: row.requestedBy,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionComment: row.decisionComment,
    createdAt: row.createdAt.toISOString(),
  };
}

function toAssetView(row: WebAsset): AssetView {
  return {
    id: row.id,
    engagementId: row.engagementId,
    identifier: row.identifier,
    kind: row.kind,
    classification: row.classification as AssetView['classification'],
    observed: row.observed,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class ScopeService {
  public constructor(private readonly db: PrismaClient) {}

  private ctx(actorId: string): ActorContext {
    return { db: this.db, actorId, multiUser: true };
  }

  public async revisions(actorId: string, engagementId: string): Promise<ScopeRevisionsView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const rows = await this.db.scopeRevision.findMany({ where: { engagementId }, orderBy: { version: 'desc' } });
    const approved = rows.find((r) => r.status === 'approved');
    return {
      engagementId,
      revisions: rows.map(toRevisionView),
      latestApprovedVersion: approved?.version ?? null,
      submitSupported: true,
      source: 'db',
    };
  }

  public async latestApproved(engagementId: string): Promise<ScopeRevision | null> {
    return this.db.scopeRevision.findFirst({ where: { engagementId, status: 'approved' }, orderBy: { version: 'desc' } });
  }

  public async submitRevision(actorId: string, engagementId: string, input: unknown): Promise<RevisionView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_WRITE);
    const body = (input ?? {}) as { diff?: unknown; roe?: unknown };
    const diff = normalizeDiff(body.diff);
    const roe = normalizeRoe(body.roe);
    const last = await this.db.scopeRevision.findFirst({ where: { engagementId }, orderBy: { version: 'desc' } });
    const nextVersion = (last?.version ?? 0) + 1;
    const created = await this.db.$transaction(async (tx) => {
      // Invalidation happens at submission: the previously approved revision is
      // superseded immediately, so pinned approvals/readiness go stale.
      await tx.scopeRevision.updateMany({ where: { engagementId, status: 'approved' }, data: { status: 'superseded' } });
      return tx.scopeRevision.create({
        data: {
          engagementId,
          version: nextVersion,
          status: 'pending',
          diff: diff as object,
          roe: roe as object,
          requestedBy: actorId,
        },
      });
    });
    await this.audit(engagementId, actorId, 'scope.revision_submitted', 'scope_revision', created.id, `v${created.version} (+${diff.added.length}/-${diff.removed.length})`);
    return toRevisionView(created);
  }

  public async decideRevision(actorId: string, engagementId: string, revisionId: string, input: unknown): Promise<RevisionView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_REVIEW);
    const body = (input ?? {}) as { decision?: unknown; comment?: unknown };
    const decision = typeof body.decision === 'string' ? body.decision : '';
    if (decision !== 'approved' && decision !== 'rejected') throw new ProjectApiError(400, "decision must be 'approved' or 'rejected'.");
    const revision = await this.db.scopeRevision.findFirst({ where: { id: revisionId, engagementId } });
    if (revision === null) throw new ProjectApiError(404, 'Scope revision not found');
    if (revision.status !== 'pending') throw new ProjectApiError(409, `Revision v${revision.version} is already ${revision.status}.`);
    requireIndependentActor(revision.requestedBy, actorId, 'The scope revision decision');
    const comment = typeof body.comment === 'string' ? body.comment : null;
    const updated = await this.db.$transaction(async (tx) => {
      const row = await tx.scopeRevision.update({
        where: { id: revision.id },
        data: { status: decision, decidedBy: actorId, decidedAt: new Date(), decisionComment: comment },
      });
      if (decision === 'approved') {
        const diff = revision.diff as unknown as ScopeDiff;
        for (const identifier of diff.added ?? []) {
          // Newly added targets become executable only through this governance path.
          await tx.webAsset.updateMany({ where: { engagementId, identifier, classification: 'pending' }, data: { classification: 'in_scope', updatedBy: actorId, version: { increment: 1 } } });
        }
      }
      return row;
    });
    await this.audit(engagementId, actorId, `scope.revision_${decision}`, 'scope_revision', revision.id, comment ?? `v${revision.version}`);
    await createNotice(this.db, { engagementId, actorId: revision.requestedBy, kind: 'scope.revision_decided', title: `Scope revision v${revision.version} was ${decision}`, detail: { revisionId: revision.id, decision, decidedBy: actorId } });
    return toRevisionView(updated);
  }

  public async assets(actorId: string, engagementId: string): Promise<AssetsInventoryView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const rows = await this.db.webAsset.findMany({ where: { engagementId }, orderBy: { identifier: 'asc' } });
    const approved = await this.latestApproved(engagementId);
    return { engagementId, assets: rows.map(toAssetView), latestApprovedVersion: approved?.version ?? null, source: 'db' };
  }

  public async addAsset(actorId: string, engagementId: string, input: unknown): Promise<AssetView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_WRITE);
    const body = (input ?? {}) as { identifier?: unknown; kind?: unknown };
    const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
    if (identifier.length === 0 || identifier.length > 500) throw new ProjectApiError(400, 'identifier (1-500 chars) is required.');
    const kind = typeof body.kind === 'string' && ['host', 'web_url', 'ip_range'].includes(body.kind) ? body.kind : 'host';
    const existing = await this.db.webAsset.findFirst({ where: { engagementId, identifier } });
    if (existing !== null) throw new ProjectApiError(409, `Asset ${identifier} already exists on this engagement.`);
    // Operator-managed additions start pending: only the approved governance
    // path (revision decision) can make a target executable.
    const row = await this.db.webAsset.create({ data: { engagementId, identifier, kind, classification: 'pending', observed: false, createdBy: actorId } });
    await this.audit(engagementId, actorId, 'asset.added', 'asset', row.id, `${identifier} (${kind}, pending)`);
    return toAssetView(row);
  }

  public async importAssets(actorId: string, engagementId: string, input: unknown): Promise<{ imported: number; skipped: number }> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_WRITE);
    const body = (input ?? {}) as { identifiers?: unknown; kind?: unknown };
    const identifiers = Array.isArray(body.identifiers) ? body.identifiers.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim()) : [];
    if (identifiers.length === 0) throw new ProjectApiError(400, 'identifiers (non-empty array) is required.');
    if (identifiers.length > 500) throw new ProjectApiError(400, 'Import at most 500 identifiers per request.');
    const kind = typeof body.kind === 'string' && ['host', 'web_url', 'ip_range'].includes(body.kind) ? body.kind : 'host';
    let imported = 0;
    let skipped = 0;
    for (const identifier of identifiers) {
      const existing = await this.db.webAsset.findFirst({ where: { engagementId, identifier } });
      if (existing !== null) { skipped += 1; continue; }
      await this.db.webAsset.create({ data: { engagementId, identifier, kind, classification: 'pending', observed: false, createdBy: actorId } });
      imported += 1;
    }
    await this.audit(engagementId, actorId, 'asset.imported', 'asset_batch', engagementId, `${imported} imported, ${skipped} skipped`);
    return { imported, skipped };
  }

  public async classifyAsset(actorId: string, engagementId: string, assetId: string, input: unknown): Promise<AssetView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_WRITE);
    const body = (input ?? {}) as { classification?: unknown };
    const classification = typeof body.classification === 'string' ? body.classification : '';
    if (classification !== 'in_scope' && classification !== 'out_of_scope' && classification !== 'pending') {
      throw new ProjectApiError(400, "classification must be 'in_scope', 'out_of_scope' or 'pending'.");
    }
    const asset = await this.db.webAsset.findFirst({ where: { id: assetId, engagementId } });
    if (asset === null) throw new ProjectApiError(404, 'Asset not found');
    if (classification === 'in_scope' && asset.classification !== 'in_scope') {
      const approved = await this.latestApproved(engagementId);
      const diff = approved?.diff as ScopeDiff | undefined;
      const covered = diff?.added?.includes(asset.identifier) === true
        || (approved !== null && this.engagementTargetIncludes(engagementId, asset.identifier));
      if (!covered) {
        throw new ProjectApiError(409, `Marking ${asset.identifier} in scope requires an approved scope revision that adds it; newly added targets stay pending.`);
      }
    }
    const row = await this.db.webAsset.update({ where: { id: asset.id }, data: { classification, updatedBy: actorId, version: { increment: 1 } } });
    await this.audit(engagementId, actorId, 'asset.classified', 'asset', asset.id, `${asset.identifier} -> ${classification}`);
    return toAssetView(row);
  }

  /** The engagement's own authorized target is always in scope by definition. */
  private async engagementTargetIncludes(engagementId: string, identifier: string): Promise<boolean> {
    const engagement = await this.db.engagement.findFirst({ where: { id: engagementId }, select: { targetValue: true } });
    return engagement?.targetValue === identifier;
  }

  /** Checks a stored approved ROE revision window at `now` (edited windows, tz-ISO). */
  public async roeWindowAllows(engagementId: string, now: number): Promise<{ ok: boolean; reason: string | null; version: number | null }> {
    const approved = await this.latestApproved(engagementId);
    if (approved === null) return { ok: false, reason: 'No approved ROE revision exists yet.', version: null };
    const roe = approved?.roe as unknown as RoeWindows;
    const windows = roe.windows ?? [];
    if (windows.length === 0) return { ok: true, reason: null, version: approved.version };
    const inWindow = windows.some((w) => {
      const start = Date.parse(w.start);
      const end = Date.parse(w.end);
      return !Number.isNaN(start) && !Number.isNaN(end) && now >= start && now < end;
    });
    if (!inWindow) {
      const list = windows.map((w) => `${w.start}..${w.end} (${w.tz})`).join(', ');
      return { ok: false, reason: `Outside the approved ROE time windows: ${list}.`, version: approved.version };
    }
    return { ok: true, reason: null, version: approved.version };
  }

  /** Guard reused by tickets 09/12/17: absolute deadline check with the shared policy helper. */
  public static checkDeadline(expiresAt: Date | null, now: number, what: string): void {
    assertNotExpired(expiresAt, now, what);
  }

  private async audit(engagementId: string, actorId: string, action: string, targetType: string, targetId: string, reason: string): Promise<void> {
    await this.db.webAuditEntry.create({ data: { engagementId, actorId, action, targetType, targetId, reason } });
  }
}

function normalizeDiff(raw: unknown): ScopeDiff {
  const body = (raw ?? {}) as { added?: unknown; removed?: unknown; rationale?: unknown };
  const added = Array.isArray(body.added) ? body.added.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim()) : [];
  const removed = Array.isArray(body.removed) ? body.removed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim()) : [];
  const rationale = typeof body.rationale === 'string' ? body.rationale : '';
  if (added.length === 0 && removed.length === 0) throw new ProjectApiError(400, 'A scope revision needs at least one added or removed identifier.');
  if (rationale.trim().length === 0) throw new ProjectApiError(400, 'A revision rationale is required.');
  return { added, removed, rationale };
}

function normalizeRoe(raw: unknown): RoeWindows {
  const body = (raw ?? {}) as { windows?: unknown; emergencyContacts?: unknown; restrictions?: unknown };
  const windows = Array.isArray(body.windows)
    ? body.windows.map((w) => {
      const item = (w ?? {}) as { start?: unknown; end?: unknown; tz?: unknown };
      const start = typeof item.start === 'string' ? item.start : '';
      const end = typeof item.end === 'string' ? item.end : '';
      if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) {
        throw new ProjectApiError(400, 'Each ROE window needs a valid start/end pair with end after start.');
      }
      return { start, end, tz: typeof item.tz === 'string' && item.tz.trim().length > 0 ? item.tz : 'UTC' };
    })
    : [];
  const emergencyContacts = Array.isArray(body.emergencyContacts) ? body.emergencyContacts.filter((v): v is string => typeof v === 'string') : [];
  const restrictions = Array.isArray(body.restrictions) ? body.restrictions.filter((v): v is string => typeof v === 'string') : [];
  return { windows, emergencyContacts, restrictions };
}
