/**
 * Typed real-mode API adapters (integration tickets 03-04). Every function
 * validates its wire response with the shared web-contracts guards and maps
 * the public DTO onto the console's UI entity shape with explicit unavailable
 * fields — mapping never invents demo values (client, owner, ROE, dates) for
 * data the engagement API does not carry.
 */
import {
  isCapabilitiesDocument,
  isProjectViewModel,
  isPlanningView,
  isRequestRecoveryView,
  isRuntimeContextView,
  isScopedRunView,
  isScopedThreadListView,
  isScopedThreadView,
  isApprovalsView,
  isFindingsView,
  isArtifactsView,
  isArtifactContentView,
  isTimelineView,
  isGraphView,
  isAssetsView,
  type CapabilitiesDocument,
  type Capability,
  type ProjectViewModel,
  type PlanningView,
  type RequestRecoveryView,
  type RuntimeContextView,
  type ScopedRunView,
  type ScopedThreadListView,
  type ScopedThreadView,
  type ThreadKind,
  type ApprovalsView,
  type FindingsView,
  type ArtifactsView,
  type ArtifactContentView,
  type TimelineView,
  type GraphView,
  type AssetsView,
} from '@raptix/web-contracts'
import { apiFetch } from './transport'

export type {
  CapabilitiesDocument, Capability, ProjectViewModel, PlanningView,
  RequestRecoveryView, ScopedRunView, ScopedThreadListView, ScopedThreadView, ThreadKind,
}

/** Response of the workspace-backed HITL decision endpoint. */
export interface ApprovalDecisionView {
  ok: true
  requestId: string
  action: 'allow' | 'deny'
  decidedAtSeconds: number
}

/** Fetches and validates the server's capability document. */
export function fetchCapabilities(): Promise<CapabilitiesDocument> {
  return apiFetch('/capabilities', isCapabilitiesDocument)
}

export function capabilityState(document: CapabilitiesDocument, name: string): Capability | null {
  return document.capabilities[name] ?? null
}

function isProjectViewModelArray(value: unknown): value is ProjectViewModel[] {
  return Array.isArray(value) && value.every(isProjectViewModel)
}

export function listEngagements(): Promise<ProjectViewModel[]> {
  return apiFetch('/engagements', isProjectViewModelArray)
}

export function getEngagement(id: string): Promise<ProjectViewModel> {
  return apiFetch(`/engagements/${encodeURIComponent(id)}`, (v): v is ProjectViewModel => isProjectViewModel(v) && v.id === id)
}

/** The subset of the demo wizard's create fields the engagement contract accepts. */
export interface CreateEngagementInput {
  name: string
  displayName?: string
  targetType: ProjectViewModel['targetType']
  targetValue: string
  authorizationConfirmed: true
  brief?: string
}

export function createEngagement(input: CreateEngagementInput): Promise<ProjectViewModel> {
  return apiFetch('/engagements', isProjectViewModel, { method: 'POST', body: input })
}

/** One-way planning-handoff confirmation (server stamps handoffConfirmedAt). */
export function confirmHandoff(engagementId: string): Promise<ProjectViewModel> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}`, (v): v is ProjectViewModel => isProjectViewModel(v) && v.id === engagementId, {
    method: 'PATCH',
    body: { handoffConfirmed: true },
  })
}

/* ───────────── Planning documents (ticket 04) ───────────── */

export function fetchPlanning(engagementId: string): Promise<PlanningView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/plan-docs`, owned(engagementId, isPlanningView))
}

function owned<T extends { engagementId: string }>(id: string, guard: (v: unknown) => v is T): (v: unknown) => v is T {
  return (v): v is T => guard(v) && v.engagementId === id
}

/* ───────────── Scoped runtime threads (ticket 04) ───────────── */

export interface CreateThreadInput {
  requestId: string
  kind: ThreadKind
  assistantId?: string
}

export function createThread(engagementId: string, input: CreateThreadInput): Promise<RequestRecoveryView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/threads`, (v): v is RequestRecoveryView => isRequestRecoveryView(v) && v.engagementId === engagementId && v.requestId === input.requestId && v.operation === 'create_thread', {
    method: 'POST',
    body: input,
  })
}

export function listThreads(engagementId: string): Promise<ScopedThreadListView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/threads`, (v): v is ScopedThreadListView => isScopedThreadListView(v) && v.engagementId === engagementId && v.threads.every(t => t.engagementId === engagementId))
}

export function getThread(engagementId: string, threadId: string): Promise<ScopedThreadView> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/threads/${encodeURIComponent(threadId)}`,
    (v): v is ScopedThreadView => isScopedThreadView(v) && v.binding.engagementId === engagementId && v.binding.threadId === threadId,
  )
}

export function submitRun(engagementId: string, threadId: string, input: { requestId: string; message: string }): Promise<RequestRecoveryView> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/threads/${encodeURIComponent(threadId)}/runs`,
    (v): v is RequestRecoveryView => isRequestRecoveryView(v) && v.engagementId === engagementId && v.threadId === threadId && v.requestId === input.requestId && v.operation === 'create_run',
    { method: 'POST', body: input },
  )
}

export interface ResumeInput {
  requestId: string
  value?: string | string[]
  questionId?: string
  answers?: { questionId: string; value: string | string[] }[]
}

export function resumeThread(engagementId: string, threadId: string, input: ResumeInput): Promise<RequestRecoveryView> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/threads/${encodeURIComponent(threadId)}/resume`,
    (v): v is RequestRecoveryView => isRequestRecoveryView(v) && v.engagementId === engagementId && v.threadId === threadId && v.requestId === input.requestId && v.operation === 'resume',
    { method: 'POST', body: input },
  )
}

export function getRun(engagementId: string, threadId: string, runId: string): Promise<ScopedRunView> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}`,
    (v): v is ScopedRunView => isScopedRunView(v) && v.engagementId === engagementId && v.threadId === threadId && v.runId === runId,
  )
}

/** Paged owner-scoped run list for one thread. */
export function listRunsOfThread(engagementId: string, threadId: string, offset = 0, limit = 20): Promise<{ runs: ScopedRunView[]; offset: number; nextOffset: number | null }> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/threads/${encodeURIComponent(threadId)}/runs?offset=${offset}&limit=${limit}`,
    (v): v is { runs: ScopedRunView[]; offset: number; nextOffset: number | null } => isRunList(v) && v.runs.every(r => r.engagementId === engagementId && r.threadId === threadId),
  )
}

function isRunList(v: unknown): v is { runs: ScopedRunView[]; offset: number; nextOffset: number | null } {
  if (typeof v !== 'object' || v === null) return false
  const page = v as Record<string, unknown>
  return Array.isArray(page.runs) && page.runs.every(isScopedRunView) && Number.isInteger(page.offset) && Number(page.offset) >= 0 &&
    (page.nextOffset === null || Number.isInteger(page.nextOffset) && Number(page.nextOffset) > Number(page.offset))
}

export function cancelRun(engagementId: string, threadId: string, runId: string): Promise<ScopedRunView> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/cancel`,
    (v): v is ScopedRunView => isScopedRunView(v) && v.engagementId === engagementId && v.threadId === threadId && v.runId === runId,
    { method: 'POST' },
  )
}

export function getRequest(engagementId: string, requestId: string): Promise<RequestRecoveryView> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/requests/${encodeURIComponent(requestId)}`,
    (v): v is RequestRecoveryView => isRequestRecoveryView(v) && v.engagementId === engagementId && v.requestId === requestId,
  )
}

export function reconcileRequest(engagementId: string, requestId: string): Promise<RequestRecoveryView> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/requests/${encodeURIComponent(requestId)}/reconcile`,
    (v): v is RequestRecoveryView => isRequestRecoveryView(v) && v.engagementId === engagementId && v.requestId === requestId,
    { method: 'POST', body: {} },
  )
}

/* ───────────── Execution runtime (ticket 05) ───────────── */

/** Server-verified runtime context; `executionReady` gates execution runs. */
export function fetchRuntimeContext(engagementId: string, kind: ThreadKind, threadId: string): Promise<RuntimeContextView> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/runtime-context?kind=${encodeURIComponent(kind)}&threadId=${encodeURIComponent(threadId)}`,
    (v): v is RuntimeContextView => isRuntimeContextView(v) && v.engagementId === engagementId && v.kind === kind,
  )
}

export function fetchApprovals(engagementId: string): Promise<ApprovalsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/approvals`, (v): v is ApprovalsView => isApprovalsView(v) && v.engagementId === engagementId && v.approvals.every(a => a.engagementId === engagementId))
}

export function decideApproval(
  engagementId: string,
  input: { requestId: string; action: 'allow' | 'deny'; operatorNote?: string },
): Promise<ApprovalDecisionView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/approvals`, isApprovalDecision, {
    method: 'POST',
    body: input,
  })
}

function isApprovalDecision(v: unknown): v is ApprovalDecisionView {
  return typeof v === 'object' && v !== null && (v as Record<string, unknown>).ok === true &&
    typeof (v as Record<string, unknown>).requestId === 'string' &&
    ((v as Record<string, unknown>).action === 'allow' || (v as Record<string, unknown>).action === 'deny') &&
    typeof (v as Record<string, unknown>).decidedAtSeconds === 'number'
}

/* ───────────── Observed results (ticket 06, read-only) ───────────── */

export function fetchFindings(engagementId: string): Promise<FindingsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/findings`, (v): v is FindingsView => isFindingsView(v) && v.engagementId === engagementId && v.findings.every(f => f.engagementId === engagementId))
}

export function fetchArtifacts(engagementId: string): Promise<ArtifactsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/artifacts`, owned(engagementId, isArtifactsView))
}

export function fetchArtifactContent(engagementId: string, path: string): Promise<ArtifactContentView> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/artifacts/content?path=${encodeURIComponent(path)}`,
    (v): v is ArtifactContentView => isArtifactContentView(v) && v.engagementId === engagementId && v.path === path,
  )
}

export function fetchTimeline(engagementId: string): Promise<TimelineView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/timeline`, owned(engagementId, isTimelineView))
}

export function fetchGraph(engagementId: string): Promise<GraphView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/graph`, owned(engagementId, isGraphView))
}

export function fetchAssets(engagementId: string): Promise<AssetsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/assets`, owned(engagementId, isAssetsView))
}

/**
 * Maps the public engagement DTO onto the console's UI Project entity.
 * Fields with no engagement-API source are explicit neutral values, never
 * fabricated: the portfolio/ribbon render them as unavailable rather than
 * as demo-shaped facts. `lifecycleStatus` maps 1:1 (raw status is kept).
 */
export function engagementToProject(dto: ProjectViewModel): import('../domain/entities').Project {
  return {
    id: dto.id,
    name: dto.displayName,
    client: '',
    owner: '',
    type: dto.targetType,
    status: dto.lifecycleStatus,
    start: '',
    end: '',
    tz: 'UTC',
    desc: dto.brief ?? '',
    pinned: false,
    roeStatus: 'none',
    roeVersion: '',
    window: '',
    emergency: '',
    methods: [],
    restrictions: [],
    objectives: [],
    members: [],
    updated: dto.updatedAt,
  }
}
