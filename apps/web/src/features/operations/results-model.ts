/**
 * Results of one execution thread, summarised from the runtime's own runs and fleet branches and from the
 * curated findings that reference the thread. Every status is the runtime's word; nothing is inferred as success.
 */
import type { CuratedFindingView } from '@raptix/web-contracts'
import type { RuntimeFleetBranch, RuntimeRun } from './runtime'
import { runStatusTone } from './runtime-status'

/** Run statuses that mean the run is still moving. */
const IN_FLIGHT = ['pending', 'running', 'submitting']
/** Run statuses that mean the run stopped before it finished its work. */
const STOPPED = ['interrupted', 'cancelled', 'canceled']

export interface ThreadResults {
  /** Run count per raw status word, most frequent first. */
  runsByStatus: { status: string; count: number }[]
  inFlightRuns: number
  /** True while a run is in flight or stopped early, so the outcome is not final yet. */
  partial: boolean
  branches: RuntimeFleetBranch[]
  /** Branches that ended with an outcome other than success, or without any reported outcome. */
  unsuccessfulBranches: number
  findings: CuratedFindingView[]
}

export function summariseThreadResults(
  threadId: string,
  runs: readonly RuntimeRun[],
  branches: readonly RuntimeFleetBranch[],
  curated: readonly CuratedFindingView[],
): ThreadResults {
  const counts = new Map<string, number>()
  for (const run of runs) counts.set(run.rawStatus, (counts.get(run.rawStatus) ?? 0) + 1)
  const runsByStatus = [...counts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status))

  const inFlightRuns = runs.filter((run) => IN_FLIGHT.includes(run.rawStatus)).length
  const stoppedRuns = runs.filter((run) => STOPPED.includes(run.rawStatus)).length

  const threadBranches = branches.filter((branch) => branch.threadId === threadId)
  const unsuccessfulBranches = threadBranches.filter((branch) => branch.state === 'ended' && runStatusTone(branch.outcome ?? '') !== 'ok').length

  const runIds = new Set(runs.map((run) => run.runId))
  const findings = curated.filter((finding) => {
    const { threadId: linkedThread, runId } = finding.references
    return linkedThread === threadId || (runId !== null && runIds.has(runId))
  })

  return {
    runsByStatus,
    inFlightRuns,
    partial: inFlightRuns > 0 || stoppedRuns > 0,
    branches: threadBranches,
    unsuccessfulBranches,
    findings,
  }
}
