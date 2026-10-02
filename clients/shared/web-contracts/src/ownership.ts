import { isIsoUtcTimestamp, isNonEmptyString, isRecord } from './guards.js'

export type ThreadKind = 'planning' | 'execution'
export type RequestOperation = 'create_thread' | 'create_run' | 'resume'
export type RequestState = 'creating' | 'accepted' | 'uncertain' | 'rejected'
export interface ThreadBindingView {
  engagementId: string; threadId: string; assistantId: string; kind: ThreadKind
  createdAt: string; updatedAt: string
}
export interface RequestRecoveryView {
  engagementId: string; requestId: string; operation: RequestOperation; state: RequestState
  threadId: string | null; runId: string | null; createdAt: string; updatedAt: string
}
export function isThreadBindingView(v: unknown): v is ThreadBindingView {
  return isRecord(v) && ['engagementId', 'threadId', 'assistantId'].every(k => isNonEmptyString(v[k])) &&
    ['planning', 'execution'].includes(String(v.kind)) && isIsoUtcTimestamp(v.createdAt) && isIsoUtcTimestamp(v.updatedAt)
}
export function isRequestRecoveryView(v: unknown): v is RequestRecoveryView {
  if (!isRecord(v) || !isNonEmptyString(v.engagementId) || !isNonEmptyString(v.requestId)) return false
  if (!['create_thread', 'create_run', 'resume'].includes(String(v.operation)) || !['creating', 'accepted', 'uncertain', 'rejected'].includes(String(v.state))) return false
  if (v.threadId !== null && !isNonEmptyString(v.threadId) || v.runId !== null && !isNonEmptyString(v.runId)) return false
  if (v.operation === 'create_thread' ? v.runId !== null : v.threadId === null) return false
  if (v.state === 'accepted' && (v.threadId === null || v.operation !== 'create_thread' && v.runId === null)) return false
  return isIsoUtcTimestamp(v.createdAt) && isIsoUtcTimestamp(v.updatedAt)
}
