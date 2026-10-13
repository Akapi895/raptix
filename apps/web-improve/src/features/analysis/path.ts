/**
 * Attack-path read model (ticket 55, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local handler for the analysis screen's attack-path graph: one
 * scope-checked read that derives the asset→step→technique chain of a single
 * operation from recorded canonical records. Scope semantics mirror the
 * coverage read: a specific projectId reads only that project's operations
 * and only for members; `'all'`/`''` aggregates across the actor's
 * accessible projects; a non-member read is `not-found` (no existence leak).
 *
 * Vocabulary (glossary): only recorded execution events — steps that reached
 * an outcome (`ok`/`fail`) — produce observed edges. Planned, running and
 * awaiting-review steps are proposed states: their edges render planned
 * (dashed) and missing/unknown data never yields an invented lateral
 * movement or success. The read carries step/agent/evidence/finding
 * provenance per project and makes no exploitability claim — `observed`
 * means "recorded", the graph shows the observed/proposed chain only.
 *
 * The step→technique links are taxonomy connectors, not path edges: they are
 * drawn by the screen between a step and its technique node and carry no
 * observed/planned chronology.
 */
import { projectAccessible } from '../../auth/policy'
import { TECHNIQUES, type Db } from '../../data'
import type { Operation, Step } from '../../domain/entities'
import type { RequestContext, ServiceResult } from '../../domain/service'

/** Filter state for the attack-path read (all optional; empty = unfiltered). */
export interface AttackPathQuery {
  /** Operation id filter; undefined/'' = the first operation with recorded outcomes in scope. */
  opId?: string
  /** Agent id filter; 'all' = unfiltered. */
  agent?: string
  /** Operating-system filter; 'all' = unfiltered. */
  os?: string
}

/** Provenance-bearing edge kinds (asset→step anchors, step→step transitions). */
export type PathEdgeKind = 'asset-step' | 'step-step'

/**
 * One derived edge. `observed` is true only when every hop is a recorded
 * execution event; proposed hops stay `false` and render planned (dashed).
 */
export interface PathEdge {
  /** Stable id: `<kind>:<from>-><to>`. */
  id: string
  kind: PathEdgeKind
  /** Asset name (`asset-step`) or step id (`step-step`). */
  from: string
  /** Step id. */
  to: string
  /** Both endpoints reached recorded outcomes (ok/fail). */
  observed: boolean
}

/** One step node: the recorded step plus its observed-event state. */
export interface PathStep {
  step: Step
  /** The step reached a recorded outcome (ok/fail); running/review/pending/notrun never do. */
  executed: boolean
}

/** One asset node with the recorded steps that targeted it. */
export interface PathAsset {
  name: string
  stepIds: string[]
}

/** One technique node referenced by the chain, with scope-checked finding references. */
export interface PathTechnique {
  id: string
  name: string
  tactic: string
  desc: string
  /** Recorded steps using this technique. */
  stepIds: string[]
  /** Findings recorded for this technique in the operation's project. */
  findings: { id: string; title: string; status: string }[]
}

/** The derived graph for one operation. */
export interface GraphPath {
  op: Operation
  projectId: string
  steps: PathStep[]
  assets: PathAsset[]
  edges: PathEdge[]
  techniques: PathTechnique[]
  /** Steps that reached a recorded outcome — the observed portion of the chain. */
  nObserved: number
}

export interface AttackPathRead {
  /** Operations in scope with at least one step after the filters (selector options). */
  ops: Operation[]
  /** The resolved operation's graph; null when no scoped operation has steps under the filters. */
  selected: GraphPath | null
}

/** A step reached a recorded outcome (ok/fail) — the only state that yields observed edges. */
const executed = (st: Step) => st.status === 'ok' || st.status === 'fail'

/**
 * Pure attack-path handler. The graph derives from scoped canonical
 * operations only; findings attach per technique within the operation's own
 * project, so an aggregate read never mixes projects into one chain.
 */
export function pathOf(db: Db, ctx: RequestContext, query: AttackPathQuery = {}): ServiceResult<AttackPathRead> {
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
  const inScope = db.operations.filter((o) => (aggregate ? accessible.has(o.projectId) : o.projectId === pid))
  const matches = (st: Step) =>
    (!query.agent || query.agent === 'all' || st.agent === query.agent) &&
    (!query.os || query.os === 'all' || db.agents.find((a) => a.id === st.agent)?.os === query.os)
  const visible = inScope
    .map((op) => ({ op, steps: op.steps.filter(matches) }))
    .filter((x) => x.steps.length > 0)
  if (!visible.length) return { ok: true, data: { ops: [], selected: null } }
  const chosen =
    (query.opId && visible.find((x) => x.op.id === query.opId)) ||
    visible.find((x) => x.steps.some(executed)) ||
    visible[0]
  const steps: PathStep[] = chosen.steps.map((step) => ({ step, executed: executed(step) }))
  const assets: PathAsset[] = []
  const edges: PathEdge[] = []
  steps.forEach((ps) => {
    const a = ps.step.asset
    // Unknown/placeholder asset names never anchor an asset node.
    if (!a || a === '—') return
    let asset = assets.find((x) => x.name === a)
    if (!asset) { asset = { name: a, stepIds: [] }; assets.push(asset) }
    asset.stepIds.push(ps.step.id)
    // asset→step: observed only when the step itself is a recorded event.
    edges.push({ id: `asset-step:${a}->${ps.step.id}`, kind: 'asset-step', from: a, to: ps.step.id, observed: ps.executed })
  })
  for (let i = 1; i < steps.length; i++) {
    // step→step: observed only when both steps reached recorded outcomes —
    // running/review/pending hops stay planned so missing data never
    // invents lateral movement.
    edges.push({
      id: `step-step:${steps[i - 1].step.id}->${steps[i].step.id}`,
      kind: 'step-step',
      from: steps[i - 1].step.id,
      to: steps[i].step.id,
      observed: steps[i - 1].executed && steps[i].executed,
    })
  }
  const techniques: PathTechnique[] = [...new Set(steps.map((ps) => ps.step.technique))].flatMap((tid) => {
    const tech = TECHNIQUES.find((t) => t.id === tid)
    if (!tech) return []
    return [{
      id: tech.id,
      name: tech.name,
      tactic: tech.tactic,
      desc: tech.desc,
      stepIds: steps.filter((ps) => ps.step.technique === tid).map((ps) => ps.step.id),
      findings: db.findings
        .filter((f) => f.projectId === chosen.op.projectId && f.technique === tid)
        .map((f) => ({ id: f.id, title: f.title, status: f.status })),
    }]
  })
  return {
    ok: true,
    data: {
      ops: visible.map((x) => x.op),
      selected: {
        op: chosen.op,
        projectId: chosen.op.projectId,
        steps,
        assets,
        edges,
        techniques,
        nObserved: steps.filter((ps) => ps.executed).length,
      },
    },
  }
}
