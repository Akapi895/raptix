/**
 * Runtime operations port (plan P12, Operations slice). The runtime owns the
 * execution threads and the runs on them; the console shows each raw status as
 * the runtime reports it, cancels a run that is still in flight, and drives the
 * operation lifecycle (plan P11): pause a run, resume a paused operation, mark it
 * complete. Approval and step controls are not here. The mock console keeps
 * its own operation lifecycle, so this port has no mock adapter.
 */
import type { OperationView, RequestRecoveryView, ThreadHistoryEvent, TimelineEntryView } from '@raptix/web-contracts'
import type { RequestContext, ServiceResult } from '../../domain/service'

export interface RuntimeThread {
  threadId: string
  assistantId: string
  createdAt: string
}

export interface RuntimeRun {
  runId: string
  requestId: string
  threadId: string
  /** The runtime's own status word, shown as reported; never mapped to success by default. */
  rawStatus: string
  createdAt: string
  updatedAt: string
}

export interface RuntimeThreadSnapshot {
  transcripts: ThreadHistoryEvent[]
  transcriptsTruncated: boolean
}

export interface RuntimeTimeline {
  entries: TimelineEntryView[]
  truncated: boolean
  /** Threads whose runtime binding no longer matches persisted state; their runs are left out. */
  unavailableThreads: number
}

/** The three identities the fleet keeps apart: catalog graph ids, bound runtime threads and checkpoint subagent branches. */
export interface RuntimeFleetAgent { graphId: string }

export interface RuntimeFleetThread {
  threadId: string
  assistantId: string | null
  kind: string | null
  /** The runtime's raw thread status; null when the runtime does not report one. */
  rawStatus: string | null
  activeRunId: string | null
}

export interface RuntimeFleetBranch {
  threadId: string
  key: string
  agent: string
  state: 'running' | 'ended' | 'unknown'
  outcome: string | null
  startedAt: string | null
  endedAt: string | null
}

export interface RuntimeFleet {
  agents: RuntimeFleetAgent[]
  threads: RuntimeFleetThread[]
  branches: RuntimeFleetBranch[]
  counts: { threads: number; threadsTruncated: boolean; activeRuns: number; branches: number; runningBranches: number }
  /** Controls the runtime has no action contract for; shown as recorded exclusions. */
  excludedActions: string[]
  sources: { agents: string; threads: string; branches: string }
}

export interface RuntimeOperationsService {
  fleet(ctx: RequestContext): Promise<ServiceResult<RuntimeFleet>>
  /** The engagement's execution threads only; planning threads are not operation resources. */
  threads(ctx: RequestContext): Promise<ServiceResult<RuntimeThread[]>>
  runs(ctx: RequestContext, threadId: string): Promise<ServiceResult<RuntimeRun[]>>
  snapshot(ctx: RequestContext, threadId: string): Promise<ServiceResult<RuntimeThreadSnapshot>>
  /** Cancels one run that the runtime still reports in flight. */
  cancelRun(ctx: RequestContext, threadId: string, runId: string): Promise<ServiceResult<RuntimeRun>>
  /** P11: the lifecycle the runtime reports for one execution thread. */
  operation(ctx: RequestContext, threadId: string): Promise<ServiceResult<OperationView>>
  /** P11: pauses one run; cooperative, so the answer is the operation as recorded. */
  pauseRun(ctx: RequestContext, threadId: string, runId: string): Promise<ServiceResult<OperationView>>
  /** P11: continues a paused operation as a new run; the request id makes a retry replay the same run. */
  resumeOperation(ctx: RequestContext, threadId: string, requestId: string): Promise<ServiceResult<RequestRecoveryView>>
  completeOperation(ctx: RequestContext, threadId: string): Promise<ServiceResult<OperationView>>
  timeline(ctx: RequestContext): Promise<ServiceResult<RuntimeTimeline>>
}

/** Every call resolves to an explicit unavailable outcome when the backend does not advertise runs. */
export function unavailableRuntimeOperationsService(): RuntimeOperationsService {
  const failure = { kind: 'unavailable' as const, message: 'Runtime operations are not available on this server.' }
  const unavailable = () => Promise.resolve({ ok: false as const, failure })
  return {
    fleet: unavailable,
    threads: unavailable,
    runs: unavailable,
    snapshot: unavailable,
    cancelRun: unavailable,
    operation: unavailable,
    pauseRun: unavailable,
    resumeOperation: unavailable,
    completeOperation: unavailable,
    timeline: unavailable,
  }
}
