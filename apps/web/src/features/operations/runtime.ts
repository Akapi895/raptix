/**
 * Runtime operations port (plan P12, Operations slice). The runtime owns the
 * execution threads and the runs on them; the console shows each raw status as
 * the runtime reports it and can cancel a run that is still in flight. Pause,
 * resume and completion have no runtime action until the operation lifecycle
 * lands (plan P11), so this port does not offer them. The mock console keeps
 * its own operation lifecycle, so this port has no mock adapter.
 */
import type { ThreadHistoryEvent, TimelineEntryView } from '@raptix/web-contracts'
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

export interface RuntimeOperationsService {
  /** The engagement's execution threads only; planning threads are not operation resources. */
  threads(ctx: RequestContext): Promise<ServiceResult<RuntimeThread[]>>
  runs(ctx: RequestContext, threadId: string): Promise<ServiceResult<RuntimeRun[]>>
  snapshot(ctx: RequestContext, threadId: string): Promise<ServiceResult<RuntimeThreadSnapshot>>
  /** Cancels one run that the runtime still reports in flight. */
  cancelRun(ctx: RequestContext, threadId: string, runId: string): Promise<ServiceResult<RuntimeRun>>
  timeline(ctx: RequestContext): Promise<ServiceResult<RuntimeTimeline>>
}

/** Every call resolves to an explicit unavailable outcome when the backend does not advertise runs. */
export function unavailableRuntimeOperationsService(): RuntimeOperationsService {
  const failure = { kind: 'unavailable' as const, message: 'Runtime operations are not available on this server.' }
  const unavailable = () => Promise.resolve({ ok: false as const, failure })
  return {
    threads: unavailable,
    runs: unavailable,
    snapshot: unavailable,
    cancelRun: unavailable,
    timeline: unavailable,
  }
}
