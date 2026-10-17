/**
 * Operator messages to one dispatch instance (P10c). Each message shows the runtime's own
 * delivery state: waiting for the next step, delivered, handled, or undelivered because the
 * instance ended first. A message is only sent to the latest attempt when the runtime reports
 * that attempt as running; otherwise the panel explains why sending is closed.
 */
import { useState, type ReactElement } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchInstanceMailbox, INSTANCE_MESSAGE_MAX_CHARS, sendInstanceMessage, type InstanceMessageState, type InstanceMailboxView } from '../api'
import { utcMinute } from '../format'
import { Banner, Button, Skeleton, Textarea } from '../../ui'

const STATE_TEXT: Record<InstanceMessageState, string> = {
  accepted: 'waiting for the next step',
  delivered: 'delivered to the instance',
  handled: 'handled in its next turn',
  undelivered: 'not delivered: the instance ended first',
}

export function InstanceMessenger({ engagementId, threadId, dispatchId, attempt }: { engagementId: string; threadId: string; dispatchId: string; attempt: number }): ReactElement {
  const client = useQueryClient()
  const key = ['real', 'instance-mailbox', engagementId, threadId, dispatchId]
  const mailbox = useQuery({
    queryKey: key,
    queryFn: () => fetchInstanceMailbox(engagementId, threadId, dispatchId),
    refetchInterval: 5_000,
    retry: false,
  })
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: () => sendInstanceMessage(engagementId, threadId, dispatchId, { messageId: crypto.randomUUID(), body: draft.trim() }),
    onSuccess: () => {
      setDraft('')
      setError(null)
      void client.invalidateQueries({ queryKey: key })
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The message was not sent.'),
  })

  if (mailbox.isPending) return <Skeleton className="h-16" />
  if (mailbox.isError || !mailbox.data) {
    return <Banner tone="warn" title="Mailbox unavailable">{mailbox.error instanceof Error ? mailbox.error.message : 'The runtime mailbox could not be read.'} Sending is closed until it can be read.</Banner>
  }
  const view: InstanceMailboxView = mailbox.data
  const latest = view.instances.reduce<InstanceMailboxView['instances'][number] | null>((best, row) => (best === null || row.attempt > best.attempt ? row : best), null)
  const canSend = latest !== null && latest.state === 'running' && latest.attempt === attempt
  const mine = view.messages.filter((m) => m.attempt === attempt)

  return (
    <section aria-label={`Operator messages to ${dispatchId}`} className="mt-3 space-y-2 border-t border-line pt-3">
      <h4 className="text-xs font-semibold">Operator messages</h4>
      {mine.length === 0 ? <p className="text-xs text-muted">No messages sent to this attempt.</p> : (
        <ul className="space-y-1">
          {mine.map((m) => (
            <li key={m.messageId} className="rounded-lg border border-line p-2 text-xs">
              <span className="font-medium text-fg">{m.state}</span> · {STATE_TEXT[m.state]} · <span className="text-muted">{utcMinute(m.acceptedAt)}</span>
              <p className="mt-1 whitespace-pre-wrap break-words text-fg">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canSend ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) send.mutate() }}>
          <label className="block text-xs text-muted" htmlFor={`msg-${dispatchId}-${attempt}`}>Message to this running attempt (delivered before its next model call)</label>
          <Textarea id={`msg-${dispatchId}-${attempt}`} maxLength={INSTANCE_MESSAGE_MAX_CHARS} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <Button type="submit" variant="primary" disabled={send.isPending || draft.trim().length === 0}>{send.isPending ? 'Sending…' : 'Send to instance'}</Button>
        </form>
      ) : (
        <p className="text-xs text-muted">
          {latest === null ? 'The runtime reports no attempt for this dispatch.' : latest.attempt !== attempt ? `A newer attempt (${latest.attempt}) is the one the runtime reports.` : `This attempt is ${latest.state}; the runtime accepts messages only for a running attempt.`}
        </p>
      )}
      {error !== null && <p className="text-xs text-bad" role="alert">{error}</p>}
    </section>
  )
}
