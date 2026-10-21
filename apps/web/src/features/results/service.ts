/**
 * Operation results + execution graph read model (ticket 30, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * One scope-checked read derives everything the results/graph tabs render
 * from canonical records only: step outcomes exactly as recorded (executed,
 * failed, unknown, queued and not-run stay distinct), graph edges from the
 * playbook order between consecutive steps (connectors are sequence, never
 * an inferred attack path), recorded branch runs and sessions as observed,
 * and the operation's evidence/findings/reports references. Sensitive-output
 * masking is policy-derived here for the requesting actor; the read grants
 * nothing — every field is presentation data for a read-only view.
 *
 * Reads share the factory's superseded-scope guard (cancel-on-switch).
 * Nothing writes here: the attach/signoff/export actions stay legacy writes
 * that commit through the shared authority, whose ChangeSets refetch this
 * read via the bridge.
 */
import { can, projectAccessible } from '../../domain/policy'
import type { Db } from '../../demo/seed';
import type { DbAuthority } from '../../domain/database'
import type { BranchState, Evidence, FindingStatus, Operation, ReportStatus, SessionState, Step, StepStatus } from '../../domain/entities'
import type { RequestContext, ServiceResult } from '../../domain/service'

/** Steps with an observed execution event (the graph's draw gate). A review-gated step has not produced its outcome yet. */
const OBSERVED: readonly StepStatus[] = ['ok', 'fail', 'running', 'unknown']

/** One recorded branch run attached to a step (observed state only). */
export interface ResultsBranch { id: string; stepId: string; state: BranchState; failed: boolean; error?: string }

/** One graph node's source step plus its recorded branch runs and masking. */
export interface ResultsStep {
  step: Step
  branches: ResultsBranch[]
  /** Sensitive-evidence output masking for the requesting actor (policy-derived). */
  maskOutput: boolean
}

/** One playbook-order connector; `dashed` marks a target that has not run. */
export interface ResultsEdge { from: string; to: string; dashed: boolean }

/** One recorded C2 session of the operation. */
export interface ResultsSession { id: string; state: SessionState; agentId: string; asset: string }

/** One finding linked to the operation (verified proposals excluded from `proposed`). */
export interface ResultsFinding { id: string; title: string; status: FindingStatus; technique: string }

/** One report that references the operation's verified findings. */
export interface ResultsReport { id: string; title: string; status: ReportStatus }

export interface ResultsCounts extends Record<StepStatus, number> { total: number }

/** The whole results/graph read for one operation. */
export interface OperationResultsRead {
  op: Operation
  playbookGoal?: string
  counts: ResultsCounts
  /** Steps with an observed execution event (the graph's ≥2 draw gate). */
  executed: number
  steps: ResultsStep[]
  edges: ResultsEdge[]
  sessions: ResultsSession[]
  evidence: Evidence[]
  /** Verified human findings of this operation (AI suggestions excluded). */
  findings: ResultsFinding[]
  /** AI-suggested findings — displayed separately, never as evidence. */
  proposed: ResultsFinding[]
  reports: ResultsReport[]
  /** Recorded failed branch runs — the operation is never success while one exists. */
  failedBranches: ResultsBranch[]
  /** Whether the requesting actor may view sensitive evidence (policy-derived). */
  viewSensitive: boolean
}

/** Pure results handler. Scope semantics mirror the operation detail read. */
export function operationResults(db: Db, ctx: RequestContext, id: string): ServiceResult<OperationResultsRead> {
  const op = db.operations.find((o) => o.id === id)
  if (!op) return { ok: false, failure: { kind: 'not-found', message: 'Operation not found.' } }
  if (ctx.projectId && ctx.projectId !== 'all' && ctx.projectId !== op.projectId) {
    return { ok: false, failure: { kind: 'not-found', message: `Operation ${op.id} does not exist or is out of scope.`, entity: { kind: 'operation', id: op.id, projectId: op.projectId } } }
  }
  const project = db.projects.find((p) => p.id === op.projectId)
  if (!project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: 'Operations for this project are not available for your account.' } }
  }
  const viewSensitive = can(ctx.actor, 'viewSensitive', project)
  const branches = db.branches.filter((b) => b.opId === op.id)
  const toBranch = (b: Db['branches'][number]): ResultsBranch =>
    ({ id: b.id, stepId: b.stepId, state: b.state, failed: b.state === 'failed', error: b.error })
  const evidenceById = new Map(db.evidence.map((e) => [e.id, e]))
  const steps: ResultsStep[] = op.steps.map((step) => ({
    step,
    branches: branches.filter((b) => b.stepId === step.id).map(toBranch),
    maskOutput: !viewSensitive && !!step.evidence && evidenceById.get(step.evidence)?.sensitive === true,
  }))
  const edges: ResultsEdge[] = op.steps.slice(1).map((s, i) => ({ from: op.steps[i]!.id, to: s.id, dashed: s.status === 'notrun' || s.status === 'pending' }))
  const counts: ResultsCounts = { ok: 0, fail: 0, pending: 0, running: 0, notrun: 0, unknown: 0, review: 0, total: op.steps.length }
  op.steps.forEach((s) => { counts[s.status]++ })
  const mine = db.findings.filter((f) => f.op === op.id)
  const toFinding = (f: Db['findings'][number]): ResultsFinding => ({ id: f.id, title: f.title, status: f.status, technique: f.technique })
  return {
    ok: true,
    data: {
      op,
      playbookGoal: db.playbooks.find((p) => p.id === op.playbookId)?.goal,
      counts,
      executed: op.steps.filter((s) => OBSERVED.includes(s.status)).length,
      steps,
      edges,
      sessions: db.sessions.filter((s) => s.opId === op.id).map((s) => ({ id: s.id, state: s.state, agentId: s.agentId, asset: s.asset })),
      evidence: db.evidence.filter((e) => e.opId === op.id),
      findings: mine.filter((f) => f.status !== 'ai_suggested').map(toFinding),
      proposed: mine.filter((f) => f.status === 'ai_suggested').map(toFinding),
      reports: db.reports
        .filter((r) => r.projectId === op.projectId && r.findings.some((fid) => mine.some((f) => f.id === fid && f.status !== 'ai_suggested')))
        .map((r) => ({ id: r.id, title: r.title, status: r.status })),
      failedBranches: branches.filter((b) => b.state === 'failed').map(toBranch),
      viewSensitive,
    },
  }
}

export interface ResultsService {
  /** Scope-checked results/graph read for one operation. */
  detail(ctx: RequestContext, id: string): Promise<ServiceResult<OperationResultsRead>>
}

/** Builds the typed results service; `guard` is the factory's superseded-scope read guard. */
export function createResultsService(
  authority: DbAuthority,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): ResultsService {
  return {
    detail: (ctx, id) => guard(() => operationResults(authority.snapshot(), ctx, id)),
  }
}
