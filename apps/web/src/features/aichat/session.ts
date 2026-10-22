/** Durable browser recovery identities; command bodies remain on the server ledger. */
import type { ThreadKind } from '@raptix/web-contracts';
import { REAL_IDENTITY } from '../../state/real-identity'

export interface PendingRequest { requestId: string; threadId: string | null; kind: ThreadKind }
export interface SelectedThread { threadId: string; kind: ThreadKind }

/**
 * Recovery keys are scoped to the trusted actor id (multi-user sessions) or
 * the fixed local identity (single-user deployments), so two accounts sharing
 * a browser never read each other's selected thread or uncertain request.
 * The legacy `raptix.real.local.*` keys from the pre-actor era are
 * deliberately dropped instead of migrated: they carry no trustworthy actor
 * attribution, so keeping them would hand one account another account's
 * recovery state. Writing the versioned key removes the stale legacy twin.
 */
/**
 * Older servers cannot safely attribute persisted recovery across page loads,
 * so they get a per-load namespace. `crypto.randomUUID` is absent outside a
 * secure context; fall back to a load-local value rather than failing import.
 */
const pageDeployment: string = (() => {
  try { return crypto.randomUUID() } catch { return `load-${Date.now()}-${Math.random().toString(36).slice(2)}` }
})()
const selectionKey = (actorId: string, engagementId: string, deploymentId = pageDeployment): string => `raptix.real.selection.v2.${JSON.stringify([deploymentId, actorId, engagementId])}`
const pendingKey = (actorId: string, engagementId: string, deploymentId = pageDeployment): string => `raptix.real.pending.v2.${JSON.stringify([deploymentId, actorId, engagementId])}`

const legacySelectionKey = (engagementId: string): string => `raptix.real.${REAL_IDENTITY.id}.${engagementId}.thread`
const legacyPendingKey = (engagementId: string): string => `raptix.real.${REAL_IDENTITY.id}.${engagementId}.request`

const isThreadKind = (value: unknown): value is ThreadKind => value === 'planning' || value === 'execution'

function readEntry(key: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    return typeof v === 'object' && v !== null ? v as Record<string, unknown> : null
  } catch { return null }
}

function dropLegacy(engagementId: string): void {
  try {
    localStorage.removeItem(legacySelectionKey(engagementId))
    localStorage.removeItem(legacyPendingKey(engagementId))
  } catch { /* best effort cleanup */ }
}

export function readSelection(actorId: string, engagementId: string, deploymentId?: string): SelectedThread | null {
  const entry = readEntry(selectionKey(actorId, engagementId, deploymentId))
  return entry !== null && typeof entry.threadId === 'string' && isThreadKind(entry.kind)
    ? { threadId: entry.threadId, kind: entry.kind }
    : null
}

export function saveSelection(actorId: string, engagementId: string, selected: SelectedThread, deploymentId?: string): void {
  localStorage.setItem(selectionKey(actorId, engagementId, deploymentId), JSON.stringify({ threadId: selected.threadId, kind: selected.kind }))
  dropLegacy(engagementId)
}

export function readPending(actorId: string, engagementId: string, deploymentId?: string): PendingRequest | null {
  const entry = readEntry(pendingKey(actorId, engagementId, deploymentId))
  return entry !== null && typeof entry.requestId === 'string' && (entry.threadId === null || typeof entry.threadId === 'string') && isThreadKind(entry.kind)
    ? { requestId: entry.requestId, threadId: entry.threadId, kind: entry.kind }
    : null
}

/** Must succeed before dispatch, so refresh cannot lose an uncertain command identity. */
export function savePending(actorId: string, engagementId: string, pending: PendingRequest, deploymentId?: string): void {
  localStorage.setItem(pendingKey(actorId, engagementId, deploymentId), JSON.stringify(pending))
  dropLegacy(engagementId)
}

export function clearPending(actorId: string, engagementId: string, requestId: string, deploymentId?: string): void {
  if (readPending(actorId, engagementId, deploymentId)?.requestId === requestId) localStorage.removeItem(pendingKey(actorId, engagementId, deploymentId))
}

/** Recovery namespaces only: the plaintext draft mirror, selection/pending pointers and the pre-actor legacy twins. */
const RECOVERY_PREFIXES = ['raptix.real.selection.', 'raptix.real.pending.', 'raptix.real.draft.', 'raptix.real.capture-request.', 'raptix.real.finding-request.', `raptix.real.${REAL_IDENTITY.id}.`]
const isRecoveryKey = (key: string): boolean => RECOVERY_PREFIXES.some((prefix) => key.startsWith(prefix))

/**
 * Removes this browser's real-mode recovery entries — selections, pending
 * requests and drafts (drafts are plaintext). Called on confirmed logout,
 * expiry or an authenticated actor change so the prior session's recovery
 * state never survives on a shared browser; unrelated UI preferences
 * (`raptix.real.execution.agents.width`) are left in place. Re-signing in as
 * the same account starts with a clean mirror; durable facts stay on the
 * server ledger.
 */
export function clearWorkspaceRecovery(): void {
  try {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (k !== null && isRecoveryKey(k)) doomed.push(k)
    }
    for (const k of doomed) localStorage.removeItem(k)
  } catch { /* storage unavailable */ }
}

const draftKey = (engagementId: string, threadId: string, actorId: string, deploymentId = pageDeployment): string => `raptix.real.draft.v2.${JSON.stringify([deploymentId, actorId, engagementId, threadId])}`

export function readWorkspaceDraft(engagementId: string, threadId: string, actorId: string, deploymentId?: string): string {
  try { return localStorage.getItem(draftKey(engagementId, threadId, actorId, deploymentId)) ?? '' }
  catch { return '' }
}

export function saveWorkspaceDraft(engagementId: string, threadId: string, text: string, actorId: string, deploymentId?: string): void {
  localStorage.setItem(draftKey(engagementId, threadId, actorId, deploymentId), text)
}

/** Raw LangGraph terminal states, matching the server's run-service policy. */
export const isTerminalRun = (status: string): boolean => ['success', 'error', 'timeout', 'interrupted'].includes(status)
