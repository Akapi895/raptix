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

/** The entries the timeline shows first, and the most one page can ask for (the server's window bound). */
export const TIMELINE_PAGE_LIMIT = 50
export const TIMELINE_MAX_LIMIT = 250

export interface RuntimeTimeline {
  entries: TimelineEntryView[]
  /** The source window hit its bound; older activity beyond it is not projected. */
  truncated: boolean
  /** More entries exist in the window than this page returned; a larger limit returns them. */
  hasMore: boolean
  /** Checkpoint events with no recorded time; they are left out of the ordered timeline. */
  untimedCheckpoints: number
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
  /** One page of the merged timeline, newest first; the limit is clamped to the window bound. */
  timeline(ctx: RequestContext, limit?: number): Promise<ServiceResult<RuntimeTimeline>>
}

