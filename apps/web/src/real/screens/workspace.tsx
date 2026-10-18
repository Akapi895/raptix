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
import { ArrowDown, Check, ChevronDown, ChevronRight, CircleAlert, Copy, Hand, ListPlus, MessagesSquare, MoreHorizontal, Pencil, PanelRightClose, PanelRightOpen, RefreshCw, Search, Send, ServerCrash, ShieldQuestion, Wrench } from 'lucide-react'
import { isPendingInterruptView, type ApprovalRequestView, type PendingInterruptView, type ScopedThreadMessage, type ThreadKind } from '@raptix/web-contracts'
import { cancelRun, createThread, decideApproval, fetchApprovals, fetchFleet, fetchPlanning, fetchRuntimeContext, getEngagement, getRun, getThread, listRunsOfThread, listThreads, reconcileRequest, renameThread, resumeThread, submitRun } from '../api'
import { ApiTransportError } from '../transport'
import { useCapabilityReady } from '../bootstrap'
import { awaitRequest, newRequestId, type AckOutcome } from '../request-ledger'
import { clearPending, isTerminalRun, readPending, readSelection, savePending, saveSelection, type PendingRequest } from '../workspace-session'
import { useRunStream } from '../stream'
import { projectKeys } from '../queries'
import { go, useRoute } from '../../router/navigate'
import { useProjectStore } from '../../state/stores'
import { Banner, Button, Card, CardHeader, Drawer, Empty, PageHeader, Segmented, Skeleton, Textarea, cx } from '../../ui'
import { utcMinute, utcMinuteOr } from '../format'
import { renderMarkdown } from '../markdown'
import { RealExecutionAgents, ObservedInvocation } from './execution-agents'
import { INSP, Separator, useResizable, useViewportW } from '../../ui/panel-sizing'
import { readWorkspaceDraft, saveWorkspaceDraft } from '../workspace-session'
import { clearPlanningSeed, hasPlanningSeed, planningSeedMessage } from '../planning-seed'
import { RuntimeOperationsTab as RealOperationsHistory } from '../../features/operations/runtime-tab'
import { useSession } from '../session'

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

export function RealConversation({ engagementId, initialThreadId, embedded = false }: { engagementId: string; initialThreadId?: string; embedded?: boolean }): ReactElement {
  const client = useQueryClient()
  const agents = useCapabilityReady('agents')
  const { session, deploymentId } = useSession()
  const actorId = session?.actor?.id ?? 'local'
  const [kindFilter, setKindFilter] = useState<ThreadKind>(() => embedded ? 'execution' : readSelection(actorId, engagementId, deploymentId)?.kind ?? 'planning')
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(() => initialThreadId ?? (embedded && readSelection(actorId, engagementId, deploymentId)?.kind !== 'execution' ? null : readSelection(actorId, engagementId, deploymentId)?.threadId ?? null))
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const draft = selectedThreadId ? drafts[selectedThreadId] ?? readWorkspaceDraft(engagementId, selectedThreadId, actorId, deploymentId) : ''
  const setDraft = (text: string): void => { if (selectedThreadId) { setDrafts((previous) => ({ ...previous, [selectedThreadId]: text })); try { saveWorkspaceDraft(engagementId, selectedThreadId, text, actorId, deploymentId) } catch { setDispatchError('Draft recovery storage is unavailable.') } } }
  const [observation, setObservation] = useState<{ threadId: string; key: string } | null>(null)
  const [agentsOpen, setAgentsOpen] = useState(true)
  const [agentsSheet, setAgentsSheet] = useState(false)
  const [historySheet, setHistorySheet] = useState(false)
  const wide = useViewportW() >= 1280
  const agentWidth = useResizable('raptix.real.execution.agents.width', INSP)
  const [dispatchError, setDispatchError] = useState<string | null>(null)
  const [unconfirmed, setUnconfirmed] = useState<PendingRequest | null>(() => readPending(actorId, engagementId, deploymentId))
  const [observedRun, setObservedRun] = useState<{ threadId: string; runId: string } | null>(null)
  const activeRunId = observedRun?.threadId === selectedThreadId ? observedRun.runId : null
  const [runStatus, setRunStatus] = useState<string | null>(null)
  const [live, setLive] = useState<LiveMessage[]>([])
  const [trace, setTrace] = useState<TraceLine[]>([])
  const [recovery, setRecovery] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [sideTab, setSideTab] = useState<'agents' | 'activity' | 'artifacts'>('agents')
  const chatScroll = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const scope = `${engagementId}/${selectedThreadId ?? ''}`
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const current = (captured: string): boolean => mounted.current && scopeRef.current === captured

  const detail = useQuery({ queryKey: projectKeys.detail(engagementId), queryFn: () => getEngagement(engagementId) })
  /* Planning readiness subscription (same projection/key as the planning
     panel): polled so a completed planning bundle is noticed from the
     workspace without the panel mounted. */
  const planning = useQuery({
    queryKey: ['real', 'planning', engagementId],
    queryFn: () => fetchPlanning(engagementId),
    enabled: agents.ready,
    refetchInterval: 15_000,
  })
  const threads = useQuery({ queryKey: ['real', 'threads', engagementId], queryFn: () => listThreads(engagementId), enabled: agents.ready })
  const allThreads = useMemo(() => [...(threads.data?.threads ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [threads.data])
  const filteredThreads = useMemo(() => allThreads.filter((t) => t.kind === kindFilter), [allThreads, kindFilter])
  const selectedThread = allThreads.find((t) => t.threadId === selectedThreadId) ?? null
  const selectedKind: ThreadKind = selectedThread?.kind ?? kindFilter

  useEffect(() => {
    if (threads.isPending || initialThreadId) return
    if (!selectedThreadId || !allThreads.some((t) => t.threadId === selectedThreadId && (!embedded || t.kind === 'execution'))) {
      setSelectedThreadId(filteredThreads[0]?.threadId ?? null)
    }
  }, [allThreads, filteredThreads, selectedThreadId, threads.isPending, initialThreadId, embedded])
  useEffect(() => {
    if (selectedThread) {
      try { saveSelection(actorId, engagementId, selectedThread, deploymentId) }
      catch { setDispatchError('Browser recovery storage is unavailable.') }
    }
  }, [actorId, engagementId, selectedThread, deploymentId])

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
    onControl: (type, recoveryRequired) => {
      /* A run that pauses for an answer closes its stream normally: reconcile the thread (pending questions) without a warning. */
      setRecovery(!recoveryRequired ? null : type === 'stream_error'
        ? 'The event stream reported an error. The run keeps executing on the server - refresh the conversation to reconcile its state.'
        : 'The event stream closed. The run keeps executing on the server - the conversation restores from checkpoints on refresh.')
      void client.invalidateQueries({ queryKey: ['real', 'thread', streamRef.current.engagementId, streamRef.current.threadId] })
    },
  })

  const dispatch = async (pending: PendingRequest, invoke: () => Promise<Awaited<ReturnType<typeof createThread>>>): Promise<{ outcome: AckOutcome; scope: string }> => {
    const captured = scope
    savePending(actorId, engagementId, pending, deploymentId)
    setUnconfirmed(pending)
    try {
      const outcome = await awaitRequest(engagementId, await invoke())
      if (outcome.kind !== 'unconfirmed') clearPending(actorId, engagementId, pending.requestId, deploymentId)
      if (mounted.current) setUnconfirmed(previous => previous?.requestId === pending.requestId ? (outcome.kind === 'unconfirmed' ? pending : null) : previous)
      if (current(captured)) {
        if (outcome.kind === 'rejected') setDispatchError('The server recorded the request as rejected.')
      }
      return { outcome, scope: captured }
    } catch (error) {
      const rejected = error instanceof ApiTransportError && ['bad_request', 'forbidden', 'unauthorized', 'conflict'].includes(error.code)
      if (rejected) clearPending(actorId, engagementId, pending.requestId, deploymentId)
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
    onSuccess: (result, kind) => {
      if (!current(result.scope) || result.outcome.kind !== 'accepted') return
      void client.invalidateQueries({ queryKey: ['real', 'threads', engagementId] })
      setKindFilter(kind)
      setSelectedThreadId(result.outcome.threadId)
      if (kind === 'execution' && autoRequested.current === engagementId) setAutoTransitioned(true)
    },
    onError: (error) => setDispatchError(error instanceof Error ? error.message : 'Recovery identity could not be saved; nothing dispatched.'),
  })

  /* W22 auto-transition (operator decision: prepare the tab + thread only —
     never Send). Once the planning bundle is ready and the one-way handoff is
     confirmed, create the execution thread exactly once and switch the
     workspace to it. The request goes through the same ledger/dispatch path
     as a manual click; a refused creation is not retried. */
  const hasExecutionThread = allThreads.some((t) => t.kind === 'execution')
  const [autoTransitioned, setAutoTransitioned] = useState(false)
  const autoRequested = useRef<string | null>(null)
  useEffect(() => {
    if (embedded) return
    if (autoRequested.current === engagementId || autoTransitioned) return
    if (hasExecutionThread) return
    if (detail.data?.handoffConfirmedAt == null) return
    if (planning.data?.readiness.state !== 'ready') return
    if (threads.isPending || activeRunId || createThreadByKind.isPending || unconfirmed) return
    /* Keep the dispatch scope stable: wait until the threads effect has
       selected an existing thread (or there is none to select). */
    if (selectedThreadId === null && filteredThreads.length > 0) return
    autoRequested.current = engagementId
    setDispatchError(null)
    createThreadByKind.mutate('execution')
  }, [engagementId, autoTransitioned, hasExecutionThread, detail.data, planning.data, threads.isPending, activeRunId, unconfirmed, selectedThreadId, filteredThreads.length, createThreadByKind, embedded])

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

  /* Project creation starts the planner: when the create form flagged this
     engagement and no planning thread exists yet, open one and send the brief
     as its first message. The flag is consumed on read, so a reload never sends
     it twice, and an existing planning thread always wins. */
  const seedPending = useRef(false)
  const seedMessage = useRef<string | null>(null)
  useEffect(() => {
    if (embedded) return
    seedPending.current = hasPlanningSeed(engagementId)
  }, [engagementId, embedded])
  useEffect(() => {
    if (!seedPending.current || embedded || threads.isPending || !detail.data || createThreadByKind.isPending) return
    seedPending.current = false
    clearPlanningSeed(engagementId)
    if (allThreads.some((t) => t.kind === 'planning')) return
    seedMessage.current = planningSeedMessage(detail.data)
    setDispatchError(null)
    createThreadByKind.mutate('planning')
  }, [allThreads, createThreadByKind, detail.data, embedded, engagementId, threads.isPending])
  useEffect(() => {
    const message = seedMessage.current
    if (message === null || selectedKind !== 'planning' || selectedThreadId === null || send.isPending) return
    seedMessage.current = null
    send.mutate(message)
  }, [selectedKind, selectedThreadId, send])

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
      if (outcome.kind !== 'unconfirmed') clearPending(actorId, engagementId, outcome.requestId, deploymentId)
      if (!current(captured)) return
      if (outcome.kind !== 'unconfirmed') setUnconfirmed(null)
      if (outcome.kind === 'accepted') {
        if (embedded && unconfirmed?.kind === 'planning') return
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
  const rename = useMutation({
    mutationFn: (input: { threadId: string; title: string }) => renameThread(engagementId, input.threadId, input.title),
    onSuccess: () => { setDispatchError(null); void client.invalidateQueries({ queryKey: ['real', 'threads', engagementId] }) },
    onError: (error) => setDispatchError(error instanceof Error ? error.message : 'The conversation could not be renamed.'),
  })
  const displayed = [...snapshotMessages, ...live.filter((m) => !m.messageId || !snapshotIds.has(m.messageId))]
  const pendingQuestions = (snapshot.data?.pendingQuestions ?? []).filter(isPendingInterruptView)
  // Keep the newest content in view only while the operator is already at the bottom; never pull them down while they read older messages.
  useEffect(() => {
    const el = chatScroll.current
    if (el && atBottom) el.scrollTop = el.scrollHeight
  }, [displayed.length, trace.length, atBottom, selectedThreadId])
  const transcripts = snapshot.data?.transcripts ?? []
  const fleet = useQuery({ queryKey: ['real', 'fleet', engagementId], queryFn: () => fetchFleet(engagementId), enabled: agents.ready, refetchInterval: 8000 })
  const observationKey = observation?.threadId === selectedThreadId ? observation.key : null
  const branches = fleet.data?.branches.filter((branch) => branch.threadId === selectedThreadId) ?? []
  const observedBranch = branches.find((branch) => branch.key === observationKey)
  const selectObservation = (key: string | null): void => { setObservation(key && selectedThreadId ? { threadId: selectedThreadId, key } : null); setAgentsSheet(false) }
  const agentPanel = <RealExecutionAgents engagementId={engagementId} assistantId={selectedThread?.assistantId ?? null} threadId={selectedThreadId} branches={branches} selectedKey={observationKey} onSelect={selectObservation} sourceError={fleet.isError ? 'The fleet source is unavailable. No completion is inferred.' : null} />

  /* Honest unavailable surface (D4): without the assistant runtime the
     workspace has nothing to host - no demo conversation is substituted. */
  if (!agents.ready) {
    return (
      <>
        {!embedded && <PageHeader
          title="AI Workspace"
          sub={<span>Planning and execution conversations for <span className="font-mono">{engagementId}</span>.</span>}
          crumbs={[{ label: 'Projects', to: () => go('projects') }, { label: 'AI Workspace' }]}
        />}
        <Empty icon={ServerCrash} title="Assistant runtime is not available on this server">
          {agents.reason ?? 'The conversation/run runtime is not configured, so the workspace cannot host threads. No demo data is shown.'}
        </Empty>
      </>
    )
  }

  if (!engagementId) return <Empty icon={ServerCrash} title="No engagement selected" />

  return (
    <>
      {!embedded && <PageHeader
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
      />}

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
      {autoTransitioned && selectedKind === 'execution' && (
        <Banner tone="ok" title="Planning handoff is confirmed — execution thread ready" action={<Button size="sm" variant="ghost" onClick={() => setAutoTransitioned(false)}>Dismiss</Button>}>
          All required plan documents are ready, so the execution thread was created and selected. Review it, then press Send to start execution — nothing is dispatched automatically.
        </Banner>
      )}

      <div className="mt-4 flex min-h-0 min-w-0 gap-3">
        <div className="flex min-h-[32rem] min-w-0 flex-1 flex-col xl:h-[calc(100dvh-12rem)]">
          {observationKey ? <ObservedInvocation branch={observedBranch} onRoot={() => selectObservation(null)} /> : <>
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

          <ConversationHeader
            threads={allThreads}
            selectedId={selectedThreadId}
            runLabel={activeRunId ? `Run ${activeRunId.slice(0, 12)}… · ${runStatus ?? 'pending'} · ${stream.connected ? 'streaming' : 'reconnecting'}` : null}
            creating={createThreadByKind.isPending}
            executionLocked={detail.data?.handoffConfirmedAt == null || !!unconfirmed}
            embedded={embedded}
            agentsOpen={agentsOpen}
            onSelect={(id) => setSelectedThreadId(id)}
            onCreate={(kind) => { setDispatchError(null); setKindFilter(kind); createThreadByKind.mutate(kind) }}
            onHistory={() => setHistorySheet(true)}
            onRename={(threadId, title) => rename.mutate({ threadId, title })}
            renaming={rename.isPending}
            onToggleAgents={() => (wide ? setAgentsOpen(!agentsOpen) : setAgentsSheet(true))}
          />
          <div ref={chatScroll} onScroll={(e) => setAtBottom(e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 80)} className="relative min-h-0 flex-1 overflow-y-auto py-4 pr-1">
            <div className="space-y-6">
              {!selectedThreadId ? (
                <Empty icon={MessagesSquare} title="No thread selected">Create a thread to start the conversation.</Empty>
              ) : snapshot.isPending ? (
                <div className="space-y-3" aria-busy="true" role="status"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
              ) : snapshot.isError ? (
                <div role="alert" className="text-sm text-bad">{snapshot.error instanceof Error ? snapshot.error.message : 'The thread snapshot failed to load.'}</div>
              ) : (
                <Transcript messages={displayed} trace={trace} onReuse={(content) => setDraft(content)} />
              )}

          {selectedKind === 'execution' && (
            <ApprovalsCard
              state={approvals}
              busyId={decide.isPending ? decide.variables?.requestId ?? null : null}
              onDecide={(requestId, action) => decide.mutate({ requestId, action })}
            />
          )}

            </div>
            {!atBottom && (
              <div className="sticky bottom-2 flex justify-center">
                <Button size="sm" variant="secondary" icon={ArrowDown} onClick={() => { const el = chatScroll.current; if (el) { el.scrollTop = el.scrollHeight; setAtBottom(true) } }}>Scroll to bottom</Button>
              </div>
            )}
          </div>
          <Composer
            questions={pendingQuestions}
            onValue={(questionId, value) => setAnswers((prev) => ({ ...prev, [questionId]: value }))}
            onAnswer={(questionId, value) => answerQuestion.mutate([{ questionId, value }])}
            onAnswerAll={() => answerQuestion.mutate(pendingQuestions.map((q) => ({ questionId: q.questionId, value: answers[q.questionId] })))}
            answerBusy={answerQuestion.isPending || !!unconfirmed}
            batchReady={pendingQuestions.every((q) => { const value = answers[q.questionId]; return typeof value === 'string' ? value.trim().length > 0 : !!value?.length })}
            draft={draft}
            onDraft={setDraft}
            inputDisabled={!selectedThreadId || send.isPending || executionBlocked || !!unconfirmed || !!activeRunId}
            placeholder={selectedThreadId ? 'Describe what to do next - scope, constraints, instructions...' : 'Create a thread first...'}
            sendDisabled={!selectedThreadId || !draft.trim() || send.isPending || createThreadByKind.isPending || executionBlocked || !!unconfirmed || !!activeRunId}
            sending={send.isPending}
            onSend={() => { setDispatchError(null); send.mutate(draft.trim()) }}
            hint={executionBlocked ? 'Execution is blocked: it needs the confirmed planning handoff and a server-verified runtime context.' : 'Sending dispatches exactly one runtime run per request id. Refreshing never re-dispatches.'}
          />
          </>}
        </div>
        {wide && agentsOpen && <><Separator label="Resize agent sidebar" side="right" r={agentWidth} cfg={INSP} /><aside style={{ width: agentWidth.w }} className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-panel xl:h-[calc(100dvh-12rem)]" aria-label="Agent and activity sidebar"><AgentSidebar tab={sideTab} onTab={setSideTab} summary={{ state: runStatus === 'pending' || runStatus === 'running' ? 'Running' : pendingQuestions.length > 0 ? 'Waiting' : 'Idle', active: (fleet.data?.branches ?? []).filter((b) => b.state === 'running').length, task: trace.at(-1)?.label ?? null }} agents={agentPanel} activity={<ActivityList trace={trace} history={transcripts} />} artifacts={<ArtifactLinks engagementId={engagementId} />} /></aside></>}
      </div>
      {embedded && <><Drawer open={agentsSheet && !wide} onClose={() => setAgentsSheet(false)} title="Agents / Context" width={420}>{agentPanel}</Drawer><Drawer open={historySheet} onClose={() => setHistorySheet(false)} title="Execution history" width={980}><RealOperationsHistory engagementId={engagementId} /></Drawer></>}
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

/** Chat header: the conversation switcher sits here instead of a left column. */
function ConversationHeader({ threads, selectedId, runLabel, creating, executionLocked, embedded, agentsOpen, onSelect, onCreate, onHistory, onToggleAgents, onRename, renaming }: {
  threads: { threadId: string; kind: ThreadKind; assistantId: string; title?: string | null; createdAt?: string; updatedAt: string }[]
  selectedId: string | null
  runLabel: string | null
  creating: boolean
  executionLocked: boolean
  embedded: boolean
  agentsOpen: boolean
  onSelect: (threadId: string) => void
  onCreate: (kind: ThreadKind) => void
  onHistory?: () => void
  onToggleAgents: () => void
  onRename: (threadId: string, title: string) => void
  renaming: boolean
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [details, setDetails] = useState(false)
  const [copied, setCopied] = useState(false)
  const [query, setQuery] = useState('')
  const selected = threads.find((t) => t.threadId === selectedId) ?? null
  const needle = query.trim().toLowerCase()
  const shown = threads.filter((t) => !needle || `${t.threadId} ${t.assistantId} ${t.kind}`.toLowerCase().includes(needle))
  const copyId = (): void => {
    if (!selected) return
    void navigator.clipboard?.writeText(selected.threadId).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }).catch(() => undefined)
    setMenuOpen(false)
  }
  return (
    <div className="relative flex min-w-0 flex-wrap items-center gap-2 border-b border-line pb-3" onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setMenuOpen(false) } }}>
      <div className="relative min-w-0 flex-1">
        <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}
          className="flex max-w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left hover:bg-hover">
          <MessagesSquare size={16} className="shrink-0 text-muted" aria-hidden />
          {selected ? (
            <>
              <span className="truncate text-sm font-medium text-fg">{selected.title || selected.threadId.slice(0, 8)}</span>
              <KindBadge kind={selected.kind} />
              <span className="truncate text-xs text-muted">{selected.assistantId}</span>
            </>
          ) : <span className="text-sm text-muted">{threads.length === 0 ? 'No planning thread yet · create one to start' : 'No conversation selected'}</span>}
          <ChevronDown size={14} className="shrink-0 text-muted" aria-hidden />
        </button>
        {runLabel && <p role="status" className="px-2 text-xs text-muted">{runLabel}</p>}
        {open && (
          <div role="listbox" aria-label="Conversations" className="absolute left-0 top-full z-30 mt-1 w-[min(22rem,90vw)] rounded-xl border border-line bg-panel p-2 shadow-lg">
            <div className="relative mb-2">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
              <input aria-label="Search conversations" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations"
                className="h-9 w-full rounded-[10px] border border-line bg-subtle pl-7 pr-2 text-sm text-fg" />
            </div>
            <ul className="max-h-72 space-y-0.5 overflow-y-auto">
              {shown.length === 0 && <li className="px-2 py-2 text-xs text-muted">No conversation matches.</li>}
              {shown.map((t) => (
                <li key={t.threadId}>
                  <button type="button" role="option" aria-selected={t.threadId === selectedId}
                    onClick={() => { onSelect(t.threadId); setOpen(false) }}
                    className={cx('flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-left', t.threadId === selectedId ? 'bg-accent-soft' : 'hover:bg-hover')}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-fg">{t.title || t.threadId.slice(0, 8)} · {t.assistantId}</span>
                      <span className="block text-[11px] text-muted">{utcMinute(t.updatedAt)}</span>
                    </span>
                    <KindBadge kind={t.kind} />
                    {t.threadId === selectedId && <Check size={14} className="shrink-0 text-accent" aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2 border-t border-line pt-2">
              <Button size="sm" variant="secondary" icon={ListPlus} disabled={creating} onClick={() => { onCreate('planning'); setOpen(false) }}>New planning</Button>
              <Button size="sm" variant="secondary" icon={ListPlus} disabled={creating || executionLocked}
                title={executionLocked ? 'Confirm the planning handoff first - execution never bypasses it' : undefined}
                onClick={() => { onCreate('execution'); setOpen(false) }}>New execution</Button>
            </div>
          </div>
        )}
      </div>
      {selected && (
        <div className="relative shrink-0">
          <Button size="sm" variant="ghost" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Conversation actions" title="Conversation actions" onClick={() => setMenuOpen((v) => !v)}>
            <MoreHorizontal size={16} aria-hidden />
          </Button>
          {menuOpen && (
            <div role="menu" aria-label="Conversation actions" className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-line bg-panel p-1 shadow-lg">
              <button type="button" role="menuitem" onClick={copyId} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-hover">
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{copied ? 'Copied' : 'Copy conversation ID'}
              </button>
              <button type="button" role="menuitem" onClick={() => { setDetails((v) => !v); setMenuOpen(false) }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-hover">
                <CircleAlert size={14} aria-hidden />{details ? 'Hide details' : 'Show details'}
              </button>
              <button type="button" role="menuitem" onClick={() => { setRenameDraft(selected.title ?? ''); setMenuOpen(false) }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-hover">
                <Pencil size={14} aria-hidden />Rename
              </button>
            </div>
          )}
        </div>
      )}
      {embedded && onHistory && <Button size="sm" variant="ghost" onClick={onHistory}>History</Button>}
      <Button size="sm" variant="ghost" icon={agentsOpen ? PanelRightClose : PanelRightOpen} onClick={onToggleAgents}
        aria-pressed={agentsOpen} aria-label={agentsOpen ? 'Hide agent sidebar' : 'Show agent sidebar'} title={agentsOpen ? 'Hide agent sidebar' : 'Show agent sidebar'}>
        <span className="sr-only">{agentsOpen ? 'Hide agent sidebar' : 'Show agent sidebar'}</span>
      </Button>
      {selected && renameDraft !== null && (
        <form className="flex basis-full items-center gap-2" onSubmit={(e) => { e.preventDefault(); const next = renameDraft.trim(); if (!next || renaming) return; onRename(selected.threadId, next); setRenameDraft(null) }}>
          <input aria-label="Conversation name" autoFocus maxLength={80} value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setRenameDraft(null) }}
            className="h-9 min-w-0 flex-1 rounded-[10px] border border-line bg-subtle px-3 text-sm text-fg" placeholder="Name this conversation" />
          <Button size="sm" variant="primary" type="submit" disabled={renaming || renameDraft.trim().length === 0}>{renaming ? 'Saving...' : 'Save'}</Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setRenameDraft(null)}>Cancel</Button>
        </form>
      )}
      {selected && details && (
        <dl className="absolute right-0 top-full z-20 mt-1 grid w-80 grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl border border-line bg-panel p-3 text-xs shadow-lg">
          <dt className="text-muted">Kind</dt><dd>{selected.kind}</dd>
          <dt className="text-muted">Assistant</dt><dd className="font-mono">{selected.assistantId}</dd>
          <dt className="text-muted">Created</dt><dd>{selected.createdAt ? utcMinuteOr(selected.createdAt) : '—'}</dd>
          <dt className="text-muted">Updated</dt><dd>{utcMinuteOr(selected.updatedAt)}</dd>
          <dt className="text-muted">ID</dt><dd className="break-all font-mono">{selected.threadId}</dd>
        </dl>
      )}
    </div>
  )
}
function KindBadge({ kind }: { kind: ThreadKind }): ReactElement {
  return <span className={cx('shrink-0 rounded-full border px-1.5 text-[10px] uppercase', kind === 'planning' ? 'border-line text-muted' : 'border-warn/40 text-warn')}>{kind}</span>
}

/** Messages, then the current run's activity: consecutive tool lines fold into one collapsed group. */
function Transcript({ messages, trace, onReuse }: { messages: ScopedThreadMessage[]; trace: TraceLine[]; onReuse?: (content: string) => void }): ReactElement {
  if (messages.length === 0 && trace.length === 0) {
    return <p className="text-sm text-muted">No messages yet. Open with the engagement context, constraints and what you want planned.</p>
  }
  const groups = groupTrace(trace)
  const lastAssistant = messages.reduce((found, m, i) => (m.role === 'user' ? found : i), -1)
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? null
  return (
    <ol className="space-y-5">
      {messages.map((m, i) => <MessageRow key={m.messageId ?? `msg-${i}`} message={m}
        onReuse={i === lastAssistant && onReuse && lastUser ? () => onReuse(lastUser) : undefined} />)}
      {groups.map((g) => (g.kind === 'tools'
        ? <ToolActivityGroup key={g.lines[0]!.id} lines={g.lines} />
        : <SystemLine key={g.lines[0]!.id} line={g.lines[0]!} />))}
    </ol>
  )
}

function isToolLine(line: TraceLine): boolean {
  return line.label.startsWith('tool ') || line.label.startsWith('subagent tool')
}

function groupTrace(trace: TraceLine[]): { kind: 'tools' | 'system'; lines: TraceLine[] }[] {
  const groups: { kind: 'tools' | 'system'; lines: TraceLine[] }[] = []
  for (const line of trace) {
    const kind = isToolLine(line) ? 'tools' : 'system'
    const last = groups.at(-1)
    if (last && last.kind === kind && kind === 'tools') last.lines.push(line)
    else groups.push({ kind, lines: [line] })
  }
  return groups
}

function MessageRow({ message, onReuse }: { message: ScopedThreadMessage; onReuse?: () => void }): ReactElement {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard?.writeText(message.content).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }).catch(() => undefined)
  }
  const long = message.content.length > 1200
  return (
    <li className={cx('group flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-neutral">{isUser ? 'You' : 'Assistant'}</span>
      {!isUser && message.reasoning && <ThinkingBlock text={message.reasoning} />}
      {isUser
        ? <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl border border-line bg-subtle px-3.5 py-2 text-sm leading-relaxed text-fg">{message.content}</div>
        : <div className={cx('w-full min-w-0 text-sm leading-relaxed text-fg', long && 'max-h-96 overflow-y-auto')}>{renderMarkdown(message.content)}</div>}
      <div className="flex gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
        <Button size="sm" variant="ghost" icon={copied ? Check : Copy} onClick={copy} aria-label="Copy message">{copied ? 'Copied' : 'Copy'}</Button>
        {onReuse && <Button size="sm" variant="ghost" icon={RefreshCw} onClick={onReuse} title="Puts the last prompt back in the composer; nothing is sent until you press Send">Reuse prompt</Button>}
      </div>
    </li>
  )
}

/** Shows the server-projected reasoning summary only on request; it never outweighs the answer. */
function ThinkingBlock({ text }: { text: string }): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div className="w-full text-xs text-muted">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 hover:text-fg">
        {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
        {open ? 'Hide thinking' : 'Thinking...'}
      </button>
      {open && <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words border-l border-line pl-3 italic">{text}</p>}
    </div>
  )
}

function ToolActivityGroup({ lines }: { lines: TraceLine[] }): ReactElement {
  const [groupOpen, setGroupOpen] = useState(false)
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set())
  const failed = lines.filter((l) => l.error).length
  return (
    <li className="rounded-xl border border-line text-xs">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button type="button" aria-expanded={groupOpen} onClick={() => setGroupOpen((v) => !v)} className="flex min-w-0 items-center gap-2 text-left text-muted hover:text-fg">
          {groupOpen ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
          <Wrench size={12} aria-hidden />
          <span>{lines.length} tool call{lines.length === 1 ? '' : 's'}</span>
          {failed > 0 && <span className="text-bad">{failed} failed</span>}
        </button>
        {groupOpen && lines.length > 1 && (
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="ghost" onClick={() => setOpenIds(new Set(lines.map((l) => l.id)))}>Expand all</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpenIds(new Set())}>Collapse all</Button>
          </div>
        )}
      </div>
      {groupOpen && (
        <ul className="space-y-1 border-t border-line px-3 py-2">
          {lines.map((line) => {
            const isOpen = openIds.has(line.id)
            return (
              <li key={line.id}>
                <button type="button" aria-expanded={isOpen}
                  onClick={() => setOpenIds((prev) => { const next = new Set(prev); if (next.has(line.id)) next.delete(line.id); else next.add(line.id); return next })}
                  className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-hover">
                  {isOpen ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
                  <CircleAlert size={12} className={cx('shrink-0', line.error ? 'text-bad' : 'text-muted')} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-muted" title={line.label}>{line.label}</span>
                  {line.status && <span className="shrink-0 font-mono text-neutral">{line.status}</span>}
                </button>
                {isOpen && <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-subtle p-2 font-mono text-[11px] text-fg">{line.label}</pre>}
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

function SystemLine({ line }: { line: TraceLine }): ReactElement {
  return (
    <li className="flex items-center justify-center gap-2 text-xs text-muted">
      <CircleAlert size={12} className={cx('shrink-0', line.error ? 'text-bad' : 'text-neutral')} aria-hidden />
      <span className="min-w-0 truncate" title={line.label}>{line.label}</span>
      {line.status && <span className="shrink-0 font-mono text-neutral">{line.status}</span>}
    </li>
  )
}

function growTextarea(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

/** Bottom composer: normal input, or the pending question(s) in place of the input. */
function Composer({ questions, onValue, onAnswer, onAnswerAll, answerBusy, batchReady, draft, onDraft, inputDisabled, placeholder, sendDisabled, sending, onSend, hint }: {
  questions: PendingInterruptView[]
  onValue: (questionId: string, value: string | string[]) => void
  onAnswer: (questionId: string, value: string | string[]) => void
  onAnswerAll: () => void
  answerBusy: boolean
  batchReady: boolean
  draft: string
  onDraft: (value: string) => void
  inputDisabled: boolean
  placeholder: string
  sendDisabled: boolean
  sending: boolean
  onSend: () => void
  hint: string
}): ReactElement {
  if (questions.length > 0) {
    return (
      <div className="shrink-0 border-t border-line pt-3">
        <div className="space-y-3 rounded-2xl border border-warn/30 bg-panel p-3">
          <p className="text-xs font-semibold text-warn">The assistant is waiting for your answer. The answer resumes the same thread.</p>
          <div className="max-h-[40vh] space-y-4 overflow-y-auto pr-1">
            {questions.map((q) => (
              <QuestionCard key={`${q.questionId}/${q.interruptId ?? ''}`} question={q} busy={answerBusy}
                onValue={(value) => onValue(q.questionId, value)}
                onAnswer={questions.length === 1 ? (value) => onAnswer(q.questionId, value) : undefined} />
            ))}
          </div>
          {questions.length > 1 && (
            <div className="flex justify-end">
              <Button variant="primary" disabled={answerBusy || !batchReady} onClick={onAnswerAll}>{answerBusy ? 'Sending...' : 'Answer all questions'}</Button>
            </div>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="shrink-0 border-t border-line pt-3">
      <div className="rounded-2xl border border-line bg-panel p-2 focus-within:border-accent-line">
        <Textarea
          value={draft}
          rows={1}
          onChange={(e) => { onDraft(e.target.value); growTextarea(e.currentTarget) }}
          placeholder={placeholder}
          aria-label="Workspace message"
          disabled={inputDisabled}
          className="min-h-[44px] resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus:ring-0"
        />
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <p className="min-w-0 text-[11px] text-neutral">{hint}</p>
          <Button variant="primary" icon={Send} size="sm" disabled={sendDisabled} onClick={onSend}>{sending ? 'Sending...' : 'Send'}</Button>
        </div>
      </div>
    </div>
  )
}

type SideTab = 'agents' | 'activity' | 'artifacts'

function AgentSidebar({ tab, onTab, summary, agents, activity, artifacts }: {
  tab: SideTab
  onTab: (tab: SideTab) => void
  summary: { state: string; active: number; task: string | null }
  agents: ReactElement
  activity: ReactElement
  artifacts: ReactElement
}): ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-1 border-b border-line px-3 py-2.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-fg">{summary.state}</span>
          <span className="text-muted">{summary.active} active</span>
        </div>
        {summary.task && <p className="truncate text-muted" title={summary.task}>{summary.task}</p>}
      </div>
      <div className="px-3 pt-2.5">
        <Segmented value={tab} onChange={onTab} options={[{ id: 'agents', label: 'Agents' }, { id: 'activity', label: 'Activity' }, { id: 'artifacts', label: 'Artifacts' }]} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'agents' ? agents : tab === 'activity' ? activity : artifacts}
      </div>
    </div>
  )
}

function ActivityList({ trace, history }: { trace: TraceLine[]; history: { key?: string | null; payload: unknown }[] }): ReactElement {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set())
  const historyLines = history.map((t, i) => traceLineFor(t.key ?? `hist-${i}`, t.payload as TraceLikePayload)).filter((l): l is TraceLine => l !== null)
  const lines = [...trace, ...historyLines]
  if (lines.length === 0) return <p className="text-xs text-muted">No activity yet. Events appear here as the assistant works.</p>
  return (
    <ol className="space-y-1">
      {lines.map((line) => {
        const isOpen = openIds.has(line.id)
        return (
          <li key={line.id}>
            <button type="button" aria-expanded={isOpen} title="Show details"
              onClick={() => setOpenIds((prev) => { const next = new Set(prev); if (next.has(line.id)) next.delete(line.id); else next.add(line.id); return next })}
              className="flex w-full items-start gap-2 rounded-lg px-1 py-1 text-left text-xs hover:bg-hover">
              {isOpen ? <ChevronDown size={11} className="mt-0.5 shrink-0" aria-hidden /> : <ChevronRight size={11} className="mt-0.5 shrink-0" aria-hidden />}
              <CircleAlert size={12} className={cx('mt-0.5 shrink-0', line.error ? 'text-bad' : 'text-muted')} aria-hidden />
              <span className={cx('min-w-0 flex-1', isOpen ? 'whitespace-pre-wrap break-words text-fg' : 'truncate text-muted')}>{line.label}</span>
              {line.status && <span className="shrink-0 font-mono text-neutral">{line.status}</span>}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

const PLANNING_DOC_LABELS: Record<string, string> = {
  roe: 'Rules of engagement (RoE)',
  conops: 'CONOPS',
  deconfliction: 'Deconfliction plan',
  opplan: 'OPPLAN',
  'threat-profile': 'Threat profile',
  contact: 'Contact plan',
  'data-handling': 'Data handling',
  abort: 'Abort plan',
  cleanup: 'Cleanup plan',
}
const PLANNING_STATE_TONE: Record<string, string> = {
  ready: 'border-ok/40 text-ok',
  missing: 'border-line text-muted',
  invalid: 'border-bad/40 text-bad',
  unavailable: 'border-warn/40 text-warn',
}

/** Artifacts: real planning document states from the server, plus shortcuts to the surfaces that own each artifact. */
function ArtifactLinks({ engagementId }: { engagementId: string }): ReactElement {
  const planning = useQuery({ queryKey: ['real', 'planning', engagementId], queryFn: () => fetchPlanning(engagementId) })
  const docs = planning.data ? Object.entries(planning.data.bundle) : []
  const links: { label: string; tab: string }[] = [
    { label: 'Scope & RoE', tab: 'scope' },
    { label: 'Findings & evidence', tab: 'findings' },
    { label: 'Reports', tab: 'reports' },
  ]
  return (
    <div className="space-y-4">
      <section aria-label="Planning documents" className="space-y-2">
        <h3 className="text-xs font-semibold text-fg">Planning documents</h3>
        {planning.isPending ? <Skeleton className="h-16" /> : planning.isError ? (
          <p className="text-xs text-bad" role="alert">{planning.error instanceof Error ? planning.error.message : 'Planning documents could not be read.'}</p>
        ) : (
          <ul className="space-y-1.5">
            {docs.map(([name, state]) => (
              <li key={name} className="flex items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-2 text-xs">
                <span className="min-w-0 truncate text-fg">{PLANNING_DOC_LABELS[name] ?? name}</span>
                <span className={cx('shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase', PLANNING_STATE_TONE[state] ?? 'border-line text-muted')}>{state}</span>
              </li>
            ))}
          </ul>
        )}
        <Button size="sm" variant="secondary" onClick={() => go('project', { id: engagementId, tab: 'planning' })}>Open planning documents</Button>
      </section>
      <section aria-label="Project surfaces" className="space-y-1.5">
        <h3 className="text-xs font-semibold text-fg">Project surfaces</h3>
        <ul className="space-y-1.5">
          {links.map((item) => (
            <li key={item.tab}>
              <button type="button" onClick={() => go('project', { id: engagementId, tab: item.tab })}
                className="flex w-full items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-2 text-left text-sm hover:bg-hover">
                <span className="truncate text-fg">{item.label}</span>
                <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </section>
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
    <div className="space-y-2" role="group" aria-label={question.header || 'Pending question'}>
      <div className="flex items-start gap-2">
        <ShieldQuestion size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0">
          {question.header && <div className="text-xs font-semibold uppercase tracking-wider text-neutral">{question.header}</div>}
          <p className="text-sm text-fg">{question.question}</p>
          {question.instance && <p className="mt-1 text-xs text-muted">Asked by dispatch {question.instance.dispatchId.slice(0, 12)} · attempt {question.instance.attempt}. Answer with the others below.</p>}
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
