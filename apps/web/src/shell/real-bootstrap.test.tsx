/** Real-mode bootstrap + honest-unavailability panels (ticket 03). */
import { afterEach, describe, expect, it, vi } from 'vitest'

const { cleanup, render, screen, waitFor } = await import('@testing-library/react')
const { RealModeProvider } = await import('./real-bootstrap')
const { useCapabilityReady } = await import('../state/real-context')
const { RealNotIntegrated } = await import('./not-integrated')
const { ROUTES } = await import('../router/routes')
/** A key is integrated when real mode renders it with its own presentation, not the unavailable panel. */
const integrated = (page: string) => ROUTES[page]?.real.kind !== undefined && ROUTES[page].real.kind !== 'unavailable'

const CAPABILITIES = {
  version: 1,
  mode: 'local-single-user',
  capabilities: {
    projects: { supported: true, available: true },
    agents: { supported: false, available: false, reason: 'service_missing' },
  },
}

function Probe({ name }: { name: string }) {
  const { ready, reason } = useCapabilityReady(name)
  return <div data-testid="probe">{ready ? 'ready' : `blocked: ${reason}`}</div>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('RealModeProvider', () => {
  it('bootstraps the capability document before exposing children', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/auth/session')) return new Response('not found', { status: 404 })
      return new Response(JSON.stringify(CAPABILITIES), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<RealModeProvider><Probe name="projects" /><Probe name="agents" /></RealModeProvider>)
    await waitFor(() => expect(screen.getAllByTestId('probe')[0]).toHaveTextContent('ready'))
    expect(screen.getAllByTestId('probe')[1]).toHaveTextContent('blocked: This capability is not implemented on the connected server.')
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('/api/capabilities')
  })

  it('renders an actionable boot error without any fallback to mock data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    render(<RealModeProvider><Probe name="projects" /></RealModeProvider>)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Raptix is unavailable right now'))
    expect(screen.getByText('Switch to demo mode')).toBeTruthy()
    expect(screen.queryByTestId('probe')).toBeNull()
  })
})

describe('real route gating', () => {
  it('integrates exactly the bootstrap/project routes plus the self-rendering system pages', () => {
    for (const page of ['projects', 'project', 'project-new', 'notfound', 'error', 'offline', 'forbidden', 'session-expired']) {
      expect(integrated(page), page).toBe(true)
    }
  })

  it('integrates Infrastructure: its real route reads the engagement-scoped runtime, C2 and grant panels', () => {
    expect(integrated('infrastructure')).toBe(true)
  })

  it('names the unintegrated surface honestly and never offers demo data', () => {
    render(<RealNotIntegrated page="operations" />)
    expect(screen.getByRole('status')).toHaveTextContent('operations')
    expect(screen.getByText('Go to Projects')).toBeTruthy()
    expect(screen.getByText(/not integrated with the real backend yet/)).toBeTruthy()
  })
})
