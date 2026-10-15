/** Acceptance regressions found while re-verifying integration tickets 01-06. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { fetchFindings, listRunsOfThread } from './api'
import { apiFetch } from './transport'
import { useRunStream } from './stream'
import { RealModeProvider } from './bootstrap'
import { RealPlanningPanel } from './screens/planning-panel'
import { RealFindingsPanel } from './screens/findings-panel'
import { RealWorkspace } from './screens/workspace'
import { go } from '../router/navigate'
import { useRoute } from '../router/navigate'
import { setActiveRouter } from '../router/active'
import { createMemoryRouter } from 'react-router'
import { readPending } from './workspace-session'

const AT = '2026-10-14T09:00:00.000Z'
const BINDING = { engagementId: 'eng-1', threadId: 'thread-1', assistantId: 'soundwave', kind: 'planning', createdAt: AT, updatedAt: AT }
const QUESTION = { questionId: 'q-1', interruptId: 'int-1', question: 'Which scope?', header: 'Scope', options: [{ label: 'All', description: 'All authorized assets' }], multiSelect: false, allowOther: false, source: 'runtime' }
const BLOCKED_PLAN = {
  version: 1, engagementId: 'eng-1',
  documents: { roe: { state: 'missing' }, conops: { state: 'missing' }, deconfliction: { state: 'missing' }, opplan: { state: 'missing' } },
  bundle: { roe: 'missing', conops: 'missing', deconfliction: 'missing', opplan: 'missing', 'threat-profile': 'missing', contact: 'missing', 'data-handling': 'missing', abort: 'missing', cleanup: 'missing' },
  readiness: { state: 'blocked', reasons: ['roe:missing'], runtimeSignal: 'not_observed' },
}
const EVENT = {
  version: 1, eventId: 'event-1', engagementId: 'eng-1', threadId: 'thread-1', streamRunId: 'run-1', runId: 'run-1',
  source: 'runtime', namespace: [], occurredAt: null, observedAt: AT, identity: 'occurrence', upstreamCursor: 'cursor-1',
  payload: { type: 'message', messageId: 'message-1', role: 'assistant', content: 'token', mode: 'delta', truncated: false },
}

class StreamSource {
  static instances: StreamSource[] = []
  readonly url: string
  closed = false
  private listeners = new Map<string, EventListener[]>()
  constructor(url: string) { this.url = url; StreamSource.instances.push(this) }
  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  close(): void { this.closed = true }
  emit(payload: unknown): void {
    for (const listener of this.listeners.get('run-event') ?? []) listener(new MessageEvent('run-event', { data: JSON.stringify(payload) }))
  }
}

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
function panel(child: ReactElement): void {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{child}</QueryClientProvider>)
}

beforeEach(() => { window.localStorage.clear(); StreamSource.instances = []; vi.stubGlobal('EventSource', StreamSource) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('precommit boundary acceptance', () => {
  it('restores a route traversed before asynchronous bootstrap mounted its subscriber', () => {
    const router = createMemoryRouter([{ path: '*', element: <div /> }], { initialEntries: ['/project/late-engagement'] })
    setActiveRouter(router)
    try {
      const hook = renderHook(() => useRoute())
      expect(hook.result.current).toEqual({ page: 'project', id: 'late-engagement', tab: undefined })
      hook.unmount()
    } finally { setActiveRouter(null); router.dispose() }
  })

  it('rejects a run page containing null entries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ runs: [null], offset: 0, nextOffset: null })))
    await expect(listRunsOfThread('eng-1', 'thread-1')).rejects.toMatchObject({ code: 'internal_error' })
  })

  it('rejects a valid findings DTO belonging to a different engagement', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ engagementId: 'foreign', findings: [], truncated: false, source: 'workspace' })))
    await expect(fetchFindings('eng-1')).rejects.toMatchObject({ code: 'internal_error' })
  })

  it('preserves caller cancellation during response body consumption', async () => {
    const controller = new AbortController()
    const reply = response({ ok: true })
    vi.spyOn(reply, 'text').mockImplementation(async () => { controller.abort(); throw new DOMException('Aborted', 'AbortError') })
    vi.stubGlobal('fetch', vi.fn(async () => reply))
    const valid = (v: unknown): v is { ok: true } => typeof v === 'object' && v !== null && 'ok' in v && v.ok === true
    await expect(apiFetch('/x', valid, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('delivers a replayed event only once to delta consumers', async () => {
    const onEvent = vi.fn()
    renderHook(() => useRunStream({ engagementId: 'eng-1', threadId: 'thread-1', runId: 'run-1', onEvent }))
    await act(async () => { StreamSource.instances[0].emit(EVENT); StreamSource.instances[0].emit(EVENT) })
    expect(onEvent).toHaveBeenCalledTimes(1)
  })

  it('rejects an event with a valid shape but a foreign stream scope', async () => {
    const onEvent = vi.fn()
    renderHook(() => useRunStream({ engagementId: 'eng-1', threadId: 'thread-1', runId: 'run-1', onEvent }))
    await act(async () => StreamSource.instances[0].emit({ ...EVENT, engagementId: 'foreign' }))
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('ignores buffered callbacks from a closed stream after scope change', async () => {
    const onEvent = vi.fn()
    const hook = renderHook(({ thread }) => useRunStream({ engagementId: 'eng-1', threadId: thread, runId: 'run-1', onEvent }), { initialProps: { thread: 'thread-1' } })
    const old = StreamSource.instances[0]
    hook.rerender({ thread: 'thread-2' })
    expect(old.closed).toBe(true)
    await act(async () => old.emit(EVENT))
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('keeps planning handoff unavailable while required documents are missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(BLOCKED_PLAN)))
    panel(<RealPlanningPanel engagementId="eng-1" handoffConfirmedAt={null} />)
    const handoff = await screen.findByRole('button', { name: 'Confirm planning handoff' })
    expect(handoff).toBeDisabled()
  })

  it('warns about an incomplete projection when every finding source was skipped', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.endsWith('/findings')
      ? { engagementId: 'eng-1', findings: [], truncated: true, source: 'workspace' }
      : { engagementId: 'eng-1', folders: [], source: 'workspace' })))
    panel(<RealFindingsPanel engagementId="eng-1" />)
    await screen.findByText('No findings recorded')
    expect(screen.queryByText(/truncated/i)).not.toBeNull()
  })
})

function workspaceNetwork(questions: unknown[] = [], options: { lostAck?: boolean; running?: boolean; execution?: boolean; secondThread?: boolean; runReply?: () => Promise<Response> } = {}): { url: string; method: string; body: Record<string, unknown> | undefined }[] {
  const calls: { url: string; method: string; body: Record<string, unknown> | undefined }[] = []
  const binding = { ...BINDING, kind: options.execution ? 'execution' : 'planning' }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined
    calls.push({ url, method, body })
    if (url.endsWith('/capabilities')) return response({ version: 1, mode: 'local-single-user', capabilities: { projects: { supported: true, available: true }, agents: { supported: true, available: true } } })
    if (url.endsWith('/auth/session')) return new Response('not found', { status: 404 })
    if (url.endsWith('/engagements/eng-1')) return response({ id: 'eng-1', workspaceSlug: 'w', displayName: 'Test', targetType: 'web_url', targetValue: 'https://example.test', authorizationConfirmed: true, brief: null, handoffConfirmedAt: AT, metadataState: 'verified', lifecycleStatus: 'planning', findingCount: null, assetCount: null, activeAgentCount: null, createdAt: AT, updatedAt: AT })
    if (url.endsWith('/threads')) return response({ engagementId: 'eng-1', threads: options.secondThread ? [binding, { ...binding, threadId: 'thread-2' }] : [binding], source: 'runtime' })
    if (url.endsWith('/approvals')) return response({ engagementId: 'eng-1', approvals: [], source: 'workspace' })
    if (url.includes('/runtime-context')) return response({ engagementId: 'eng-1', workspaceSlug: 'w', assistantId: 'soundwave', kind: binding.kind, authorizationConfirmed: true, planningState: 'ready', executionReady: true, threadVerified: !options.execution, source: 'runtime' })
    if (method === 'POST') {
      if (options.runReply && url.endsWith('/runs')) return options.runReply()
      if (options.lostAck && url.endsWith('/runs')) throw new TypeError('Connection lost after the server accepted the run')
      return response({ engagementId: 'eng-1', requestId: url.endsWith('/reconcile') ? url.split('/').at(-2) : body?.requestId, operation: url.endsWith('/resume') ? 'resume' : 'create_run', state: 'accepted', threadId: 'thread-1', runId: 'run-1', createdAt: AT, updatedAt: AT })
    }
    if (url.endsWith('/runs/run-1')) return response({ engagementId: 'eng-1', threadId: 'thread-1', runId: 'run-1', requestId: 'req-12345678', rawStatus: 'success', createdAt: AT, updatedAt: AT, source: 'runtime' })
    if (url.endsWith('/threads/thread-1')) return response({ binding, rawStatus: options.running ? 'busy' : 'idle', messages: [{ role: 'assistant', content: 'Restored conversation' }], messagesTruncated: false, historyScope: 'root_messages_only', source: 'runtime', pendingQuestions: questions })
    if (url.endsWith('/threads/thread-2')) return response({ binding: { ...binding, threadId: 'thread-2' }, rawStatus: 'idle', messages: [{ role: 'assistant', content: 'Other conversation' }], messagesTruncated: false, historyScope: 'root_messages_only', source: 'runtime' })
    return response({ engagementId: 'eng-1', runs: [], offset: 0, nextOffset: null })
  }))
  go('ai-operator', { id: 'eng-1' })
  render(<RealModeProvider><RealWorkspace /></RealModeProvider>)
  return calls
}

describe('precommit execution acceptance', () => {
  it('reconciles a lost acknowledgement after remount without a second run POST', async () => {
    const calls = workspaceNetwork([], { lostAck: true })
    await screen.findByText('Restored conversation')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Workspace message'), 'Plan next step')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByRole('button', { name: 'Reconcile request' })
    const pending = readPending('eng-1')
    expect(pending?.requestId).toBeTruthy()
    cleanup()
    render(<RealModeProvider><RealWorkspace /></RealModeProvider>)
    await user.click(await screen.findByRole('button', { name: 'Reconcile request' }))
    await waitFor(() => expect(calls.some(c => c.url.endsWith(`/requests/${pending!.requestId}/reconcile`))).toBe(true))
    await waitFor(() => expect(readPending('eng-1')).toBeNull())
    expect(calls.filter(c => c.method === 'POST' && c.url.endsWith('/runs'))).toHaveLength(1)
  })

  it('does not install a late run acknowledgement into another selected thread', async () => {
    let settle: (reply: Response) => void = () => { throw new Error('POST has not started') }
    const calls = workspaceNetwork([], { secondThread: true, runReply: () => new Promise(resolve => { settle = resolve }) })
    await screen.findByText('Restored conversation')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Workspace message'), 'Plan next step')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true))
    await user.click(screen.getByRole('button', { name: /thread-2/ }))
    await screen.findByText('Other conversation')
    const requestId = calls.find(c => c.method === 'POST')!.body!.requestId
    await act(async () => settle(response({ engagementId: 'eng-1', requestId, operation: 'create_run', state: 'accepted', threadId: 'thread-1', runId: 'run-1', createdAt: AT, updatedAt: AT })))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reconcile request' })).toBeNull())
    expect(screen.queryByRole('button', { name: 'Cancel run' })).toBeNull()
    expect(StreamSource.instances.some(s => s.url.includes('/thread-2/runs/run-1/'))).toBe(false)
  })

  it('offers recovery under the same request id after a lost POST acknowledgement', async () => {
    const calls = workspaceNetwork([], { lostAck: true })
    await screen.findByText('Restored conversation')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Workspace message'), 'Plan next step')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    await screen.findByRole('button', { name: 'Reconcile request' })
  })

  it('queries owned runs on remount to restore a busy conversation without redispatch', async () => {
    const calls = workspaceNetwork([], { running: true })
    await screen.findByText('Restored conversation')
    await waitFor(() => expect(calls.some((c) => c.method === 'GET' && c.url.includes('/runs'))).toBe(true))
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('keeps execution disabled when the selected thread has not been verified', async () => {
    workspaceNetwork([], { execution: true })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'execution' }))
    await screen.findByText('Restored conversation')
    await screen.findByText('Server-verified runtime context')
    expect(screen.getByLabelText('Workspace message')).toBeDisabled()
  })

  it('finalizes a run when the authoritative runtime status is success', async () => {
    const calls = workspaceNetwork()
    await screen.findByText('Restored conversation')
    const composer = screen.getByLabelText('Workspace message')
    const user = userEvent.setup()
    await user.type(composer, 'Plan next step')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/runs/run-1'))).toBe(true))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel run' })).toBeNull())
  })

  it('answers every parallel interrupt in a single resume request', async () => {
    const calls = workspaceNetwork([QUESTION, { ...QUESTION, questionId: 'q-2', interruptId: 'int-2', question: 'Which timing?' }])
    await screen.findByText('Which timing?')
    const user = userEvent.setup()
    for (const option of screen.getAllByRole('radio')) await user.click(option)
    const buttons = screen.getAllByRole('button', { name: /Answer/ })
    await user.click(buttons[buttons.length - 1])
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/resume'))).toBe(true))
    expect(calls.find((c) => c.url.endsWith('/resume'))?.body?.answers).toEqual([
      { questionId: 'q-1', value: 'All' }, { questionId: 'q-2', value: 'All' },
    ])
  })
})
