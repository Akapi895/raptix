import { isRequestRecoveryView, isScopedRunView, isScopedThreadListView, isScopedThreadView, type RequestRecoveryView, type ScopedRunView, type ScopedThreadListView, type ScopedThreadView, type ThreadKind } from '@raptix/web-contracts';
import { apiFetch } from '../../platform/transport';

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

/** Owner-set display name of a thread. The server validates it; the thread identity never changes. */
export function renameThread(engagementId: string, threadId: string, title: string): Promise<{ threadId: string; title: string | null }> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/threads/${encodeURIComponent(threadId)}`,
    (v): v is { threadId: string; title: string | null } => typeof v === 'object' && v !== null && (v as { threadId?: unknown }).threadId === threadId,
    { method: 'PATCH', body: { title } })
}

export function setThreadHitl(engagementId: string, threadId: string, enabled: boolean): Promise<{ threadId: string; hitlEnabled: boolean }> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/threads/${encodeURIComponent(threadId)}/hitl`,
    (v): v is { threadId: string; hitlEnabled: boolean } => typeof v === 'object' && v !== null && (v as { threadId?: unknown }).threadId === threadId && typeof (v as { hitlEnabled?: unknown }).hitlEnabled === 'boolean',
    { method: 'PATCH', body: { enabled } })
}

export function getThread(engagementId: string, threadId: string): Promise<ScopedThreadView> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/threads/${encodeURIComponent(threadId)}`,
    (v): v is ScopedThreadView => isScopedThreadView(v) && v.binding.engagementId === engagementId && v.binding.threadId === threadId,
  )
}

/** One older page of a conversation: messages ending before index `before`, with the cursor for the page before it. */
export function getThreadPage(engagementId: string, threadId: string, before: number): Promise<ScopedThreadView> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/threads/${encodeURIComponent(threadId)}?before=${before}`,
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

export function isRunList(v: unknown): v is { runs: ScopedRunView[]; offset: number; nextOffset: number | null } {
  if (typeof v !== 'object' || v === null) return false
  const page = v as Record<string, unknown>
  return Array.isArray(page.runs) && page.runs.every(isScopedRunView) && Number.isInteger(page.offset) && Number(page.offset) >= 0 &&
    (page.nextOffset === null || Number.isInteger(page.nextOffset) && Number(page.nextOffset) > Number(page.offset))
}

/* ───────────── Operation lifecycle (P11) ───────────── */
export const threadPath = (engagementId: string, threadId: string): string =>
  `/engagements/${encodeURIComponent(engagementId)}/threads/${encodeURIComponent(threadId)}`

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
