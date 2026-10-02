/**
 * Run/thread wire contracts: the public event envelope, stream subscription
 * request, run identity and snapshot.
 *
 * `RunEventKind` is a W01 SUBSET of envelope coverage: only the canonical
 * custom sub-agent event kinds (type from @raptix/streaming; no second
 * event-name set). LangGraph root SDK message/state kinds are a W08 extension.
 * `runId: null` = unattributed checkpoint history; `toolCallId: null` matches
 * the producer emitting no tool-call ID; `cursor` (SSE Last-Event-ID) is
 * distinct from `eventId` (reducer dedup key).
 */
import type { SubagentEventType } from '@raptix/streaming'
import { isIsoUtcTimestamp, isNonEmptyString, isRecord } from './guards.js'

export const RUN_EVENT_SOURCES = ['runtime', 'checkpoint'] as const

export type RunEventSource = (typeof RUN_EVENT_SOURCES)[number]

export function isRunEventSource(value: unknown): value is RunEventSource {
  return typeof value === 'string' && (RUN_EVENT_SOURCES as readonly string[]).includes(value)
}

export type RunEventKind = SubagentEventType

/** Runtime mirror of the canonical union; both directions are checked below. */
export const RUN_EVENT_KINDS = [
  'subagent_start', 'subagent_end', 'subagent_tool_call', 'subagent_tool_result',
  'subagent_message', 'ask_user_question', 'engagement_ready', 'background_complete',
] as const satisfies readonly RunEventKind[]

type CanonicalKindsCovered = [RunEventKind] extends [(typeof RUN_EVENT_KINDS)[number]] ? true : false
const CANONICAL_KINDS_COVERED: CanonicalKindsCovered = true
void CANONICAL_KINDS_COVERED

export function isRunEventKind(value: unknown): value is RunEventKind {
  return typeof value === 'string' && (RUN_EVENT_KINDS as readonly string[]).includes(value)
}

export interface RunEventEnvelope {
  version: 1
  eventId: string
  engagementId: string
  threadId: string
  /** null = unattributed checkpoint history, not a missing field. */
  runId: string | null
  source: RunEventSource
  kind: RunEventKind
  /** Sub-agent invocation identity (producer `session_id`). */
  sessionId?: string
  /** LangChain tool-call ID; null when the producer omitted it. */
  toolCallId?: string | null
  /** Upstream replay cursor for SSE Last-Event-ID, independent of eventId. */
  cursor?: string
  /** Producer timestamp; null when the producer emitted none. */
  occurredAt: string | null
  /** Boundary receive time (UTC ISO-8601). */
  observedAt: string
  /** Per-kind payload; typed per-kind validation lands with the reducer. */
  payload: unknown
}

export function isRunEventEnvelope(value: unknown): value is RunEventEnvelope {
  if (!isRecord(value) || value.version !== 1 || !isNonEmptyString(value.eventId)) return false
  if (!isNonEmptyString(value.engagementId) || !isNonEmptyString(value.threadId)) return false
  if (value.runId !== null && !isNonEmptyString(value.runId)) return false
  if (!isRunEventSource(value.source) || !isRunEventKind(value.kind)) return false
  if (value.sessionId !== undefined && !isNonEmptyString(value.sessionId)) return false
  if (value.toolCallId !== undefined && value.toolCallId !== null && !isNonEmptyString(value.toolCallId)) {
    return false
  }
  if (value.cursor !== undefined && !isNonEmptyString(value.cursor)) return false
  if (value.occurredAt !== null && !isIsoUtcTimestamp(value.occurredAt)) return false
  if (!isIsoUtcTimestamp(value.observedAt)) return false
  return Object.prototype.hasOwnProperty.call(value, 'payload')
}

/**
 * Execution view-state (guide section 5.3 layer 2) — a UI projection, NOT the
 * raw wire status. The raw SDK/runtime status is captured later and preserved
 * separately on {@link RunSnapshot.rawStatus}.
 */
export const RUN_VIEW_STATUSES = [
  'idle', 'submitting', 'pending', 'running', 'awaiting_approval',
  'interrupted', 'completed', 'failed', 'cancelled', 'unknown',
] as const

export type RunViewStatus = (typeof RUN_VIEW_STATUSES)[number]

export function isRunViewStatus(value: unknown): value is RunViewStatus {
  return typeof value === 'string' && (RUN_VIEW_STATUSES as readonly string[]).includes(value)
}

export interface RunIdentity {
  engagementId: string
  threadId: string
  runId: string | null
}

export function isRunIdentity(value: unknown): value is RunIdentity {
  return (
    isRecord(value) && isNonEmptyString(value.engagementId) && isNonEmptyString(value.threadId) &&
    (value.runId === null || isNonEmptyString(value.runId))
  )
}

export interface ThreadRunRequest {
  threadId: string
  runId?: string | null
  /** Validated replay cursor (SSE Last-Event-ID); never an arbitrary URL. */
  lastEventId?: string | null
}

export function isThreadRunRequest(value: unknown): value is ThreadRunRequest {
  if (!isRecord(value) || !isNonEmptyString(value.threadId)) return false
  if (value.runId !== undefined && value.runId !== null && !isNonEmptyString(value.runId)) return false
  if (value.lastEventId !== undefined && value.lastEventId !== null && !isNonEmptyString(value.lastEventId)) {
    return false
  }
  return true
}

export interface RunSnapshot {
  engagementId: string
  threadId: string
  runId: string | null
  /** Execution view-state; a dropped stream never maps to "failed" here. */
  status: RunViewStatus
  /** Raw wire status preserved verbatim until it is captured and typed. */
  rawStatus?: string
  updatedAt: string
}

export function isRunSnapshot(value: unknown): value is RunSnapshot {
  if (!isRecord(value) || !isNonEmptyString(value.engagementId) || !isNonEmptyString(value.threadId)) {
    return false
  }
  if (value.runId !== null && !isNonEmptyString(value.runId)) return false
  if (!isRunViewStatus(value.status)) return false
  if (value.rawStatus !== undefined && !isNonEmptyString(value.rawStatus)) return false
  return isIsoUtcTimestamp(value.updatedAt)
}
