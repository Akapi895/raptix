import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectApiError } from './projects-service.js';
import { createNotice } from './inbox-service.js';
import { requireEngagementAccess, requireIndependentActor, type ActorContext } from '../auth/membership-policy.js';

/**
 * Ticket 17: real engagement closure. The closure checklist reads the
 * authoritative operation/stop, C2 session, finding-disposition, report-
 * delivery and outstanding-approval state — unknown sources answer
 * `unavailable` and block, they are never treated as settled. The request
 * itself requires a passing checklist; the confirming transition RECHECKS it
 * inside the same transaction that flips the status, so a run/session or
 * approval that appears after a stale checklist cannot slip through. Closed
 * engagements are read-only by enforcement at the mutation/execution
 * entrypoints (assertEngagementOpen), not merely in the UI. Closure is not
 * deletion: workspace data is retained.
 */

export interface ClosureChecklistEntry {
  readonly id: string;
  readonly state: 'pass' | 'fail' | 'unavailable';
  readonly detail: string | null;
}

export interface ClosureChecklist {
  readonly entries: readonly ClosureChecklistEntry[];
  readonly ok: boolean;
}

export interface ClosureView {
  readonly id: string;
  readonly engagementId: string;
  readonly status: 'requested' | 'confirmed' | 'rejected' | 'closed' | 'cancelled';
  readonly requestedBy: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly reason: string;
  readonly checklist: ClosureChecklist;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly source: 'db';
}

export interface ClosureSurfaceView {
  readonly engagementId: string;
  readonly closure: ClosureView | null;
  readonly readOnly: boolean;
  readonly source: 'db';
}

interface ClosureRow {
  id: string;
  engagementId: string;
  status: string;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  reason: string;
  checklist: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/** The post-close gate shared by every mutation/execution entrypoint. */
export async function assertEngagementOpen(db: PrismaClient, engagementId: string): Promise<void> {
  // The closure table ships with the current migration set, so the store is
  // always present in production; the optional lookup only tolerates clients
  // that predate it (legacy test fakes), never weakens a live deployment.
  const store = (db as unknown as { engagementClosure?: { findFirst: (args: unknown) => Promise<unknown> } }).engagementClosure;
  if (store === undefined) return;
  const row = await store.findFirst({ where: { engagementId } });
  if (row !== null && row !== undefined && (row as { status: string }).status === 'closed') {
    throw new ProjectApiError(409, 'This engagement is closed and read-only; mutations and execution are refused. Closure records remain available.');
  }
}

export class ClosureService {
  /** @param pendingApprovals counts outstanding workspace HITL approvals; absent → the checklist blocks as unavailable. */
  public constructor(private readonly db: PrismaClient, private readonly pendingApprovals?: (userId: string, engagementId: string) => Promise<number>) {}

  private ctx(actorId: string): ActorContext {
    return { db: this.db, actorId, multiUser: true };
  }

  public assertOpen(engagementId: string): Promise<void> {
    return assertEngagementOpen(this.db, engagementId);
  }

  public async get(actorId: string, engagementId: string): Promise<ClosureSurfaceView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const row = await this.findRow(engagementId);
    return { engagementId, closure: row === null ? null : this.toView(row), readOnly: row?.status === 'closed', source: 'db' };
  }

  public async request(actorId: string, engagementId: string, input: unknown): Promise<ClosureView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'operator');
    const body = (input ?? {}) as { reason?: unknown };
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length === 0) throw new ProjectApiError(400, 'A reason is required to request closure.');
    const existing = await this.findRow(engagementId);
    if (existing !== null) {
      if (existing.status === 'requested') throw new ProjectApiError(409, 'A closure request is already pending review.');
      if (existing.status === 'closed') throw new ProjectApiError(409, 'This engagement is already closed.');
    }
    const checklist = await this.checklist(actorId, engagementId, this.db);
    const blocked = checklist.entries.filter((e) => e.state !== 'pass');
    if (blocked.length > 0) {
      throw new ProjectApiError(409, `Closure prerequisites are not met: ${blocked.map((e) => `${e.id} (${e.state}${e.detail === null ? '' : `: ${e.detail}`})`).join('; ')}.`);
    }
    const row = existing === null
      ? await this.db.engagementClosure.create({ data: { engagementId, status: 'requested', requestedBy: actorId, reason, checklist: checklist as unknown as object } })
      : await this.db.engagementClosure.update({ where: { id: existing.id }, data: { status: 'requested', requestedBy: actorId, decidedBy: null, decidedAt: null, reason, checklist: checklist as unknown as object } });
    await this.audit(engagementId, actorId, 'closure.requested', 'engagement_closure', (row as unknown as { id: string }).id, reason);
    await createNotice(this.db, { engagementId, actorId, kind: 'closure.requested', title: 'Engagement closure was requested', detail: { closureId: (row as unknown as { id: string }).id, requestedBy: actorId } });
    return this.toView(row as unknown as ClosureRow);
  }

  public async decide(actorId: string, engagementId: string, input: unknown): Promise<ClosureView> {
    const body = (input ?? {}) as { decision?: unknown };
    const decision = typeof body.decision === 'string' ? body.decision : '';
    if (decision !== 'confirmed' && decision !== 'rejected' && decision !== 'cancelled') {
      throw new ProjectApiError(400, "decision must be 'confirmed', 'rejected' or 'cancelled'.");
    }
    // Cancel is the requester's withdrawal (existence check only); the
    // confirm/reject decision requires reviewer-or-above plus independence.
    await requireEngagementAccess(this.ctx(actorId), engagementId, decision === 'cancelled' ? 'viewer' : 'reviewer');
    if (decision === 'cancelled') {      const row = await this.findRow(engagementId);
      if (row === null || row.status !== 'requested') throw new ProjectApiError(409, 'Only a pending closure request can be cancelled.');
      if (row.requestedBy !== actorId) throw new ProjectApiError(403, 'Only the requesting actor can cancel their closure request.');
      const updated = await this.db.engagementClosure.update({ where: { id: row.id }, data: { status: 'cancelled', decidedBy: actorId, decidedAt: new Date() } });
      await this.audit(engagementId, actorId, 'closure.cancelled', 'engagement_closure', row.id, row.reason);
      return this.toView(updated as unknown as ClosureRow);
    }
    // Confirm/reject require reviewer-or-above AND an independent actor. The
    // confirmation rechecks the checklist inside the transition transaction.
    const updated = await this.db.$transaction(async (tx) => {
      const row = await (tx as PrismaClient).engagementClosure.findFirst({ where: { engagementId } }) as unknown as ClosureRow | null;
      if (row === null || row.status !== 'requested') throw new ProjectApiError(409, 'There is no pending closure request to decide.');
      // Role authorization (operator+, which covers the reviewer requirement)
      // was resolved before the transaction; independence is checked here
      // against the persisted requester.
      requireIndependentActor(row.requestedBy, actorId, 'The closure decision');
      if (decision === 'rejected') {
        return await (tx as PrismaClient).engagementClosure.update({ where: { id: row.id }, data: { status: 'rejected', decidedBy: actorId, decidedAt: new Date() } }) as unknown as ClosureRow;
      }
      const check = await this.checklist(actorId, engagementId, tx as PrismaClient);
      const blocked = check.entries.filter((e) => e.state !== 'pass');
      if (blocked.length > 0) {
        throw new ProjectApiError(409, `The closure checklist changed and is no longer satisfied: ${blocked.map((e) => `${e.id} (${e.state}${e.detail === null ? '' : `: ${e.detail}`})`).join('; ')}.`);
      }
      return await (tx as PrismaClient).engagementClosure.update({ where: { id: row.id }, data: { status: 'closed', decidedBy: actorId, decidedAt: new Date(), checklist: check as unknown as object } }) as unknown as ClosureRow;
    });
    await this.audit(engagementId, actorId, `closure.${decision === 'confirmed' ? 'confirmed' : 'rejected'}`, 'engagement_closure', updated.id, `${updated.status}${updated.decidedAt === null ? '' : ` at ${updated.decidedAt.toISOString()}`}`);
    if (decision === 'confirmed') {
      await createNotice(this.db, { engagementId, actorId, kind: 'closure.confirmed', title: 'Engagement closure was confirmed', detail: { closureId: updated.id, decidedBy: actorId } });
    }
    return this.toView(updated);
  }

  /** Authoritative checklist; `client` allows the atomic recheck inside the decision transaction. */
  private async checklist(userId: string, engagementId: string, client: PrismaClient): Promise<ClosureChecklist> {
    const entries: ClosureChecklistEntry[] = [];
    const push = async (id: string, count: Promise<number>, zero: string, nonZero: (n: number) => string): Promise<void> => {
      try {
        const n = await count;
        entries.push({ id, state: n === 0 ? 'pass' : 'fail', detail: n === 0 ? zero : nonZero(n) });
      } catch {
        entries.push({ id, state: 'unavailable', detail: 'The authoritative source could not be read; closure cannot proceed on unknown state.' });
      }
    };
    await push('runtime', client.webRequestLedger.count({ where: { engagementId, activeThreadId: { not: null }, operation: { not: 'create_thread' } } }), 'no in-flight runtime requests', (n) => `${n} runtime request(s) still hold an active run`);
    await push('estop', client.emergencyStop.count({ where: { engagementId, outcome: { in: ['requested', 'acknowledged'] } } }), 'no unresolved emergency stops', (n) => `${n} unresolved emergency stop(s)`);
    try {
      await client.c2Grant.updateMany({ where: { engagementId, status: 'approved', expiresAt: { lte: new Date() } }, data: { status: 'expired' } });
    } catch { /* the count below still gates */ }
    await push('c2', client.c2Grant.count({ where: { engagementId, status: 'approved' } }), 'no live C2 session grants', (n) => `${n} approved C2 session grant(s) still live`);
    await push('findings', client.findingRecord.count({ where: { engagementId, status: 'review' } }), 'no findings left in review', (n) => `${n} finding(s) still in review`);
    await push('reports', client.reportRecord.count({ where: { engagementId, status: { not: 'delivered' } } }), 'all reports delivered', (n) => `${n} report(s) not delivered`);
    if (this.pendingApprovals === undefined) {
      entries.push({ id: 'approvals', state: 'unavailable', detail: 'The approval service is not available in this deployment.' });
    } else {
      try {
        const pending = await this.pendingApprovals(userId, engagementId);
        entries.push({ id: 'approvals', state: pending === 0 ? 'pass' : 'fail', detail: pending === 0 ? 'no pending approvals' : `${pending} pending approval(s)` });
      } catch {
        entries.push({ id: 'approvals', state: 'unavailable', detail: 'The approval service could not be read.' });
      }
    }
    return { entries, ok: entries.every((e) => e.state === 'pass') };
  }

  private async findRow(engagementId: string): Promise<ClosureRow | null> {
    const row = await this.db.engagementClosure.findFirst({ where: { engagementId } });
    return row === null ? null : (row as unknown as ClosureRow);
  }

  private toView(row: ClosureRow): ClosureView {
    const checklist = row.checklist as { entries?: { id: string; state: string; detail: string | null }[] } | null;
    const entries = (Array.isArray(checklist?.entries) ? checklist.entries : []) as ClosureChecklistEntry[];
    return {
      id: row.id,
      engagementId: row.engagementId,
      status: row.status as ClosureView['status'],
      requestedBy: row.requestedBy,
      decidedBy: row.decidedBy,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      reason: row.reason,
      checklist: { entries, ok: entries.length > 0 && entries.every((e) => e.state === 'pass') },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      source: 'db',
    };
  }

  private async audit(engagementId: string, actorId: string, action: string, targetType: string, targetId: string, reason: string): Promise<void> {
    await this.db.webAuditEntry.create({ data: { engagementId, actorId, action, targetType, targetId, reason } });
  }
}
