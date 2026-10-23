/**
 * The project overview in real mode. Each block reads its own source: a failed or unconfigured source names its state in
 * place of a number, only this engagement's decisions are listed, and an active emergency stop becomes the next step.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectViewModel } from '@raptix/web-contracts'

const hooks = vi.hoisted(() => ({
  fetchOverview: vi.fn(),
  fetchEnvironment: vi.fn(),
  fleet: vi.fn(),
  surface: vi.fn(),
  findings: vi.fn(),
  assets: vi.fn(),
  tasks: vi.fn(),
  scope: vi.fn(),
  planning: vi.fn(),
  go: vi.fn(),
}))

vi.mock('../../assets', () => ({ useAssetList: () => hooks.assets() }))
vi.mock('../../findings', () => ({ useFindingList: () => hooks.findings() }))
vi.mock('../../c2', () => ({ useProviderSurface: () => hooks.surface() }))
vi.mock('../../overview', () => ({ useOverviewTasks: () => hooks.tasks() }))
vi.mock('../../operations', () => ({ useRuntimeFleet: () => hooks.fleet() }))
vi.mock('../../planning', () => ({ usePlanningRead: () => hooks.planning() }))
vi.mock('../../scope', () => ({ useScopeRead: () => hooks.scope() }))
vi.mock('../../../router/navigate', () => ({ go: (...args: unknown[]) => hooks.go(...args) }))
vi.mock('../overview-api', () => ({ fetchEngagementOverview: (id: string) => hooks.fetchOverview(id) }))
vi.mock('../environment-api', () => ({ fetchEnvironment: (id: string) => hooks.fetchEnvironment(id) }))
vi.mock('./environment-panel', () => ({ EnvironmentPanel: () => <p>environment controls</p> }))

const ok = <T,>(data: T) => ({ isPending: false, isError: false, error: null, data })
const failed = (message: string) => ({ isPending: false, isError: true, error: new Error(message), data: undefined })

const project = {
  id: 'RT-2026-014',
  displayName: 'Viettel lab',
  workspaceSlug: 'viettel-lab',
  targetValue: '10.14.0.0/24',
  targetType: 'cidr',
  metadataState: 'verified',
  authorizationConfirmed: true,
  lifecycleStatus: 'running',
  handoffConfirmedAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-23T09:12:00Z',
  brief: 'Internal attack-surface review.',
} as unknown as ProjectViewModel

const overviewRead = {
  engagementId: 'RT-2026-014',
  readiness: { state: 'available', ok: false, failed: [{ id: 'roe-window', detail: 'Run outside the ROE window' }], reason: null },
  completion: { findingsConfirmed: 2, reportsDelivered: 0, activeStops: 0 },
  activity: [{ action: 'scope.approved', actorId: 'Pat Kim', createdAt: '2026-10-21T09:00:00Z' }],
  source: 'db',
}

const task = (overrides: Record<string, unknown>) => ({
  kind: 'finding-review',
  refId: 'F-1',
  engagementId: 'RT-2026-014',
  engagementName: 'Viettel lab',
  title: 'Finding awaiting confirmation',
  createdAt: '2026-10-22T09:00:00Z',
  href: '#/project/RT-2026-014?tab=findings',
  awaitingActor: false,
  ...overrides,
})

function useReads(overrides: { overview?: Record<string, unknown> } = {}): void {
  hooks.scope.mockReturnValue(ok({ latestApprovedVersion: 3 }))
  hooks.planning.mockReturnValue(ok({ ready: false, reasons: [1, 2], opplan: { objectives: [{ id: 'OBJ-1', status: 'done' }, { id: 'OBJ-2', status: 'pending' }] } }))
  hooks.fleet.mockReturnValue(ok({ counts: { threads: 5, activeRuns: 1 } }))
  hooks.surface.mockReturnValue(failed('C2 provider not configured'))
  hooks.findings.mockReturnValue(ok({ items: [], total: 0, counts: { all: 5, drafts: 1, review: 2, confirmed: 1, remediation: 0, ai: 1 }, summary: { total: 5, severity: { critical: 1, high: 1, medium: 2, low: 0, info: 1 } } }))
  hooks.assets.mockReturnValue(ok({ items: [], total: 5, kpis: { in: 3, out: 1, pending: 1, unclassified: 0 } }))
  hooks.tasks.mockReturnValue(ok({ items: [
    task({ refId: 'T-1', awaitingActor: true, title: 'Review of scope v3' }),
    task({ refId: 'T-2', kind: 'report-review', title: 'Quarterly report' }),
    task({ refId: 'T-3', engagementId: 'RT-2026-009', title: 'Other project finding' }),
  ], limited: false }))
  hooks.fetchOverview.mockResolvedValue({ ...overviewRead, ...overrides.overview })
  hooks.fetchEnvironment.mockResolvedValue({
    engagementId: 'RT-2026-014',
    environment: { observedState: 'stopped', desiredState: 'stopped', generation: 1, observedAt: null, archived: false, lastError: null },
    slot: { phase: 'idle', version: 1, held: false, ownedByThisProject: false, activeEngagementId: null },
  })
}

async function renderOverview(overrides: Partial<ProjectViewModel> = {}) {
  const { ProjectOverview } = await import('./project-overview')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ProjectOverview d={{ ...project, ...overrides }} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('project overview', () => {
  it('names the next step and the open check, and keeps other engagements out', async () => {
    useReads()
    await renderOverview()
    expect(await screen.findByText('Resolve: Planning handed off')).toBeTruthy()
    expect(await screen.findByText('Planning handed off')).toBeTruthy()
    expect(screen.queryByText('Other project finding')).toBeNull()
  }, 20_000)

  it('shows the OPPLAN objectives by the status the runtime reports', async () => {
    useReads()
    await renderOverview()
    expect(await screen.findByText('done')).toBeTruthy()
    expect(screen.getByText('pending')).toBeTruthy()
  })

  it('makes an active emergency stop the next step', async () => {
    useReads({ overview: { completion: { findingsConfirmed: 2, reportsDelivered: 0, activeStops: 1 } } })
    await renderOverview()
    expect(await screen.findByText('Resolve the active emergency stop')).toBeTruthy()
  })

  it('keeps execution blocked while a preparation check is open, even with the target and authorization met', async () => {
    useReads()
    await renderOverview({ lifecycleStatus: 'draft', handoffConfirmedAt: null })
    expect(await screen.findByText('Blocked until 1 preparation check is met')).toBeTruthy()
    expect(screen.getByText('Resolve: Planning handed off')).toBeTruthy()
  })

  it('shows a provider that is not configured by its state, not by a count', async () => {
    useReads()
    await renderOverview()
    expect(await screen.findByText('C2 provider not configured')).toBeTruthy()
  })

  it('leaves the blocks of an unreadable overview unavailable instead of showing zeros', async () => {
    useReads()
    hooks.fetchOverview.mockRejectedValue(new Error('overview read failed'))
    await renderOverview()
    expect(await screen.findByText('Some figures could not be read')).toBeTruthy()
    expect(screen.getByText('Some figures could not be read')).toBeTruthy()
  })

  it('opens the environment controls from its figure, not from a block of their own', async () => {
    useReads()
    await renderOverview()
    expect(screen.queryByText('environment controls')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Manage environment' }))
    expect(await screen.findByText('environment controls')).toBeTruthy()
  })
})
