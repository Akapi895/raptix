/**
 * Operator controls for one dispatch instance (P10c–P10d). Messages, forwards, cancel, retry and reassign
 * all act on the attempt the runtime reports as latest, and the runtime decides each one; its reason is
 * shown as written. "Cancel requested" is recorded intent: the attempt has stopped only when it reads cancelled.
 */
import { useRef, useState, type ReactElement } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cancelInstance, commandInstance, fetchInstanceMailbox, forwardInstanceMessage, sendInstanceMessage } from '../../features/agents/remote';
import { getThread } from '../../features/aichat/remote';
import { INSTANCE_MESSAGE_MAX_CHARS, type InstanceAttemptState, type InstanceMailboxView, type InstanceMessageState, type RuntimeInstanceView } from '@raptix/web-contracts';
import { go } from '../../router/navigate'
import { ApiTransportError } from '../../platform/transport'
import { utcMinute } from '../format'
import { Banner, Button, Input, Select, Skeleton, Textarea } from '../../ui/index'

const STATE_TEXT: Record<InstanceMessageState, string> = {
  accepted: 'waiting for the next step',
  delivered: 'delivered to the instance',
  handled: 'handled in its next turn',
  undelivered: 'not delivered: the instance ended first',
}
const ATTEMPT_TEXT: Record<InstanceAttemptState, string> = {
  running: 'running',
  cancel_requested: 'cancel requested, not yet stopped',
  cancelled: 'cancelled',
  finished: 'finished',
  interrupted: 'interrupted',
}
const TERMINAL: ReadonlySet<InstanceAttemptState> = new Set(['cancelled', 'finished', 'interrupted'])
const ROLE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/
const UNCONFIRMED = 'The previous request has no confirmed outcome. Send it again unchanged; the runtime answers whether it was recorded.'

/**
 * One id per unsettled operator intent. A lost ACK leaves the intent open, so the same request reuses its id and the
 * runtime answers the first outcome instead of recording a second one. A different request waits until the open one
 * is confirmed or refused.
 */
function useIntentId(): { idFor: (content: string) => string; settle: () => void } {
  const pending = useRef<{ content: string; id: string } | null>(null)
  return {
    idFor: (content) => {
      const current = pending.current
      if (current !== null && current.content === content) return current.id
      if (current !== null) throw new Error(UNCONFIRMED)
      const next = { content, id: crypto.randomUUID() }
      pending.current = next
      return next.id
    },
    settle: () => { pending.current = null },
  }
}

/** A 4xx is the runtime's refusal, with no effect recorded; any other failure may have landed, so its id stays open. */
const refused = (err: unknown): boolean => err instanceof ApiTransportError && err.status >= 400 && err.status < 500

export function InstanceMessenger({ engagementId, threadId, dispatchId, attempt, peers = [] }: {
  engagementId: string; threadId: string; dispatchId: string; attempt: number
  /** Other roster rows on the same thread: the candidates a forward can target. */
  peers?: RuntimeInstanceView[]
}): ReactElement {
  const client = useQueryClient()
  const key = ['real', 'instance-mailbox', engagementId, threadId, dispatchId]
  const mailbox = useQuery({
    queryKey: key,
    queryFn: () => fetchInstanceMailbox(engagementId, threadId, dispatchId),
    refetchInterval: 5_000,
    retry: false,
  })
  // The thread's open questions; the ones this attempt asked are pinned here. Answers go through the workspace's batch resume.
  const thread = useQuery({
    queryKey: ['real', 'thread', engagementId, threadId],
    queryFn: () => getThread(engagementId, threadId),
    refetchInterval: 5_000,
    retry: false,
  })
  const [draft, setDraft] = useState('')
  const [reassignRole, setReassignRole] = useState('')
  const [forwardSource, setForwardSource] = useState('')
  const [forwardTarget, setForwardTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const sendIntent = useIntentId()
  const commandIntent = useIntentId()
  const forwardIntent = useIntentId()

  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: key })
    void client.invalidateQueries({ queryKey: ['real', 'runtime-instances', engagementId] })
  }
  const fail = (err: unknown, fallback: string): void => {
    setNotice(null)
    setError(err instanceof Error ? err.message : fallback)
  }
  const view: InstanceMailboxView | undefined = mailbox.data
  const latest = view?.instances.reduce<InstanceMailboxView['instances'][number] | null>((best, row) => (best === null || row.attempt > best.attempt ? row : best), null) ?? null

  const send = useMutation({
    mutationFn: async () => {
      const body = draft.trim()
      const messageId = sendIntent.idFor(`${attempt}\n${body}`)
      // Reconcile before resending: a message the runtime already recorded under this id is not recorded twice.
      const current = await fetchInstanceMailbox(engagementId, threadId, dispatchId)
      if (current.messages.some((m) => m.messageId === messageId)) return null
      return sendInstanceMessage(engagementId, threadId, dispatchId, { messageId, body, expectedAttempt: attempt })
    },
    onSuccess: () => { sendIntent.settle(); setDraft(''); setError(null); setNotice(null); refresh() },
    onError: (err) => { if (refused(err)) sendIntent.settle(); fail(err, 'The message was not sent.') },
  })
  const cancel = useMutation({
    mutationFn: (expectedAttempt: number) => cancelInstance(engagementId, threadId, dispatchId, expectedAttempt),
    onSuccess: () => { setError(null); setNotice('Cancel recorded. The attempt stops before its next model or tool call; a tool already running may finish first.'); refresh() },
    onError: (err) => fail(err, 'The cancel was not recorded.'),
  })
  const command = useMutation({
    mutationFn: (input: { kind: 'retry' | 'reassign'; expectedAttempt: number; role?: string }) => commandInstance(engagementId, threadId, dispatchId, { commandId: commandIntent.idFor(`${input.kind}|${input.expectedAttempt}|${input.role ?? ''}`), ...input }),
    onSuccess: (ack) => {
      commandIntent.settle()
      setError(null)
      const outcome = ack.run.state === 'accepted' ? 'admitted: the orchestrator run has started' : ack.run.state === 'uncertain' ? 'the run outcome is uncertain; the same request replays it' : `the run was ${String(ack.run.state)}`
      setNotice(`${ack.kind === 'retry' ? 'Retry' : 'Reassignment'} to dispatch ${ack.dispatchId.slice(0, 12)} (${ack.role}): ${outcome}.`)
      setReassignRole('')
      refresh()
    },
    onError: (err) => { if (refused(err)) commandIntent.settle(); fail(err, 'The retry or reassignment was not admitted.') },
  })
  const forward = useMutation({
    mutationFn: () => {
      const target = peers.find((peer) => peer.instanceId === forwardTarget)
      if (!target) throw new Error('Choose a running target instance.')
      const messageId = forwardIntent.idFor(`${forwardSource}|${target.instanceId}`)
      return forwardInstanceMessage(engagementId, threadId, target.dispatchId, { messageId, sourceDispatchId: dispatchId, sourceMessageId: forwardSource, expectedAttempt: target.attempt })
    },
    onSuccess: () => { forwardIntent.settle(); setError(null); setNotice('Forwarded as a new message to the target. The source message is unchanged.'); setForwardSource(''); setForwardTarget(''); refresh() },
    onError: (err) => { if (refused(err)) forwardIntent.settle(); fail(err, 'The message was not forwarded.') },
  })

  if (mailbox.isPending) return <Skeleton className="h-16" />
  if (mailbox.isError || !view) {
    return <Banner tone="warn" title="Mailbox unavailable">{mailbox.error instanceof Error ? mailbox.error.message : 'The runtime mailbox could not be read.'} Sending and controls are closed until it can be read.</Banner>
  }
  const isLatest = latest !== null && latest.attempt === attempt
  const canSend = isLatest && latest.state === 'running'
  const mine = view.messages.filter((m) => m.attempt === attempt)
  const runningPeers = peers.filter((peer) => peer.threadId === threadId && peer.dispatchId !== dispatchId && peer.outcome === 'running')
  const roleValid = ROLE_PATTERN.test(reassignRole)
  const pinned = (thread.data?.pendingQuestions ?? []).filter((q) => q.instance?.dispatchId === dispatchId)

  return (
    <section aria-label={`Operator controls for ${dispatchId}`} className="mt-3 space-y-3 border-t border-line pt-3">
      <h4 className="text-xs font-semibold">Attempts</h4>
      <ul className="space-y-1 text-xs">
        {view.instances.map((row) => (
          <li key={row.attempt}><span className="font-medium">attempt {row.attempt}</span> · {row.role ?? 'role not recorded'} · {ATTEMPT_TEXT[row.state]}</li>
        ))}
      </ul>

      {latest !== null && latest.state === 'running' && isLatest && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="danger" disabled={cancel.isPending} onClick={() => cancel.mutate(latest.attempt)}>{cancel.isPending ? 'Recording cancel…' : 'Cancel attempt'}</Button>
        </div>
      )}
      {latest !== null && latest.state === 'cancel_requested' && (
        <p className="text-xs text-muted">Cancel requested. The attempt is still running and will stop at its next safe point; it is not reported as stopped until the runtime records it.</p>
      )}
      {latest !== null && TERMINAL.has(latest.state) && isLatest && (
        <div className="space-y-2 rounded-lg border border-line p-2">
          <p className="text-xs text-muted">This attempt has ended. A retry re-issues the same intent as a new attempt; a reassignment runs it under another role as a new dispatch. The old attempt is never changed.</p>
          <div className="flex flex-wrap items-end gap-2">
            <Button size="sm" disabled={command.isPending || latest.role === null} onClick={() => command.mutate({ kind: 'retry', expectedAttempt: latest.attempt })}>Retry attempt</Button>
            <Input aria-label="Reassign to role" className="h-8 w-40 text-xs" placeholder="new role, e.g. recon" value={reassignRole} onChange={(e) => setReassignRole(e.target.value.trim())} />
            <Button size="sm" disabled={command.isPending || !roleValid} onClick={() => command.mutate({ kind: 'reassign', expectedAttempt: latest.attempt, role: reassignRole })}>Reassign</Button>
          </div>
        </div>
      )}

      <h4 className="text-xs font-semibold">Operator messages</h4>
      {mine.length === 0 ? <p className="text-xs text-muted">No messages sent to this attempt.</p> : (
        <ul className="space-y-1">
          {mine.map((m) => (
            <li key={m.messageId} className="rounded-lg border border-line p-2 text-xs">
              <span className="font-medium text-fg">{m.state}</span> · {STATE_TEXT[m.state]} · <span className="text-muted">{utcMinute(m.acceptedAt)}</span>
              {m.sourceMessageId !== null && <span className="text-muted"> · forwarded from message {m.sourceMessageId}</span>}
              <p className="mt-1 whitespace-pre-wrap break-words text-fg">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      {pinned.length > 0 && (
        <section aria-label="Questions from this instance" className="space-y-2 rounded-lg border border-line p-2">
          <h4 className="text-xs font-semibold">Waiting for your answer</h4>
          <ul className="space-y-1">
            {pinned.map((q) => <li key={q.questionId} className="text-xs text-fg">{q.question}</li>)}
          </ul>
          <p className="text-xs text-muted">The thread answers every pending question in one batch, so answer them in the AI workspace.</p>
          <Button size="sm" variant="secondary" onClick={() => go('project', { id: engagementId, tab: 'ai-workspace' })}>Open AI workspace</Button>
        </section>
      )}
      {canSend ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) send.mutate() }}>
          <label className="block text-xs text-muted" htmlFor={`msg-${dispatchId}-${attempt}`}>Message to this running attempt (delivered before its next model call)</label>
          <Textarea id={`msg-${dispatchId}-${attempt}`} maxLength={INSTANCE_MESSAGE_MAX_CHARS} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <Button type="submit" variant="primary" disabled={send.isPending || draft.trim().length === 0}>{send.isPending ? 'Sending…' : 'Send to instance'}</Button>
        </form>
      ) : (
        <p className="text-xs text-muted">
          {latest === null ? 'The runtime reports no attempt for this dispatch.' : latest.attempt !== attempt ? `A newer attempt (${latest.attempt}) is the one the runtime reports.` : `This attempt is ${ATTEMPT_TEXT[latest.state]}; the runtime accepts messages only for a running attempt.`}
        </p>
      )}

      {view.messages.length > 0 && runningPeers.length > 0 && (
        <form className="space-y-2 border-t border-line pt-3" aria-label="Forward a message" onSubmit={(e) => { e.preventDefault(); if (forwardSource && forwardTarget) forward.mutate() }}>
          <p className="text-xs text-muted">Forward repeats one message from this dispatch to another running instance as a new message. Nothing moves automatically.</p>
          <div className="flex flex-wrap items-end gap-2">
            <Select aria-label="Message to forward" className="h-8 max-w-56 text-xs" value={forwardSource} onChange={(e) => setForwardSource(e.target.value)}>
              <option value="">Choose a message…</option>
              {view.messages.map((m) => <option key={m.messageId} value={m.messageId}>{`attempt ${m.attempt} · ${m.body.slice(0, 40)}`}</option>)}
            </Select>
            <Select aria-label="Target instance" className="h-8 max-w-56 text-xs" value={forwardTarget} onChange={(e) => setForwardTarget(e.target.value)}>
              <option value="">Choose a target…</option>
              {runningPeers.map((peer) => <option key={peer.instanceId} value={peer.instanceId}>{`${peer.role ?? 'role not recorded'} · ${peer.dispatchId.slice(0, 12)} · attempt ${peer.attempt}`}</option>)}
            </Select>
            <Button size="sm" type="submit" disabled={forward.isPending || !forwardSource || !forwardTarget}>{forward.isPending ? 'Forwarding…' : 'Forward'}</Button>
          </div>
        </form>
      )}

      {notice !== null && <p className="text-xs text-muted" role="status">{notice}</p>}
      {error !== null && <p className="text-xs text-bad" role="alert">{error}</p>}
    </section>
  )
}
