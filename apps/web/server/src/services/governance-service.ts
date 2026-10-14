import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectApiError } from './projects-service.js';
import { createNotice } from './inbox-service.js';
import type { ScopeService } from './scope-service.js';
import { assertNotExpired, requireEngagementAccess, requireIndependentActor, type ActorContext, type MemberRole } from '../auth/membership-policy.js';
import { assertEngagementOpen } from './closure-service.js';

/**
 * Ticket 09: governed business plans, operation bindings, preflight and
 * emergency stops. OPPLAN documents (planning artifacts) and tool HITL
 * decisions stay distinct from the persisted business plan approval recorded
 * here. Approvals pin plan version + approved scope revision and carry an
 * absolute 24-hour deadline enforced at every bind/start site; a scope
 * revision supersedes the pinned version, so bound operations refuse to start
 * until a fresh approval exists. Emergency stops record truthful outcomes
 * (requested/acknowledged/stopped/failed/unknown) and never auto-resume.
 */

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_DECIDE: MemberRole = 'reviewer';

export interface PlanView {
  readonly id: string;
  readonly engagementId: string;
  readonly version: number;
  readonly status: 'draft' | 'proposed' | 'approved' | 'rejected' | 'superseded';
  readonly objective: string;
  readonly methods: readonly string[];
  readonly requestedBy: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decisionComment: string | null;
  /** Absolute approval deadline (decidedAt + 24h); null until approved. */
  readonly expiresAt: string | null;
  readonly roeVersion: number | null;
  readonly createdAt: string;
}

export interface PlansView {
  readonly engagementId: string;
  readonly plans: PlanView[];
  readonly latestApprovedScopeVersion: number | null;
  readonly deadlineHours: 24;
  readonly source: 'db';
}

export interface PreflightCheck {
  readonly id: string;
  readonly state: 'pass' | 'fail' | 'unavailable';
  readonly detail: string | null;
}

export interface PreflightView {
  readonly engagementId: string;
  readonly ok: boolean;
  readonly checks: readonly PreflightCheck[];
  readonly source: 'db';
}

export interface BindingView {
  readonly id: string;
  readonly engagementId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly threadId: string | null;
  readonly status: 'bound' | 'running' | 'stopped' | 'completed';
  readonly concurrencyVersion: number;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface EmergencyStopView {
  readonly id: string;
  readonly engagementId: string;
  readonly scope: 'operation' | 'project' | 'workspace';
  readonly targetId: string | null;
  readonly requestedBy: string;
  readonly outcome: 'requested' | 'acknowledged' | 'stopped' | 'failed' | 'unknown';
  readonly reason: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function toPlanView(row: {
  id: string; engagementId: string; version: number; status: string; body: unknown;
  requestedBy: string; decidedBy: string | null; decidedAt: Date | null; decisionComment: string | null; expiresAt: Date | null; roeVersion: number | null; createdAt: Date;
}): PlanView {
  const body = row.body as { objective?: unknown; methods?: unknown };
  return {
    id: row.id,
    engagementId: row.engagementId,
    version: row.version,
    status: row.status as PlanView['status'],
    objective: typeof body.objective === 'string' ? body.objective : '',
    methods: Array.isArray(body.methods) ? body.methods.filter((m): m is string => typeof m === 'string') : [],
    requestedBy: row.requestedBy,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionComment: row.decisionComment,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    roeVersion: row.roeVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

export class GovernanceService {
  public constructor(private readonly db: PrismaClient, private readonly scope: ScopeService) {}

  private ctx(actorId: string): ActorContext {
    return { db: this.db, actorId, multiUser: true };
  }

  public async plans(actorId: string, engagementId: string): Promise<PlansView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const rows = await this.db.businessPlan.findMany({ where: { engagementId }, orderBy: { version: 'desc' } });
    const approved = await this.scope.latestApproved(engagementId);
    return {
      engagementId,
      plans: rows.map(toPlanView),
      latestApprovedScopeVersion: approved?.version ?? null,
      deadlineHours: 24,
      source: 'db',
    };
  }

  public async savePlan(actorId: string, engagementId: string, input: unknown): Promise<PlanView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'operator');
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { objective?: unknown; methods?: unknown };
    const objective = typeof body.objective === 'string' ? body.objective.trim() : '';
    const methods = Array.isArray(body.methods) ? body.methods.filter((m): m is string => typeof m === 'string') : [];
    if (objective.length === 0) throw new ProjectApiError(400, 'objective is required.');
    const last = await this.db.businessPlan.findFirst({ where: { engagementId }, orderBy: { version: 'desc' } });
    const created = await this.db.businessPlan.create({
      data: {
        engagementId,
        version: (last?.version ?? 0) + 1,
        status: 'draft',
        body: { objective, methods } as object,
        requestedBy: actorId,
      },
    });
    await this.audit(engagementId, actorId, 'plan.drafted', 'business_plan', created.id, `v${created.version}`);
    return toPlanView(created as never);
  }

  public async proposePlan(actorId: string, engagementId: string, planId: string): Promise<PlanView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'operator');
    await assertEngagementOpen(this.db, engagementId);
    const plan = await this.findPlan(engagementId, planId);
    if (plan.status !== 'draft') throw new ProjectApiError(409, `Plan v${plan.version} is already ${plan.status}.`);
    const approved = await this.scope.latestApproved(engagementId);
    if (approved === null) throw new ProjectApiError(409, 'Proposing a plan requires an approved scope revision (ROE) to pin.');
    const updated = await this.db.businessPlan.update({ where: { id: plan.id }, data: { status: 'proposed', roeVersion: approved.version } });
    await this.audit(engagementId, actorId, 'plan.proposed', 'business_plan', plan.id, `v${plan.version} pinned ROE v${approved.version}`);
    return toPlanView(updated as never);
  }

  public async decidePlan(actorId: string, engagementId: string, planId: string, input: unknown): Promise<PlanView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_DECIDE);
    const body = (input ?? {}) as { decision?: unknown; comment?: unknown };
    const decision = typeof body.decision === 'string' ? body.decision : '';
    if (decision !== 'approved' && decision !== 'rejected') throw new ProjectApiError(400, "decision must be 'approved' or 'rejected'.");
    const plan = await this.findPlan(engagementId, planId);
    if (plan.status !== 'proposed') throw new ProjectApiError(409, `Plan v${plan.version} is ${plan.status}, not proposed.`);
    requireIndependentActor(plan.requestedBy, actorId, 'The plan decision');
    const decidedAt = new Date();
    // Supersede all other approved plans of this engagement: one authoritative plan at a time.
    await this.db.businessPlan.updateMany({ where: { engagementId, status: 'approved' }, data: { status: 'superseded' } });
    const updated = await this.db.businessPlan.update({
      where: { id: plan.id },
      data: {
        status: decision,
        decidedBy: actorId,
        decidedAt,
        decisionComment: typeof body.comment === 'string' ? body.comment : null,
        expiresAt: decision === 'approved' ? new Date(decidedAt.getTime() + APPROVAL_TTL_MS) : null,
      },
    });
    await this.audit(engagementId, actorId, `plan.${decision}`, 'business_plan', plan.id, `v${plan.version} by ${actorId}`);
    const planBody = plan.body as { title?: unknown } | null;
    const planTitle = typeof planBody?.title === 'string' && planBody.title.length > 0 ? planBody.title : 'untitled';
    await createNotice(this.db, { engagementId, actorId: plan.requestedBy, kind: 'plan.decided', title: `Plan "${planTitle}" v${plan.version} was ${decision}`, detail: { planId: plan.id, decision, decidedBy: actorId } });
    return toPlanView(updated as never);
  }

  /** Preflight: the readiness checklist consumed by the operation wizard/start. */
  public async preflight(actorId: string, engagementId: string, threadId: string | null): Promise<PreflightView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'operator');
    const now = Date.now();
    const checks: PreflightCheck[] = [];

    const engagement = await this.db.engagement.findFirst({ where: { id: engagementId } });
    checks.push(engagement === null
      ? { id: 'project', state: 'fail', detail: 'Engagement not found.' }
      : engagement.handoffConfirmedAt !== null
        ? { id: 'project', state: 'pass', detail: null }
        : { id: 'project', state: 'fail', detail: 'Planning handoff is not confirmed yet.' });

    const roe = await this.scope.roeWindowAllows(engagementId, now);
    checks.push(roe.ok ? { id: 'roe', state: 'pass', detail: `Approved scope revision v${roe.version}.` } : { id: 'roe', state: 'fail', detail: roe.reason });

    const inScope = await this.db.webAsset.count({ where: { engagementId, classification: 'in_scope' } });
    const engagement2 = await this.db.engagement.findFirst({ where: { id: engagementId }, select: { targetValue: true } });
    checks.push(inScope > 0 || engagement2 !== null
      ? { id: 'targets', state: 'pass', detail: `${inScope} inventoried target(s) in scope.` }
      : { id: 'targets', state: 'fail', detail: 'No target is in scope.' });

    const contact = await this.db.scopeRevision.findFirst({ where: { engagementId, status: 'approved' }, orderBy: { version: 'desc' } });
    const contacts = (contact?.roe as { emergencyContacts?: unknown } | null)?.emergencyContacts;
    checks.push(Array.isArray(contacts) && contacts.length > 0
      ? { id: 'contact', state: 'pass', detail: null }
      : { id: 'contact', state: 'fail', detail: 'The approved ROE revision carries no emergency contact.' });

    const activeEstop = await this.db.emergencyStop.findFirst({
      where: { engagementId, outcome: { in: ['requested', 'acknowledged'] }, ...(threadId !== null ? { OR: [{ targetId: threadId }, { scope: { in: ['project', 'workspace'] } }] } : {}) },
    });
    checks.push(activeEstop === null ? { id: 'estop', state: 'pass', detail: null } : { id: 'estop', state: 'fail', detail: 'An emergency stop is active; work cannot start until it is resolved.' });

    return { engagementId, ok: checks.every((c) => c.state === 'pass'), checks, source: 'db' };
  }

  /** Binds an approved plan to an execution thread; the deadline and scope-pin gates run here. */
  public async bindPlan(actorId: string, engagementId: string, planId: string, threadId: string | null): Promise<BindingView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'operator');
    await assertEngagementOpen(this.db, engagementId);
    const pre = await this.preflight(actorId, engagementId, threadId);
    if (!pre.ok) {
      const failed = pre.checks.filter((c) => c.state === 'fail').map((c) => `${c.id}: ${c.detail ?? 'failed'}`).join('; ');
      throw new ProjectApiError(409, `Preflight refuses the binding — ${failed}`);
    }
    const plan = await this.findPlan(engagementId, planId);
    if (plan.status !== 'approved') throw new ProjectApiError(409, `Plan v${plan.version} is ${plan.status}; an approved plan is required.`);
    assertNotExpired(plan.expiresAt, Date.now(), `Plan v${plan.version} approval`);
    const approved = await this.scope.latestApproved(engagementId);
    if (plan.roeVersion === null || approved === null || plan.roeVersion !== approved.version) {
      throw new ProjectApiError(409, `Plan v${plan.version} pins scope v${plan.roeVersion ?? 'none'} but the authoritative approved scope is v${approved?.version ?? 'none'}; re-review required.`);
    }
    const binding = await this.db.operationBinding.create({
      data: { engagementId, planId: plan.id, threadId, status: 'bound', createdBy: actorId },
    });
    await this.audit(engagementId, actorId, 'operation.bound', 'operation_binding', binding.id, `plan v${plan.version} ROE v${plan.roeVersion}`);
    return this.toBindingView(binding as never, plan.version);
  }

  /** Emergency stop at operation/project/workspace scope with truthful runtime outcome. */
  public async emergencyStop(actorId: string, engagementId: string, input: unknown, cancelRun?: (threadId: string, runId: string | null) => Promise<string>): Promise<EmergencyStopView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'operator');
    const body = (input ?? {}) as { scope?: unknown; targetId?: unknown; reason?: unknown; threadId?: unknown; runId?: unknown };
    const scope = typeof body.scope === 'string' && ['operation', 'project', 'workspace'].includes(body.scope) ? body.scope : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (scope.length === 0) throw new ProjectApiError(400, "scope must be 'operation', 'project' or 'workspace'.");
    if (reason.length === 0) throw new ProjectApiError(400, 'reason is required.');
    let outcome: EmergencyStopView['outcome'] = 'requested';
    let detail = '';
    if (cancelRun !== undefined && typeof body.threadId === 'string' && body.threadId.length > 0) {
      try {
        const reported = await cancelRun(body.threadId, typeof body.runId === 'string' ? body.runId : null);
        outcome = reported === 'stopped' ? 'stopped' : 'acknowledged';
        detail = ` (${reported})`;
      } catch (err) {
        outcome = 'unknown';
        detail = ` (${err instanceof Error ? err.message : 'the runtime did not report a terminal outcome'})`;
      }
    }
    const row = await this.db.emergencyStop.create({
      data: {
        engagementId,
        scope,
        targetId: typeof body.targetId === 'string' ? body.targetId : (typeof body.threadId === 'string' ? body.threadId : null),
        requestedBy: actorId,
        outcome,
        reason,
      },
    });
    await this.audit(engagementId, actorId, 'estop.requested', 'emergency_stop', row.id, `${scope}: ${reason} -> ${outcome}${detail}`);
    return this.toEstopView(row as never);
  }

  public async emergencyStops(actorId: string, engagementId: string): Promise<{ engagementId: string; stops: EmergencyStopView[]; source: 'db' }> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const rows = await this.db.emergencyStop.findMany({ where: { engagementId }, orderBy: { createdAt: 'desc' } });
    return { engagementId, stops: rows.map((r) => this.toEstopView(r as never)), source: 'db' };
  }

  /** Refuses lifecycle mutations while an emergency stop is still active. */
  public async assertNoActiveStop(engagementId: string, threadId: string | null): Promise<void> {
    const active = await this.db.emergencyStop.findFirst({
      where: { engagementId, outcome: { in: ['requested', 'acknowledged'] }, ...(threadId !== null ? { OR: [{ targetId: threadId }, { scope: { in: ['project', 'workspace'] } }] } : {}) },
    });
    if (active !== null) {
      throw new ProjectApiError(409, `An emergency stop (${active.scope}) is active; work never auto-resumes and needs explicit resolution first.`);
    }
  }

  private toBindingView(row: { id: string; engagementId: string; planId: string; threadId: string | null; status: string; concurrencyVersion: number; createdBy: string; createdAt: Date }, planVersion: number): BindingView {
    return {
      id: row.id,
      engagementId: row.engagementId,
      planId: row.planId,
      planVersion,
      threadId: row.threadId,
      status: row.status as BindingView['status'],
      concurrencyVersion: row.concurrencyVersion,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toEstopView(row: { id: string; engagementId: string; scope: string; targetId: string | null; requestedBy: string; outcome: string; reason: string; createdAt: Date; updatedAt: Date }): EmergencyStopView {
    return {
      id: row.id,
      engagementId: row.engagementId,
      scope: row.scope as EmergencyStopView['scope'],
      targetId: row.targetId,
      requestedBy: row.requestedBy,
      outcome: row.outcome as EmergencyStopView['outcome'],
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async findPlan(engagementId: string, planId: string) {
    const plan = await this.db.businessPlan.findFirst({ where: { id: planId, engagementId } });
    if (plan === null) throw new ProjectApiError(404, 'Plan not found');
    return plan;
  }

  private async audit(engagementId: string, actorId: string, action: string, targetType: string, targetId: string, reason: string): Promise<void> {
    await this.db.webAuditEntry.create({ data: { engagementId, actorId, action, targetType, targetId, reason } });
  }
}
