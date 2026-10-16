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
  isVaultView,
  isVaultRevealView,
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
  type VaultView,
  type VaultSecretView,
  type VaultRevealView,
  type C2View,
  type C2CommandView,
  type CampaignProviderCapabilities,
  type CampaignsView,
  type CampaignView,
  type CampaignJobView,
  type CampaignVector,
  isC2View,
isC2Listener,
isC2Profile,
  isC2CommandView,
  isCampaignProviderCapabilities,
  isCampaignsView,
  isCampaignView,
  isCampaignJobView,
} from '@raptix/web-contracts'
import { apiFetch, ApiTransportError, setCsrfToken } from './transport'

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

/** W22: edit the display name, primary target and brief on the project detail Settings tab. */
export function patchEngagement(engagementId: string, input: { displayName?: string; targetValue?: string; brief?: string }): Promise<ProjectViewModel> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}`, (v): v is ProjectViewModel => isProjectViewModel(v) && v.id === engagementId, {
    method: 'PATCH',
    body: input,
  })
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Planning documents (ticket 04) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export function fetchPlanning(engagementId: string): Promise<PlanningView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/plan-docs`, owned(engagementId, isPlanningView))
}

function owned<T extends { engagementId: string }>(id: string, guard: (v: unknown) => v is T): (v: unknown) => v is T {
  return (v): v is T => guard(v) && v.engagementId === id
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Scoped runtime threads (ticket 04) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Execution runtime (ticket 05) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Observed results (ticket 06, read-only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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

export interface RetainedCaptureView { engagementId: string; path: string; digest: string; sizeBytes: number; producer: string | null }
export function uploadCapture(engagementId: string, input: { base64: string; mediaType: string }): Promise<RetainedCaptureView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/artifacts/captures`, owned(engagementId, (v): v is RetainedCaptureView => typeof v === 'object' && v !== null && typeof (v as RetainedCaptureView).path === 'string' && /^[a-f0-9]{64}$/.test((v as RetainedCaptureView).digest)), { method: 'POST', body: input })
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

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Identity + team (integration ticket 07) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

import { isMembersView, type MembersView } from '@raptix/web-contracts'

/** Response of GET /api/auth/session (multi-user deployments; local 404s). */
export interface AuthSessionView {
  authenticated: boolean
  actor?: { id: string; username: string; displayName: string }
  csrfToken?: string
  mode: 'multi-user'
}

function isAuthSessionView(v: unknown): v is AuthSessionView {
  return typeof v === 'object' && v !== null && typeof (v as AuthSessionView).authenticated === 'boolean'
    && (v as AuthSessionView).mode === 'multi-user'
}

/**
 * Resolves the trusted session. A 404 (or any failure that says the route is
 * absent) means the server runs the local single-user identity — the caller
 * falls back to REAL_IDENTITY instead of inventing a session.
 */
export async function fetchAuthSession(): Promise<AuthSessionView | null> {
  try {
    const session = await apiFetch('/auth/session', isAuthSessionView)
    setCsrfToken(session.authenticated ? session.csrfToken ?? null : null)
    return session
  } catch (error) {
    setCsrfToken(null)
    if (error instanceof ApiTransportError && error.status === 404) return null
    throw error
  }
}

export interface LoginInput { username: string; password: string }

function announceSessionChange(): void {
  try { localStorage.setItem('raptix.session-change', crypto.randomUUID()) } catch { /* focus revalidation also covers unavailable storage */ }
  window.dispatchEvent(new Event('raptix:session-change'))
}

export async function login(input: LoginInput): Promise<AuthSessionView> {
  const view = await apiFetch('/auth/login', isAuthSessionView, { method: 'POST', body: input })
  setCsrfToken(view.csrfToken ?? null)
  announceSessionChange()
  return view
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', (v): v is { authenticated: boolean } => typeof v === 'object' && v !== null && typeof (v as { authenticated: unknown }).authenticated === 'boolean', { method: 'POST' })
    announceSessionChange()
  } finally {
    setCsrfToken(null)
  }
}

export function fetchMembers(engagementId: string): Promise<MembersView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/members`, owned(engagementId, isMembersView))
}

export interface InviteMemberInput { username: string; displayName?: string; password: string; role: 'operator' | 'reviewer' | 'viewer' }

export function inviteMember(engagementId: string, input: InviteMemberInput): Promise<{ ok: true; memberId: string }> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/members`, (v): v is { ok: true; memberId: string } =>
    typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === true && typeof (v as { memberId?: unknown }).memberId === 'string',
  { method: 'POST', body: input })
}

export function updateMemberRole(engagementId: string, memberId: string, role: 'operator' | 'reviewer' | 'viewer'): Promise<{ ok: true; role: string }> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/members/${encodeURIComponent(memberId)}`, (v): v is { ok: true; role: string } =>
    typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === true && typeof (v as { role?: unknown }).role === 'string',
  { method: 'PATCH', body: { role } })
}

export function removeMember(engagementId: string, memberId: string): Promise<{ ok: true }> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/members/${encodeURIComponent(memberId)}`, (v): v is { ok: true } =>
    typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === true,
  { method: 'DELETE' })
}

/* ───────────── Scope/ROE governance (integration ticket 08) ───────────── */

export interface ScopeRevisionView {
  id: string
  engagementId: string
  version: number
  status: 'pending' | 'approved' | 'rejected' | 'superseded'
  diff: { added: string[]; removed: string[]; rationale: string }
  roe: { windows: { start: string; end: string; tz: string }[]; emergencyContacts: string[]; restrictions: string[] }
  requestedBy: string
  decidedBy: string | null
  decidedAt: string | null
  decisionComment: string | null
  createdAt: string
}

export interface ScopeRevisionsView {
  engagementId: string
  revisions: ScopeRevisionView[]
  latestApprovedVersion: number | null
  submitSupported: true
  source: 'db'
}

function isScopeRevisionsView(v: unknown): v is ScopeRevisionsView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as ScopeRevisionsView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.revisions) && doc.source === 'db'
    && doc.revisions.every((r) => typeof r.id === 'string' && typeof r.version === 'number' && typeof r.status === 'string'
      && typeof r.diff === 'object' && Array.isArray(r.diff.added) && typeof r.roe === 'object')
}

export function fetchScopeRevisions(engagementId: string): Promise<ScopeRevisionsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/scope/revisions`, owned(engagementId, isScopeRevisionsView))
}

export interface SubmitScopeRevisionInput {
  diff: { added: string[]; removed: string[]; rationale: string }
  roe: { windows: { start: string; end: string; tz: string }[]; emergencyContacts: string[]; restrictions: string[] }
}

export function submitScopeRevision(engagementId: string, input: SubmitScopeRevisionInput): Promise<ScopeRevisionView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/scope/revisions`, (v): v is ScopeRevisionView =>
    typeof v === 'object' && v !== null && typeof (v as ScopeRevisionView).id === 'string' && typeof (v as ScopeRevisionView).version === 'number',
  { method: 'POST', body: input })
}

export function decideScopeRevision(engagementId: string, revisionId: string, decision: 'approved' | 'rejected'): Promise<ScopeRevisionView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/scope/revisions/${encodeURIComponent(revisionId)}/decision`, (v): v is ScopeRevisionView =>
    typeof v === 'object' && v !== null && (v as ScopeRevisionView).status === decision,
  { method: 'POST', body: { decision } })
}

/** W07-3: cumulative effective scope snapshot (ADR-0072 read bridge). */
export interface EffectiveScopeView {
  engagementId: string
  version: number | null
  rootTarget: string | null
  inScope: string[]
  roe: { windows: { start: string; end: string; tz: string }[]; emergencyContacts: string[]; restrictions: string[] }
  source: 'db'
}

function isEffectiveScopeView(v: unknown): v is EffectiveScopeView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as EffectiveScopeView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.inScope) && doc.source === 'db'
}

export function fetchEffectiveScope(engagementId: string): Promise<EffectiveScopeView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/scope/effective`, owned(engagementId, isEffectiveScopeView))
}

export interface AssetInventoryView {
  engagementId: string
  assets: { id: string; engagementId: string; identifier: string; kind: string; classification: 'pending' | 'in_scope' | 'out_of_scope'; observed: boolean; version: number; updatedAt: string }[]
  latestApprovedVersion: number | null
  source: 'db'
}

function isAssetInventoryView(v: unknown): v is AssetInventoryView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as AssetInventoryView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.assets) && doc.source === 'db'
}

export function fetchAssetInventory(engagementId: string): Promise<AssetInventoryView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/assets/inventory`, owned(engagementId, isAssetInventoryView))
}

export function importAssets(engagementId: string, identifiers: string[], kind: 'host' | 'web_url' | 'ip_range'): Promise<{ imported: number; skipped: number }> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/assets/inventory/import`, (v): v is { imported: number; skipped: number } =>
    typeof v === 'object' && v !== null && typeof (v as { imported?: unknown }).imported === 'number',
  { method: 'POST', body: { identifiers, kind } })
}

export function classifyAsset(engagementId: string, assetId: string, classification: 'in_scope' | 'out_of_scope' | 'pending', expectedVersion?: number): Promise<unknown> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/assets/inventory/${encodeURIComponent(assetId)}`, (v): v is { ok: true } =>
    typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === true,
  { method: 'PATCH', body: { classification, ...(expectedVersion === undefined ? {} : { expectedVersion }) } })
}

/* ───────────── Governed plans/preflight/estop (integration ticket 09) ───────────── */

export interface PlanView {
  id: string
  engagementId: string
  version: number
  status: 'draft' | 'proposed' | 'approved' | 'rejected' | 'superseded'
  objective: string
  methods: string[]
  requestedBy: string
  decidedBy: string | null
  decidedAt: string | null
  decisionComment: string | null
  expiresAt: string | null
  roeVersion: number | null
  createdAt: string
}

export interface PlansView {
  engagementId: string
  plans: PlanView[]
  latestApprovedScopeVersion: number | null
  deadlineHours: number
  source: 'db'
}

function isPlansView(v: unknown): v is PlansView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as PlansView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.plans) && doc.source === 'db'
    && doc.plans.every((p) => typeof p.id === 'string' && typeof p.version === 'number' && typeof p.status === 'string')
}

export function fetchPlans(engagementId: string): Promise<PlansView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/plans`, owned(engagementId, isPlansView))
}

export function savePlan(engagementId: string, input: { objective: string; methods: string[] }): Promise<PlanView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/plans`, (v): v is PlanView =>
    typeof v === 'object' && v !== null && typeof (v as PlanView).id === 'string' && (v as PlanView).status === 'draft',
  { method: 'POST', body: input })
}

export function proposePlan(engagementId: string, planId: string): Promise<PlanView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/plans/${encodeURIComponent(planId)}/propose`, (v): v is PlanView =>
    typeof v === 'object' && v !== null && (v as PlanView).status === 'proposed',
  { method: 'POST' })
}

export function decidePlan(engagementId: string, planId: string, decision: 'approved' | 'rejected', expectedVersion: number): Promise<PlanView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/plans/${encodeURIComponent(planId)}/decision`, (v): v is PlanView =>
    typeof v === 'object' && v !== null && (v as PlanView).status === decision,
  { method: 'POST', body: { decision, expectedVersion } })
}

/** Revises a reviewed plan: the reviewed version stays untouched; a new draft at the next version carries the body. */
export function revisePlan(engagementId: string, planId: string, input: { objective: string; methods: string[] }): Promise<PlanView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/plans/${encodeURIComponent(planId)}/revisions`, (v): v is PlanView =>
    typeof v === 'object' && v !== null && (v as PlanView).status === 'draft',
    { method: 'POST', body: input })
}

export interface PlanComparisonView {
  base: PlanView
  revision: PlanView
  source: 'db'
}

export function comparePlans(engagementId: string, planId: string, baseId: string): Promise<PlanComparisonView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/plans/${encodeURIComponent(planId)}/compare?baseId=${encodeURIComponent(baseId)}`, (v): v is PlanComparisonView =>
    typeof v === 'object' && v !== null && typeof (v as PlanComparisonView).base === 'object' && typeof (v as PlanComparisonView).revision === 'object')
}

export interface PreflightView {
  engagementId: string
  ok: boolean
  checks: { id: string; state: 'pass' | 'fail' | 'unavailable'; detail: string | null }[]
  source: 'db'
}

function isPreflightView(v: unknown): v is PreflightView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as PreflightView
  return typeof doc.engagementId === 'string' && typeof doc.ok === 'boolean' && Array.isArray(doc.checks) && doc.source === 'db'
}

export function fetchPreflight(engagementId: string, threadId?: string): Promise<PreflightView> {
  const qs = threadId !== undefined && threadId !== '' ? `?threadId=${encodeURIComponent(threadId)}` : ''
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/preflight${qs}`, owned(engagementId, isPreflightView))
}

export interface OperationBindingView {
  id: string
  engagementId: string
  planId: string
  planVersion: number
  threadId: string | null
  status: string
  concurrencyVersion: number
  createdBy: string
  createdAt: string
}

export function bindPlan(engagementId: string, planId: string, threadId: string): Promise<OperationBindingView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/bindings`, (v): v is OperationBindingView =>
    typeof v === 'object' && v !== null && typeof (v as OperationBindingView).id === 'string' && (v as OperationBindingView).status === 'bound',
    { method: 'POST', body: { planId, threadId } })
}

export interface EmergencyStopView {
  id: string
  engagementId: string
  scope: 'operation' | 'project' | 'workspace'
  targetId: string | null
  requestedBy: string
  outcome: 'requested' | 'acknowledged' | 'stopped' | 'failed' | 'unknown' | 'resolved'
  reason: string
  concurrencyVersion: number
  createdAt: string
  updatedAt: string
  /** W10/ADR-0074: sibling latches a workspace stop recorded in other owned engagements. */
  related?: EmergencyStopView[]
}

/** Outcomes that block work start until an explicit resolution (server contract). */
export const ACTIVE_STOP_OUTCOMES = ['requested', 'acknowledged', 'stopped', 'failed', 'unknown'] as const

export function requestEmergencyStop(engagementId: string, input: { scope: 'operation' | 'project' | 'workspace'; reason: string; threadId?: string }): Promise<EmergencyStopView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/estops`, (v): v is EmergencyStopView =>
    typeof v === 'object' && v !== null && typeof (v as EmergencyStopView).id === 'string' && typeof (v as EmergencyStopView).outcome === 'string',
  { method: 'POST', body: input })
}

export interface EmergencyStopsView {
  engagementId: string
  stops: EmergencyStopView[]
  source: 'db'
}

function isEmergencyStopsView(v: unknown): v is EmergencyStopsView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as EmergencyStopsView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.stops) && doc.source === 'db'
}

export function fetchEmergencyStops(engagementId: string): Promise<EmergencyStopsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/estops`, owned(engagementId, isEmergencyStopsView))
}

/** W10: explicit resolution records why work may restart; it never resumes anything. The version guards against stale resolvers. */
export function resolveEmergencyStop(engagementId: string, stopId: string, reason: string, concurrencyVersion: number): Promise<EmergencyStopView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/estops/${encodeURIComponent(stopId)}/resolve`, (v): v is EmergencyStopView =>
    typeof v === 'object' && v !== null && (v as EmergencyStopView).outcome === 'resolved',
  { method: 'POST', body: { reason, concurrencyVersion } })
}

/* ───────────── W11 operation schedules (ADR-0073 durable execution intents) ───────────── */

export type ScheduleStatus = 'scheduled' | 'claimed' | 'dispatched' | 'refused' | 'canceled' | 'missed' | 'uncertain'

export interface ScheduleView {
  id: string
  engagementId: string
  planId: string
  threadId: string
  requestId: string
  status: ScheduleStatus
  version: number
  executeAt: string
  timezone: string
  reason: string
  runId: string | null
  outcomeDetail: string | null
  claimedBy: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface SchedulesView {
  engagementId: string
  schedules: ScheduleView[]
  source: 'db'
}

function isSchedulesView(v: unknown): v is SchedulesView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as SchedulesView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.schedules) && doc.source === 'db'
    && doc.schedules.every((s) => typeof s.id === 'string' && typeof s.status === 'string' && typeof s.version === 'number')
}

export function fetchSchedules(engagementId: string): Promise<SchedulesView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/schedules`, owned(engagementId, isSchedulesView))
}

export function createSchedule(engagementId: string, input: { planId: string; threadId: string; executeAt: string; timezone: string; reason: string; requestId: string }): Promise<ScheduleView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/schedules`, (v): v is ScheduleView =>
    typeof v === 'object' && v !== null && (v as ScheduleView).status === 'scheduled',
  { method: 'POST', body: input })
}

export function cancelSchedule(engagementId: string, scheduleId: string): Promise<ScheduleView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/schedules/${encodeURIComponent(scheduleId)}/cancel`, (v): v is ScheduleView =>
    typeof v === 'object' && v !== null && (v as ScheduleView).status === 'canceled',
  { method: 'POST' })
}

export function rescheduleSchedule(engagementId: string, scheduleId: string, input: { executeAt: string; timezone: string; expectedVersion: number }): Promise<ScheduleView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/schedules/${encodeURIComponent(scheduleId)}/reschedule`, (v): v is ScheduleView =>
    typeof v === 'object' && v !== null && typeof (v as ScheduleView).version === 'number',
  { method: 'POST', body: input })
}

/* ───────────── Curated findings/evidence (integration ticket 10) ───────────── */

export interface CuratedFindingView {
  id: string
  engagementId: string
  title: string
  severity: string
  status: string
  body: { detail: string }
  expectedVersion: number
  sourceType: 'authored' | 'imported'
  producerRef: string | null
  /** W19: true when the producer reference resolved through the retained artifact authority. */
  producerResolved?: boolean
  createdBy: string
  updatedBy: string | null
  updatedAt: string
  evidence: { id: string; kind: 'artifact' | 'digest'; artifactPath: string | null; digest: string | null; producer: string | null; createdAt: string }[]
}

export interface CuratedFindingsView {
  engagementId: string
  findings: CuratedFindingView[]
  transitions: Record<string, string[]>
  source: 'db'
}

function isCuratedFindingsView(v: unknown): v is CuratedFindingsView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as CuratedFindingsView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.findings) && doc.source === 'db' && typeof doc.transitions === 'object'
}

export function fetchCuratedFindings(engagementId: string): Promise<CuratedFindingsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/curated-findings`, owned(engagementId, isCuratedFindingsView))
}

export function createCuratedFinding(engagementId: string, input: { title: string; severity: string; detail: string }): Promise<CuratedFindingView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/curated-findings`, (v): v is CuratedFindingView =>
    typeof v === 'object' && v !== null && typeof (v as CuratedFindingView).id === 'string' && (v as CuratedFindingView).status === 'draft',
  { method: 'POST', body: input })
}

export function importCuratedFinding(engagementId: string, input: { title: string; severity: string; detail: string; producerRef: string }): Promise<CuratedFindingView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/curated-findings/import`, owned(engagementId, (v): v is CuratedFindingView => typeof v === 'object' && v !== null && (v as CuratedFindingView).sourceType === 'imported' && (v as CuratedFindingView).status === 'draft'), { method: 'POST', body: input })
}

export function updateCuratedFinding(engagementId: string, findingId: string, input: { expectedVersion: number; title: string; severity: string; detail: string }): Promise<CuratedFindingView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/curated-findings/${encodeURIComponent(findingId)}`, owned(engagementId, (v): v is CuratedFindingView => typeof v === 'object' && v !== null && (v as CuratedFindingView).id === findingId && Number.isInteger((v as CuratedFindingView).expectedVersion)), { method: 'PATCH', body: input })
}

export function transitionCuratedFinding(engagementId: string, findingId: string, to: string, expectedVersion: number): Promise<CuratedFindingView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/curated-findings/${encodeURIComponent(findingId)}/transition`, (v): v is CuratedFindingView =>
    typeof v === 'object' && v !== null && typeof (v as CuratedFindingView).status === 'string',
  { method: 'POST', body: { to, expectedVersion } })
}

export function attachEvidence(engagementId: string, findingId: string, input: { kind: 'artifact' | 'digest'; artifactPath?: string; digest?: string; producer?: string }): Promise<{ id: string; kind: string }> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/curated-findings/${encodeURIComponent(findingId)}/evidence`, (v): v is { id: string; kind: string } =>
    typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string',
  { method: 'POST', body: input })
}

/* ───────────── Report lifecycle/delivery (integration ticket 11) ───────────── */

export interface ReportView {
  id: string
  engagementId: string
  title: string
  version: number
  status: 'draft' | 'in_review' | 'approved' | 'changes_requested' | 'delivered'
  body: { summary: string; sections: { title: string; content: string }[] }
  createdBy: string
  reviewedBy: string | null
  reviewedAt: string | null
  reviewComment: string | null
  approvedVersion: number | null
  updatedAt: string
  deliveries: { id: string; kind: string; format: string; status: string; createdAt: string }[]
}

export interface ReportsView {
  engagementId: string
  reports: ReportView[]
  exportFormats: string[]
  source: 'db'
}

function isReportsView(v: unknown): v is ReportsView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as ReportsView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.reports) && doc.source === 'db'
}

export function fetchReports(engagementId: string): Promise<ReportsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-records`, owned(engagementId, isReportsView))
}

export function createReport(engagementId: string, input: { title: string; summary: string }): Promise<ReportView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-records`, (v): v is ReportView =>
    typeof v === 'object' && v !== null && typeof (v as ReportView).id === 'string' && (v as ReportView).status === 'draft',
  { method: 'POST', body: input })
}

export function decideReportReview(engagementId: string, reportId: string, body: Record<string, unknown>): Promise<ReportView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-records/${encodeURIComponent(reportId)}/review`, (v): v is ReportView =>
    typeof v === 'object' && v !== null && typeof (v as ReportView).status === 'string',
  { method: 'POST', body })
}

export function deliverReport(engagementId: string, reportId: string, input: { kind: 'export' | 'delivery'; format: string; requestId: string; expectedVersion?: number; recipient?: string; receipt?: string }): Promise<ReportView & { artifact: { reportId: string; version: number; format: string; mediaType: string; content: string; digest: string } }> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-records/${encodeURIComponent(reportId)}/deliveries`, (v): v is ReportView & { artifact: { reportId: string; version: number; format: string; mediaType: string; content: string; digest: string } } =>
    typeof v === 'object' && v !== null && typeof (v as { artifact?: { content?: unknown } }).artifact?.content === 'string' && typeof (v as { artifact?: { digest?: unknown } }).artifact?.digest === 'string',
  { method: 'POST', body: input })
}

/** W20: a fresh draft revision of an approved/delivered report; the reviewed snapshot stays immutable. */
export function reviseReport(engagementId: string, reportId: string, input: { expectedVersion: number }): Promise<ReportView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-records/${encodeURIComponent(reportId)}/revision`, (v): v is ReportView =>
    typeof v === 'object' && v !== null && (v as ReportView).status === 'draft' && (v as ReportView).version === 1,
  { method: 'POST', body: input })
}

/* ───────────── C2 session grants (integration ticket 12) ───────────── */

export interface C2GrantView {
  id: string
  engagementId: string
  sessionId: string
  actorId: string
  reviewerId: string | null
  status: 'requested' | 'approved' | 'rejected' | 'revoked' | 'expired'
  reason: string
  commandPrefix: string | null
  expiresAt: string
  createdAt: string
}

export interface C2GrantsView {
  engagementId: string
  grants: C2GrantView[]
  /** W14: effective enforced bounds from the server — never a hard-coded clamp. */
  minGrantHours: number
  maxGrantHours: number
  source: 'db'
}

function isC2GrantsView(v: unknown): v is C2GrantsView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as C2GrantsView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.grants) && doc.source === 'db'
}

export function fetchC2Grants(engagementId: string): Promise<C2GrantsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/grants`, owned(engagementId, isC2GrantsView))
}

export function requestC2Grant(engagementId: string, input: { sessionId: string; reason: string; expiresAt: string }): Promise<C2GrantView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/grants`, (v): v is C2GrantView =>
    typeof v === 'object' && v !== null && typeof (v as C2GrantView).id === 'string' && (v as C2GrantView).status === 'requested',
  { method: 'POST', body: input })
}

export function decideC2Grant(engagementId: string, grantId: string, decision: 'approved' | 'rejected' | 'revoked'): Promise<C2GrantView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/grants/${encodeURIComponent(grantId)}/decision`, (v): v is C2GrantView =>
    typeof v === 'object' && v !== null && typeof (v as C2GrantView).status === 'string',
  { method: 'POST', body: { decision } })
}

/* ───────────── C2 provider console (integration ticket 12): real sessions and the durable command audit ───────────── */

export function fetchC2Sessions(engagementId: string): Promise<C2View> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/sessions`, (v): v is C2View =>
    isC2View(v) && v.engagementId === engagementId)
}

export function dispatchC2Command(engagementId: string, sessionId: string, input: { requestId: string; path: string; args: string[] }): Promise<C2CommandView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/sessions/${encodeURIComponent(sessionId)}/commands`, isC2CommandView,
    { method: 'POST', body: input })
}

export function fetchC2Commands(engagementId: string): Promise<C2CommandView[]> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/commands`, (v): v is C2CommandView[] =>
    Array.isArray(v) && v.every(isC2CommandView))
}

export function reconcileC2Command(engagementId: string, commandId: string): Promise<C2CommandView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/commands/${encodeURIComponent(commandId)}/reconcile`, isC2CommandView,
    { method: 'POST', body: {} })
}

/* W15: real provider management — listeners and lab profiles, per the provider contract. */

export function configureC2Listener(engagementId: string, protocol: 'mtls' | 'http'): Promise<Record<string, unknown>> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/listeners`, (v): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && isC2Listener((v as { listener?: unknown }).listener),
  { method: 'POST', body: { protocol } })
}

export function configureC2Profile(engagementId: string, name: string): Promise<Record<string, unknown>> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/profiles`, (v): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && isC2Profile((v as { profile?: unknown }).profile),
  { method: 'POST', body: { name } })
}

export function stopC2Listener(engagementId: string, jobId: number): Promise<Record<string, unknown>> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/listeners/${encodeURIComponent(String(jobId))}`, (v): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null,
  { method: 'DELETE' })
}

/* ───────────── Campaign drafts and provider jobs (integration ticket 12, D5 placement) ───────────── */

export function fetchCampaignCapabilities(engagementId: string): Promise<CampaignProviderCapabilities> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/campaigns/capabilities`, (v): v is CampaignProviderCapabilities =>
    isCampaignProviderCapabilities(v) && v.engagementId === engagementId)
}

export function fetchCampaigns(engagementId: string): Promise<CampaignsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/campaigns`, (v): v is CampaignsView =>
    isCampaignsView(v) && v.engagementId === engagementId)
}

export interface GoPhishAssetsInput { templateId: number; pageId: number; groupId: number; smtpId: number }

export function createCampaign(engagementId: string, input: { name: string; vector: CampaignVector; scenario?: string; gophish?: GoPhishAssetsInput; evilginxLab?: boolean }): Promise<CampaignView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/campaigns`, (v): v is CampaignView =>
    isCampaignView(v) && v.status === 'draft',
    {
      method: 'POST',
      body: {
        name: input.name,
        vector: input.vector,
        ...(input.scenario !== undefined ? { scenario: input.scenario } : {}),
        ...(input.gophish !== undefined ? { gophish: input.gophish } : {}),
        ...(input.evilginxLab === true ? { evilginx: { profile: 'lab' } } : {}),
      },
    })
}

export function runCampaignJob(engagementId: string, campaignId: string, kind: 'generate' | 'deploy', intent: { requestId: string; version: number }): Promise<CampaignJobView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/campaigns/${encodeURIComponent(campaignId)}/${kind}`, isCampaignJobView,
    { method: 'POST', body: intent })
}

export function reconcileCampaignJob(engagementId: string, campaignId: string, jobId: string): Promise<CampaignJobView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/campaigns/${encodeURIComponent(campaignId)}/jobs/${encodeURIComponent(jobId)}/reconcile`, isCampaignJobView,
    { method: 'POST', body: {} })
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

function isFleetView(v: unknown): v is FleetView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as FleetView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.agents) && Array.isArray(doc.threads) && Array.isArray(doc.branches) && doc.source === 'runtime'
}

export function fetchFleet(engagementId: string): Promise<FleetView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/fleet`, owned(engagementId, isFleetView))
}

/* ───────────── Tradecraft library and observed analysis (integration ticket 14) ───────────── */

export interface LibrarySkillView {
  name: string
  description: string | null
  subdomain: string | null
  mitreIds: string[]
  whenToUse: string | null
  path: string | null
}

export interface LibraryView {
  skills: LibrarySkillView[]
  counts: { skills: number; techniques: number | null }
  excludedActions: string[]
  sources: { skills: string }
  source: 'graph'
}

function isLibraryView(v: unknown): v is LibraryView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as LibraryView
  return Array.isArray(doc.skills) && typeof doc.counts === 'object' && doc.source === 'graph'
}

export function fetchLibrary(): Promise<LibraryView> {
  return apiFetch('/library', isLibraryView)
}

/** Canonical single-skill detail (the graph Skill node is the only publication). */
export interface LibrarySkillDetailView {
  name: string
  description: string | null
  subdomain: string | null
  mitreIds: string[]
  whenToUse: string | null
  path: string | null
  body: string
  contentSha256: string | null
  commitSha: string | null
  allowedTools: string[]
  publication: 'canonical'
}

export function fetchLibrarySkill(name: string): Promise<LibrarySkillDetailView> {
  return apiFetch(`/library/skills/${encodeURIComponent(name)}`, (v): v is LibrarySkillDetailView =>
    typeof v === 'object' && v !== null && (v as LibrarySkillDetailView).publication === 'canonical' && typeof (v as LibrarySkillDetailView).body === 'string')
}

export interface LibraryTechniqueDetailView {
  id: string
  name: string | null
  description: string | null
  url: string | null
  skills: { name: string }[]
}

export function fetchLibraryTechnique(id: string): Promise<LibraryTechniqueDetailView> {
  return apiFetch(`/library/techniques/${encodeURIComponent(id)}`, (v): v is LibraryTechniqueDetailView =>
    typeof v === 'object' && v !== null && typeof (v as LibraryTechniqueDetailView).id === 'string' && Array.isArray((v as LibraryTechniqueDetailView).skills))
}

/** ADR-0070 engagement-scoped library review proposals (never a corpus mutation API). */
export interface LibraryProposalReviewView {
  id: string
  proposalVersion: number
  decision: 'approved' | 'rejected'
  comment: string | null
  reviewerId: string
  createdAt: string
}

export interface LibraryProposalView {
  id: string
  engagementId: string
  skillName: string
  skillPath: string
  baseRevision: string
  status: 'draft' | 'proposed' | 'approved' | 'rejected'
  version: number
  proposedBody: string
  baseBody: string
  rationale: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  reviews: LibraryProposalReviewView[]
  canonicalCurrent?: boolean
}

function isLibraryProposalView(v: unknown): v is LibraryProposalView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as LibraryProposalView
  return typeof doc.id === 'string' && typeof doc.skillName === 'string' && typeof doc.version === 'number' && Array.isArray(doc.reviews)
}

export function fetchLibraryProposals(engagementId: string): Promise<{ engagementId: string; proposals: LibraryProposalView[]; source: 'db' }> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/library-proposals`, (v): v is { engagementId: string; proposals: LibraryProposalView[]; source: 'db' } =>
    typeof v === 'object' && v !== null && Array.isArray((v as { proposals?: unknown }).proposals) && (v as { source?: unknown }).source === 'db')
}

/** W18: detail read by proposal id — the only place canonicalCurrent is authoritative. */
export function fetchLibraryProposal(engagementId: string, proposalId: string): Promise<LibraryProposalView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/library-proposals/${encodeURIComponent(proposalId)}`, (v): v is LibraryProposalView =>
    isLibraryProposalView(v) && (v as LibraryProposalView).engagementId === engagementId)
}

export function submitLibraryProposal(engagementId: string, input: { skillName: string; proposedBody: string; rationale?: string }): Promise<LibraryProposalView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/library-proposals`, (v): v is LibraryProposalView =>
    isLibraryProposalView(v) && v.status === 'draft' && v.version === 1,
  { method: 'POST', body: input })
}

export function amendLibraryProposal(engagementId: string, proposalId: string, input: { proposedBody: string; expectedVersion: number; rationale?: string }): Promise<LibraryProposalView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/library-proposals/${encodeURIComponent(proposalId)}/amendments`, isLibraryProposalView,
    { method: 'POST', body: input })
}

export function proposeLibraryProposal(engagementId: string, proposalId: string): Promise<LibraryProposalView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/library-proposals/${encodeURIComponent(proposalId)}/propose`, (v): v is LibraryProposalView =>
    isLibraryProposalView(v) && v.status === 'proposed',
  { method: 'POST' })
}

export function decideLibraryProposal(engagementId: string, proposalId: string, input: { decision: 'approved' | 'rejected'; expectedVersion: number; comment?: string }): Promise<LibraryProposalView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/library-proposals/${encodeURIComponent(proposalId)}/decision`, (v): v is LibraryProposalView =>
    isLibraryProposalView(v) && (v.status === 'approved' || v.status === 'rejected'),
  { method: 'POST', body: input })
}

export interface LibraryProposalExportView {
  kind: 'library-body-replacement-proposal'
  proposal: { id: string; engagementId: string; skillName: string; skillPath: string; baseRevision: string; status: string; version: number; createdBy: string }
  base: { body: string; revision: string }
  proposed: { body: string }
  diff: { before: string; after: string }
  reviews: LibraryProposalReviewView[]
  publicationContract: string[]
}

export function exportLibraryProposal(engagementId: string, proposalId: string): Promise<LibraryProposalExportView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/library-proposals/${encodeURIComponent(proposalId)}/export`, (v): v is LibraryProposalExportView =>
    typeof v === 'object' && v !== null && (v as LibraryProposalExportView).kind === 'library-body-replacement-proposal' && Array.isArray((v as LibraryProposalExportView).publicationContract))
}

export interface ObservedTechniqueView {
  techniqueId: string
  label: string | null
  nodeIds: string[]
}

export interface AnalysisPathView {
  id: string
  steps: { nodeId: string; techniqueId: string | null; label: string | null }[]
}

export interface AnalysisView {
  engagementId: string
  observed: ObservedTechniqueView[]
  coverage: { observedTechniques: number; corpusTechniques: number | null; inCorpus: number | null }
  paths: AnalysisPathView[]
  quality: { graph: 'available' | 'empty'; truncated: boolean }
  excludedActions: string[]
  source: 'graph'
}

function isAnalysisView(v: unknown): v is AnalysisView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as AnalysisView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.observed) && Array.isArray(doc.paths) && doc.source === 'graph'
}

export function fetchAnalysis(engagementId: string): Promise<AnalysisView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/analysis`, owned(engagementId, isAnalysisView))
}

/* ───────────── Command center, tasks and notices (integration ticket 15) ───────────── */

export interface TaskItemView {
  kind: 'scope-revision' | 'business-plan' | 'c2-grant' | 'report-review' | 'finding-review' | 'active-stop'
  engagementId: string
  engagementName: string | null
  refId: string
  title: string
  createdAt: string
  href: string
  awaitingActor: boolean
}

export interface TaskEngagementView {
  engagementId: string
  name: string | null
  readiness: { state: 'available' | 'unavailable'; ok: boolean | null; failedChecks: number; reason: string | null }
}

export interface TasksView {
  tasks: TaskItemView[]
  engagements: TaskEngagementView[]
  counts: Record<string, number>
  source: 'db'
}

function isTasksView(v: unknown): v is TasksView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as TasksView
  return Array.isArray(doc.tasks) && Array.isArray(doc.engagements) && typeof doc.counts === 'object' && doc.source === 'db'
}

export function fetchTasks(): Promise<TasksView> {
  return apiFetch('/tasks', isTasksView)
}

/* ───────────── System Overview (cross-project dashboard, per-domain reads) ───────────── */

export interface OverviewFindingsView {
  total: number
  bySeverity: Record<string, number>
  byStatus: Record<string, number>
  engagementsWithFindings: number
  engagements: number
  truncated: boolean
  source: 'db'
}

function isOverviewFindingsView(v: unknown): v is OverviewFindingsView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as OverviewFindingsView
  return typeof doc.total === 'number' && typeof doc.bySeverity === 'object' && doc.bySeverity !== null && typeof doc.byStatus === 'object' && doc.byStatus !== null && typeof doc.engagements === 'number' && doc.source === 'db'
}

export function fetchOverviewFindings(): Promise<OverviewFindingsView> {
  return apiFetch('/overview/findings', isOverviewFindingsView)
}

export interface OverviewC2CommandView {
  id: string
  engagementId: string
  sessionId: string
  status: string
  createdAt: string
}

export interface OverviewC2View {
  commandsByStatus: Record<string, number>
  recentCommands: OverviewC2CommandView[]
  pendingGrants: number
  source: 'db'
}

function isOverviewC2View(v: unknown): v is OverviewC2View {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as OverviewC2View
  return typeof doc.commandsByStatus === 'object' && doc.commandsByStatus !== null && Array.isArray(doc.recentCommands) && typeof doc.pendingGrants === 'number' && doc.source === 'db'
}

export function fetchOverviewC2(): Promise<OverviewC2View> {
  return apiFetch('/overview/c2', isOverviewC2View)
}

export interface NoticeView {
  id: string
  engagementId: string | null
  kind: string
  title: string
  detail: Record<string, unknown> | null
  readAt: string | null
  dismissedAt: string | null
  createdAt: string
}

export interface NoticesView {
  notices: NoticeView[]
  unread: number
  source: 'db'
}

function isNoticesView(v: unknown): v is NoticesView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as NoticesView
  return Array.isArray(doc.notices) && typeof doc.unread === 'number' && doc.source === 'db'
}

export function fetchNotices(): Promise<NoticesView> {
  return apiFetch('/notices', isNoticesView)
}

export function markNoticeRead(noticeId: string): Promise<NoticeView> {
  return apiFetch(`/notices/${encodeURIComponent(noticeId)}/read`, (v): v is NoticeView =>
    typeof v === 'object' && v !== null && typeof (v as NoticeView).id === 'string',
  { method: 'POST', body: {} })
}

export function dismissNotice(noticeId: string): Promise<NoticeView> {
  return apiFetch(`/notices/${encodeURIComponent(noticeId)}/dismiss`, (v): v is NoticeView =>
    typeof v === 'object' && v !== null && typeof (v as NoticeView).dismissedAt === 'string',
  { method: 'POST', body: {} })
}

export function markAllNoticesRead(): Promise<{ updated: number }> {
  return apiFetch('/notices/read-all', (v): v is { updated: number } =>
    typeof v === 'object' && v !== null && typeof (v as { updated?: unknown }).updated === 'number',
  { method: 'POST', body: {} })
}

/* ───────────── Workspace settings, audit and vault (integration ticket 16) ───────────── */

export interface WorkspaceSettingView {
  key: string
  kind: string
  value: number
  version: number
  updatedBy: string | null
  updatedAt: string | null
  consumer: string | null
  enforcement: string
  description: string
}

export interface WorkspaceSettingsView {
  settings: WorkspaceSettingView[]
  source: 'db'
}

function isWorkspaceSettingsView(v: unknown): v is WorkspaceSettingsView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as WorkspaceSettingsView
  return Array.isArray(doc.settings) && doc.settings.every((s) => typeof s.key === 'string' && typeof s.value === 'number' && typeof s.version === 'number') && doc.source === 'db'
}

export function fetchWorkspaceSettings(): Promise<WorkspaceSettingsView> {
  return apiFetch('/workspace/settings', isWorkspaceSettingsView)
}

export interface SaveSettingInput { value: number; expectedVersion: number; reason: string }

export function saveWorkspaceSetting(key: string, input: SaveSettingInput): Promise<WorkspaceSettingView> {
  return apiFetch(`/workspace/settings/${encodeURIComponent(key)}`, (v): v is WorkspaceSettingView =>
    typeof v === 'object' && v !== null && typeof (v as WorkspaceSettingView).key === 'string' && typeof (v as WorkspaceSettingView).version === 'number',
  { method: 'PUT', body: input })
}

export interface AuditEntryView {
  id: string
  engagementId: string | null
  actorId: string | null
  action: string
  targetType: string | null
  targetId: string | null
  reason: string | null
  createdAt: string
  source: 'web' | 'vault'
}

export interface AuditView {
  engagementId: string | null
  entries: AuditEntryView[]
  total: number
  truncated: boolean
  actors: string[]
  actions: string[]
  source: 'db'
}

function isAuditView(v: unknown): v is AuditView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as AuditView
  return Array.isArray(doc.entries) && doc.entries.every((e) => typeof e.id === 'string' && typeof e.action === 'string' && (e.source === 'web' || e.source === 'vault')) && typeof doc.total === 'number' && doc.source === 'db'
}

export interface AuditQueryInput { action?: string; actor?: string; q?: string; limit?: number }

function auditQueryString(query: AuditQueryInput): string {
  const params = new URLSearchParams()
  if (query.action) params.set('action', query.action)
  if (query.actor) params.set('actor', query.actor)
  if (query.q) params.set('q', query.q)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  const s = params.toString()
  return s.length > 0 ? `?${s}` : ''
}

export function fetchWorkspaceAudit(query: AuditQueryInput = {}): Promise<AuditView> {
  return apiFetch(`/audit${auditQueryString(query)}`, isAuditView)
}

export function fetchEngagementAudit(engagementId: string, query: AuditQueryInput = {}): Promise<AuditView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/audit${auditQueryString(query)}`, (v): v is AuditView => isAuditView(v) && v.engagementId === engagementId)
}

export function fetchVault(engagementId: string): Promise<VaultView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/vault/secrets`, owned(engagementId, isVaultView))
}

export interface CreateVaultSecretInput { kind: string; label: string; plaintext: string }

export function createVaultSecret(engagementId: string, input: CreateVaultSecretInput): Promise<VaultSecretView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/vault/secrets`, (v): v is VaultSecretView =>
    typeof v === 'object' && v !== null && typeof (v as VaultSecretView).id === 'string' && typeof (v as VaultSecretView).revealCount === 'number',
  { method: 'POST', body: input })
}

export function revealVaultSecret(engagementId: string, secretId: string): Promise<VaultRevealView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/vault/secrets/${encodeURIComponent(secretId)}/reveal`, isVaultRevealView, { method: 'POST', body: {} })
}

export function revokeVaultSecret(engagementId: string, secretId: string): Promise<{ ok: true }> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/vault/secrets/${encodeURIComponent(secretId)}`, (v): v is { ok: true } =>
    typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === true,
  { method: 'DELETE' })
}

/* ───────────── Engagement closure (integration ticket 17) ───────────── */

export interface ClosureChecklistEntryView {
  id: string
  state: 'pass' | 'fail' | 'unavailable'
  detail: string | null
}

export interface ClosureView {
  id: string
  engagementId: string
  status: 'requested' | 'confirmed' | 'rejected' | 'closed' | 'cancelled'
  requestedBy: string
  decidedBy: string | null
  decidedAt: string | null
  reason: string
  checklist: { entries: ClosureChecklistEntryView[]; ok: boolean }
  createdAt: string
  updatedAt: string
  source: 'db'
}

export interface ClosureSurfaceView {
  engagementId: string
  closure: ClosureView | null
  readOnly: boolean
  checklist: { entries: ClosureChecklistEntryView[]; ok: boolean }
  source: 'db'
}

function isClosureSurfaceView(engagementId: string): (v: unknown) => v is ClosureSurfaceView {
  return (v): v is ClosureSurfaceView =>
    typeof v === 'object' && v !== null && (v as ClosureSurfaceView).engagementId === engagementId
    && typeof (v as ClosureSurfaceView).readOnly === 'boolean' && (v as ClosureSurfaceView).source === 'db'
}

export function fetchClosure(engagementId: string): Promise<ClosureSurfaceView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/closure`, isClosureSurfaceView(engagementId))
}

export function requestClosure(engagementId: string, reason: string): Promise<ClosureView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/closure/request`, (v): v is ClosureView =>
    typeof v === 'object' && v !== null && typeof (v as ClosureView).id === 'string' && typeof (v as ClosureView).status === 'string',
  { method: 'POST', body: { reason } })
}

export function decideClosure(engagementId: string, decision: 'confirmed' | 'rejected' | 'cancelled'): Promise<ClosureView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/closure/decision`, (v): v is ClosureView =>
    typeof v === 'object' && v !== null && typeof (v as ClosureView).status === 'string',
  { method: 'POST', body: { decision } })
}

export function updateReport(engagementId: string, reportId: string, input: { expectedVersion: number; title: string; summary: string; sections: { title: string; content: string }[] }): Promise<ReportView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-records/${encodeURIComponent(reportId)}`, owned(engagementId, (v): v is ReportView => typeof v === 'object' && v !== null && (v as ReportView).id === reportId && Number.isInteger((v as ReportView).version)), { method: 'PATCH', body: input })
}

export interface ReportArtifactView { engagementId: string; reportId: string; version: number; format: string; mediaType: string; content: string; digest: string }
export function exportReport(engagementId: string, reportId: string, format: 'json' | 'markdown'): Promise<ReportArtifactView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/report-records/${encodeURIComponent(reportId)}/export?format=${format}`, owned(engagementId, (v): v is ReportArtifactView => typeof v === 'object' && v !== null && (v as ReportArtifactView).reportId === reportId && typeof (v as ReportArtifactView).content === 'string' && /^[a-f0-9]{64}$/.test((v as ReportArtifactView).digest)))
}
