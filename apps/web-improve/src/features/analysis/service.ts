/**
 * ATT&CK coverage read model (ticket 54, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local handler for the analysis screens' MITRE matrix and detection
 * heatmap: one scope-checked read that folds recorded canonical operations,
 * steps and findings into tactic/technique coverage. Every request captures
 * actor and project explicitly; a non-member's specific-project read is
 * denied with `not-found` (no existence leak), and the aggregate scope
 * (`'all'`/`''`) folds in only projects the actor can access.
 *
 * Vocabulary (glossary): coverage is derived from observed operation events
 * only. A technique is covered when a step reached a recorded outcome
 * (`ok`/`fail`); planned or awaiting-review steps are not coverage. The
 * detection states distinguish observed outcomes — `detected`, `undetected`
 * (verified absence) and `nodata` (unverified) — and never imply
 * exploitability or a control verdict by themselves. Without a connected
 * detection source every executed technique stays `nodata`, never
 * "undetected".
 */
import { projectAccessible } from '../../auth/policy'
import { TECHNIQUES, type Db } from '../../data'
import type { DbAuthority } from '../../domain/database'
import type { DetectState, Operation, Step, Technique } from '../../domain/entities'
import type { RequestContext, ServiceResult } from '../../domain/service'

/** Filter state for the coverage read (all optional; empty = unfiltered). */
export interface AnalysisCoverageQuery {
  /** Operation id filter; undefined/'' = every operation in scope. */
  opId?: string
  /** Agent id filter; 'all' = unfiltered. */
  agent?: string
  /** Operating-system filter; 'all' = unfiltered. */
  os?: string
}

/** One recorded step occurrence behind a technique's coverage. */
export interface CoverageEntry {
  op: Operation
  step: Step
  /** Executed = the step reached a recorded outcome (ok/fail); review/pending are planned, never counted as executed. */
  tested: boolean
}

/** Matrix cell state: observed detection outcomes plus the two non-executed states. */
export type CoverageCellState = DetectState | 'planned' | 'untested'

/** One tactic×technique cell: executed runs, planned-only steps and the rolled-up state. */
export interface CoverageCell {
  tech: Technique
  runs: CoverageEntry[]
  planned: CoverageEntry[]
  state: CoverageCellState
}

/** One project×technique pair: the observed detection outcome and related findings. */
export interface CoveragePair {
  projectId: string
  tech: Technique
  runs: CoverageEntry[]
  /** Observed outcome — detected / undetected (verified) / nodata (unverified). Never a claim of exploitability. */
  state: DetectState
  /** Findings recorded for this technique in this project (scope-checked references). */
  findings: { id: string; title: string; status: string }[]
}

/** Agent filter option derived from the scoped fleet (project-assigned agents only). */
export interface AgentOption { id: string; host: string; projectId: string; os: string }

/** The whole coverage read: filtered operations, entries, matrix cells, heatmap pairs and counts. */
export interface AnalysisCoverageRead {
  /** Scoped operations after the operation filter. */
  ops: Operation[]
  /** All operations in scope before the operation filter (filter options + out-of-scope detection). */
  allOps: Operation[]
  /** Project-assigned agents in scope (agent filter options). */
  agentOptions: AgentOption[]
  entries: CoverageEntry[]
  cells: CoverageCell[]
  pairs: CoveragePair[]
  /** Whether the detection source is connected; when false every technique reads `nodata`. */
  siemOn: boolean
  siemName: string
  /** Techniques with at least one executed run. */
  nRun: number
  nDetected: number
  nUndetected: number
  nNoData: number
  /** Cells with planned-only steps (not executed, not coverage). */
  nPlanned: number
  /** Distinct project+asset pairs among executed steps. */
  nBranch: number
  /** Distinct evidence references linked to steps in the current filter. */
  nEvidence: number
}

export interface AnalysisService {
  /** Scope-checked ATT&CK coverage + detection heatmap read for the current filters. */
  coverage(ctx: RequestContext, query?: AnalysisCoverageQuery): Promise<ServiceResult<AnalysisCoverageRead>>
}

/**
 * Pure coverage handler. Scope semantics mirror the operations inventory:
 * a specific projectId reads only that project's operations and only for
 * members; `'all'`/`''` aggregates across the actor's accessible projects.
 */
export function coverageOf(db: Db, ctx: RequestContext, query: AnalysisCoverageQuery = {}): ServiceResult<AnalysisCoverageRead> {
  const aggregate = !ctx.projectId || ctx.projectId === 'all'
  const pid = ctx.projectId
  if (!aggregate) {
    const project = db.projects.find((p) => p.id === pid)
    // Out-of-scope reads are not-found, never a leaked existence signal.
    if (!project || !projectAccessible(project, ctx.actor)) {
      return { ok: false, failure: { kind: 'not-found', message: 'Attack analysis for this project is not available for your account.' } }
    }
  }
  const accessible = new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
  const allOps = db.operations.filter((o) => (aggregate ? accessible.has(o.projectId) : o.projectId === pid))
  const ops = query.opId ? allOps.filter((o) => o.id === query.opId) : allOps
  const siem = db.integrations.find((i) => i.kind === 'SIEM')
  const siemOn = !!siem && siem.status === 'connected'
  const siemName = siem?.name || 'SIEM'
  // Observed outcome per project+technique from the recorded telemetry view.
  // Without a connected source every executed technique is "no data"
  // (unverified) — never reported as detected or undetected.
  const det = (p: string, t: string): DetectState => (siemOn ? db.detection[p]?.[t] ?? 'nodata' : 'nodata')
  const tested = (st: Step) => st.status === 'ok' || st.status === 'fail'
  const entries: CoverageEntry[] = []
  ops.forEach((op) => op.steps.forEach((step) => {
    if (query.agent && query.agent !== 'all' && step.agent !== query.agent) return
    if (query.os && query.os !== 'all' && db.agents.find((a) => a.id === step.agent)?.os !== query.os) return
    entries.push({ op, step, tested: tested(step) })
  }))
  const byTech = new Map<string, CoverageEntry[]>()
  entries.filter((e) => e.tested).forEach((e) => byTech.set(e.step.technique, [...(byTech.get(e.step.technique) || []), e]))
  const cells: CoverageCell[] = TECHNIQUES.map((tech) => {
    const runs = byTech.get(tech.id) || []
    const states = runs.map((r) => det(r.op.projectId, tech.id))
    const planned = entries.filter((e) => !e.tested && e.step.technique === tech.id)
    const state: CoverageCellState = !runs.length
      ? (planned.length ? 'planned' : 'untested')
      : states.includes('undetected') ? 'undetected' : states.includes('detected') ? 'detected' : 'nodata'
    return { tech, runs, planned, state }
  })
  const pairs: CoveragePair[] = []
  byTech.forEach((runs, tid) => {
    const tech = TECHNIQUES.find((t) => t.id === tid)
    if (!tech) return
    ;[...new Set(runs.map((r) => r.op.projectId))].forEach((p) => {
      pairs.push({
        projectId: p,
        tech,
        runs: runs.filter((r) => r.op.projectId === p),
        state: det(p, tid),
        findings: db.findings
          .filter((f) => f.projectId === p && f.technique === tid)
          .map((f) => ({ id: f.id, title: f.title, status: f.status })),
      })
    })
  })
  const branches = new Set(entries.filter((e) => e.tested).map((e) => e.op.projectId + '|' + e.step.asset))
  return {
    ok: true,
    data: {
      ops,
      allOps,
      agentOptions: db.agents
        .filter((a) => (aggregate ? !!a.projectId && accessible.has(a.projectId) : a.projectId === pid))
        .map((a) => ({ id: a.id, host: a.host, projectId: a.projectId, os: a.os })),
      entries,
      cells,
      pairs,
      siemOn,
      siemName,
      nRun: byTech.size,
      nDetected: cells.filter((c) => c.state === 'detected').length,
      nUndetected: cells.filter((c) => c.state === 'undetected').length,
      nNoData: cells.filter((c) => c.state === 'nodata').length,
      nPlanned: cells.filter((c) => c.state === 'planned').length,
      nBranch: branches.size,
      nEvidence: new Set(entries.map((e) => e.step.evidence).filter((x): x is string => !!x && x.startsWith('EV-'))).size,
    },
  }
}

/** Builds the typed analysis service; `guard` is the factory's superseded-scope read guard. */
export function createAnalysisService(
  authority: DbAuthority,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): AnalysisService {
  return {
    coverage: (ctx, query) => guard(() => coverageOf(authority.snapshot(), ctx, query)),
  }
}
