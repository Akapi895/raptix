/** Results panel (P12, real mode): run and branch outcomes as reported, the unsuccessful and partial banners, and the findings that cite the thread. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'

vi.mock('../../router/navigate', () => ({ go: vi.fn(), useRoute: () => ({ page: 'operation' }) }))
vi.mock('../findings/remote', () => ({ fetchCuratedFindings: vi.fn() }))
vi.mock('../../state/keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../state/keys')>()),
  useQueryScope: () => ({ actor: 'u-owner', role: 'manager', project: 'eng-1' }),
}))
vi.mock('./runtime-query', () => ({
  messageOf: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
  useRuntimeRuns: vi.fn(),
  useRuntimeFleet: vi.fn(),
}))

const { ThreadResults } = await import('./results-panel')
const runtime = await import('./runtime-query')
const api_findings = await import('../findings/remote');

const THREAD = { engagementId: 'eng-1', threadId: 'th-1', assistantId: 'raptix', kind: 'execution', createdAt: '2026-10-19T09:00:00.000Z', updatedAt: '2026-10-19T09:05:00.000Z' }
const RUN = (runId: string, rawStatus: string) => ({ runId, requestId: `req-${runId}`, threadId: 'th-1', rawStatus, createdAt: '2026-10-19T09:00:00.000Z', updatedAt: '2026-10-19T09:01:00.000Z' })
const FINDING = { id: 'FD-101', title: 'Exposed admin panel', severity: 'high', status: 'draft', references: { threadId: 'th-1', runId: null } }

function withClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

function stub(runs: unknown[], branches: unknown[] = [], findings: unknown[] = []) {
  vi.mocked(runtime.useRuntimeRuns).mockReturnValue({ isPending: false, isError: false, data: runs } as never)
  vi.mocked(runtime.useRuntimeFleet).mockReturnValue({ isPending: false, isError: false, data: { branches } } as never)
  vi.mocked(api_findings.fetchCuratedFindings).mockResolvedValue({ engagementId: 'eng-1', findings, transitions: {} } as never)
}

beforeEach(() => { cleanup(); vi.clearAllMocks() })

describe('ThreadResults', () => {
  it('shows run statuses as the runtime words them and a partial banner while a run is in flight', async () => {
    stub([RUN('run-1', 'success'), RUN('run-2', 'running')])
    render(withClient(<ThreadResults engagementId="eng-1" thread={THREAD} />))
    const runs = await screen.findByRole('region', { name: 'Run outcomes' })
    expect(within(runs).getByText('success')).toBeInTheDocument()
    expect(within(runs).getByText('running')).toBeInTheDocument()
    expect(screen.getByText('Results are partial')).toBeInTheDocument()
  })

  it('warns when a branch ended without a success outcome', async () => {
    stub([RUN('run-1', 'success')], [{ threadId: 'th-1', key: 'k1', agent: 'recon', state: 'ended', outcome: 'error', startedAt: null, endedAt: null }])
    render(withClient(<ThreadResults engagementId="eng-1" thread={THREAD} />))
    expect(await screen.findByText('1 branch ended without a success outcome')).toBeInTheDocument()
  })

  it('lists the findings that cite this operation', async () => {
    stub([RUN('run-1', 'success')], [], [FINDING])
    render(withClient(<ThreadResults engagementId="eng-1" thread={THREAD} />))
    expect(await screen.findByRole('button', { name: 'Exposed admin panel' })).toBeInTheDocument()
  })

  it('shows an explicit unavailable state rather than a substitute when the findings source fails', async () => {
    stub([RUN('run-1', 'success')])
    vi.mocked(api_findings.fetchCuratedFindings).mockRejectedValue(new Error('findings down'))
    render(withClient(<ThreadResults engagementId="eng-1" thread={THREAD} />))
    expect(await screen.findByText('Results unavailable')).toBeInTheDocument()
    expect(screen.getByText(/findings down/)).toBeInTheDocument()
  })
})
