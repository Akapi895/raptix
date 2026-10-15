import type { PrismaClient, ScopeRevision, WebAsset } from '../generated/prisma/client.js';
import { ProjectApiError } from './projects-service.js';
import { createNotice } from './inbox-service.js';
import { assertNotExpired, requireEngagementAccess, requireIndependentActor, type ActorContext, type MemberRole } from '../auth/membership-policy.js';
import { assertEngagementOpen } from './closure-service.js';

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

/** W07-3: cumulative effective scope snapshot consumed through the public read bridge. */
export interface EffectiveScopeView {
  readonly engagementId: string;
  readonly version: number | null;
  readonly rootTarget: string | null;
  readonly inScope: readonly string[];
  readonly roe: RoeWindows;
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
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { diff?: unknown; roe?: unknown };
    const diff = normalizeDiff(body.diff);
    const roe = normalizeRoe(body.roe);
    const engagement = await this.db.engagement.findFirst({ where: { id: engagementId }, select: { targetValue: true } });
    if (engagement !== null && typeof engagement.targetValue === 'string' && diff.removed.includes(engagement.targetValue)) {
      throw new ProjectApiError(409, 'The engagement target cannot be removed from scope; close the engagement instead.');
    }
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
      // W07 CAS: a decision is only authoritative for the newest submitted
      // version. An older pending revision must not be approved after a
      // newer one exists (no implicit rebase — resubmit instead).
      const siblings = await tx.scopeRevision.findMany({ where: { engagementId } });
      if (siblings.some((r) => r.version > revision.version)) {
        throw new ProjectApiError(409, `Scope revision v${revision.version} is stale — revision v${Math.max(...siblings.map((r) => r.version))} was submitted after it. Re-submit the change against the current version.`);
      }
      if (decision === 'approved') {
        // One authoritative approved version per engagement: an older
        // approval never survives a newer one.
        await tx.scopeRevision.updateMany({ where: { engagementId, status: 'approved' }, data: { status: 'superseded' } });
      }
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
        for (const identifier of diff.removed ?? []) {
          // W07: approved removals take real effect inside the same
          // transaction — earlier additions are never silently lost, and
          // observed runtime evidence stays untouched.
          await tx.webAsset.updateMany({ where: { engagementId, identifier, classification: 'in_scope' }, data: { classification: 'out_of_scope', updatedBy: actorId, version: { increment: 1 } } });
          await tx.webAsset.updateMany({ where: { engagementId, identifier, classification: 'pending' }, data: { classification: 'out_of_scope', updatedBy: actorId, version: { increment: 1 } } });
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
    await assertEngagementOpen(this.db, engagementId);
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
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { classification?: unknown; expectedVersion?: unknown };
    const classification = typeof body.classification === 'string' ? body.classification : '';
    if (classification !== 'in_scope' && classification !== 'out_of_scope' && classification !== 'pending') {
      throw new ProjectApiError(400, "classification must be 'in_scope', 'out_of_scope' or 'pending'.");
    }
    const asset = await this.db.webAsset.findFirst({ where: { id: assetId, engagementId } });
    if (asset === null) throw new ProjectApiError(404, 'Asset not found');
    // W07 CAS: the classification applies to the inventory version the caller
    // actually read; a stale read must re-read instead of overwriting.
    if (typeof body.expectedVersion === 'number' && body.expectedVersion !== asset.version) {
      throw new ProjectApiError(409, `${asset.identifier} changed since you read it (now v${asset.version}); re-read the inventory and classify again.`);
    }
    if (classification === 'in_scope' && asset.classification !== 'in_scope') {
      const approved = await this.latestApproved(engagementId);
      const diff = approved?.diff as ScopeDiff | undefined;
      const covered = diff?.added?.includes(asset.identifier) === true
        || (approved !== null && await this.engagementTargetIncludes(engagementId, asset.identifier));
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

  /**
   * W07-3 read-side bridge: the cumulative effective scope for the runtime —
   * the approved revision version, the always-in-scope root target, the
   * cumulative in-scope identifiers and the authoritative approved ROE.
   * Consumers apply it through their own guardrails; this endpoint never
   * mutates runtime state.
   */
  public async effectiveScope(actorId: string, engagementId: string): Promise<EffectiveScopeView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const approved = await this.latestApproved(engagementId);
    const rows = await this.db.webAsset.findMany({ where: { engagementId }, orderBy: { identifier: 'asc' } });
    const engagement = await this.db.engagement.findFirst({ where: { id: engagementId }, select: { targetValue: true } });
    return {
      engagementId,
      version: approved?.version ?? null,
      rootTarget: typeof engagement?.targetValue === 'string' ? engagement.targetValue : null,
      inScope: rows.filter((r) => r.classification === 'in_scope').map((r) => r.identifier),
      roe: approved !== null ? approved.roe as unknown as RoeWindows : { windows: [], emergencyContacts: [], restrictions: [] },
      source: 'db',
    };
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

  /**
   * W12: freeze provider session → authorized target mapping. A C2 session's
   * observed target address is only authorized when it falls inside the
   * engagement's approved effective scope (in-scope assets plus the immutable
   * root target). The address is never trusted as authority by itself.
   */
  public async targetInScope(engagementId: string, target: string): Promise<{ ok: boolean; reason: string | null }> {
    const host = sessionHost(target);
    if (host.length === 0) return { ok: false, reason: 'The provider session reports no usable target address.' };
    const rows = await this.db.webAsset.findMany({ where: { engagementId, classification: 'in_scope' } });
    const engagement = await this.db.engagement.findFirst({ where: { id: engagementId }, select: { targetType: true, targetValue: true } });
    const rootTarget = typeof engagement?.targetValue === 'string' ? engagement.targetValue : '';
    const rootType = typeof engagement?.targetType === 'string' ? engagement.targetType : '';
    const matchesRoot = rootTarget.length > 0
      && (rootType === 'ip_range' ? ipInCidr(host, rootTarget) : sessionHost(rootTarget) === host);
    const matched = rows.some((r) => identifierCovers(r.identifier, r.kind, host));
    if (matched || matchesRoot) return { ok: true, reason: null };
    const inScope = rows.map((r) => `${r.identifier} (${r.kind})`).join(', ');
    return { ok: false, reason: `Session target ${target} is outside the approved effective scope${inScope.length > 0 ? `: ${inScope}` : ' (no in-scope assets)'}.` };
  }

  /** Guard reused by tickets 09/12/17: absolute deadline check with the shared policy helper. */
  public static checkDeadline(expiresAt: Date | null, now: number, what: string): void {
    assertNotExpired(expiresAt, now, what);
  }

  private async audit(engagementId: string, actorId: string, action: string, targetType: string, targetId: string, reason: string): Promise<void> {
    await this.db.webAuditEntry.create({ data: { engagementId, actorId, action, targetType, targetId, reason } });
  }
}

/** Extracts the host from a session target address ('10.0.0.5', '10.0.0.5:4444', '[::1]:4444') or a URL. */
function sessionHost(target: string): string {
  const value = target.trim();
  if (value.includes('://')) {
    try { return new URL(value).hostname.toLowerCase(); } catch { return ''; }
  }
  if (value.startsWith('[')) { const end = value.indexOf(']'); return end > 0 ? value.slice(1, end).toLowerCase() : ''; }
  const colon = value.lastIndexOf(':');
  if (colon > 0 && value.indexOf(':') === colon && /^\d+$/.test(value.slice(colon + 1))) return value.slice(0, colon).toLowerCase();
  return value.toLowerCase();
}

/** Whether an in-scope identifier of the given kind covers the target host. */
function identifierCovers(identifier: string, kind: string, host: string): boolean {
  if (kind === 'ip_range') return ipInCidr(host, identifier);
  if (kind === 'web_url') return sessionHost(identifier) === host;
  return identifier.trim().toLowerCase() === host;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function ipv6ToBigInt(ip: string): bigint | null {
  const value = ip.trim().toLowerCase();
  if (value.includes('%')) return null;
  if (value.split('::').length > 2) return null;
  const [head, tail] = value.split('::');
  const toGroups = (segment: string): string[] => segment.length === 0 ? [] : segment.split(':');
  const headGroups = toGroups(head ?? '');
  const tailGroups = tail === undefined ? [] : toGroups(tail);
  const missing = 8 - headGroups.length - tailGroups.length;
  if (tail !== undefined && missing < 0) return null;
  if (tail === undefined && headGroups.length !== 8) return null;
  const groups = tail === undefined ? headGroups : [...headGroups, ...Array(missing).fill('0'), ...tailGroups];
  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    result = (result << 16n) + BigInt(parseInt(group, 16));
  }
  return result;
}

/** IPv4 or IPv6 CIDR/address containment. */
function ipInCidr(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf('/');
  const range = slash === -1 ? cidr : cidr.slice(0, slash);
  const prefixText = slash === -1 ? undefined : cidr.slice(slash + 1);
  const v4ip = ipv4ToInt(ip);
  const v4range = ipv4ToInt(range);
  if (v4ip !== null && v4range !== null) {
    const prefix = prefixText === undefined ? 32 : Number(prefixText);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return ((v4ip & mask) >>> 0) === ((v4range & mask) >>> 0);
  }
  const v6ip = ipv6ToBigInt(ip);
  const v6range = ipv6ToBigInt(range);
  if (v6ip !== null && v6range !== null) {
    const prefix = prefixText === undefined ? 128 : Number(prefixText);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return false;
    const shift = BigInt(128 - prefix);
    return (v6ip >> shift) === (v6range >> shift);
  }
  return false;
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

/** W07: a persisted window must name a real IANA zone (or UTC). */
export function isKnownTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** W07: accepts only absolute ISO-8601 timestamps (Z or ±HH:MM/±HHMM offset). */
export const OFFSET_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function normalizeRoe(raw: unknown): RoeWindows {
  const body = (raw ?? {}) as { windows?: unknown; emergencyContacts?: unknown; restrictions?: unknown };
  const windows = Array.isArray(body.windows)
    ? body.windows.map((w) => {
      const item = (w ?? {}) as { start?: unknown; end?: unknown; tz?: unknown };
      const start = typeof item.start === 'string' ? item.start.trim() : '';
      const end = typeof item.end === 'string' ? item.end.trim() : '';
      // A timestamp without an explicit offset would silently follow the API
      // machine's timezone and change the real authorized window.
      if (!OFFSET_SUFFIX.test(start) || !OFFSET_SUFFIX.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) {
        throw new ProjectApiError(400, 'Each ROE window needs absolute ISO-8601 start/end timestamps (with a Z or ±HH:MM offset) with end after start.');
      }
      const tz = typeof item.tz === 'string' && item.tz.trim().length > 0 ? item.tz.trim() : 'UTC';
      if (!isKnownTimeZone(tz)) throw new ProjectApiError(400, `Unknown ROE window timezone: ${tz}.`);
      return { start, end, tz };
    })
    : [];
  const stringList = (value: unknown, what: string): string[] => {
    if (!Array.isArray(value)) return [];
    const list = value.map((v) => (typeof v === 'string' ? v.trim() : ''));
    if (list.some((v) => v.length === 0)) throw new ProjectApiError(400, `${what} entries must be non-empty strings.`);
    return list;
  };
  const emergencyContacts = stringList(body.emergencyContacts, 'emergencyContacts');
  const restrictions = stringList(body.restrictions, 'restrictions');
  return { windows, emergencyContacts, restrictions };
}
