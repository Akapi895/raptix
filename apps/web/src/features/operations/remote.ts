import { isOperationView, isRequestRecoveryView, isScopedRunView, type OperationView, type RequestRecoveryView, type ScopedRunView } from '@raptix/web-contracts';
import { apiFetch } from '../../platform/transport';
import { owned } from '../planning/remote';
import { threadPath } from '../aichat/remote';

export function fetchOperation(engagementId: string, threadId: string): Promise<OperationView> {
  return apiFetch(`${threadPath(engagementId, threadId)}/operation`, owned(engagementId, isOperationView))
}

/** Pause is cooperative: the answer is the operation as recorded; the runtime stops the run at its next safe point. */
export function pauseOperationRun(engagementId: string, threadId: string, runId: string): Promise<OperationView> {
  return apiFetch(`${threadPath(engagementId, threadId)}/runs/${encodeURIComponent(runId)}/pause`, isOperationView, { method: 'POST' })
}

/** Resume continues the paused checkpoint as a new run. The request id is the idempotency key: a retry replays the same run. */
export function resumeOperation(engagementId: string, threadId: string, requestId: string): Promise<RequestRecoveryView> {
  return apiFetch(`${threadPath(engagementId, threadId)}/resume-run`, isRequestRecoveryView, { method: 'POST', body: { requestId } })
}

/** Completion is audited bookkeeping, accepted only once the runtime run is terminal. */
export function completeOperation(engagementId: string, threadId: string): Promise<OperationView> {
  return apiFetch(`${threadPath(engagementId, threadId)}/complete`, isOperationView, { method: 'POST' })
}

export function cancelRun(engagementId: string, threadId: string, runId: string): Promise<ScopedRunView> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/cancel`,
    (v): v is ScopedRunView => isScopedRunView(v) && v.engagementId === engagementId && v.threadId === threadId && v.runId === runId,
    { method: 'POST' },
  )
}

/* ───────────── Agent fleet/fanout projection (integration ticket 13) ───────────── */
export interface FleetAgentView {
  graphId: string
  source: 'catalog'
}

export interface FleetThreadView {
  threadId: string
  assistantId: string | null
  kind: string | null
  rawStatus: string | null
  updatedAt: string | null
  activeRunId: string | null
}

export interface FleetBranchView {
  threadId: string
  key: string
  agent: string
  state: 'running' | 'ended' | 'unknown'
  outcome: string | null
  startedAt: string | null
  endedAt: string | null
  provenance: 'checkpoint'
}

export interface FleetView {
  engagementId: string
  agents: FleetAgentView[]
  threads: FleetThreadView[]
  branches: FleetBranchView[]
  counts: { threads: number; threadsTruncated: boolean; activeRuns: number; branches: number; runningBranches: number }
  excludedActions: string[]
  sources: { agents: string; threads: string; branches: string }
  source: 'runtime'
}

export function isFleetView(v: unknown): v is FleetView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as FleetView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.agents) && Array.isArray(doc.threads) && Array.isArray(doc.branches) && doc.source === 'runtime'
}

export function fetchFleet(engagementId: string): Promise<FleetView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/fleet`, owned(engagementId, isFleetView))
}
