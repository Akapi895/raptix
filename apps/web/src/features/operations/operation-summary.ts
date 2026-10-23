/**
 * One execution thread read as an operation: its runs, when the first started and the last changed, the span between them,
 * the outcome counts of its runs and the agent instances the fleet bound to it. Every figure comes from the runtime's own
 * runs and branches. A value the runtime does not record is null, never a guess.
 */
import type { RuntimeFleetBranch, RuntimeRun, RuntimeThread } from './runtime'
import { runStatusTone } from './runtime-status'

export interface OperationSummary {
  runCount: number
  latestRun: RuntimeRun | null
  /** When the first run was created; null while the operation has no run. */
  startedAt: string | null
  /** When any run last changed; null while the operation has no run. */
  updatedAt: string | null
  /** Milliseconds from the first run's start to the last change. It is not a live elapsed time while a run is still open. */
  spanMs: number | null
  succeeded: number
  failed: number
  open: number
  agents: number
  runningAgents: number
}

export function summariseOperation(thread: RuntimeThread, runs: readonly RuntimeRun[], branches: readonly RuntimeFleetBranch[]): OperationSummary {
  const ordered = [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const startedAt = ordered[0]?.createdAt ?? null
  const updatedAt = ordered.reduce<string | null>((latest, run) => (latest === null || run.updatedAt > latest ? run.updatedAt : latest), null)
  const outcomes = ordered.map((run) => runStatusTone(run.rawStatus))
  const mine = branches.filter((branch) => branch.threadId === thread.threadId)
  return {
    runCount: ordered.length,
    latestRun: ordered.at(-1) ?? null,
    startedAt,
    updatedAt,
    spanMs: startedAt !== null && updatedAt !== null ? Date.parse(updatedAt) - Date.parse(startedAt) : null,
    succeeded: outcomes.filter((tone) => tone === 'ok').length,
    failed: outcomes.filter((tone) => tone === 'bad').length,
    open: outcomes.filter((tone) => tone !== 'ok' && tone !== 'bad').length,
    agents: mine.length,
    runningAgents: mine.filter((branch) => branch.state === 'running').length,
  }
}

/** A span as the operator reads it: seconds, then minutes and seconds, then hours and minutes. */
export function formatSpan(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
