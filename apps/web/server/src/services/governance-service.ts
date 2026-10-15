import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectApiError } from './projects-service.js';
import { createNotice } from './inbox-service.js';
import type { ScopeService } from './scope-service.js';
import { assertNotExpired, requireEngagementAccess, requireIndependentActor, type ActorContext, type MemberRole } from '../auth/membership-policy.js';
import { assertEngagementOpen } from './closure-service.js';
import { ACTIVE_STOP_OUTCOMES } from './engagement-stop-policy.js';

export { ACTIVE_STOP_OUTCOMES };

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
  readonly outcome: 'requested' | 'acknowledged' | 'stopped' | 'failed' | 'unknown' | 'resolved';
  readonly reason: string;
  readonly concurrencyVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** W10/ADR-0074: sibling latches a workspace stop recorded in other owned engagements. */
  readonly related?: EmergencyStopView[];
  /** W10/ADR-0074: owned engagements the workspace stop could not observe or latch. */
  readonly relatedFailures?: { readonly engagementId: string; readonly reason: string }[];
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

/** W08: runtime readiness always receives the exact actor/engagement/thread selection it evaluates. */
export interface ReadinessInput {
  readonly actorId: string;
  readonly engagementId: string;
  readonly threadId: string | null;
}

export class GovernanceService {
  public constructor(private readonly db: PrismaClient, private readonly scope: ScopeService,
    private readonly options?: { readiness?: (input: ReadinessInput) => Promise<PreflightCheck[]> }) {}

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

  /** Revalidate the binding on every execution submit/resume, not only at bind time. */
  public async assertExecutionAuthorized(actorId: string, engagementId: string, threadId: string, requirePlan = true): Promise<void> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'operator');
    await assertEngagementOpen(this.db, engagementId);
    await this.assertNoActiveStop(engagementId, threadId);
    const plans = await this.db.businessPlan.findMany({ where: { engagementId } });
    // Local R06 supports the pre-governance handoff flow. Once a business plan
    // exists, local deployments are subject to exactly the same binding gates.
    if (!requirePlan && plans.length === 0) return;
    const bindings = await this.db.operationBinding.findMany({ where: { engagementId, threadId }, orderBy: { createdAt: 'desc' } });
    const binding = bindings.find((b) => b.threadId === threadId && ['bound', 'running'].includes(b.status));
    if (!binding) throw new ProjectApiError(409, 'Execution requires a current approved plan binding for this thread.');
    const plan = await this.findPlan(engagementId, binding.planId);
    if (plan.status !== 'approved' || plan.expiresAt === null) throw new ProjectApiError(409, 'The bound plan is not approved; re-review is required.');
    assertNotExpired(plan.expiresAt, Date.now(), 'Bound plan approval');
    const approved = await this.scope.latestApproved(engagementId);
    if (!approved || approved.version !== plan.roeVersion) throw new ProjectApiError(409, 'The bound ROE version is stale; re-review is required.');
    const preflight = await this.preflight(actorId, engagementId, threadId);
    if (!preflight.ok) throw new ProjectApiError(409, `Preflight refuses execution: ${preflight.checks.filter((c) => c.state !== 'pass').map((c) => `${c.id}: ${c.detail}`).join('; ')}`);
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
    const body = (input ?? {}) as { decision?: unknown; comment?: unknown; expectedVersion?: unknown };
    const decision = typeof body.decision === 'string' ? body.decision : '';
    if (decision !== 'approved' && decision !== 'rejected') throw new ProjectApiError(400, "decision must be 'approved' or 'rejected'.");
    const plan = await this.findPlan(engagementId, planId);
    // W09: compare-and-swap on the version the reviewer actually read.
    if (typeof body.expectedVersion === 'number' && body.expectedVersion !== plan.version) {
      throw new ProjectApiError(409, `Plan v${plan.version} does not match the reviewed version v${String(body.expectedVersion)}; re-read the plan and decide again.`);
    }
    if (plan.status !== 'proposed') throw new ProjectApiError(409, `Plan v${plan.version} is ${plan.status}, not proposed.`);
    requireIndependentActor(plan.requestedBy, actorId, 'The plan decision');
    const decidedAt = new Date();
    // W09: the decision write, the supersede and the audit entry share one
    // transaction boundary, and the supersede runs ONLY on approve — a
    // rejection must never destroy the currently approved version.
    const updated = await this.db.$transaction(async (tx) => {
      const client = tx as PrismaClient;
      if (decision === 'approved') {
        await client.businessPlan.updateMany({ where: { engagementId, status: 'approved' }, data: { status: 'superseded' } });
      }
      const row = await client.businessPlan.update({
        where: { id: plan.id },
        data: {
          status: decision,
          decidedBy: actorId,
          decidedAt,
          decisionComment: typeof body.comment === 'string' ? body.comment : null,
          expiresAt: decision === 'approved' ? new Date(decidedAt.getTime() + APPROVAL_TTL_MS) : null,
        },
      });
      await client.webAuditEntry.create({ data: { engagementId, actorId, action: `plan.${decision}`, targetType: 'business_plan', targetId: plan.id, reason: `v${plan.version} by ${actorId}` } });
      return row;
    });
    const planBody = plan.body as { title?: unknown } | null;
    const planTitle = typeof planBody?.title === 'string' && planBody.title.length > 0 ? planBody.title : 'untitled';
    await createNotice(this.db, { engagementId, actorId: plan.requestedBy, kind: 'plan.decided', title: `Plan "${planTitle}" v${plan.version} was ${decision}`, detail: { planId: plan.id, decision, decidedBy: actorId } });
    return toPlanView(updated as never);
  }

  /**
   * Revises an existing plan: the reviewed version stays untouched (its
   * approval keeps applying until superseded through the decision path) and a
   * NEW draft at the next version carries the proposed body for review.
   */
  public async revisePlan(actorId: string, engagementId: string, planId: string, input: unknown): Promise<PlanView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'operator');
    await assertEngagementOpen(this.db, engagementId);
    const base = await this.findPlan(engagementId, planId);
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
    await this.audit(engagementId, actorId, 'plan.revised', 'business_plan', created.id, `revision of ${base.id} v${base.version}`);
    return toPlanView(created as never);
  }

  /** Side-by-side comparison of two persisted plan versions (both engagement-owned). */
  public async comparePlans(actorId: string, engagementId: string, planId: string, baseId: string): Promise<{ base: PlanView; revision: PlanView; source: 'db' }> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    if (baseId.length === 0) throw new ProjectApiError(400, 'baseId (the reviewed plan version) is required.');
    const base = await this.findPlan(engagementId, baseId);
    const revision = await this.findPlan(engagementId, planId);
    return { base: toPlanView(base as never), revision: toPlanView(revision as never), source: 'db' };
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

    // W08: the target check must be truthful. An existing engagement record is
    // not a target; with zero inventoried assets only the engagement root
    // target (always in scope, W07) can justify a pass.
    const inScope = await this.db.webAsset.count({ where: { engagementId, classification: 'in_scope' } });
    checks.push(
      inScope > 0
        ? { id: 'targets', state: 'pass', detail: `${inScope} inventoried target(s) in scope.` }
        : engagement !== null && Boolean(engagement.targetValue)
          ? { id: 'targets', state: 'pass', detail: 'The engagement root target is in scope; no additional inventoried targets.' }
          : { id: 'targets', state: 'fail', detail: 'No target is in scope.' },
    );

    const contact = await this.db.scopeRevision.findFirst({ where: { engagementId, status: 'approved' }, orderBy: { version: 'desc' } });
    const contacts = (contact?.roe as { emergencyContacts?: unknown } | null)?.emergencyContacts;
    checks.push(Array.isArray(contacts) && contacts.length > 0
      ? { id: 'contact', state: 'pass', detail: null }
      : { id: 'contact', state: 'fail', detail: 'The approved ROE revision carries no emergency contact.' });

    // W08: The playbook selection ties the selected operation thread to the
    // OPPLAN objective its bound plan carries. Nothing is invented when no
    // thread is selected (the check reports unverifiable, not success), and
    // an unpinned thread does not block the next bind — the bind itself is
    // what pins the objective.
    if (threadId === null) {
      checks.push({ id: 'playbook', state: 'unavailable', detail: 'Select the operation thread to verify which plan objective it is pinned to.' });
    } else {
      const binding = await this.db.operationBinding.findFirst({ where: { engagementId, threadId } });
      const pinned = binding === null ? null : await this.db.businessPlan.findFirst({ where: { id: binding.planId, engagementId } });
      const objective = (pinned?.body as { objective?: unknown } | null)?.objective;
      if (pinned === null) {
        checks.push({ id: 'playbook', state: 'pass', detail: 'No plan pinned yet; the next bind pins its objective to this thread.' });
      } else {
        // W08: a pinned objective only passes when the pinned plan is actually
        // executable — execution rejects expired/stale/unapproved plans, so a
        // green preflight must not disagree with that gate.
        const approved = await this.scope.latestApproved(engagementId);
        const now = Date.now();
        const problems: string[] = [];
        if (pinned.status !== 'approved') problems.push(`plan v${pinned.version} is ${pinned.status}`);
        if (pinned.expiresAt === null) problems.push('it carries no expiry deadline');
        else if (pinned.expiresAt.getTime() <= now) problems.push(`its approval expired at ${pinned.expiresAt.toISOString()}`);
        if (pinned.roeVersion === null || approved === null || pinned.roeVersion !== approved.version) problems.push(`its scope pin v${pinned.roeVersion ?? 'none'} is not the approved v${approved?.version ?? 'none'}`);
        checks.push(problems.length === 0
          ? { id: 'playbook', state: 'pass', detail: `Pinned to plan objective: ${typeof objective === 'string' ? objective : `plan v${pinned.version}`}` }
          : { id: 'playbook', state: 'fail', detail: `The pinned plan is not executable: ${problems.join('; ')}.` });
      }
    }

    const activeEstop = await this.db.emergencyStop.findFirst({
      where: { engagementId, outcome: { in: [...ACTIVE_STOP_OUTCOMES] }, ...(threadId !== null ? { OR: [{ targetId: threadId }, { scope: { in: ['project', 'workspace'] } }] } : {}) },
    });
    checks.push(activeEstop === null ? { id: 'estop', state: 'pass', detail: null } : { id: 'estop', state: 'fail', detail: 'An emergency stop is active; work cannot start until it is resolved.' });

    if (this.options?.readiness !== undefined) {
      try {
        checks.push(...await this.options.readiness({ actorId, engagementId, threadId }));
      } catch (error) {
        checks.push({ id: 'runtime', state: 'unavailable', detail: error instanceof Error ? error.message : 'Runtime readiness did not report.' });
      }
    }

    return { engagementId, ok: checks.every((c) => c.state === 'pass'), checks, source: 'db' };
  }

  /** Binds an approved plan to an execution thread; the deadline and scope-pin gates run here. */
  public async bindPlan(actorId: string, engagementId: string, planId: string, threadId: string | null): Promise<BindingView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'operator');
    await assertEngagementOpen(this.db, engagementId);
    if (threadId === null) throw new ProjectApiError(400, 'An operation binding requires its owned execution threadId.');
    const thread = await this.db.engagementThread.findFirst({ where: { threadId, engagementId } });
    if (thread === null) throw new ProjectApiError(404, 'Thread not found in this engagement.');
    if (thread.kind !== 'execution') throw new ProjectApiError(400, 'Only execution threads can be bound to an operation; planning threads produce plan drafts instead.');
    const pre = await this.preflight(actorId, engagementId, threadId);
    if (!pre.ok) {
      // W08: the summary must account for every non-passing state, including
      // 'unavailable' — a missing dependency refuses the bind just like a fail.
      const failed = pre.checks.filter((c) => c.state !== 'pass').map((c) => `${c.id}: ${c.detail ?? c.state}`).join('; ');
      throw new ProjectApiError(409, `Preflight refuses the binding — ${failed}`);
    }
    const plan = await this.findPlan(engagementId, planId);
    if (plan.status !== 'approved') throw new ProjectApiError(409, `Plan v${plan.version} is ${plan.status}; an approved plan is required.`);
    // W08: bind enforces the same non-null approval deadline as execution.
    if (plan.expiresAt === null) throw new ProjectApiError(409, `Plan v${plan.version} is approved but carries no expiry deadline; re-review is required.`);
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

  /**
   * Emergency stop at operation/project/workspace scope with truthful runtime
   * outcome. W05 ordering: the durable latch (outcome 'requested') is
   * persisted inside a short key-1 emergency-fence transaction BEFORE the
   * runtime cancel side effect runs — a lost runtime ack still leaves the
   * closure blocker in place, and an in-flight mutation fence can never delay
   * or refuse the stop.
   */
  public async emergencyStop(actorId: string, engagementId: string, input: unknown, cancelRun?: (threadId: string, runId: string | null, actorId: string, engagementId: string) => Promise<string>, hasActiveRuns?: (actorId: string, engagementId: string) => Promise<boolean>): Promise<EmergencyStopView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'operator');
    const body = (input ?? {}) as { scope?: unknown; targetId?: unknown; reason?: unknown; threadId?: unknown; runId?: unknown };
    const scope = typeof body.scope === 'string' && ['operation', 'project', 'workspace'].includes(body.scope) ? body.scope : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (scope.length === 0) throw new ProjectApiError(400, "scope must be 'operation', 'project' or 'workspace'.");
    if (reason.length === 0) throw new ProjectApiError(400, 'reason is required.');
    // W10/ADR-0074: a workspace stop never borrows global authority from one
    // engagement — enumerate owned/operated engagements and latch each one
    // that is actually running work, instead of latching the whole workspace
    // from a single engagement record.
    if (scope === 'workspace') return this.workspaceStop(actorId, engagementId, reason, cancelRun, hasActiveRuns);
    if (scope === 'operation' && (typeof body.threadId !== 'string' || body.threadId.length === 0)) throw new ProjectApiError(400, 'An operation stop requires its owned threadId.');
    // W10: Validate the operation target BEFORE any latch or cancel runs: a
    // stop must identify an owned execution thread of this engagement.
    if (scope === 'operation') {
      const thread = await this.db.engagementThread.findFirst({ where: { threadId: body.threadId as string, engagementId } });
      if (thread === null) throw new ProjectApiError(404, 'Thread not found in this engagement.');
      if (thread.kind !== 'execution') throw new ProjectApiError(400, 'Only execution threads can be emergency-stopped; planning threads produce plan drafts instead.');
    }
    const row = await this.latchAndCancel({
      engagementId,
      scope,
      reason,
      requestedBy: actorId,
      targetId: typeof body.targetId === 'string' ? body.targetId : (typeof body.threadId === 'string' ? body.threadId : null),
      threadId: typeof body.threadId === 'string' ? body.threadId : '',
      runId: typeof body.runId === 'string' ? body.runId : null,
    }, cancelRun);
    return this.toEstopView(row as never);
  }

  /** Persists the stop latch first, then cancels and records the truthful outcome. */
  private async latchAndCancel(input: { engagementId: string; scope: string; reason: string; requestedBy: string; targetId: string | null; threadId: string; runId: string | null }, cancelRun?: (threadId: string, runId: string | null, actorId: string, engagementId: string) => Promise<string>): Promise<Record<string, unknown>> {
    const { engagementId, reason, requestedBy, threadId, runId } = input;
    const latch = await this.db.$transaction(async (tx) => {
      const [lock] = await (tx as PrismaClient).$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${engagementId}, 1)) AS locked`;
      if (!lock?.locked) throw new ProjectApiError(409, 'Another emergency stop or closure transition is in progress. Retry with the same request identity.');
      return await (tx as PrismaClient).emergencyStop.create({
        data: {
          engagementId,
          scope: input.scope,
          targetId: input.targetId,
          requestedBy,
          outcome: 'requested',
          reason,
        },
      });
    });
    let outcome: EmergencyStopView['outcome'] = 'requested';
    let detail = '';
    let row: Record<string, unknown> = latch as Record<string, unknown>;
    if (cancelRun !== undefined) {
      try {
        const reported = await cancelRun(threadId, runId, requestedBy, engagementId);
        outcome = reported === 'stopped' ? 'stopped' : 'acknowledged';
        detail = ` (${reported})`;
      } catch (err) {
        outcome = 'unknown';
        detail = ` (${err instanceof Error ? err.message : 'the runtime did not report a terminal outcome'})`;
      }
      // W10: the runtime outcome lands only on the latch this call created and
      // only while it is still un-resolved. A concurrent explicit resolution
      // (which increments concurrencyVersion) must never be overwritten by a
      // late cancel acknowledgement.
      const finalized = await this.db.emergencyStop.updateMany({
        where: { id: String(latch.id), outcome: 'requested', concurrencyVersion: Number(latch.concurrencyVersion) },
        data: { outcome },
      });
      if (finalized.count === 1) {
        row = { ...(latch as Record<string, unknown>), outcome };
      } else {
        const reread = await this.db.emergencyStop.findFirst({ where: { id: String(latch.id), engagementId } });
        row = (reread as Record<string, unknown> | null) ?? row;
        detail += ' (a concurrent resolution kept its outcome)';
      }
    }
    await this.audit(engagementId, requestedBy, 'estop.requested', 'emergency_stop', String(row.id), `${input.scope}: ${reason} -> ${outcome}${detail}`);
    return row;
  }

  /**
   * W10/ADR-0074 workspace authority: the requesting engagement always
   * records the anchor latch. Every other engagement this actor owns or
   * operates is latched and cancelled only when the runtime observes active
   * work there; engagements that are quiet (or whose state cannot be
   * observed) are left untouched. Each latch resolves independently.
   */
  private async workspaceStop(actorId: string, anchorEngagementId: string, reason: string, cancelRun?: (threadId: string, runId: string | null, actorId: string, engagementId: string) => Promise<string>, hasActiveRuns?: (actorId: string, engagementId: string) => Promise<boolean>): Promise<EmergencyStopView> {
    // The anchor engagement latches first: the requester's own engagement is
    // contained immediately, before any enumeration work.
    const anchor = await this.latchAndCancel({ engagementId: anchorEngagementId, scope: 'workspace', reason, requestedBy: actorId, targetId: null, threadId: '', runId: null }, cancelRun);
    const memberships = await this.db.webMembership.findMany({ where: { userId: actorId, role: { in: ['owner', 'operator'] } } });
    const owned = await this.db.engagement.findMany({ where: { userId: actorId } });
    const candidates = new Set<string>();
    for (const row of memberships) candidates.add(String(row.engagementId));
    for (const row of owned) candidates.add(String(row.id));
    const related: EmergencyStopView[] = [];
    const relatedFailures: { engagementId: string; reason: string }[] = [];
    for (const engagementId of [...candidates].filter((id) => id !== anchorEngagementId).sort()) {
      if (hasActiveRuns === undefined) continue;
      // W10: a failed observation is never read as "no active work". The
      // engagement is reported as uncontained instead of silently skipped.
      let active: boolean;
      try { active = await hasActiveRuns(actorId, engagementId); }
      catch (error) { relatedFailures.push({ engagementId, reason: `runtime observation failed: ${error instanceof Error ? error.message : 'unknown error'}` }); continue; }
      if (!active) continue;
      try {
        related.push(this.toEstopView(await this.latchAndCancel({ engagementId, scope: 'workspace', reason, requestedBy: actorId, targetId: null, threadId: '', runId: null }, cancelRun) as never));
      } catch (error) {
        relatedFailures.push({ engagementId, reason: error instanceof Error ? error.message : 'the stop could not be persisted' });
      }
    }
    const view = this.toEstopView(anchor as never);
    return {
      ...view,
      ...(related.length > 0 ? { related } : {}),
      ...(relatedFailures.length > 0 ? { relatedFailures } : {}),
    };
  }

  public async emergencyStops(actorId: string, engagementId: string): Promise<{ engagementId: string; stops: EmergencyStopView[]; source: 'db' }> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const rows = await this.db.emergencyStop.findMany({ where: { engagementId }, orderBy: { createdAt: 'desc' } });
    return { engagementId, stops: rows.map((r) => this.toEstopView(r as never)), source: 'db' };
  }

  /**
   * W10 explicit stop resolution: an authorised actor records why work may
   * restart. Resolution never resumes or restores anything by itself — it
   * only clears the blocker, and any subsequent work start runs through the
   * regular preflight/bind gates.
   */
  public async resolveEmergencyStop(actorId: string, engagementId: string, stopId: string, input: unknown): Promise<EmergencyStopView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_DECIDE);
    const body = (input ?? {}) as { reason?: unknown; concurrencyVersion?: unknown };
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length === 0) throw new ProjectApiError(400, 'A reason is required to resolve an emergency stop.');
    const expectedVersion = typeof body.concurrencyVersion === 'number' && Number.isInteger(body.concurrencyVersion) && body.concurrencyVersion > 0 ? body.concurrencyVersion : 0;
    if (expectedVersion === 0) throw new ProjectApiError(400, 'A positive integer concurrencyVersion is required to resolve an emergency stop.');
    const row = await this.db.emergencyStop.findFirst({ where: { id: stopId, engagementId } });
    if (row === null) throw new ProjectApiError(404, 'Emergency stop not found');
    if (!(ACTIVE_STOP_OUTCOMES as readonly string[]).includes(row.outcome)) {
      throw new ProjectApiError(409, `The emergency stop is already ${row.outcome}.`);
    }
    // W10: optimistic concurrency — a resolver acting on a stale view must
    // reload the stop list instead of silently overwriting a newer outcome.
    const cas = await this.db.emergencyStop.updateMany({
      where: { id: row.id, concurrencyVersion: expectedVersion },
      data: { outcome: 'resolved', concurrencyVersion: { increment: 1 } },
    });
    if (cas.count === 0) throw new ProjectApiError(409, 'The emergency stop changed concurrently; reload the stop list and retry.');
    const updated = await this.db.emergencyStop.findFirst({ where: { id: stopId, engagementId } });
    await this.audit(engagementId, actorId, 'estop.resolved', 'emergency_stop', row.id, reason);
    await createNotice(this.db, { engagementId, actorId: row.requestedBy, kind: 'estop.resolved', title: 'Emergency stop was resolved', detail: { stopId: row.id, resolvedBy: actorId } });
    return this.toEstopView(updated as never);
  }

  /** Refuses lifecycle mutations while an emergency stop is still active. */
  public async assertNoActiveStop(engagementId: string, threadId: string | null): Promise<void> {
    const active = await this.db.emergencyStop.findFirst({
      where: { engagementId, outcome: { in: [...ACTIVE_STOP_OUTCOMES] }, ...(threadId !== null ? { OR: [{ targetId: threadId }, { scope: { in: ['project', 'workspace'] } }] } : {}) },
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

  private toEstopView(row: { id: string; engagementId: string; scope: string; targetId: string | null; requestedBy: string; outcome: string; reason: string; concurrencyVersion?: number; createdAt: Date; updatedAt: Date }): EmergencyStopView {
    return {
      id: row.id,
      engagementId: row.engagementId,
      scope: row.scope as EmergencyStopView['scope'],
      targetId: row.targetId,
      requestedBy: row.requestedBy,
      outcome: row.outcome as EmergencyStopView['outcome'],
      reason: row.reason,
      concurrencyVersion: Number(row.concurrencyVersion ?? 1),
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
