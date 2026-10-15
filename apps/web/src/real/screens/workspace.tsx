/**
 * Real AI workspace (integration tickets 04-05, decision D6): the planning and
 * execution conversation surface. Every conversation is an owned server thread
 * bound to the engagement; sends/resumes go through the request ledger
 * (stable request ids, poll + reconcile - the browser never re-dispatches);
 * streamed events come from the scoped SSE endpoint and checkpointed messages
 * are restored from the thread snapshot on refresh without dispatching
 * another run. Execution threads additionally require the one-way planning
 * handoff plus the server-verified runtime context, and surface workspace
 * tool HITL approvals as allow/deny decisions (never business approval).
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, CircleAlert, Hand, ListPlus, MessagesSquare, RefreshCw, Send, ServerCrash, ShieldQuestion, User } from 'lucide-react'
import { isPendingInterruptView, type ApprovalRequestView, type PendingInterruptView, type ScopedThreadMessage, type ThreadKind } from '@raptix/web-contracts'
import { cancelRun, createThread, decideApproval, fetchApprovals, fetchRuntimeContext, getEngagement, getRun, getThread, listRunsOfThread, listThreads, reconcileRequest, resumeThread, submitRun } from '../api'
import { ApiTransportError } from '../transport'
import { useCapabilityReady } from '../bootstrap'
import { awaitRequest, newRequestId, type AckOutcome } from '../request-ledger'
import { clearPending, isTerminalRun, readPending, readSelection, savePending, saveSelection, type PendingRequest } from '../workspace-session'
import { useRunStream } from '../stream'
import { projectKeys } from '../queries'
import { go, useRoute } from '../../router/navigate'
import { useProjectStore } from '../../state/stores'
import { Banner, Button, Card, CardHeader, Empty, PageHeader, Skeleton, Textarea, cx } from '../../ui'

interface LiveMessage { role: 'user' | 'assistant'; content: string; reasoning?: string; messageId: string | null }
interface TraceLine { id: string; label: string; status?: string; error?: boolean }

interface TraceLikePayload {
  type: string
  name?: string
  agent?: string
  tool?: string
  argsPreview?: string
  content?: string
  text?: string
  prompt?: string
  command?: string
  status?: string
  error?: boolean
}

/** One honest trace line for tool/subagent payloads (SSE or checkpoint history). */
function traceLineFor(id: string, p: TraceLikePayload): TraceLine | null {
  switch (p.type) {
    case 'tool_call': return { id, label: `tool call: ${p.name ?? p.tool ?? ''}${p.argsPreview ? ` (${p.argsPreview})` : ''}`, status: p.status, error: p.error }
    case 'tool_result': return { id, label: `tool result: ${p.name ?? p.tool ?? ''}${p.content ? ` (${p.content})` : ''}`, status: p.status, error: p.error }
    case 'subagent_start': return { id, label: `subagent started: ${p.agent ?? ''}`, status: p.status }
    case 'subagent_end': return { id, label: `subagent finished: ${p.agent ?? ''}`, status: p.status }
    case 'subagent_tool_call': return { id, label: `subagent tool: ${p.agent ?? ''} ${p.tool ?? ''}`, status: p.status }
    case 'subagent_tool_result': return { id, label: `subagent tool result: ${p.agent ?? ''} ${p.tool ?? ''}`, status: p.status, error: p.error }
    case 'subagent_message': return { id, label: `subagent message: ${p.agent ?? ''}`, status: p.status }
    case 'engagement_ready': return { id, label: 'Engagement context ready', status: p.status }
    case 'background_complete': return { id, label: `Background work finished: ${p.agent ?? ''}`, status: p.status }
    case 'ask_user_question': return { id, label: `Question to operator: ${p.prompt ?? p.text ?? p.content ?? ''}`, status: p.status }
    default: return null
  }
}

export function RealWorkspace(): ReactElement {
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const engagementId = route.engagementId || (route.page === 'ai-operator' ? route.id : undefined) || (pid !== 'all' ? pid : '')
  return engagementId ? <RealConversation key={`${engagementId}/${route.id ?? ''}`} engagementId={engagementId} initialThreadId={route.page !== 'ai-operator' ? route.id : undefined} /> : (
    <>
      <PageHeader title="AI Workspace" sub="Planning and execution conversations are scoped to a real engagement." />
      <Empty icon={MessagesSquare} title="No engagement selected" action={<Button variant="primary" onClick={() => go('projects')}>Go to Projects</Button>}>
        Open an engagement from the portfolio, then start its workspace here.
      </Empty>
    </>
  )
}

export function RealConversation({ engagementId, initialThreadId }: { engagementId: string; initialThreadId?: string }): ReactElement {
  const client = useQueryClient()
  const agents = useCapabilityReady('agents')
  const [kindFilter, setKindFilter] = useState<ThreadKind>(() => readSelection(engagementId)?.kind ?? 'planning')
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(() => initialThreadId ?? readSelection(engagementId)?.threadId ?? null)
  const [draft, setDraft] = useState('')
  const [dispatchError, setDispatchError] = useState<string | null>(null)
  const [unconfirmed, setUnconfirmed] = useState<PendingRequest | null>(() => readPending(engagementId))
  const [observedRun, setObservedRun] = useState<{ threadId: string; runId: string } | null>(null)
  const activeRunId = observedRun?.threadId === selectedThreadId ? observedRun.runId : null
  const [runStatus, setRunStatus] = useState<string | null>(null)
  const [live, setLive] = useState<LiveMessage[]>([])
  const [trace, setTrace] = useState<TraceLine[]>([])
  const [recovery, setRecovery] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const scope = `${engagementId}/${selectedThreadId ?? ''}`
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const current = (captured: string): boolean => mounted.current && scopeRef.current === captured

  const detail = useQuery({ queryKey: projectKeys.detail(engagementId), queryFn: () => getEngagement(engagementId) })
  const threads = useQuery({ queryKey: ['real', 'threads', engagementId], queryFn: () => listThreads(engagementId), enabled: agents.ready })
  const allThreads = useMemo(() => [...(threads.data?.threads ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [threads.data])
  const filteredThreads = useMemo(() => allThreads.filter((t) => t.kind === kindFilter), [allThreads, kindFilter])
  const selectedThread = allThreads.find((t) => t.threadId === selectedThreadId) ?? null
  const selectedKind: ThreadKind = selectedThread?.kind ?? kindFilter

  useEffect(() => {
    if (threads.isPending || initialThreadId) return
    if (!selectedThreadId || !allThreads.some((t) => t.threadId === selectedThreadId)) {
      setSelectedThreadId(filteredThreads[0]?.threadId ?? null)
    }
  }, [allThreads, filteredThreads, selectedThreadId, threads.isPending, initialThreadId])
  useEffect(() => {
    if (selectedThread) {
      try { saveSelection(engagementId, selectedThread) }
      catch { setDispatchError('Browser recovery storage is unavailable.') }
    }
  }, [engagementId, selectedThread])

  const snapshot = useQuery({
    queryKey: ['real', 'thread', engagementId, selectedThreadId],
    queryFn: () => getThread(engagementId, selectedThreadId!),
    enabled: !!selectedThreadId,
  })

  /* Server-verified runtime context (R06): gates execution runs. */
  const runtimeCtx = useQuery({
    queryKey: ['real', 'runtime-context', engagementId, selectedKind, selectedThreadId],
    queryFn: () => fetchRuntimeContext(engagementId, selectedKind, selectedThreadId!),
    enabled: !!selectedThreadId && !threads.isPending,
    retry: false,
  })
  const executionBlocked = selectedKind === 'execution' &&
    (runtimeCtx.isError || runtimeCtx.data?.executionReady !== true || runtimeCtx.data.threadVerified !== true || runtimeCtx.data.assistantId !== selectedThread?.assistantId || snapshot.isError || !snapshot.data || detail.data?.handoffConfirmedAt == null)

  /* Live buffers reset whenever the scope (engagement/thread/run) changes. */
  useEffect(() => { setLive([]); setTrace([]); setRecovery(null); setAnswers({}); setRunStatus(null) }, [engagementId, selectedThreadId])
  useEffect(() => { if (activeRunId) { setLive([]); setTrace([]) } }, [activeRunId])

  const runs = useQuery({
    queryKey: ['real', 'runs', engagementId, selectedThreadId],
    queryFn: () => listRunsOfThread(engagementId, selectedThreadId!),
    enabled: !!selectedThreadId && agents.ready,
    retry: false,
  })
  useEffect(() => {
    const running = runs.data?.runs.find(r => !isTerminalRun(r.rawStatus))
    if (running && !activeRunId) setObservedRun({ threadId: running.threadId, runId: running.runId })
  }, [runs.data, activeRunId])

  /* Poll the active run's truthful status; terminal -> finalize. */
  useEffect(() => {
    if (!activeRunId) return
    let cancelled = false
    const tick = async (): Promise<void> => {
      try {
        const run = await getRun(engagementId, selectedThreadId ?? '', activeRunId)
        if (cancelled) return
        setRunStatus(run.rawStatus)
        if (isTerminalRun(run.rawStatus)) {
          setObservedRun(null)
          setLive([])
          void client.invalidateQueries({ queryKey: ['real', 'thread', engagementId] })
          void client.invalidateQueries({ queryKey: ['real', 'planning'] })
          void client.invalidateQueries({ queryKey: ['real', 'approvals'] })
          void client.invalidateQueries({ queryKey: ['real', 'runs', engagementId, selectedThreadId] })
        }
      } catch (error) { if (!cancelled) setRecovery(error instanceof Error ? error.message : 'Run state could not be reconciled.') }
    }
    void tick()
    const handle = setInterval(() => void tick(), 3_000)
    return () => { cancelled = true; clearInterval(handle) }
  }, [activeRunId, engagementId, selectedThreadId, client])

  /* Workspace tool HITL approvals (execution scope only). */
  const approvals = useQuery({
    queryKey: ['real', 'approvals', engagementId],
    queryFn: () => fetchApprovals(engagementId),
    enabled: selectedKind === 'execution',
    refetchInterval: 15_000,
  })
  const decide = useMutation({
    mutationFn: (input: { requestId: string; action: 'allow' | 'deny' }) => decideApproval(engagementId, { ...input, operatorNote: '' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['real', 'approvals', engagementId] })
      void client.invalidateQueries({ queryKey: ['real', 'thread', engagementId] })
    },
    onError: (error) => setDispatchError(error instanceof Error ? error.message : 'Recording the approval decision failed.'),
  })

  /* Scoped SSE for the active run. */
  const streamRef = useRef({ engagementId, threadId: selectedThreadId })
  const checkpointReadAt = useRef(0)
  streamRef.current = { engagementId, threadId: selectedThreadId }
  const stream = useRunStream({
    engagementId,
    threadId: selectedThreadId ?? '',
    runId: activeRunId,
    onEvent: (event) => {
      const p = event.payload
      if (event.source === 'checkpoint') {
        // A replay can contain thousands of checkpoint frames. Coalesce their
        // snapshot reads; final status/control reconciliation still refetches.
        if (Date.now() - checkpointReadAt.current >= 1000) {
          checkpointReadAt.current = Date.now()
          void client.invalidateQueries({ queryKey: ['real', 'thread', engagementId, selectedThreadId] }, { cancelRefetch: false })
        }
        return
      }
      if (p.type === 'message') {
        setLive((prev) => {
          const next = [...prev]
          const at = p.messageId ? next.findIndex((m) => m.messageId === p.messageId) : -1
          const entry: LiveMessage = { role: p.role, messageId: p.messageId, content: p.mode === 'snapshot' ? p.content : (at >= 0 ? next[at].content + p.content : p.content), reasoning: p.reasoning ?? (at >= 0 ? next[at].reasoning : undefined) }
          if (at >= 0) next[at] = entry
          else next.push(entry)
          return next
        })
        return
      }
      if (p.type === 'interrupt' || p.type === 'ask_user_question') {
        void client.invalidateQueries({ queryKey: ['real', 'thread', streamRef.current.engagementId, streamRef.current.threadId] })
        return
      }
      const line = traceLineFor(event.eventId, p as TraceLikePayload)
      if (line) setTrace((prev) => [...prev.slice(-199), line])
    },
    onControl: (type) => {
      setRecovery(type === 'stream_error'
        ? 'The event stream reported an error. The run keeps executing on the server - refresh the conversation to reconcile its state.'
        : 'The event stream closed. The run keeps executing on the server - the conversation restores from checkpoints on refresh.')
      void client.invalidateQueries({ queryKey: ['real', 'thread', streamRef.current.engagementId, streamRef.current.threadId] })
    },
  })

  const dispatch = async (pending: PendingRequest, invoke: () => Promise<Awaited<ReturnType<typeof createThread>>>): Promise<{ outcome: AckOutcome; scope: string }> => {
    const captured = scope
    savePending(engagementId, pending)
    setUnconfirmed(pending)
    try {
      const outcome = await awaitRequest(engagementId, await invoke())
      if (outcome.kind !== 'unconfirmed') clearPending(engagementId, pending.requestId)
      if (mounted.current) setUnconfirmed(previous => previous?.requestId === pending.requestId ? (outcome.kind === 'unconfirmed' ? pending : null) : previous)
      if (current(captured)) {
        if (outcome.kind === 'rejected') setDispatchError('The server recorded the request as rejected.')
      }
      return { outcome, scope: captured }
    } catch (error) {
      const rejected = error instanceof ApiTransportError && ['bad_request', 'forbidden', 'unauthorized', 'conflict'].includes(error.code)
      if (rejected) clearPending(engagementId, pending.requestId)
      if (current(captured)) {
        setDispatchError(error instanceof Error ? error.message : 'Dispatch outcome is unknown; reconcile the existing request.')
        if (rejected) setUnconfirmed(null)
      }
      return { outcome: { kind: rejected ? 'rejected' : 'unconfirmed', requestId: pending.requestId, message: 'Check the same request identity before any new dispatch.' }, scope: captured }
    }
  }

  const createThreadByKind = useMutation({
    mutationFn: async (kind: ThreadKind) => {
      const pending = { requestId: newRequestId(), threadId: null, kind }
      return dispatch(pending, () => createThread(engagementId, { requestId: pending.requestId, kind }))
    },
    onSuccess: (result) => {
      if (!current(result.scope) || result.outcome.kind !== 'accepted') return
      void client.invalidateQueries({ queryKey: ['real', 'threads', engagementId] })
      setSelectedThreadId(result.outcome.threadId)
    },
    onError: (error) => setDispatchError(error instanceof Error ? error.message : 'Recovery identity could not be saved; nothing dispatched.'),
  })

  const send = useMutation({
    mutationFn: async (message: string) => {
      const threadId = selectedThreadId
      if (!threadId) throw new Error('Select or create a thread first.')
      if (executionBlocked) throw new Error('Execution is not ready: confirm the planning handoff and let the server verify the runtime context.')
      const pending = { requestId: newRequestId(), threadId, kind: selectedKind }
      return dispatch(pending, () => submitRun(engagementId, threadId, { requestId: pending.requestId, message }))
    },
    onSuccess: (result) => {
      if (!current(result.scope) || result.outcome.kind !== 'accepted') return
      setDraft('')
      if (result.outcome.runId) { setRunStatus('pending'); setObservedRun({ threadId: result.outcome.threadId, runId: result.outcome.runId }) }
      void client.invalidateQueries({ queryKey: ['real', 'thread', engagementId, selectedThreadId] })
    },
    onError: (error) => setDispatchError(error instanceof Error ? error.message : 'Message dispatch failed.'),
  })

  const answerQuestion = useMutation({
    mutationFn: async (responses: { questionId: string; value: string | string[] }[]) => {
      const threadId = selectedThreadId
      if (!threadId) throw new Error('Select or create a thread first.')
      const pending = { requestId: newRequestId(), threadId, kind: selectedKind }
      const input = responses.length === 1 ? { value: responses[0].value, questionId: responses[0].questionId } : { answers: responses }
      return dispatch(pending, () => resumeThread(engagementId, threadId, { requestId: pending.requestId, ...input }))
    },
    onSuccess: (result) => {
      if (!current(result.scope) || result.outcome.kind !== 'accepted') return
      setAnswers({})
      if (result.outcome.runId) { setRunStatus('pending'); setObservedRun({ threadId: result.outcome.threadId, runId: result.outcome.runId }) }
      void client.invalidateQueries({ queryKey: ['real', 'thread', engagementId, selectedThreadId] })
    },
    onError: (error) => setDispatchError(error instanceof Error ? error.message : 'Question resume failed.'),
  })

  const stopRun = useMutation({
    mutationFn: async () => {
      if (!activeRunId || !selectedThreadId) throw new Error('No running plan to stop.')
      return { run: await cancelRun(engagementId, selectedThreadId, activeRunId), scope }
    },
    onSuccess: ({ run, scope: captured }) => {
      if (!current(captured)) return
      setRunStatus(run.rawStatus)
      if (isTerminalRun(run.rawStatus)) setObservedRun(null)
      else setRecovery('Cancellation was requested; termination has not been verified yet.')
      void client.invalidateQueries({ queryKey: ['real', 'thread', engagementId, selectedThreadId] })
    },
    onError: (error) => setDispatchError(error instanceof Error ? error.message : 'Cancellation was not confirmed.'),
  })

  const reconcilePending = useMutation({
    mutationFn: async (requestId: string) => {
      const view = await reconcileRequest(engagementId, requestId)
      return { outcome: await awaitRequest(engagementId, view), scope }
    },
    onSuccess: ({ outcome, scope: captured }) => {
      if (outcome.kind !== 'unconfirmed') clearPending(engagementId, outcome.requestId)
      if (!current(captured)) return
      if (outcome.kind !== 'unconfirmed') setUnconfirmed(null)
      if (outcome.kind === 'accepted') {
        setKindFilter(unconfirmed?.kind ?? selectedKind)
        setSelectedThreadId(outcome.threadId)
        void client.invalidateQueries({ queryKey: ['real', 'threads', engagementId] })
        if (outcome.runId) { setRunStatus('pending'); setObservedRun({ threadId: outcome.threadId, runId: outcome.runId }) }
      } else if (outcome.kind === 'rejected') setDispatchError('The server recorded this request as rejected.')
    },
    onError: (error) => setDispatchError(error instanceof Error ? error.message : 'Reconciling the request failed.'),
  })

  const snapshotMessages = snapshot.data?.messages ?? []
  const snapshotIds = new Set(snapshotMessages.map((m) => m.messageId).filter((x): x is string => !!x))
  const displayed = [...snapshotMessages, ...live.filter((m) => !m.messageId || !snapshotIds.has(m.messageId))]
  const pendingQuestions = (snapshot.data?.pendingQuestions ?? []).filter(isPendingInterruptView)
  const transcripts = snapshot.data?.transcripts ?? []

  /* Honest unavailable surface (D4): without the assistant runtime the
     workspace has nothing to host - no demo conversation is substituted. */
  if (!agents.ready) {
    return (
      <>
        <PageHeader
          title="AI Workspace"
          sub={<span>Planning and execution conversations for <span className="font-mono">{engagementId}</span>.</span>}
          crumbs={[{ label: 'Projects', to: () => go('projects') }, { label: 'AI Workspace' }]}
        />
        <Empty icon={ServerCrash} title="Assistant runtime is not available on this server">
          {agents.reason ?? 'The conversation/run runtime is not configured, so the workspace cannot host threads. No demo data is shown.'}
        </Empty>
      </>
    )
  }

  if (!engagementId) return <Empty icon={ServerCrash} title="No engagement selected" />

  return (
    <>
      <PageHeader
        title="AI Workspace"
        sub={<span>Planning and execution conversations for <span className="font-mono">{engagementId}</span>. Threads and messages live on the server and survive a refresh.</span>}
        crumbs={[{ label: 'Projects', to: () => go('projects') }, { label: 'AI Workspace' }]}
        meta={<span className="inline-flex h-6 items-center rounded-full border border-cyan/30 bg-info-soft px-2.5 text-xs font-medium text-cyan">Real mode</span>}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="primary" icon={ListPlus} disabled={createThreadByKind.isPending || send.isPending || !!unconfirmed}
              title="Creates a new owned planning thread on the server"
              onClick={() => { setDispatchError(null); setKindFilter('planning'); createThreadByKind.mutate('planning') }}>
              {createThreadByKind.isPending && kindFilter === 'planning' ? 'Creating...' : 'New planning thread'}
            </Button>
            <Button variant="secondary" icon={ListPlus}
              disabled={createThreadByKind.isPending || !!unconfirmed || detail.data?.handoffConfirmedAt == null}
              title={detail.data?.handoffConfirmedAt == null ? 'Confirm the planning handoff first - execution never bypasses it' : 'Creates a new owned execution thread on the server'}
              onClick={() => { setDispatchError(null); setKindFilter('execution'); createThreadByKind.mutate('execution') }}>
              New execution thread
            </Button>
          </div>
        )}
      />

      {dispatchError && <Banner tone="bad" title="Request not completed" action={<Button size="sm" variant="ghost" onClick={() => setDispatchError(null)}>Dismiss</Button>}>{dispatchError}</Banner>}
      {unconfirmed && (
        <Banner tone="warn" title="Request still unconfirmed" action={(
          <Button size="sm" variant="secondary" icon={RefreshCw} disabled={reconcilePending.isPending} onClick={() => reconcilePending.mutate(unconfirmed.requestId)}>
            {reconcilePending.isPending ? 'Reconciling...' : 'Reconcile request'}
          </Button>
        )}>
          Request <span className="font-mono">{unconfirmed.requestId}</span> is still unconfirmed. Reconcile this identity before another dispatch.
        </Banner>
      )}
      {recovery && (
        <Banner tone="warn" title="Observation needs recovery" action={<Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => { void snapshot.refetch(); void runs.refetch(); setRecovery(null) }}>Refresh view</Button>}>
          {recovery}
        </Banner>
      )}

      <div className="mt-4 grid grid-cols-1 gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <Card>
            <CardHeader title="Threads" sub="Owned bindings from the runtime ledger." />
            <div className="mb-3 flex gap-1" role="group" aria-label="Thread kind filter">
              {(['planning', 'execution'] as ThreadKind[]).map((k) => (
                <button key={k} onClick={() => setKindFilter(k)}
                  aria-pressed={kindFilter === k}
                  className={cx('h-8 rounded-full border px-3 text-xs font-medium capitalize', kindFilter === k ? 'border-accent-line bg-accent-soft text-accent' : 'border-line text-muted hover:bg-hover')}>
                  {k}
                </button>
              ))}
            </div>
            {threads.isPending ? <div className="space-y-2" aria-busy="true" role="status"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
              : threads.isError ? <p className="text-sm text-bad" role="alert">{threads.error instanceof Error ? threads.error.message : 'Threads could not be loaded.'}</p>
              : filteredThreads.length === 0 ? <p className="text-sm text-muted">No {kindFilter} thread yet.</p>
              : (
                <ul className="space-y-1">
                  {filteredThreads.map((t) => (
                    <li key={t.threadId}>
                      <button
                        onClick={() => setSelectedThreadId(t.threadId)}
                        aria-current={selectedThreadId === t.threadId ? 'true' : undefined}
                        className={cx('w-full rounded-[10px] px-3 py-2 text-left', selectedThreadId === t.threadId ? 'bg-accent-soft' : 'hover:bg-hover')}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-xs font-medium text-fg">{t.threadId}</span>
                          <span className={cx('shrink-0 rounded-full border px-1.5 text-[10px] uppercase', t.kind === 'planning' ? 'border-line text-muted' : 'border-warn/40 text-warn')}>{t.kind}</span>
                        </div>
                        <div className="text-xs text-muted">assistant {t.assistantId} | {t.updatedAt.replace('T', ' ').slice(0, 16)}Z</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          </Card>
          <Card>
            <CardHeader title="Connection" />
            <p className="text-xs text-muted" role="status">
              {activeRunId
                ? <>Run <span className="font-mono">{activeRunId.slice(0, 12)}...</span> - {stream.connected ? 'streaming events' : 'stream connecting/reconnecting'}{stream.malformedCount > 0 ? ` (${stream.malformedCount} malformed frame(s) ignored)` : ''}</>
                : 'No active run. Sending a message dispatches exactly one server run.'}
            </p>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          {activeRunId && (
            <div className="flex items-center gap-2 text-xs text-muted" role="status">
              <span className="inline-flex h-6 items-center rounded-full border border-line bg-subtle px-2.5 font-mono">run {activeRunId.slice(0, 12)}...</span>
              <span>{runStatus ?? 'pending'}</span>
              <Button size="sm" variant="secondary" disabled={stopRun.isPending} onClick={() => stopRun.mutate()}>Cancel run</Button>
            </div>
          )}

          {selectedKind === 'execution' && runtimeCtx.data && (
            <Banner tone={runtimeCtx.data.executionReady ? 'ok' : 'warn'} title="Server-verified runtime context">
              assistant <span className="font-mono">{runtimeCtx.data.assistantId}</span> | workspace <span className="font-mono">{runtimeCtx.data.workspaceSlug}</span> | planning {runtimeCtx.data.planningState} | execution {runtimeCtx.data.executionReady ? 'ready' : 'blocked'}
            </Banner>
          )}

          <Card>
            <CardHeader title="Conversation" sub={snapshot.data?.messagesTruncated ? 'Earlier messages are truncated by the server projection.' : undefined} />
            {!selectedThreadId ? (
              <Empty icon={MessagesSquare} title="No thread selected">Create a thread to start the conversation.</Empty>
            ) : snapshot.isPending ? (
              <div className="space-y-3" aria-busy="true" role="status"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
            ) : snapshot.isError ? (
              <div role="alert" className="text-sm text-bad">{snapshot.error instanceof Error ? snapshot.error.message : 'The thread snapshot failed to load.'}</div>
            ) : (
              <Transcript messages={displayed} trace={trace} />
            )}
          </Card>

          {transcripts.length > 0 && (
            <Card>
              <CardHeader title="Thread history (checkpoints)" sub="Unattributed checkpoint events accumulated across runs - never current-run work." />
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {transcripts.map((t, i) => {
                  const line = traceLineFor(t.key ?? `hist-${i}`, t.payload as TraceLikePayload)
                  if (!line) return null
                  return (
                    <li key={t.key ?? `hist-${i}`} className="flex items-start gap-2 text-xs">
                      <CircleAlert size={12} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                      <span className="min-w-0 flex-1 break-words text-muted">{line.label}</span>
                      {line.status && <span className="shrink-0 font-mono text-neutral">{line.status}</span>}
                    </li>
                  )
                })}
              </ul>
              {snapshot.data?.transcriptsTruncated && <p className="mt-2 text-xs text-neutral">Older checkpoint events are truncated by the server projection.</p>}
            </Card>
          )}

          {selectedKind === 'execution' && (
            <ApprovalsCard
              state={approvals}
              busyId={decide.isPending ? decide.variables?.requestId ?? null : null}
              onDecide={(requestId, action) => decide.mutate({ requestId, action })}
            />
          )}

          {pendingQuestions.length > 0 && (
            <Card>
              <CardHeader title="Pending questions" sub="The assistant is waiting for your answers before it continues. Answers resume the same thread." />
              <div className="space-y-4">
                  {pendingQuestions.map((q) => <QuestionCard key={`${selectedThreadId}/${q.questionId}/${q.interruptId ?? ''}`} question={q} busy={answerQuestion.isPending || !!unconfirmed} onValue={(value) => setAnswers(prev => ({ ...prev, [q.questionId]: value }))} onAnswer={pendingQuestions.length === 1 ? (value) => answerQuestion.mutate([{ questionId: q.questionId, value }]) : undefined} />)}
                  {pendingQuestions.length > 1 && <Button variant="primary" disabled={answerQuestion.isPending || !!unconfirmed || pendingQuestions.some(q => { const value = answers[q.questionId]; return typeof value === 'string' ? !value.trim() : !value?.length })} onClick={() => answerQuestion.mutate(pendingQuestions.map(q => ({ questionId: q.questionId, value: answers[q.questionId] })))}>Answer all questions</Button>}
              </div>
            </Card>
          )}

          <Card>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={selectedThreadId ? 'Describe what to do next - scope, constraints, instructions...' : 'Create a thread first...'}
                  aria-label="Workspace message"
                  disabled={!selectedThreadId || send.isPending || executionBlocked || !!unconfirmed || !!activeRunId}
                />
                <p className="mt-1 text-xs text-neutral">
                  {executionBlocked
                    ? 'Execution is blocked: it needs the confirmed planning handoff and a server-verified runtime context.'
                    : 'Sending dispatches exactly one runtime run per request id. Refreshing never re-dispatches.'}
                </p>
              </div>
              <Button variant="primary" icon={Send} disabled={!selectedThreadId || !draft.trim() || send.isPending || createThreadByKind.isPending || executionBlocked || !!unconfirmed || !!activeRunId}
                onClick={() => { setDispatchError(null); send.mutate(draft.trim()) }}>
                {send.isPending ? 'Dispatching...' : 'Send'}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}

function ApprovalsCard({ state, busyId, onDecide }: {
  state: { data?: { approvals: ApprovalRequestView[]; truncated?: boolean }; isPending: boolean; isError: boolean; error: unknown; refetch: () => void }
  busyId: string | null
  onDecide: (requestId: string, action: 'allow' | 'deny') => void
}): ReactElement {
  return (
    <Card>
      <CardHeader title="Tool approvals (HITL)" sub="Workspace policy requests for this engagement's tools. Allow/Deny is an operational tool decision - never business plan approval." />
      {state.isPending ? <div className="space-y-2" aria-busy="true" role="status"><Skeleton className="h-12" /></div>
        : state.isError ? <p className="text-sm text-bad" role="alert">{state.error instanceof Error ? state.error.message : 'Approvals could not be loaded.'}</p>
        : (state.data?.approvals.length ?? 0) === 0 ? <p className="text-sm text-muted">No pending tool approvals.</p>
        : (
          <ul className="space-y-3">
            {state.data!.approvals.map((a) => (
              <li key={a.requestId} className="rounded-xl border border-warn/30 bg-warn-soft p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Hand size={14} className="text-warn" aria-hidden />
                  <span className="font-medium text-fg">{a.toolName}</span>
                  <span className="text-xs text-muted">agent {a.agentName}</span>
                  <span className="font-mono text-xs text-neutral">{a.requestId}</span>
                </div>
                <p className="mt-1 text-xs text-muted">{a.reason}</p>
                <p className="mt-1 font-mono text-xs text-neutral">{JSON.stringify(a.toolArgsRedacted).slice(0, 240)}</p>
                <p className="mt-1 text-xs text-neutral">rule: {a.matchedRule.techniqueTag ?? a.matchedRule.toolPattern ?? 'unmatched'} | timeout {a.matchedRule.timeoutSeconds}s | on timeout: {a.matchedRule.defaultOnTimeout}</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="primary" disabled={busyId === a.requestId} onClick={() => onDecide(a.requestId, 'allow')}>Allow</Button>
                  <Button size="sm" variant="secondary" disabled={busyId === a.requestId} onClick={() => onDecide(a.requestId, 'deny')}>Deny</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
    </Card>
  )
}

function Transcript({ messages, trace }: { messages: ScopedThreadMessage[]; trace: TraceLine[] }): ReactElement {
  return (
    <div className="space-y-3">
      {messages.length === 0 && trace.length === 0 ? (
        <p className="text-sm text-muted">No messages yet. Open with the engagement context, constraints and what you want planned.</p>
      ) : messages.map((m, i) => (
        <div key={m.messageId ?? `msg-${i}`} className={cx('flex gap-3', m.role === 'user' ? '' : 'bg-subtle rounded-xl p-3')}>
          <span className={cx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border', m.role === 'user' ? 'border-line text-muted' : 'border-accent-line bg-accent-soft text-accent')} aria-hidden>
            {m.role === 'user' ? <User size={14} /> : <Bot size={14} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">{m.role === 'user' ? 'You' : 'Planner'}</div>
            {m.reasoning && <p className="mt-1 text-xs italic text-neutral">{m.reasoning}</p>}
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{m.content}</p>
          </div>
        </div>
      ))}
      {trace.length > 0 && (
        <div className="rounded-xl border border-line bg-panel">
          <div className="border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wider text-neutral">Current run activity</div>
          <ul className="max-h-56 space-y-1 overflow-y-auto px-3 py-2">
            {trace.map((t) => (
              <li key={t.id} className="flex items-start gap-2 text-xs">
                <CircleAlert size={12} className={cx('mt-0.5 shrink-0', t.error ? 'text-bad' : 'text-muted')} aria-hidden />
                <span className="min-w-0 flex-1 break-words text-muted">{t.label}</span>
                {t.status && <span className="shrink-0 font-mono text-neutral">{t.status}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function QuestionCard({ question, busy, onAnswer, onValue }: { question: PendingInterruptView; busy: boolean; onAnswer?: (value: string | string[]) => void; onValue: (value: string | string[]) => void }): ReactElement {
  const [selected, setSelected] = useState<string[]>([])
  const [other, setOther] = useState('')
  const useOther = question.allowOther && other.trim().length > 0
  const canSubmit = !busy && (useOther || (!question.multiSelect ? selected.length === 1 : selected.length > 0))
  const submit = (): void => {
    if (useOther) { onAnswer?.(other.trim()); return }
    onAnswer?.(question.multiSelect ? selected : selected[0])
  }
  return (
    <div className="rounded-xl border border-line bg-subtle p-3" role="group" aria-label={question.header || 'Pending question'}>
      <div className="flex items-start gap-2">
        <ShieldQuestion size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0">
          {question.header && <div className="text-xs font-semibold uppercase tracking-wider text-neutral">{question.header}</div>}
          <p className="text-sm text-fg">{question.question}</p>
        </div>
      </div>
      <div className="mt-2 space-y-1.5">
        {question.options.map((o) => (
          <label key={o.label} className="flex min-h-10 cursor-pointer items-start gap-2 rounded-[10px] border border-line bg-panel px-3 py-2 text-sm hover:bg-hover">
            <input
              type={question.multiSelect ? 'checkbox' : 'radio'}
              name={`question-${question.questionId}`}
              checked={selected.includes(o.label)}
              onChange={() => {
                const next = question.multiSelect ? (selected.includes(o.label) ? selected.filter(x => x !== o.label) : [...selected, o.label]) : [o.label]
                setSelected(next)
                onValue(question.multiSelect ? next : next[0])
              }}
              className="mt-1 accent-[var(--c-accent)]"
            />
            <span className="min-w-0"><span className="font-medium">{o.label}</span>{o.description && <span className="block text-xs text-muted">{o.description}</span>}</span>
          </label>
        ))}
        {question.allowOther && (
          <input
            value={other}
            onChange={(e) => { setOther(e.target.value); onValue(e.target.value.trim() || (question.multiSelect ? selected : selected[0])) }}
            placeholder="Other - type your answer..."
            aria-label="Other answer"
            className="h-10 w-full rounded-[10px] border border-line bg-panel px-3 text-sm text-fg"
          />
        )}
      </div>
      {onAnswer && <div className="mt-2 flex justify-end">
        <Button size="sm" variant="primary" disabled={!canSubmit} onClick={submit} title="Resumes the same thread with this answer">
          {busy ? 'Sending...' : 'Answer'}
        </Button>
      </div>}
    </div>
  )
}
