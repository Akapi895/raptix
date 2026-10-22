/**
 * Global surfaces show the cross-project counts the server actually rolls up,
 * and an explicit error instead of zeros when a rollup source fails.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { ApiTransportError } from '../../platform/transport'

// The first import loads the module graph; keep that cold start out of the test timer.
beforeAll(async () => {
  await import('./global-resource')
}, 30_000)

const fetchOverviewFindings = vi.fn()
const fetchOverviewC2 = vi.fn()

vi.mock('../../features/overview/remote', () => ({
  fetchOverviewFindings: (...a: unknown[]) => fetchOverviewFindings(...a),
  fetchOverviewC2: (...a: unknown[]) => fetchOverviewC2(...a),
}))
vi.mock('../../features/projects/query', () => ({
  useRealProjects: () => ({ list: { isPending: false, isError: false, data: [] } }),
}))

const FINDINGS = { total: 7, bySeverity: { high: 3, low: 4 }, byStatus: { draft: 5, confirmed: 2 }, engagementsWithFindings: 2, engagements: 3, truncated: false, source: 'db' }
const C2 = { commandsByStatus: { completed: 4 }, recentCommands: [], pendingGrants: 2, source: 'db' }

async function renderAt(hash: string): Promise<void> {
  window.location.hash = hash
  const { resetNavStores } = await import('../../router/navigate')
  resetNavStores()
  const { RealGlobalResource } = await import('./global-resource')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<RealGlobalResource />, { wrapper })
}

beforeEach(() => {
  fetchOverviewFindings.mockReset()
  fetchOverviewC2.mockReset()
})
afterEach(() => { cleanup() })

describe('RealGlobalResource rollups', () => {
  it('shows the cross-project finding counts from the overview rollup', async () => {
    fetchOverviewFindings.mockResolvedValue(FINDINGS)
    await renderAt('#/findings')
    expect(await screen.findByText('7')).toBeInTheDocument()
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    expect(screen.getByText('high 3 · low 4')).toBeInTheDocument()
  })

  it('reports a failed C2 rollup explicitly rather than showing zero counts', async () => {
    fetchOverviewC2.mockRejectedValue(new ApiTransportError(503, 'unavailable', 'C2 audit unavailable'))
    await renderAt('#/infrastructure')
    expect(await screen.findByText('C2 rollup unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Pending grants')).not.toBeInTheDocument()
  })

  it('shows pending grants and commands by status when the C2 rollup loads', async () => {
    fetchOverviewC2.mockResolvedValue(C2)
    await renderAt('#/infrastructure')
    expect(await screen.findByText('Pending grants')).toBeInTheDocument()
    expect(screen.getByText('completed 4')).toBeInTheDocument()
  })
})
