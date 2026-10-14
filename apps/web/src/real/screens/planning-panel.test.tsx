/** Real planning panel tests (ticket 04): documents, readiness, one-way handoff. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { cleanup, render, screen, waitFor } = await import('@testing-library/react')
const userEvent = (await import('@testing-library/user-event')).default
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { RealPlanningPanel } = await import('./planning-panel')

const ROE = { state: 'ready', content: { engagement_name: 'E', client: 'Acme', start_date: '2026-10-01', end_date: '2026-10-31', engagement_type: 'external', testing_window: '09:00-17:00', authorization_reference: 'AUTH-7', in_scope: [{ target: '10.0.0.0/24', type: 'cidr' }], out_of_scope: [], prohibited_actions: ['DoS'] } }
const CONOPS = { state: 'ready', content: { engagement_name: 'E', executive_summary: 'External assessment of the perimeter.', success_criteria: ['Access demonstrated'] } }
const DECON = { state: 'missing' }
const OPPLAN = { state: 'invalid' }
const VIEW = (over: Record<string, unknown> = {}) => ({
  version: 1, engagementId: 'eng-1',
  documents: { roe: ROE, conops: CONOPS, deconfliction: DECON, opplan: OPPLAN },
  bundle: { roe: 'ready', conops: 'ready', deconfliction: 'missing', opplan: 'invalid', 'threat-profile': 'missing', contact: 'missing', 'data-handling': 'missing', abort: 'missing', cleanup: 'missing' },
  readiness: { state: 'blocked', reasons: ['deconfliction: missing', 'opplan: invalid'], runtimeSignal: 'not_observed' },
  ...over,
})

function stubApi(view: unknown, patchStatus = 200) {
  const calls: { url: string; init?: RequestInit; body?: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
    if (url.endsWith('/plan-docs')) return new Response(JSON.stringify(view), { status: 200 })
    if (url === '/api/engagements/eng-1' && init?.method === 'PATCH') return new Response(JSON.stringify({ id: 'eng-1', workspaceSlug: 'w', displayName: 'D', targetType: 'web_url', targetValue: 't', authorizationConfirmed: true, brief: null, handoffConfirmedAt: '2026-10-14T10:00:00.000Z', metadataState: 'verified', lifecycleStatus: 'planning', findingCount: null, assetCount: null, activeAgentCount: null, createdAt: '2026-10-14T08:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z' }), { status: patchStatus })
    return new Response('unexpected', { status: 404 })
  }))
  return calls
}

function renderPanel(props: { engagementId: string; handoffConfirmedAt: string | null }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RealPlanningPanel {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => { window.localStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('RealPlanningPanel', () => {
  it('shows blocked readiness with the server reasons and honest document states', async () => {
    stubApi(VIEW())
    renderPanel({ engagementId: 'eng-1', handoffConfirmedAt: null })
    expect(await screen.findByText('Planning is blocked')).toBeTruthy()
    expect(screen.getByText('deconfliction: missing')).toBeTruthy()
    expect(screen.getByText('opplan: invalid')).toBeTruthy()
    expect((await screen.findByTestId('plan-doc-roe')).textContent).toContain('external')
    expect(screen.getByTestId('plan-doc-deconfliction').textContent).toContain('not been generated yet')
    expect(screen.getByTestId('plan-doc-opplan').textContent).toContain('failed validation')
    expect(screen.getByText('opplan: Invalid')).toBeTruthy()
  })

  it('confirms the planning handoff with the one-way PATCH', async () => {
    const calls = stubApi(VIEW({
      documents: { roe: ROE, conops: CONOPS, deconfliction: { state: 'ready', content: { engagement_name: 'E' } }, opplan: { state: 'missing' } },
      bundle: { roe: 'ready', conops: 'ready', deconfliction: 'ready', opplan: 'missing', 'threat-profile': 'ready', contact: 'ready', 'data-handling': 'ready', abort: 'ready', cleanup: 'ready' },
      readiness: { state: 'ready', reasons: [], runtimeSignal: 'not_observed' },
    }))
    renderPanel({ engagementId: 'eng-1', handoffConfirmedAt: null })
    const confirm = await screen.findByRole('button', { name: /Confirm planning handoff/ })
    await userEvent.setup().click(confirm)
    await waitFor(() => expect(calls.some((c) => c.url === '/api/engagements/eng-1' && c.init?.method === 'PATCH')).toBe(true))
    const patch = calls.find((c) => c.init?.method === 'PATCH')
    expect(patch?.body).toEqual({ handoffConfirmed: true })
  })

  it('shows a confirmed handoff without offering the button again', async () => {
    stubApi(VIEW())
    renderPanel({ engagementId: 'eng-1', handoffConfirmedAt: '2026-10-14T09:00:00.000Z' })
    await screen.findByText(/Confirmed at 2026-10-14 09:00/)
    expect(screen.queryByRole('button', { name: /Confirm planning handoff/ })).toBeNull()
  })

  it('surfaces a planning-load failure with retry and no mock fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))
    renderPanel({ engagementId: 'eng-1', handoffConfirmedAt: null })
    expect(await screen.findByText('Could not load planning documents')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
