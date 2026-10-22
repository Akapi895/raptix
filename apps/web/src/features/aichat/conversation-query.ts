/**
 * The real conversation's reads and endpoint calls (migration Mốc 1). The conversation view reads through these hooks and
 * calls the endpoints through the functions re-exported here, so presentation never imports an adapter file. Each hook keeps
 * its query key, `enabled` flag and polling interval from the conversation it was lifted out of: the keys are shared with the
 * planning, approvals and fleet surfaces, so invalidation keeps reaching them.
 */
import { useQuery } from '@tanstack/react-query'
import type { ThreadKind } from '@raptix/web-contracts'
import { getEngagement, projectKeys } from '../projects'
import { fetchPlanning } from '../planning'
import { cancelRun, fetchFleet } from '../operations'
import { decideApproval, fetchApprovals } from '../approvals'
import { fetchReports } from '../reports'
import { fetchRuntimeContext } from '../execution'
import { getThread, listRunsOfThread, listThreads } from './remote'

/** Endpoint calls the dispatch flow makes imperatively; the flow owns their ordering and request ledger. */
export { createThread, getRun, getThreadPage, reconcileRequest, renameThread, resumeThread, setThreadHitl, submitRun } from './remote'
export { cancelRun, decideApproval }

export const useEngagementDetail = (engagementId: string) =>
  useQuery({ queryKey: projectKeys.detail(engagementId), queryFn: () => getEngagement(engagementId) })

/** Planning readiness the conversation subscribes to; polled so a completed bundle is noticed without the planning tab mounted. */
export const useConversationPlanning = (engagementId: string, enabled: boolean) =>
  useQuery({ queryKey: ['real', 'planning', engagementId], queryFn: () => fetchPlanning(engagementId), enabled, refetchInterval: 15_000 })

/** The planning bundle's documents for the artifact list; same key as the planning reads, without polling. */
export const usePlanningDocuments = (engagementId: string) =>
  useQuery({ queryKey: ['real', 'planning', engagementId], queryFn: () => fetchPlanning(engagementId) })

export const useConversationThreads = (engagementId: string, enabled: boolean) =>
  useQuery({ queryKey: ['real', 'threads', engagementId], queryFn: () => listThreads(engagementId), enabled })

export const useThreadSnapshot = (engagementId: string, threadId: string | null) =>
  useQuery({
    queryKey: ['real', 'thread', engagementId, threadId],
    queryFn: () => getThread(engagementId, threadId!),
    enabled: !!threadId,
  })

/** Server-verified runtime context (R06): gates execution runs. */
export const useRuntimeContext = (engagementId: string, kind: ThreadKind, threadId: string | null, threadsReady: boolean) =>
  useQuery({
    queryKey: ['real', 'runtime-context', engagementId, kind, threadId],
    queryFn: () => fetchRuntimeContext(engagementId, kind, threadId!),
    enabled: !!threadId && threadsReady,
    retry: false,
  })

export const useThreadRuns = (engagementId: string, threadId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: ['real', 'runs', engagementId, threadId],
    queryFn: () => listRunsOfThread(engagementId, threadId!),
    enabled: !!threadId && enabled,
    retry: false,
  })

/** Tool HITL approvals of the execution scope. */
export const useApprovalQueue = (engagementId: string, enabled: boolean) =>
  useQuery({ queryKey: ['real', 'approvals', engagementId], queryFn: () => fetchApprovals(engagementId), enabled, refetchInterval: 15_000 })

/** The agent fleet the conversation's sidebar and branch panel read. */
export const useConversationFleet = (engagementId: string, enabled: boolean) =>
  useQuery({ queryKey: ['real', 'fleet', engagementId], queryFn: () => fetchFleet(engagementId), enabled, refetchInterval: 8000 })

/** Reports the artifact list links to. */
export const useConversationReports = (engagementId: string) =>
  useQuery({ queryKey: ['real', 'reports', engagementId], queryFn: () => fetchReports(engagementId) })
