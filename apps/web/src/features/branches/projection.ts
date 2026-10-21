/**
 * Fanout/branch typed reads (ticket 67, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The fanout cards and allocation view assemble their display slices here
 * instead of scanning the database: one cached derivation per authority
 * publication. The reads add no access checks of their own — the branch
 * service's Query reads enforce the one-membership rule; these projections
 * only assemble what an already-authorized surface renders.
 */
import { BRANCH_TERMINAL } from '../../domain/catalog';
import type { Db } from '../../demo/seed';
import type { BranchState } from '../../domain/entities'
import type { BranchGroup } from '../../domain/entities'
import type { RequestContext } from '../../domain/service'
import type { ConsoleServices } from '../../domain/console-services';
import { projectView } from '../../domain/projection'
import { useServiceProjection } from '../../state/projection'

/** Counted branch states for one group's card and fan-in panel. */
export interface FanoutSummary {
  bs: Db['branches']
  total: number
  running: number
  done: number
  failed: number
  waiting: number
  queued: number
  paused: number
  unknown: number
  missing: number
  open: number
  overall: string
  evidence: number
}

function groupSummary(db: Db, groupId: string): FanoutSummary {
  const bs = db.branches.filter((b) => b.groupId === groupId)
  const n = (st: BranchState) => bs.filter((b) => b.state === st).length
  const done = n('completed'), failed = n('failed')
  const open = bs.filter((b) => !BRANCH_TERMINAL.includes(b.state)).length
  const missing = bs.length - done - failed - n('cancelled') - n('blocked')
  const overall = open > 0 ? (n('unknown') + n('paused') > 0 ? 'Degraded — branches paused or unknown' : 'In progress') : failed + n('blocked') > 0 ? 'Partially Completed' : 'Completed'
  return { bs, total: bs.length, running: n('running'), done, failed, waiting: n('waiting_approval'), queued: n('queued'), paused: n('paused'), unknown: n('unknown'), missing, open, overall, evidence: bs.reduce((a, b) => a + b.evidence.length, 0) }
}

/** One branch group with its counts, for the compact fan-out card. */
export interface FanoutCardRead {
  group?: BranchGroup
  summary?: FanoutSummary
}

export function readFanoutCard(services: ConsoleServices, ctx: RequestContext, groupId: string): FanoutCardRead {
  return projectView(services, ctx, 'fanout-card.' + groupId, (db) => {
    const group = db.branchGroups.find((x) => x.id === groupId)
    return { group, summary: group ? groupSummary(db, groupId) : undefined }
  })
}

export function useFanoutCard(groupId: string): FanoutCardRead {
  return useServiceProjection((services, ctx) => readFanoutCard(services, ctx, groupId))
}

/** Allocation context for one project: agents (shared pool included), open branches and concurrency policy. */
export interface AllocationRead {
  all: Db['agents']
  mine: Db['agents']
  pool: Db['agents']
  busy: Db['agents']
  avail: Db['agents']
  disc: Db['agents']
  total: number
  connected: number
  capacity: number
  /** Open (non-terminal) branches per agent id. */
  openByAgent: Record<string, Db['branches']>
  /** Concurrency policy max across the project's branch groups. */
  maxConcurrency: number
}

export function readAllocation(services: ConsoleServices, ctx: RequestContext, projectId: string): AllocationRead {
  return projectView(services, ctx, 'allocation.' + projectId, (db) => {
    const conn = (a: Db['agents'][number]) => a.status === 'online' || a.status === 'idle'
    const mine = db.agents.filter((a) => a.projectId === projectId)
    const pool = db.agents.filter((a) => !a.projectId && conn(a))
    const all = [...mine, ...pool]
    const busy = all.filter((a) => conn(a) && a.op)
    const avail = all.filter((a) => conn(a) && !a.op)
    const disc = all.filter((a) => !conn(a))
    return {
      all, mine, pool, busy, avail, disc,
      total: all.length,
      connected: all.filter(conn).length,
      capacity: avail.length,
      openByAgent: db.branches.reduce<Record<string, Db['branches']>>((acc, b) => {
        if (!BRANCH_TERMINAL.includes(b.state)) (acc[b.agent] ??= []).push(b)
        return acc
      }, {}),
      maxConcurrency: Math.max(2, ...db.branchGroups.filter((g) => g.projectId === projectId).map((g) => g.maxConcurrency)),
    }
  })
}

export function useAllocation(projectId: string): AllocationRead {
  return useServiceProjection((services, ctx) => readAllocation(services, ctx, projectId))
}

/** Resolves a target name/ident to its asset record, for deep links. */
export function readAssetRef(services: ConsoleServices, ctx: RequestContext, name: string): Db['assets'][number] | undefined {
  return projectView(services, ctx, 'asset-ref.' + name, (db) => db.assets.find((x) => x.name === name || x.ident === name))
}

export function useAssetRef(name: string): Db['assets'][number] | undefined {
  return useServiceProjection((services, ctx) => readAssetRef(services, ctx, name))
}
