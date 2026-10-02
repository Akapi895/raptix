/**
 * W10 real Console session: one canonical per-thread run store wired to the
 * new API only. Loads the owner-scoped thread selector feed, merges owned
 * checkpoint history (W09) on select/reconnect, observes the acknowledged run
 * through the W08 GET-only stream, and submits root messages with server ACK
 * recovery. Question answering/HITL and pause/cancel controls are W11: they
 * are never faked here.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isRequestRecoveryView, isScopedRunView, isScopedThreadListView, isScopedThreadView,
  type RequestRecoveryView, type ScopedRunView, type StreamScope, type ThreadBindingView,
} from '@raptix/web-contracts'
import { apiBaseUrl } from '../../app/config'
import { ApiInvalidResponseError } from '../../shared/api/errors'
import { encodePathSegment, requestJson } from '../../shared/api/http'
import { emptyStreamState, mergeRunObservation, reduceStreamEvent, streamDisconnected, type StreamState } from './stream-reducer'
import { mergeThreadHistory } from './history-merge'
import { activeRunFromPage } from './console-view'
import { observeRunStream } from './observe-stream'

export type ConsoleStatus = 'loading' | 'ready' | 'error'

export interface ConsoleSession {
  status: ConsoleStatus
  error: string | null
  threads: readonly ThreadBindingView[]
  activeThreadId: string | null
  stream: StreamState | null
  run: ScopedRunView | null
  transport: 'connected' | 'disconnected'
  recoveryRequired: boolean
  submitting: boolean
  creating: boolean
  submitError: string | null
  createThread(kind: 'planning' | 'execution'): Promise<void>
  selectThread(threadId: string): void
  send(text: string): Promise<void>
  refresh(): void
}

const engagementPath = (engagementId: string): string => `/engagements/${encodePathSegment(engagementId)}`
const threadPath = (engagementId: string, threadId: string): string => `${engagementPath(engagementId)}/threads/${encodePathSegment(threadId)}`
const newRequestId = (): string => (crypto.randomUUID ? `ui-${crypto.randomUUID()}` : `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`)
const ackPollIntervalMs = 400
const ackPollAttempts = 40

async function waitForAcceptance(engagementId: string, requestId: string, signal: AbortSignal): Promise<RequestRecoveryView> {
  let last: RequestRecoveryView | null = null
  for (let attempt = 0; attempt < ackPollAttempts; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const view: unknown = await requestJson(apiBaseUrl, `${engagementPath(engagementId)}/requests/${encodePathSegment(requestId)}`, { signal })
    if (!isRequestRecoveryView(view) || view.engagementId !== engagementId || view.requestId !== requestId) throw new ApiInvalidResponseError('Recovery view did not match this request')
    last = view
    if (view.state === 'accepted' || view.state === 'rejected') return view
    await new Promise(resolve => setTimeout(resolve, ackPollIntervalMs))
  }
  return last ?? new Promise((_resolve, reject) => reject(new ApiInvalidResponseError('Request acknowledgement did not settle')))
}

export function useConsoleSession(engagementId: string): ConsoleSession {
  const [status, setStatus] = useState<ConsoleStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [threads, setThreads] = useState<readonly ThreadBindingView[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [stream, setStream] = useState<StreamState | null>(null)
  const [run, setRun] = useState<ScopedRunView | null>(null)
  const [transport, setTransport] = useState<'connected' | 'disconnected'>('disconnected')
  const [recoveryRequired, setRecoveryRequired] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [creating, setCreating] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  const observeController = useRef<AbortController | null>(null)
  const pollController = useRef<AbortController | null>(null)
  const streamRef = useRef<StreamState | null>(null)

  const stopObservation = useCallback(() => {
    observeController.current?.abort()
    observeController.current = null
    pollController.current?.abort()
    pollController.current = null
  }, [])

  const loadThreads = useCallback(async (signal: AbortSignal, select: 'none' | 'first'): Promise<readonly ThreadBindingView[]> => {
    const value: unknown = await requestJson(apiBaseUrl, `${engagementPath(engagementId)}/threads`, { signal, retries: 1 })
    if (!isScopedThreadListView(value) || value.engagementId !== engagementId) throw new ApiInvalidResponseError('Thread list did not match this engagement')
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    setThreads(value.threads)
    if (select === 'first' && value.threads.length > 0) setActiveThreadId(previous => previous ?? value.threads[0]!.threadId)
    return value.threads
  }, [engagementId])

  const observeRun = useCallback((threadId: string, runId: string): void => {
    const controller = new AbortController()
    observeController.current?.abort()
    observeController.current = controller
    const scope: StreamScope = { engagementId, threadId, runId }
    const apply = (update: (state: StreamState) => StreamState): void => {
      const next = update(streamRef.current ?? emptyStreamState(engagementId, threadId))
      if (next !== streamRef.current) { streamRef.current = next; setStream(next) }
    }
    void observeRunStream({
      scope, signal: controller.signal,
      onEvent: event => apply(state => reduceStreamEvent(state, event)),
      onRecovery: (observed, snapshot) => {
        setRun(observed)
        apply(state => mergeThreadHistory(mergeRunObservation(state, observed), snapshot))
      },
      onTransport: next => { setTransport(next); if (next === 'disconnected') apply(streamDisconnected) },
    }).then(result => {
      if (controller.signal.aborted) return
      setRecoveryRequired(result.recoveryRequired)
    }).catch(() => {
      if (controller.signal.aborted) return
      setTransport('disconnected')
      setRecoveryRequired(true)
    })
  }, [engagementId])

  const selectThread = useCallback((threadId: string): void => {
    if (threadId === activeThreadId) return
    stopObservation()
    streamRef.current = emptyStreamState(engagementId, threadId)
    setStream(streamRef.current)
    setRun(null)
    setRecoveryRequired(false)
    setSubmitError(null)
    setActiveThreadId(threadId)
  }, [activeThreadId, engagementId, stopObservation])

  // Snapshot + run resolution whenever the active thread changes.
  useEffect(() => {
    if (!activeThreadId) return
    const controller = new AbortController()
    let cancelled = false
    const hydrate = async (): Promise<void> => {
      const snapshot: unknown = await requestJson(apiBaseUrl, threadPath(engagementId, activeThreadId), { signal: controller.signal, retries: 1 })
      if (!isScopedThreadView(snapshot) || snapshot.binding.engagementId !== engagementId || snapshot.binding.threadId !== activeThreadId) throw new ApiInvalidResponseError('Thread snapshot did not match this engagement/thread')
      if (cancelled || controller.signal.aborted) return
      streamRef.current = mergeThreadHistory(emptyStreamState(engagementId, activeThreadId), snapshot)
      setStream(streamRef.current)
      const page: unknown = await requestJson(apiBaseUrl, `${threadPath(engagementId, activeThreadId)}/runs?limit=10`, { signal: controller.signal, retries: 1 })
      const list = (page as { runs?: unknown }).runs
      if (!Array.isArray(list) || !list.every(isScopedRunView)) throw new ApiInvalidResponseError('Run page was not a validated scoped run list')
      if (cancelled || controller.signal.aborted) return
      const candidate = activeRunFromPage(list)
      if (candidate) {
        setRun(candidate)
        setRecoveryRequired(true)
        streamRef.current = mergeRunObservation(streamRef.current, candidate)
        setStream(streamRef.current)
        observeRun(activeThreadId, candidate.runId)
      }
    }
    hydrate().catch(cause => {
      if (cancelled || controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : 'Console data unavailable')
    })
    return () => { cancelled = true; controller.abort() }
  }, [activeThreadId, engagementId, observeRun])

  // Initial thread list load.
  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    setError(null)
    loadThreads(controller.signal, 'first').then(
      () => { if (!controller.signal.aborted) setStatus('ready') },
      cause => { if (!controller.signal.aborted) { setStatus('error'); setError(cause instanceof Error ? cause.message : 'Thread list unavailable') } },
    )
    return () => { controller.abort(); stopObservation() }
  }, [engagementId, revision, loadThreads, stopObservation])

  const createThread = useCallback(async (kind: 'planning' | 'execution'): Promise<void> => {
    if (creating) return
    setCreating(true)
    setError(null)
    const controller = new AbortController()
    pollController.current?.abort()
    pollController.current = controller
    try {
      const requestId = newRequestId()
      const ack: unknown = await requestJson(apiBaseUrl, `${engagementPath(engagementId)}/threads`, { method: 'POST', body: { requestId, kind }, signal: controller.signal })
      if (!isRequestRecoveryView(ack) || ack.engagementId !== engagementId) throw new ApiInvalidResponseError('Thread acknowledgement did not match this engagement')
      const accepted = ack.state === 'accepted' ? ack : await waitForAcceptance(engagementId, requestId, controller.signal)
      if (accepted.state !== 'accepted' || !accepted.threadId) throw new ApiInvalidResponseError(`Thread creation ended as ${accepted.state}`)
      await loadThreads(controller.signal, 'none')
      if (controller.signal.aborted) return
      selectThread(accepted.threadId)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Thread creation failed')
    } finally {
      if (pollController.current === controller) pollController.current = null
      setCreating(false)
    }
  }, [creating, engagementId, loadThreads, selectThread])

  const send = useCallback(async (text: string): Promise<void> => {
    const threadId = activeThreadId
    if (!threadId || submitting) return
    const trimmed = text.trim()
    if (!trimmed) return
    setSubmitting(true)
    setSubmitError(null)
    const controller = new AbortController()
    pollController.current?.abort()
    pollController.current = controller
    try {
      const requestId = newRequestId()
      const ack: unknown = await requestJson(apiBaseUrl, `${engagementPath(engagementId)}/threads/${encodePathSegment(threadId)}/runs`, { method: 'POST', body: { requestId, message: trimmed }, signal: controller.signal })
      if (!isRequestRecoveryView(ack) || ack.engagementId !== engagementId || ack.threadId !== threadId) throw new ApiInvalidResponseError('Run acknowledgement did not match this thread')
      const accepted = ack.state === 'accepted' ? ack : await waitForAcceptance(engagementId, requestId, controller.signal)
      if (accepted.state !== 'accepted' || !accepted.runId) throw new ApiInvalidResponseError(`Run submission ended as ${accepted.state}`)
      setRecoveryRequired(true)
      observeRun(threadId, accepted.runId)
    } catch (cause) {
      if (!controller.signal.aborted) setSubmitError(cause instanceof Error ? cause.message : 'Run submission failed')
    } finally {
      if (pollController.current === controller) pollController.current = null
      setSubmitting(false)
    }
  }, [activeThreadId, engagementId, observeRun, submitting])

  const refresh = useCallback((): void => { setRevision(value => value + 1) }, [])

  useEffect(() => () => stopObservation(), [stopObservation])
  return { status, error, threads, activeThreadId, stream, run, transport, recoveryRequired, submitting, creating, submitError, createThread, selectThread, send, refresh }
}
