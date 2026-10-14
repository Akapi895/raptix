import type { PrismaClient } from '../generated/prisma/client.js';
import { requireEngagementAccess, type ActorContext } from '../auth/membership-policy.js';

/**
 * Ticket 16: authoritative audit projection over the records this server
 * actually writes. `webAuditEntry` rows carry `source: 'web'`; vault
 * lifecycle rows (which have no actor column) project with `source: 'vault'`
 * and `actorId: null` — missing facts are never fabricated. `detail` is
 * omitted from the projection: it is written sensitive-free by construction,
 * and the audit surface does not need it. Workspace views only include
 * engagement rows from engagements the actor is authorized on.
 */

export interface AuditEntryView {
  readonly id: string;
  readonly engagementId: string | null;
  readonly actorId: string | null;
  readonly action: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly reason: string | null;
  readonly createdAt: string;
  readonly source: 'web' | 'vault';
}

export interface AuditView {
  /** Null for the workspace-wide view. */
  readonly engagementId: string | null;
  readonly entries: readonly AuditEntryView[];
  readonly total: number;
  readonly truncated: boolean;
  readonly actors: readonly string[];
  readonly actions: readonly string[];
  readonly source: 'db';
}

export interface AuditQuery {
  readonly action?: string;
  readonly actor?: string;
  readonly q?: string;
  readonly limit?: number;
}

const MAX_FETCH = 500;
const DEFAULT_LIMIT = 100;

interface RawRow {
  id: string;
  engagementId: string | null;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  createdAt: Date;
}

interface VaultRow {
  id: string;
  engagementId: string;
  secretId: string;
  action: string;
  createdAt: Date;
}

export class AuditService {
  public constructor(private readonly db: PrismaClient) {}

  private ctx(actorId: string): ActorContext {
    return { db: this.db, actorId, multiUser: true };
  }

  public async engagementAudit(actorId: string, engagementId: string, query: AuditQuery = {}): Promise<AuditView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const [web, vault] = await Promise.all([
      this.db.webAuditEntry.findMany({ where: { engagementId }, orderBy: { createdAt: 'desc' }, take: MAX_FETCH }) as Promise<RawRow[]>,
      this.db.vaultAudit.findMany({ where: { engagementId }, orderBy: { createdAt: 'desc' }, take: MAX_FETCH }).catch(() => []),
    ]);
    const merged = [...web.map((r) => this.toEntry(r, 'web')), ...vault.map((r) => this.toVaultEntry(r as VaultRow))];
    merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return this.project(engagementId, merged, query, web.length >= MAX_FETCH);
  }

  public async workspaceAudit(actorId: string, query: AuditQuery = {}): Promise<AuditView> {
    const ids = await this.authorizedEngagementIds(actorId);
    const [workspace, engagement, vault] = await Promise.all([
      this.db.webAuditEntry.findMany({ where: { engagementId: null }, orderBy: { createdAt: 'desc' }, take: MAX_FETCH }) as Promise<RawRow[]>,
      ids.length === 0
        ? Promise.resolve([] as RawRow[])
        : this.db.webAuditEntry.findMany({ where: { engagementId: { in: ids } }, orderBy: { createdAt: 'desc' }, take: MAX_FETCH }) as Promise<RawRow[]>,
      ids.length === 0 ? Promise.resolve([] as RawRow[]) : this.db.vaultAudit.findMany({ where: { engagementId: { in: ids } }, orderBy: { createdAt: 'desc' }, take: MAX_FETCH }).catch(() => []),
    ]);
    const merged = [
      ...workspace.map((r) => this.toEntry(r, 'web')),
      ...engagement.map((r) => this.toEntry(r, 'web')),
      ...vault.map((r) => this.toVaultEntry(r as VaultRow)),
    ];
    merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return this.project(null, merged, query, workspace.length >= MAX_FETCH || engagement.length >= MAX_FETCH);
  }

  private project(engagementId: string | null, merged: AuditEntryView[], query: AuditQuery, fetchTruncated: boolean): AuditView {
    const action = query.action === undefined || query.action.length === 0 ? null : query.action.toLowerCase();
    const actor = query.actor === undefined || query.actor.length === 0 ? null : query.actor;
    const q = query.q === undefined || query.q.length === 0 ? null : query.q.toLowerCase();
    const filtered = merged.filter((e) => {
      if (action !== null && !e.action.toLowerCase().startsWith(action)) return false;
      if (actor !== null && e.actorId !== actor) return false;
      if (q !== null && !`${e.action} ${e.targetType ?? ''} ${e.targetId ?? ''} ${e.reason ?? ''} ${e.actorId ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const limit = typeof query.limit === 'number' && Number.isInteger(query.limit) && query.limit >= 1 && query.limit <= MAX_FETCH ? query.limit : DEFAULT_LIMIT;
    const entries = filtered.slice(0, limit);
    return {
      engagementId,
      entries,
      total: filtered.length,
      truncated: fetchTruncated || filtered.length > limit,
      actors: [...new Set(entries.map((e) => e.actorId).filter((a): a is string => a !== null))].sort(),
      actions: [...new Set(entries.map((e) => e.action))].sort(),
      source: 'db',
    };
  }

  private toEntry(row: RawRow, source: 'web' | 'vault'): AuditEntryView {
    return {
      id: row.id,
      engagementId: row.engagementId,
      actorId: row.actorId,
      action: String(row.action),
      targetType: row.targetType,
      targetId: row.targetId,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      source,
    };
  }

  /** Vault audit rows carry no actor; projecting one would fabricate attribution. */
  private toVaultEntry(row: VaultRow): AuditEntryView {
    return {
      id: row.id,
      engagementId: row.engagementId,
      actorId: null,
      action: `vault.secret_${row.action}`,
      targetType: 'vault_secret',
      targetId: row.secretId,
      reason: null,
      createdAt: row.createdAt.toISOString(),
      source: 'vault',
    };
  }

  /** Only engagements the actor owns or holds a membership on (foreign rows never leak). */
  private async authorizedEngagementIds(actorId: string): Promise<string[]> {
    try {
      const owned = await this.db.engagement.findMany({ where: { userId: actorId }, select: { id: true } });
      const memberships = await this.db.webMembership.findMany({ where: { userId: actorId }, select: { engagementId: true } });
      const ids = new Set(owned.map((e) => String(e.id)));
      for (const m of memberships) ids.add(String(m.engagementId));
      return [...ids];
    } catch {
      return [];
    }
  }
}
