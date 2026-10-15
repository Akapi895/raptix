/** Real operations panel tests (ticket 05): execution threads, run identities, truthful statuses. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { cleanup, render, screen } = await import('@testing-library/react')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { RealOperationsPanel } = await import('./operations-panel')

const EXEC = { engagementId: 'eng-1', threadId: 'th-exec', assistantId: 'executor', kind: 'execution', createdAt: '2026-10-14T09:00:00.000Z', updatedAt: '2026-10-14T09:05:00.000Z' }
const PLAN = { engagementId: 'eng-1', threadId: 'th-plan', assistantId: 'soundwave', kind: 'planning', createdAt: '2026-10-14T08:00:00.000Z', updatedAt: '2026-10-14T08:05:00.000Z' }
const RUN = { engagementId: 'eng-1', threadId: 'th-exec', runId: 'run-9', requestId: 'req-abc12345', rawStatus: 'running', createdAt: '2026-10-14T09:01:00.000Z', updatedAt: '2026-10-14T09:02:00.000Z', source: 'runtime' }

function stubApi(over: { threads?: unknown[]; runs?: unknown[] } = {}) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url.endsWith('/threads') && (init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ engagementId: 'eng-1', threads: over.threads ?? [PLAN, EXEC], source: 'runtime' }), { status: 200 })
    if (url.includes('/runs?') || (url.endsWith('/runs') && (init?.method ?? 'GET') === 'GET')) return new Response(JSON.stringify({ runs: over.runs ?? [RUN], offset: 0, nextOffset: null }), { status: 200 })
    return new Response('unexpected', { status: 404 })
  }))
  return calls
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RealOperationsPanel engagementId="eng-1" />
    </QueryClientProvider>,
  )
}

beforeEach(() => { window.localStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('RealOperationsPanel', () => {
  it('lists execution threads with their runs, request ids and raw statuses', async () => {
    stubApi()
    renderPanel()
    expect(await screen.findByText('th-exec')).toBeTruthy()
    expect(await screen.findByText('run-9')).toBeTruthy()
    expect(screen.getByText('req-abc12345')).toBeTruthy()
    expect(screen.getByText('running')).toBeTruthy()
    expect(screen.queryByText('th-plan')).toBeNull()
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
})

describe('RealOperationsPanel (W22 operation detail route)', () => {
  it('renders only the URL-selected thread as the operation detail', async () => {
    stubApi()
    window.location.hash = '#/operation/th-exec?engagement=eng-1'
    const { resetNavStores } = await import('../../router/navigate')
    resetNavStores()
    renderPanel()
    expect(await screen.findByText(/Operation thread th-exec/)).toBeTruthy()
    expect(await screen.findByText('run-9')).toBeTruthy()
    expect(screen.queryByText(/Execution threads/)).toBeNull()
    expect(screen.queryByText('th-plan')).toBeNull()
  })

  it('renders an explicit not-found for a foreign or unknown operation id', async () => {
    stubApi()
    window.location.hash = '#/operation/th-foreign?engagement=eng-1'
    const { resetNavStores } = await import('../../router/navigate')
    resetNavStores()
    renderPanel()
    expect(await screen.findByText('Operation thread not found')).toBeTruthy()
    expect(screen.getByText(/th-foreign/)).toBeTruthy()
    expect(screen.queryByText('th-exec')).toBeNull()
  })
})
