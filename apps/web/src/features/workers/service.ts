/**
 * AI worker dependency read model (ticket 44, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The worker/DAG presentation reads recorded canonical data here as a
 * feature-local handler over the one database authority: scope-checked
 * worker rows with resolved dependencies (a dep that references no recorded
 * worker of the same project is reported as `missing`, never dropped or
 * treated as satisfied) and branch dependencies resolved from the worker's
 * recorded inputs (an input naming a branch with no recorded row is
 * `missing` too). States are reported exactly as recorded — a missing or
 * unfinished dependency is never inferred as success, and the read grants
 * nothing: it is presentation data for a read-only graph.
 *
 * Reads share the factory's superseded-scope guard (cancel-on-switch).
 * Workers have no console actions in this ticket — nothing writes here, so
 * no bridge test exists for a legacy worker mutation (grep-verified: no
 * legacy action mutates `aiWorkers`); a runtime commit touching `aiWorkers`
 * publishes the `ai-worker` ChangeSet the Query binding below observes.
 */
import { projectAccessible } from '../../auth/policy'
import type { Db } from '../../data'
import type { DbAuthority } from '../../domain/database'
import type { AiWorker, BranchState, WorkerState } from '../../domain/entities'
import type { RequestContext, ServiceResult } from '../../domain/service'

/** One dependency edge: a recorded worker's state, or `missing` when the referenced id has no recorded row in the worker's project. */
export interface WorkerDep {
  id: string
  state: WorkerState | 'missing'
}

/** One branch dependency resolved from the worker's recorded inputs. */
export interface WorkerBranchDep {
  id: string
  state: BranchState | 'missing'
}

/** One worker node of the dependency graph. */
export interface WorkerRow {
  worker: AiWorker
  /** 1-based execution depth: 1 with no resolved deps, else 1 + max(dep levels). Dependency cycles terminate (a back edge never extends the path). */
  level: number
  deps: WorkerDep[]
  parent?: WorkerDep
  /** Branch inputs that name a recorded branch of the worker's project. */
  branchDeps: WorkerBranchDep[]
  /** Inputs shaped like branch ids that resolve to no recorded branch — explicit, never dropped. */
  missingBranches: string[]
}

export interface WorkerListRead {
  workers: WorkerRow[]
}

export interface WorkerService {
  /** Scope-checked worker dependency graph ('all' aggregates accessible projects). */
  list(ctx: RequestContext): Promise<ServiceResult<WorkerListRead>>
}

/** Dependency levels: memoized depth with a visiting guard, so cycles terminate. */
function levelsOf(workers: AiWorker[]): Map<string, number> {
  const byId = new Map(workers.map((w) => [w.id, w]))
  const depth = new Map<string, number>()
  const visiting = new Set<string>()
  const levelOf = (id: string): number => {
    const memo = depth.get(id)
    if (memo !== undefined) return memo
    if (visiting.has(id)) return 0
    visiting.add(id)
    const w = byId.get(id)
    const levels = (w?.deps ?? []).filter((d) => byId.has(d)).map(levelOf)
    visiting.delete(id)
    const v = 1 + Math.max(0, ...levels)
    depth.set(id, v)
    return v
  }
  workers.forEach((w) => levelOf(w.id))
  return depth
}

/** Pure list handler. A specific projectId reads only that project's workers and only for members; 'all'/'' aggregates the actor's accessible projects. */
export function listWorkers(db: Db, ctx: RequestContext): ServiceResult<WorkerListRead> {
  const aggregate = !ctx.projectId || ctx.projectId === 'all' || ctx.projectId === ''
  const pid = ctx.projectId
  if (!aggregate) {
    const project = db.projects.find((p) => p.id === pid)
    if (!project || !projectAccessible(project, ctx.actor)) {
      return { ok: false, failure: { kind: 'not-found', message: 'AI workers for this project are not available for your account.' } }
    }
  }
  const accessible = new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
  const workers = db.aiWorkers.filter((w) => (aggregate ? accessible.has(w.projectId) : w.projectId === pid))
  const levels = levelsOf(workers)
  return {
    ok: true,
    data: {
      workers: workers
        .map((w) => {
          const peers = new Map(db.aiWorkers.filter((x) => x.projectId === w.projectId).map((x) => [x.id, x]))
          const branches = new Map(db.branches.filter((b) => b.projectId === w.projectId).map((b) => [b.id, b.state]))
          const resolve = (id: string): WorkerDep => ({ id, state: peers.get(id)?.state ?? 'missing' })
          const branchRef = (id: string): WorkerBranchDep => ({ id, state: branches.get(id) ?? 'missing' })
          const named = w.inputs.filter((i) => i.startsWith('BR-'))
          return {
            worker: w,
            level: levels.get(w.id) ?? 1,
            deps: w.deps.map(resolve),
            parent: w.parent ? resolve(w.parent) : undefined,
            branchDeps: named.map(branchRef),
            missingBranches: named.filter((i) => !branches.has(i)),
          }
        })
        .sort((a, b) => a.level - b.level || a.worker.id.localeCompare(b.worker.id)),
    },
  }
}

/** Builds the typed worker service; `guard` is the factory's superseded-scope read guard. */
export function createWorkerService(
  authority: DbAuthority,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): WorkerService {
  return {
    list: (ctx) => guard(() => listWorkers(authority.snapshot(), ctx)),
  }
}
