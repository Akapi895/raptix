/**
 * Request-ledger handling for the scoped runtime APIs (integration ticket 04).
 * Thread/run/resume POSTs return a durable `RequestRecoveryView`; the browser
 * never re-issues the underlying operation — it polls the SAME stable
 * requestId and reconciles an uncertain outcome through the server's
 * reconcile endpoint. A rejected/uncertain request is surfaced honestly; it
 * is never retried as a new dispatch (duplicate-run prevention).
 */
import { getRequest, reconcileRequest } from '../features/aichat/remote';
import type { RequestRecoveryView } from '@raptix/web-contracts';

/** Server rule (apps/web/server security/run-policy.ts): 8-128 chars, starts
 *  alphanumeric, then alphanumeric/_/- only. */
export function newRequestId(): string {
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return uuid.replace(/[^A-Za-z0-9_-]/g, '').padEnd(16, '0').slice(0, 64)
}

export type AckOutcome =
  | { kind: 'accepted'; requestId: string; threadId: string; runId: string | null }
  | { kind: 'rejected'; requestId: string }
  | { kind: 'unconfirmed'; requestId: string; message: string }

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

/**
 * Follows one ledger request to a settled outcome: accepted/rejected, or an
 * explicit `unconfirmed` result (the UI then offers Reconcile). An uncertain
 * state is reconciled through the server endpoint — the stable request id is
 * preserved so the outcome is never duplicated into a new dispatch.
 */
export async function awaitRequest(
  engagementId: string,
  ack: RequestRecoveryView,
  opts: { pollMs?: number; maxPolls?: number } = {},
): Promise<AckOutcome> {
  const pollMs = opts.pollMs ?? 1_000
  const maxPolls = opts.maxPolls ?? 20
  let current: RequestRecoveryView = ack
  for (let attempt = 0; attempt <= maxPolls; attempt++) {
    if (current.state === 'accepted') {
      return { kind: 'accepted', requestId: current.requestId, threadId: current.threadId ?? '', runId: current.runId }
    }
    if (current.state === 'rejected') return { kind: 'rejected', requestId: current.requestId }
    if (attempt === maxPolls) break
    if (current.state === 'uncertain') {
      await sleep(pollMs)
      current = await reconcileRequest(engagementId, current.requestId)
      continue
    }
    await sleep(pollMs)
    current = await getRequest(engagementId, current.requestId)
  }
  return {
    kind: 'unconfirmed',
    requestId: current.requestId,
    message: 'The server has not confirmed this request yet. Its outcome is still tracked under the same request id — use Reconcile to check again.',
  }
}
