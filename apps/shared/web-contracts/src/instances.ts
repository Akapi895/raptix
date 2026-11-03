/**
 * Runtime instance wire contracts (P10): the dispatch roster, the attempt mailbox, operator messages and
 * control acknowledgements. Shared by the runtime facade (server) and the browser; the browser never defines
 * these shapes itself.
 */
import { isRecord } from './guards.js'
import { isRequestRecoveryView, type RequestRecoveryView } from './ownership.js'

export const INSTANCE_MESSAGE_MAX_CHARS = 2000

/** One dispatch the runtime's ledger records. `role` is null for rows written before the runtime recorded roles. */
export interface RuntimeInstanceView {
  instanceId: string
  threadId: string
  dispatchId: string
  attempt: number
  role: string | null
  objectiveId: string | null
  /** The dispatch that started this one; null for the orchestrator and for rows recorded before parents were kept. */
  parentDispatchId: string | null
  outcome: string
  terminal: boolean
  /** `mailbox` is an attempt the runtime is running now, or one that ended before its ledger row was written. */
  source: 'dispatch_ledger' | 'mailbox'
}

export interface RuntimeRosterView {
  engagementId: string
  instances: RuntimeInstanceView[]
  threads: { threadId: string; read: 'read' | 'unavailable'; reason: string | null }[]
  source: 'runtime'
}

export type InstanceMessageState = 'accepted' | 'delivered' | 'handled' | 'undelivered'

export interface InstanceMessageView {
  messageId: string
  attempt: number
  seq: number
  body: string
  state: InstanceMessageState
  acceptedAt: string
  deliveredAt: string | null
  handledAt: string | null
  outcome: string | null
  /** Set only on a message the operator forwarded from another attempt's message. */
  sourceMessageId: string | null
}

/** `cancel_requested` is the operator's recorded intent; only `cancelled`, `finished` or `interrupted` is an observed end. */
export type InstanceAttemptState = 'running' | 'cancel_requested' | 'cancelled' | 'finished' | 'interrupted'

export interface InstanceAttemptView {
  attempt: number
  role: string | null
  state: InstanceAttemptState
  startedAt: string
  finishedAt: string | null
}

export interface InstanceMailboxView {
  threadId: string
  dispatchId: string
  instances: InstanceAttemptView[]
  messages: InstanceMessageView[]
  source: 'runtime'
}

/** Accepted or duplicate operator message; the attempt pins the target. */
export interface InstanceMessageAck {
  status: 'accepted' | 'duplicate'
  attempt: number
  message: InstanceMessageView
}

/** The recorded cancel request. The final observation arrives later on the attempt. */
export interface InstanceCancelAck {
  threadId: string
  dispatchId: string
  attempt: number
  state: InstanceAttemptState
  source: 'runtime'
}

export function isRuntimeRosterView(v: unknown): v is RuntimeRosterView {
  if (!isRecord(v)) return false
  const doc = v as unknown as RuntimeRosterView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.instances) && Array.isArray(doc.threads) && doc.source === 'runtime'
    && doc.instances.every((i) => typeof i.instanceId === 'string' && typeof i.attempt === 'number' && (i.source === 'dispatch_ledger' || i.source === 'mailbox'))
}

export function isInstanceMailboxView(v: unknown): v is InstanceMailboxView {
  if (!isRecord(v)) return false
  const doc = v as unknown as InstanceMailboxView
  return typeof doc.threadId === 'string' && typeof doc.dispatchId === 'string' && Array.isArray(doc.instances)
    && Array.isArray(doc.messages) && doc.source === 'runtime'
}

export function isInstanceMessageAck(v: unknown): v is InstanceMessageAck {
  return isRecord(v) && (v.status === 'accepted' || v.status === 'duplicate')
}

export function isInstanceCancelAck(v: unknown): v is InstanceCancelAck {
  return isRecord(v) && v.state === 'cancel_requested'
}

/** P10d: a retry or reassign request and the orchestrator run that admits the replacement attempt. */
export interface InstanceCommandAck {
  commandId: string
  kind: 'retry' | 'reassign'
  threadId: string
  sourceDispatchId: string
  sourceAttempt: number
  /** The dispatch the replacement runs under: the same one for a retry, a new one for a reassign. */
  dispatchId: string
  role: string
  run: RequestRecoveryView
}

export function isInstanceCommandAck(v: unknown): v is InstanceCommandAck {
  return isRecord(v) && typeof v.commandId === 'string' && (v.kind === 'retry' || v.kind === 'reassign')
    && typeof v.threadId === 'string' && typeof v.sourceDispatchId === 'string' && typeof v.sourceAttempt === 'number'
    && typeof v.dispatchId === 'string' && typeof v.role === 'string' && isRequestRecoveryView(v.run)
}
