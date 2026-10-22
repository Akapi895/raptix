import { apiFetch } from '../../platform/transport';
import { isInstanceCancelAck, isInstanceCommandAck, isInstanceMailboxView, isInstanceMessageAck, isRuntimeRosterView, type InstanceCommandAck, type InstanceCancelAck, type InstanceMailboxView, type InstanceMessageAck, type RuntimeRosterView } from '@raptix/web-contracts';
import { owned } from '../../platform/ownership';

export function fetchRuntimeInstances(engagementId: string): Promise<RuntimeRosterView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/instances`, owned(engagementId, isRuntimeRosterView))
}

export function instanceRoot(engagementId: string, threadId: string, dispatchId: string): string {
  return `/engagements/${encodeURIComponent(engagementId)}/instances/${encodeURIComponent(threadId)}/${encodeURIComponent(dispatchId)}`
}

export function instancePath(engagementId: string, threadId: string, dispatchId: string): string {
  return `${instanceRoot(engagementId, threadId, dispatchId)}/messages`
}

export function fetchInstanceMailbox(engagementId: string, threadId: string, dispatchId: string): Promise<InstanceMailboxView> {
  return apiFetch(instancePath(engagementId, threadId, dispatchId), (v): v is InstanceMailboxView => isInstanceMailboxView(v) && v.threadId === threadId && v.dispatchId === dispatchId)
}

/** A refused message fails with the server's reason; a duplicate retry is an accepted outcome, not a second message. The attempt pins the target. */
export function sendInstanceMessage(engagementId: string, threadId: string, dispatchId: string, input: { messageId: string; body: string; expectedAttempt: number }): Promise<InstanceMessageAck> {
  return apiFetch(instancePath(engagementId, threadId, dispatchId), isInstanceMessageAck, { method: 'POST', body: input })
}

/** P10d: cooperative cancel. The answer is the recorded request (`cancel_requested`); the stop is observed on the attempt later. */
export function cancelInstance(engagementId: string, threadId: string, dispatchId: string, expectedAttempt: number): Promise<InstanceCancelAck> {
  return apiFetch(`${instanceRoot(engagementId, threadId, dispatchId)}/cancel`, isInstanceCancelAck, { method: 'POST', body: { expectedAttempt } })
}

/** P10c forward: a new message to a running attempt that names the source message on this dispatch. */
export function forwardInstanceMessage(engagementId: string, threadId: string, targetDispatchId: string, input: { messageId: string; sourceDispatchId: string; sourceMessageId: string; expectedAttempt: number }): Promise<InstanceMessageAck> {
  return apiFetch(`${instanceRoot(engagementId, threadId, targetDispatchId)}/messages/forward`, isInstanceMessageAck, { method: 'POST', body: input })
}

/** P10d: retry the same dispatch (no role) or reassign it to another role. The answer names the run that admits the replacement. */
export function commandInstance(engagementId: string, threadId: string, dispatchId: string, input: { commandId: string; kind: 'retry' | 'reassign'; expectedAttempt: number; role?: string }): Promise<InstanceCommandAck> {
  return apiFetch(`${instanceRoot(engagementId, threadId, dispatchId)}/commands`, isInstanceCommandAck, { method: 'POST', body: input })
}
