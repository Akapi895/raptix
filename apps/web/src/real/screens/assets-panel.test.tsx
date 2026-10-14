/** Real assets/graph tests (ticket 06): observed projections, honest graph-off behavior. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { cleanup, render, screen } = await import('@testing-library/react')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { RealAssets } = await import('./assets-panel')
const { go } = await import('../../router/navigate')

const ASSET = {
  id: 'a-1', type: 'Host', label: 'web-01', hostname: 'web-01.corp', ip: '10.0.0.5',
  ports: ['22', '443'], services: ['ssh', 'https'], relatedFindingIds: ['FIND-001'], source: 'graph',
}

function stubApi(over: { assets?: unknown[]; graphStatus?: number } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/assets')) return new Response(JSON.stringify({ engagementId: 'eng-1', assets: over.assets ?? [ASSET], truncated: false, source: 'graph' }), { status: 200 })
    if (url.endsWith('/graph')) {
      if (over.graphStatus) return new Response(JSON.stringify({ statusCode: over.graphStatus, error: { code: 'not_found', message: 'Route not found' } }), { status: over.graphStatus })
      return new Response(JSON.stringify({
        engagementId: 'eng-1', truncated: false, source: 'graph',
        nodes: [{ id: 'a-1', labels: ['Host'], properties: { label: 'web-01' } }],
        edges: [{ id: 'e-1', source: 'a-1', target: 'FIND-001', type: 'EVIDENCED_BY', properties: {} }],
      }), { status: 200 })
    }
    return new Response('unexpected', { status: 404 })
  }))
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RealAssets />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  go('assets', { id: 'eng-1' })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('RealAssets', () => {
  it('renders observed assets with services, ports and related findings', async () => {
    stubApi()
    renderPanel()
    expect(await screen.findByText('web-01')).toBeTruthy()
    expect(screen.getByText('web-01.corp')).toBeTruthy()
    expect(screen.getByText('10.0.0.5')).toBeTruthy()
    expect(screen.getByText('22, 443')).toBeTruthy()
    expect(screen.getByText('FIND-001')).toBeTruthy()
  })

  it('summarizes the observed graph verbatim', async () => {
    stubApi()
    renderPanel()
    expect(await screen.findByText(/1 nodes, 1 edges observed/)).toBeTruthy()
    expect(screen.getByText('(a-1) -[EVIDENCED_BY]-> (FIND-001)')).toBeTruthy()
  })

  it('renders an honest unavailable state when the graph source is off', async () => {
    stubApi({ graphStatus: 404 })
    renderPanel()
    expect(await screen.findByText('Graph source unavailable')).toBeTruthy()
    expect(screen.getByText(/No substitute graph is shown/)).toBeTruthy()
  })

  it('renders the honest empty state when no assets were discovered', async () => {
    stubApi({ assets: [] })
    renderPanel()
    expect(await screen.findByText('No assets discovered')).toBeTruthy()
  })
})
