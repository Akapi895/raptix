/**
 * The fleet tab (real mode) through the runtime adapter: the fleet detail routes
 * consume the resource id from the URL. The assistant graph catalog id and the
 * checkpoint branch key each render their own detail; unknown or foreign ids render
 * an explicit not-found, never the fleet list. An ended branch with a failed outcome
 * is never rendered as passed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

vi.mock('../../state/mode', () => ({ DATA_MODE: 'real', isRealMode: () => true, resolveDataMode: () => 'real' }))
vi.mock('../../state/keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../state/keys')>()),
  useQueryScope: () => ({ actor: 'u-owner', role: 'manager', project: 'eng-1' }),
}))

vi.mock('../../real/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../real/api')>()
  return {
    ...actual,
    fetchFleet: vi.fn(),
    cancelRun: vi.fn(),
  }
})

const api = await import('../../real/api')
const { RealFeatureServicesCtx } = await import('../../real/service-adapter/provider')
const { createRealFeatureServices } = await import('../../real/service-adapter/index')
const { resetNavStores } = await import('../../router/navigate')
const { RuntimeFleetTab } = await import('./fleet-tab')

const CAPABILITIES = { version: 1, mode: 'multi-user', capabilities: { runs: { supported: true, available: true } } } as never

function fleet() {
  return {
    engagementId: 'eng-1',
    agents: [{ graphId: 'raptix', source: 'catalog' }, { graphId: 'soundwave', source: 'catalog' }],
    threads: [],
    branches: [
      { threadId: 'th-1', key: 'br-recon-1', agent: 'recon', state: 'ended', outcome: 'PASSED', startedAt: '2026-10-14T09:00:00.000Z', endedAt: '2026-10-14T09:04:00.000Z', provenance: 'checkpoint' },
      { threadId: 'th-1', key: 'br-exploit-2', agent: 'exploit', state: 'running', outcome: null, startedAt: '2026-10-14T09:10:00.000Z', endedAt: null, provenance: 'checkpoint' },
      { threadId: 'th-1', key: 'br-failed-3', agent: 'exploit', state: 'ended', outcome: 'failed', startedAt: '2026-10-14T09:20:00.000Z', endedAt: '2026-10-14T09:21:00.000Z', provenance: 'checkpoint' },
    ],
    counts: { threads: 0, threadsTruncated: false, activeRuns: 0, branches: 2, runningBranches: 1 },
    excludedActions: ['branch retry', 'agent allocation'],
    sources: { agents: 'catalog', threads: 'runtime', branches: 'checkpoint' },
    source: 'runtime',
  }
}

function renderDetail(hash: string): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const services = createRealFeatureServices(CAPABILITIES)
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <RealFeatureServicesCtx.Provider value={services}>{children}</RealFeatureServicesCtx.Provider>
    </QueryClientProvider>
  )
  window.location.hash = hash
  resetNavStores()
  render(<RuntimeFleetTab engagementId="eng-1" />, { wrapper })
}

beforeEach(() => {
  vi.mocked(api.fetchFleet).mockReset().mockResolvedValue(fleet() as never)
  vi.mocked(api.cancelRun).mockReset()
})

afterEach(() => {
  cleanup()
})

describe('RuntimeFleetTab detail routes (W22)', () => {
  it('renders a catalog agent by its graph id without the fleet list', async () => {
    renderDetail('#/agent/raptix?engagement=eng-1')
    expect(await screen.findByText(/Assistant graph raptix/)).toBeInTheDocument()
    expect(screen.queryByText('soundwave')).not.toBeInTheDocument()
    expect(screen.queryByText(/Subagent branches/)).not.toBeInTheDocument()
  })

  it('renders an explicit not-found for an unknown assistant graph id', async () => {
    renderDetail('#/agent/no-such-graph?engagement=eng-1')
    expect(await screen.findByText('Assistant graph not found')).toBeInTheDocument()
    expect(screen.queryByText('raptix')).not.toBeInTheDocument()
  })

  it('renders a checkpoint branch by its key with provenance-only state', async () => {
    renderDetail('#/ai-branch/br-recon-1?engagement=eng-1')
    expect(await screen.findByText(/Branch br-recon-1/)).toBeInTheDocument()
    expect(screen.getByText('recon')).toBeInTheDocument()
    expect(screen.getByText('PASSED')).toBeInTheDocument()
    expect(screen.queryByText(/Bound threads/)).not.toBeInTheDocument()
  })

  it('renders an explicit not-found for a branch id absent from the transcripts', async () => {
    renderDetail('#/ai-branch/br-foreign?engagement=eng-1')
    expect(await screen.findByText('Branch not found')).toBeInTheDocument()
    expect(screen.queryByText('br-recon-1')).not.toBeInTheDocument()
  })

  it('W24: an ended branch with a failed outcome is not rendered as passed', async () => {
    renderDetail('#/agents?engagement=eng-1')
    const failedRow = (await screen.findByText('failed')).closest('tr')!
    expect(failedRow.querySelector('.text-bad')).not.toBeNull()
    const passedRow = (await screen.findByText('recon')).closest('tr')!
    expect(passedRow.querySelector('.text-ok')).not.toBeNull()
  })
})
