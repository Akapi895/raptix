/** Durable browser recovery identities; command bodies remain on the server ledger. */
import type { ThreadKind } from './api'
import { REAL_IDENTITY } from './identity'

export interface PendingRequest { requestId: string; threadId: string | null; kind: ThreadKind }
export interface SelectedThread { threadId: string; kind: ThreadKind }

const key = (engagementId: string, field: string): string => `raptix.real.${REAL_IDENTITY.id}.${engagementId}.${field}`

export function readSelection(engagementId: string): SelectedThread | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key(engagementId, 'thread')) ?? 'null')
    if (typeof v !== 'object' || v === null) return null
    const entry = v as Record<string, unknown>
    return typeof entry.threadId === 'string' && (entry.kind === 'planning' || entry.kind === 'execution')
      ? { threadId: entry.threadId, kind: entry.kind } : null
  } catch { return null }
}

export function saveSelection(engagementId: string, selected: SelectedThread): void {
  localStorage.setItem(key(engagementId, 'thread'), JSON.stringify({ threadId: selected.threadId, kind: selected.kind }))
}

export function readPending(engagementId: string): PendingRequest | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key(engagementId, 'request')) ?? 'null')
    if (typeof v !== 'object' || v === null) return null
    const entry = v as Record<string, unknown>
    return typeof entry.requestId === 'string' && (entry.threadId === null || typeof entry.threadId === 'string') &&
      (entry.kind === 'planning' || entry.kind === 'execution')
      ? { requestId: entry.requestId, threadId: entry.threadId, kind: entry.kind } : null
  } catch { return null }
}

/** Must succeed before dispatch, so refresh cannot lose an uncertain command identity. */
export function savePending(engagementId: string, pending: PendingRequest): void {
  localStorage.setItem(key(engagementId, 'request'), JSON.stringify(pending))
}

export function clearPending(engagementId: string, requestId: string): void {
  if (readPending(engagementId)?.requestId === requestId) localStorage.removeItem(key(engagementId, 'request'))
}

const draftKey = (engagementId: string, threadId: string, actorId: string): string => `raptix.real.draft.v1.${JSON.stringify([actorId, engagementId, threadId])}`

export function readWorkspaceDraft(engagementId: string, threadId: string, actorId: string): string {
  try { return localStorage.getItem(draftKey(engagementId, threadId, actorId)) ?? '' }
  catch { return '' }
}

export function saveWorkspaceDraft(engagementId: string, threadId: string, text: string, actorId: string): void {
  localStorage.setItem(draftKey(engagementId, threadId, actorId), text)
}

/** Raw LangGraph terminal states, matching the server's run-service policy. */
export const isTerminalRun = (status: string): boolean => ['success', 'error', 'timeout', 'interrupted'].includes(status)
