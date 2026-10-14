import type { PrismaClient, C2Grant } from '../generated/prisma/client.js';
import { ProjectApiError } from './projects-service.js';
import { requireEngagementAccess, requireIndependentActor, type ActorContext, type MemberRole } from '../auth/membership-policy.js';

/**
 * Ticket 12: expiring per-user C2 session grants. A connected session is not
 * an authorization: every command authorizes against a live approved grant
 * (actor + session + absolute deadline). Input locks at expiry — there is no
 * authorization grace period; server-owned sweep marks expired grants
 * lazily on read and the gate refuses -1ms past the deadline. Independent
 * review is enforced for approve/reject decisions.
 */

const MIN_REQUEST: MemberRole = 'operator';
const MAX_GRANT_TTL_MS = 24 * 60 * 60 * 1000;

export interface C2GrantView {
  readonly id: string;
  readonly engagementId: string;
  readonly sessionId: string;
  readonly actorId: string;
  readonly reviewerId: string | null;
  readonly status: 'requested' | 'approved' | 'rejected' | 'revoked' | 'expired';
  readonly reason: string;
  readonly commandPrefix: string | null;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface C2GrantsView {
  readonly engagementId: string;
  readonly grants: C2GrantView[];
  readonly maxGrantHours: 24;
  readonly source: 'db';
}

export class C2GrantsService {
  public constructor(private readonly db: PrismaClient) {}

  private ctx(actorId: string): ActorContext {
    return { db: this.db, actorId, multiUser: true };
  }

  public async list(actorId: string, engagementId: string): Promise<C2GrantsView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    await this.sweep(engagementId);
    const rows = await this.db.c2Grant.findMany({ where: { engagementId }, orderBy: { createdAt: 'desc' } });
    return { engagementId, grants: rows.map((r) => this.toView(r)), maxGrantHours: 24, source: 'db' };
  }

  public async request(actorId: string, engagementId: string, input: unknown): Promise<C2GrantView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_REQUEST);
    const body = (input ?? {}) as { sessionId?: unknown; reason?: unknown; expiresAt?: unknown; commandPrefix?: unknown };
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (sessionId.length === 0) throw new ProjectApiError(400, 'sessionId is required.');
    if (reason.length === 0) throw new ProjectApiError(400, 'reason is required.');
    const expiresAt = typeof body.expiresAt === 'string' ? Date.parse(body.expiresAt) : Number.NaN;
    if (Number.isNaN(expiresAt)) throw new ProjectApiError(400, 'expiresAt (ISO-8601) is required.');
    if (expiresAt <= Date.now()) throw new ProjectApiError(400, 'expiresAt must be in the future.');
    if (expiresAt > Date.now() + MAX_GRANT_TTL_MS) throw new ProjectApiError(400, 'expiresAt may not exceed 24 hours.');
    const open = await this.db.c2Grant.findFirst({ where: { engagementId, sessionId, actorId, status: 'requested' } });
    if (open !== null) throw new ProjectApiError(409, 'An identical grant request is already pending review.');
    const row = await this.db.c2Grant.create({
      data: {
        engagementId,
        sessionId,
        actorId,
        status: 'requested',
        reason,
        commandPrefix: typeof body.commandPrefix === 'string' ? body.commandPrefix : null,
        expiresAt: new Date(expiresAt),
      },
    });
    await this.audit(engagementId, actorId, 'c2.grant_requested', 'c2_grant', row.id, `${sessionId} until ${new Date(expiresAt).toISOString()}`);
    return this.toView(row);
  }

  public async decide(actorId: string, engagementId: string, grantId: string, input: unknown): Promise<C2GrantView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'reviewer');
    const body = (input ?? {}) as { decision?: unknown };
    const decision = typeof body.decision === 'string' ? body.decision : '';
    if (decision !== 'approved' && decision !== 'rejected' && decision !== 'revoked') {
      throw new ProjectApiError(400, "decision must be 'approved', 'rejected' or 'revoked'.");
    }
    const row = await this.findOwned(engagementId, grantId);
    if (decision === 'approved' || decision === 'rejected') {
      if (row.status !== 'requested') throw new ProjectApiError(409, `Grant is already ${row.status}.`);
      requireIndependentActor(row.actorId, actorId, 'The C2 grant decision');
    } else if (row.status !== 'approved') {
      throw new ProjectApiError(409, `Only approved grants can be revoked; this grant is ${row.status}.`);
    }
    const updated = await this.db.c2Grant.update({ where: { id: row.id }, data: { status: decision, reviewerId: actorId } });
    await this.audit(engagementId, actorId, `c2.grant_${decision}`, 'c2_grant', row.id, `session ${row.sessionId}`);
    return this.toView(updated);
  }

  /** The command gate wired into C2Service.dispatchCommand. */
  public async assertCommandAuthorized(engagementId: string, sessionId: string, actorId: string): Promise<void> {
    await this.sweep(engagementId);
    const grant = await this.db.c2Grant.findFirst({
      where: { engagementId, sessionId, actorId, status: 'approved' },
      orderBy: { expiresAt: 'desc' },
    });
    if (grant === null) {
      throw new ProjectApiError(403, 'No approved grant covers this session for your account; request access first.');
    }
    // Absolute deadline check at the command site — including the in-flight
    // completion case below, new dispatch locks at expiry with no grace.
    if (Date.now() >= grant.expiresAt.getTime()) {
      await this.db.c2Grant.updateMany({ where: { id: grant.id, status: 'approved' }, data: { status: 'expired' } });
      throw new ProjectApiError(403, `The grant for session ${sessionId} expired at ${grant.expiresAt.toISOString()}; request a renewal.`);
    }
  }

  /** Server-owned cleanup; runs without a console mounted. */
  private async sweep(engagementId: string): Promise<void> {
    await this.db.c2Grant.updateMany({
      where: { engagementId, status: 'approved', expiresAt: { lte: new Date() } },
      data: { status: 'expired' },
    });
  }

  private async findOwned(engagementId: string, grantId: string): Promise<C2Grant> {
    const row = await this.db.c2Grant.findFirst({ where: { id: grantId, engagementId } });
    if (row === null) throw new ProjectApiError(404, 'Grant not found');
    return row;
  }

  private toView(row: C2Grant): C2GrantView {
    return {
      id: row.id,
      engagementId: row.engagementId,
      sessionId: row.sessionId,
      actorId: row.actorId,
      reviewerId: row.reviewerId,
      status: row.status as C2GrantView['status'],
      reason: row.reason,
      commandPrefix: row.commandPrefix,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async audit(engagementId: string, actorId: string, action: string, targetType: string, targetId: string, reason: string): Promise<void> {
    await this.db.webAuditEntry.create({ data: { engagementId, actorId, action, targetType, targetId, reason } });
  }
}
