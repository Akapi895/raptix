/** Operations tab over the runtime (real mode): the operation list, the operation detail tabs, truthful statuses, cancel, stops, timeline. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

vi.mock('../../state/mode', () => ({ DATA_MODE: 'real', isRealMode: () => true, resolveDataMode: () => 'real' }))
vi.mock('../../state/keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../state/keys')>()),
  useQueryScope: () => ({ actor: 'u-owner', role: 'manager', project: 'eng-1' }),
}))

const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { RealFeatureServicesCtx } = await import('../../state/real-services-provider')
const { createRealFeatureServices } = await import('../../state/real-services')
const { RuntimeOperationsTab } = await import('./runtime-tab')

const CAPABILITIES = { version: 1, mode: 'multi-user', capabilities: { runs: { supported: true, available: true }, projects: { supported: true, available: true } } } as never

const EXEC = { engagementId: 'eng-1', threadId: 'th-exec', assistantId: 'executor', kind: 'execution', createdAt: '2026-10-14T09:00:00.000Z', updatedAt: '2026-10-14T09:05:00.000Z' }
const OP_RUNNING = { engagementId: 'eng-1', threadId: 'th-exec', state: 'running', latestRunId: 'run-9', latestRunStatus: 'running', source: 'runtime' }
const OP_PAUSED = { ...OP_RUNNING, state: 'paused', latestRunStatus: 'interrupted' }
const OP_FINISHED = { ...OP_RUNNING, state: 'running', latestRunStatus: 'success' }
const BODIES: string[] = []
const PLAN = { engagementId: 'eng-1', threadId: 'th-plan', assistantId: 'soundwave', kind: 'planning', createdAt: '2026-10-14T08:00:00.000Z', updatedAt: '2026-10-14T08:05:00.000Z' }
const RUN = { engagementId: 'eng-1', threadId: 'th-exec', runId: 'run-9', requestId: 'req-abc12345', rawStatus: 'running', createdAt: '2026-10-14T09:01:00.000Z', updatedAt: '2026-10-14T09:02:00.000Z', source: 'runtime' }

function stubApi(over: { threads?: unknown[]; runs?: unknown[]; stops?: unknown[]; timeline?: unknown; operation?: unknown } = {}) {
  BODIES.length = 0
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (init?.body) BODIES.push(String(init.body))
    if (url.endsWith('/threads') && (init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ engagementId: 'eng-1', threads: over.threads ?? [PLAN, EXEC], source: 'runtime' }), { status: 200 })
    if (url.includes('/runs?') || (url.endsWith('/runs') && (init?.method ?? 'GET') === 'GET')) return new Response(JSON.stringify({ runs: over.runs ?? [RUN], offset: 0, nextOffset: null }), { status: 200 })
    if (url.endsWith('/estops') && (init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ engagementId: 'eng-1', stops: over.stops ?? [], source: 'db' }), { status: 200 })
    if (url.endsWith('/operation')) return new Response(JSON.stringify(over.operation ?? OP_RUNNING), { status: 200 })
    if (url.endsWith('/resume-run') || url.endsWith('/complete') || url.endsWith('/pause')) return new Response(JSON.stringify(OP_RUNNING), { status: 202 })
    if (url.endsWith('/cancel') && init?.method === 'POST') return new Response(JSON.stringify({ ...RUN, rawStatus: 'cancelled' }), { status: 200 })
    if (url.includes('/timeline')) return new Response(JSON.stringify(over.timeline ?? { engagementId: 'eng-1', entries: [], truncated: false, hasMore: false, untimedCheckpoints: 0, unavailableThreads: 0, source: 'mixed' }), { status: 200 })
    if (url.endsWith('/threads/th-exec')) return new Response(JSON.stringify({ binding: EXEC, rawStatus: 'running', messages: [], messagesTruncated: false, historyScope: 'root_messages_only', source: 'runtime', transcriptsTruncated: false, transcripts: [{ key: 'tool-1', runId: null, source: 'checkpoint', truncated: false, payload: { type: 'subagent_tool_call', agent: 'recon', tool: 'service-mapper', truncated: false } }] }))
    return new Response('unexpected', { status: 404 })
  }))
  return calls
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const services = createRealFeatureServices(CAPABILITIES)
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <RealFeatureServicesCtx.Provider value={services}>{children}</RealFeatureServicesCtx.Provider>
    </QueryClientProvider>
  )
  return render(<RuntimeOperationsTab engagementId="eng-1" />, { wrapper })
}

/** Opens the operation detail for a thread by its URL, the way the list's Open action does. */
async function openDetail(threadId = 'th-exec'): Promise<void> {
  window.location.hash = `#/operation/${threadId}?engagement=eng-1`
  const { resetNavStores } = await import('../../router/navigate')
  resetNavStores()
}

async function openTab(name: string): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name }))
}

beforeEach(() => { window.localStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('RuntimeOperationsTab', () => {
  it('lists each execution thread as an operation row with its latest run and status', async () => {
    stubApi()
    renderPanel()
    expect(await screen.findByText('th-exec')).toBeTruthy()
    expect(await screen.findByText('run-9')).toBeTruthy()
    expect(screen.getAllByText('running').length).toBeGreaterThan(0)
    expect(screen.queryByText('th-plan')).toBeNull()
    expect(screen.queryByText('req-abc12345')).toBeNull()
  })

  it('renders an honest empty state without execution threads', async () => {
    stubApi({ threads: [PLAN] })
    renderPanel()
    expect(await screen.findByText(/No execution thread yet/)).toBeTruthy()
  })

  it('links to the AI workspace for execution', async () => {
    stubApi()
    renderPanel()
    expect(await screen.findByRole('button', { name: 'Open AI workspace' })).toBeTruthy()
  })

  it('shows persisted tool calls as checkpoint history without claiming run attribution', async () => {
    await openDetail()
    const calls = stubApi()
    renderPanel()
    await openTab('Trace')
    fireEvent.click(await screen.findByRole('button', { name: /subagent_tool_call · checkpoint/ }))
    const dialog = await screen.findByRole('dialog', { name: /Tool Event Inspector/ })
    expect(dialog.tagName).toBe('DIV')
    expect(within(dialog).getByText(/"tool": "service-mapper"/)).toBeTruthy()
    expect(screen.getByText(/events without run attribution/)).toBeTruthy()
    expect(screen.queryByLabelText('Workspace message')).toBeNull()
    expect(calls.every((call) => call.startsWith('GET '))).toBe(true)
  })

  it('W24: maps raw runtime statuses truthfully (success is ok, error is failed)', async () => {
    await openDetail()
    stubApi({ runs: [{ ...RUN, runId: 'run-ok', rawStatus: 'success' }, { ...RUN, runId: 'run-err', rawStatus: 'error' }] })
    renderPanel()
    await openTab('Live')
    const okLabel = await screen.findByText('success')
    const errLabel = await screen.findByText('error')
    expect(okLabel.className).toContain('text-ok')
    expect(errLabel.className).toContain('text-bad')
  })
})

describe('RuntimeOperationsTab (W22 operation detail route)', () => {
  it('renders only the URL-selected thread as the operation detail', async () => {
    await openDetail()
    stubApi()
    renderPanel()
    expect(await screen.findByText('Operation th-exec')).toBeTruthy()
    expect(await screen.findByText(/run-9/)).toBeTruthy()
    expect(screen.queryByText(/Execution threads/)).toBeNull()
    expect(screen.queryByText('th-plan')).toBeNull()
  })

  it('renders an explicit not-found for a foreign or unknown operation id', async () => {
    await openDetail('th-foreign')
    stubApi()
    renderPanel()
    expect(await screen.findByText('Operation thread not found')).toBeTruthy()
    expect(screen.getByText(/th-foreign/)).toBeTruthy()
    expect(screen.queryByText('th-exec')).toBeNull()
  })

  it('offers Cancel only for runs still in flight, and cancels through the run endpoint', async () => {
    await openDetail()
    const calls = stubApi({ runs: [RUN, { ...RUN, runId: 'run-done', rawStatus: 'success' }] })
    renderPanel()
    await openTab('Live')
    const cancelButtons = await screen.findAllByRole('button', { name: 'Cancel run' })
    expect(cancelButtons).toHaveLength(1)
    fireEvent.click(cancelButtons[0]!)
    await vi.waitFor(() => expect(calls).toContain('POST /api/engagements/eng-1/threads/th-exec/runs/run-9/cancel'))
  })

  it('shows a blocking emergency stop with its way to resolution, and nothing when no stop is active', async () => {
    window.location.hash = '#/operations?engagement=eng-1'
    const { resetNavStores } = await import('../../router/navigate')
    resetNavStores()
    stubApi({ stops: [{ id: 'stop-1', engagementId: 'eng-1', scope: 'project', targetId: null, requestedBy: 'u-owner', outcome: 'stopped', reason: 'halt', concurrencyVersion: 1, createdAt: '2026-10-14T09:00:00.000Z', updatedAt: '2026-10-14T09:00:00.000Z' }] })
    renderPanel()
    expect(await screen.findByText('1 emergency stop still blocks work')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Governance' })).toBeInTheDocument()
    cleanup()
    stubApi({ stops: [{ id: 'stop-2', engagementId: 'eng-1', scope: 'project', targetId: null, requestedBy: 'u-owner', outcome: 'resolved', reason: 'ok', concurrencyVersion: 2, createdAt: '2026-10-14T09:00:00.000Z', updatedAt: '2026-10-14T09:10:00.000Z' }] })
    renderPanel()
    await screen.findByText('Operations')
    expect(screen.queryByText(/emergency stop/)).not.toBeInTheDocument()
  })

  it('says how many checkpoint events have no recorded time, instead of placing them on the timeline', async () => {
    stubApi({ timeline: { engagementId: 'eng-1', entries: [{ id: 'run:run-9', at: '2026-10-14T09:01:00.000Z', source: 'runtime', kind: 'run', label: 'Run success', runId: 'run-9', status: 'success', agent: 'executor' }], truncated: false, hasMore: false, untimedCheckpoints: 2, unavailableThreads: 0, source: 'mixed' } })
    renderPanel()
    expect(await screen.findByText(/2 checkpoint events have no recorded time/)).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Time (UTC)' })).toBeInTheDocument()
    expect(screen.getByText('Run success')).toBeInTheDocument()
  })

  it('loads the timeline one page at a time, and asks for a longer page on Load more', async () => {
    const calls = stubApi({ timeline: { engagementId: 'eng-1', entries: [{ id: 'run:run-9', at: '2026-10-14T09:01:00.000Z', source: 'runtime', kind: 'run', label: 'Planning run success', runId: 'run-9', status: 'success' }], truncated: false, hasMore: true, untimedCheckpoints: 0, unavailableThreads: 0, source: 'mixed' } })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    await vi.waitFor(() => expect(calls.some((call) => call.endsWith('/timeline?limit=100'))).toBe(true))
  })

  it('names the threads a stale binding left out of the timeline instead of blanking it', async () => {
    stubApi({ timeline: { engagementId: 'eng-1', entries: [{ id: 'run:run-9', at: '2026-10-14T09:01:00.000Z', source: 'runtime', kind: 'run', label: 'Planning run success', runId: 'run-9', status: 'success' }], truncated: false, hasMore: false, untimedCheckpoints: 0, unavailableThreads: 1, source: 'mixed' } })
    renderPanel()
    expect(await screen.findByText('Some runtime threads are not shown')).toBeInTheDocument()
    expect(screen.getByText('1 thread has a runtime binding that no longer matches persisted state, so its runs and checkpoints are left out.')).toBeInTheDocument()
    expect(screen.queryByText('Timeline source unavailable')).not.toBeInTheDocument()
    expect(screen.getByText('Planning run success')).toBeInTheDocument()
  })
})

describe('RuntimeOperationsTab (P11 lifecycle)', () => {
  it('resumes a paused operation, and a retry after a lost answer reuses the same request id', async () => {
    await openDetail()
    stubApi({ operation: OP_PAUSED })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /Resume operation/ }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Resume operation/ }))
    await waitFor(() => expect(BODIES.filter((b) => b.includes('requestId')).length).toBe(2))
    const ids = BODIES.filter((b) => b.includes('requestId')).map((b) => (JSON.parse(b) as { requestId: string }).requestId)
    expect(ids[1]).toBe(ids[0])
  })

  it('offers complete only after the operation last run reached a terminal status', async () => {
    await openDetail()
    stubApi({ operation: OP_RUNNING })
    renderPanel()
    await screen.findByText('running')
    expect(screen.queryByRole('button', { name: 'Mark operation complete' })).toBeNull()
    cleanup()
    stubApi({ operation: OP_FINISHED })
    renderPanel()
    expect(await screen.findByRole('button', { name: 'Mark operation complete' })).toBeTruthy()
  })

  it('offers Pause only for a running run of an operation that is bound or running', async () => {
    await openDetail()
    stubApi({ operation: OP_RUNNING })
    renderPanel()
    await openTab('Live')
    expect(await screen.findByRole('button', { name: 'Pause run' })).toBeTruthy()
    cleanup()
    await openDetail()
    stubApi({ operation: OP_PAUSED })
    renderPanel()
    await screen.findByRole('button', { name: /Resume operation/ })
    await openTab('Live')
    expect(screen.queryByRole('button', { name: 'Pause run' })).toBeNull()
  })
})
