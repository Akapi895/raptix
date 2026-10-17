import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectApiError } from './projects-service.js';
import { assertEngagementOpen } from './closure-service.js';
import { assertNotExpired, requireEngagementAccess, type ActorContext } from '../auth/membership-policy.js';
import type { ScopeService } from './scope-service.js';
import { isKnownTimeZone, OFFSET_SUFFIX } from './scope-service.js';

/**
 * W11 (ADR-0073): an operation schedule is a durable execution intent tied to
 * an existing engagement, owned execution thread and approved plan. It never
 * creates a second business-operation authority: at due time the same
 * execution gate (binding, plan TTL, scope pin, stop, closure, preflight)
 * runs before any dispatch, and a lost dispatch acknowledgement stays
 * `uncertain` instead of re-dispatching.
 */

export type ScheduleStatus = 'scheduled' | 'claimed' | 'dispatched' | 'refused' | 'canceled' | 'missed' | 'uncertain';

export interface ScheduleView {
  readonly id: string;
  readonly engagementId: string;
  readonly planId: string;
  readonly threadId: string;
  readonly requestId: string;
  readonly status: ScheduleStatus;
  readonly version: number;
  readonly executeAt: string;
  readonly timezone: string;
  readonly reason: string;
  readonly runId: string | null;
  readonly outcomeDetail: string | null;
  readonly claimedBy: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScheduleDeps {
  /** The same gate a manual start runs: binding, plan TTL, scope pin, stop, closure, preflight. */
  readonly authorize?: (actorId: string, engagementId: string, threadId: string) => Promise<void>;
  /** Dispatches through the runtime ledger; resolves with the runId when acknowledged. */
  readonly dispatch?: (actorId: string, engagementId: string, threadId: string, requestId: string, reason: string) => Promise<string | null>;
}

export interface ClaimOutcome {
  readonly claimed: {
    readonly id: string;
    readonly engagementId: string;
    readonly threadId: string;
    readonly requestId: string;
    readonly reason: string;
    readonly createdBy: string;
    claimedBy: string | null;
    status: ScheduleStatus;
  }[];
  readonly missed: number;
}

/** A due intent may wait this long for a worker before it counts as missed. */
const CLAIM_GRACE_MS = 5 * 60 * 1000;

type ScheduleRow = {
  id: string; engagementId: string; planId: string; threadId: string; requestId: string;
  status: string; version: number; executeAt: Date; timezone: string; reason: string;
  runId: string | null; outcomeDetail: string | null; claimedBy: string | null;
  createdAt: Date; updatedAt: Date;
};

function toView(row: Record<string, unknown>): ScheduleView {
  return {
    id: String(row.id),
    engagementId: String(row.engagementId),
    planId: String(row.planId),
    threadId: String(row.threadId),
    requestId: String(row.requestId),
    status: row.status as ScheduleStatus,
    version: Number(row.version),
    executeAt: (row.executeAt as Date).toISOString(),
    timezone: String(row.timezone),
    reason: String(row.reason),
    runId: (row.runId as string | null) ?? null,
    outcomeDetail: (row.outcomeDetail as string | null) ?? null,
    claimedBy: (row.claimedBy as string | null) ?? null,
    createdBy: String(row.createdBy),
    createdAt: (row.createdAt as Date).toISOString(),
    updatedAt: (row.updatedAt as Date).toISOString(),
  };
}

function assertAbsoluteFutureInstant(value: unknown, now: number): { executeAt: Date } {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!OFFSET_SUFFIX.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new ProjectApiError(400, 'executeAt must be an absolute ISO-8601 timestamp with a Z or ±HH:MM offset.');
  }
  const executeAt = new Date(raw);
  if (executeAt.getTime() <= now) throw new ProjectApiError(400, 'executeAt must be in the future.');
  return { executeAt };
}

function assertZone(tz: unknown): string {
  const zone = typeof tz === 'string' && tz.trim().length > 0 ? tz.trim() : 'UTC';
  if (!isKnownTimeZone(zone)) throw new ProjectApiError(400, `Unknown timezone: ${zone}.`);
  return zone;
}

export class ScheduleService {
  public constructor(private readonly db: PrismaClient, private readonly deps: ScheduleDeps = {},
    private readonly scope: ScopeService | null = null) {}

  private ctx(actorId: string): ActorContext {
    return { db: this.db, actorId, multiUser: true };
  }

  public async create(actorId: string, engagementId: string, input: unknown): Promise<ScheduleView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'operator');
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { planId?: unknown; threadId?: unknown; executeAt?: unknown; timezone?: unknown; reason?: unknown; requestId?: unknown };
    const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
    if (requestId.length === 0) throw new ProjectApiError(400, 'requestId is required: it is the durable identity used for reconcile after a restart.');
    const existing = await this.db.operationSchedule.findFirst({ where: { requestId } });
    if (existing !== null) {
      if (existing.engagementId !== engagementId) throw new ProjectApiError(409, 'This requestId already belongs to another engagement.');
      return toView(existing as never);
    }
    const thread = await this.db.engagementThread.findFirst({ where: { threadId: typeof body.threadId === 'string' ? body.threadId : '', engagementId } });
    if (thread === null) throw new ProjectApiError(404, 'Thread not found in this engagement.');
    if (thread.kind !== 'execution') throw new ProjectApiError(400, 'Only execution threads can carry a scheduled start; planning threads produce plan drafts instead.');
    const plan = await this.db.businessPlan.findFirst({ where: { id: typeof body.planId === 'string' ? body.planId : '', engagementId } });
    if (plan === null) throw new ProjectApiError(404, 'Plan not found in this engagement.');
    if (plan.status !== 'approved' || plan.expiresAt === null) throw new ProjectApiError(409, `Plan v${plan.version} is ${plan.status}; an approved plan with an expiry deadline is required.`);
    assertNotExpired(plan.expiresAt, Date.now(), `Plan v${plan.version} approval`);
    const approved = this.scope === null ? null : await this.scope.latestApproved(engagementId);
    if (this.scope !== null && (plan.roeVersion === null || approved === null || plan.roeVersion !== approved.version)) {
      throw new ProjectApiError(409, `Plan v${plan.version} pins scope v${plan.roeVersion ?? 'none'} but the authoritative approved scope is v${approved?.version ?? 'none'}; re-review required.`);
    }
    const { executeAt } = assertAbsoluteFutureInstant(body.executeAt, Date.now());
    const timezone = assertZone(body.timezone);
    const reason = typeof body.reason === 'string' && body.reason.trim().length > 0 ? body.reason.trim() : '';
    if (reason.length === 0) throw new ProjectApiError(400, 'reason is required.');
    const created = await this.db.operationSchedule.create({
      data: {
        engagementId, planId: plan.id, threadId: thread.threadId, requestId, status: 'scheduled', version: 1,
        executeAt, timezone, reason, createdBy: actorId,
      },
    });
    await this.audit(engagementId, actorId, 'schedule.created', 'operation_schedule', created.id, `plan v${plan.version} at ${executeAt.toISOString()} (${timezone})`);
    return toView(created as never);
  }

  /** ADR-0073: a cancel applies to the version the caller read; a reschedule or dispatch since then refuses it. */
  public async cancel(actorId: string, engagementId: string, scheduleId: string, input: unknown = {}): Promise<ScheduleView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'operator');
    const body = (input ?? {}) as { expectedVersion?: unknown };
    const row = await this.find(engagementId, scheduleId);
    if (row.status !== 'scheduled') throw new ProjectApiError(409, `The schedule is ${row.status} and can no longer be canceled.`);
    if (typeof body.expectedVersion !== 'number' || body.expectedVersion !== row.version) {
      throw new ProjectApiError(409, `The schedule changed since you read it (now v${row.version}); re-read it and cancel again.`);
    }
    const updated = await this.db.operationSchedule.updateMany({ where: { id: row.id, status: 'scheduled', version: row.version }, data: { status: 'canceled', version: { increment: 1 } } });
    if (updated.count !== 1) throw new ProjectApiError(409, 'The schedule changed since you read it; re-read it and cancel again.');
    await this.audit(engagementId, actorId, 'schedule.canceled', 'operation_schedule', row.id, row.reason);
    return toView({ ...row, status: 'canceled' });
  }

  public async reschedule(actorId: string, engagementId: string, scheduleId: string, input: unknown): Promise<ScheduleView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'operator');
    const body = (input ?? {}) as { executeAt?: unknown; timezone?: unknown; expectedVersion?: unknown };
    const row = await this.find(engagementId, scheduleId);
    if (row.status !== 'scheduled') throw new ProjectApiError(409, `The schedule is ${row.status}; only scheduled intents can be rescheduled.`);
    if (typeof body.expectedVersion !== 'number' || body.expectedVersion !== row.version) {
      throw new ProjectApiError(409, `The schedule changed since you read it (now v${row.version}); re-read it and reschedule again.`);
    }
    const { executeAt } = assertAbsoluteFutureInstant(body.executeAt, Date.now());
    const timezone = assertZone(body.timezone);
    const updated = await this.db.operationSchedule.updateMany({
      where: { id: row.id, status: 'scheduled', version: row.version },
      data: { executeAt, timezone, version: { increment: 1 } },
    });
    // W11: the version this caller read must still be current — a concurrent
    // cancel/dispatch/further edit must not be silently overwritten.
    if (updated.count !== 1) throw new ProjectApiError(409, 'The schedule changed since you read it; re-read it and reschedule again.');
    const reread = await this.find(engagementId, scheduleId);
    await this.audit(engagementId, actorId, 'schedule.rescheduled', 'operation_schedule', row.id, `v${reread.version} at ${executeAt.toISOString()} (${timezone})`);
    return toView(reread as never);
  }

  public async list(actorId: string, engagementId: string): Promise<{ engagementId: string; schedules: ScheduleView[]; source: 'db' }> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const rows = await this.db.operationSchedule.findMany({ where: { engagementId } });
    const schedules = rows.map((r) => toView(r as never)).sort((a, b) => a.executeAt.localeCompare(b.executeAt));
    return { engagementId, schedules, source: 'db' };
  }

  /**
   * Atomically claims every due intent for one worker: the conditional
   * update means exactly one worker wins an intent, and intents whose window
   * passed the grace period become `missed` instead of dispatching late.
   */
  public async claimDue(workerId: string, now = Date.now()): Promise<ClaimOutcome> {
    const missed = await this.db.operationSchedule.updateMany({
      where: { status: 'scheduled', executeAt: { lt: new Date(now - CLAIM_GRACE_MS) } },
      data: { status: 'missed', outcomeDetail: 'The scheduled start window passed without a worker claim.' },
    });
    const due = await this.db.operationSchedule.findMany({ where: { status: 'scheduled', executeAt: { lte: new Date(now) } } });
    const claimed: ClaimOutcome['claimed'] = [];
    for (const row of due) {
      // W11: claim only the version that is still due at the moment of the
      // update — a reschedule committed after this worker read the row moves
      // executeAt into the future and the conditional update loses.
      const won = await this.db.operationSchedule.updateMany({
        where: { id: row.id, status: 'scheduled', version: row.version, executeAt: { lte: new Date(now) } },
        data: { status: 'claimed', claimedBy: workerId, claimedAt: new Date() },
      });
      if (won.count === 1) {
        claimed.push({
          id: row.id, engagementId: row.engagementId, threadId: row.threadId, requestId: row.requestId,
          reason: row.reason, createdBy: row.createdBy, claimedBy: workerId, status: 'claimed',
        });
      }
    }
    return { claimed, missed: missed.count };
  }

  /** Runs one claimed intent through the real execution gate, then dispatches. */
  public async runClaimed(intent: ClaimOutcome['claimed'][number]): Promise<void> {
    if (this.deps.authorize === undefined || this.deps.dispatch === undefined) {
      await this.db.operationSchedule.updateMany({ where: { id: intent.id, status: 'claimed' }, data: { status: 'refused', outcomeDetail: 'No execution gate is configured in this deployment.' } });
      return;
    }
    try {
      await this.deps.authorize(intent.createdBy, intent.engagementId, intent.threadId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The execution gate refused the scheduled start.';
      await this.db.operationSchedule.updateMany({ where: { id: intent.id, status: 'claimed' }, data: { status: 'refused', outcomeDetail: detail } });
      return;
    }
    try {
      const runId = await this.deps.dispatch(intent.createdBy, intent.engagementId, intent.threadId, intent.requestId, intent.reason);
      await this.db.operationSchedule.updateMany({
        where: { id: intent.id, status: 'claimed' },
        data: { status: 'dispatched', runId: runId ?? null, dispatchedAt: new Date(), outcomeDetail: null },
      });
    } catch (error) {
      // Truthful: the acknowledgement may or may not have reached the runtime.
      const detail = error instanceof Error ? error.message : 'The runtime did not acknowledge the dispatch.';
      await this.db.operationSchedule.updateMany({ where: { id: intent.id, status: 'claimed' }, data: { status: 'uncertain', outcomeDetail: detail } });
    }
  }

  /** Restart recovery: a claim that outlived its worker becomes uncertain, never silently re-dispatched. */
  public async recoverStaleClaims(maxAgeMs: number, now = Date.now()): Promise<number> {
    const stale = await this.db.operationSchedule.findMany({ where: { status: 'claimed' } });
    let count = 0;
    for (const row of stale) {
      const claimedAt = row.claimedAt instanceof Date ? row.claimedAt.getTime() : 0;
      if (now - claimedAt > maxAgeMs) {
        const won = await this.db.operationSchedule.updateMany({
          where: { id: row.id, status: 'claimed' },
          data: { status: 'uncertain', outcomeDetail: 'The worker restarted while this intent was claimed; reconcile before any re-dispatch.' },
        });
        count += won.count;
      }
    }
    return count;
  }

  private async find(engagementId: string, scheduleId: string): Promise<ScheduleRow> {
    const row = await this.db.operationSchedule.findFirst({ where: { id: scheduleId, engagementId } });
    if (row === null) throw new ProjectApiError(404, 'Schedule not found');
    return row as never;
  }

  private async audit(engagementId: string, actorId: string, action: string, targetType: string, targetId: string, reason: string): Promise<void> {
    await this.db.webAuditEntry.create({ data: { engagementId, actorId, action, targetType, targetId, reason } });
  }
}
