/**
 * Governance tab (real mode) through the real governance adapter: the workspace
 * stop scope and its sibling latches, the guarded resolution with the concurrency
 * version the row carried, an independent plan decision pinned to the version the
 * reviewer read, and the server's refusal shown in its own words.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import type { EmergencyStopView } from '../../real/api'

vi.mock('../../state/mode', () => ({ DATA_MODE: 'real', isRealMode: () => true, resolveDataMode: () => 'real' }))
vi.mock('../../state/keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../state/keys')>()),
  useQueryScope: () => ({ actor: 'u-owner', role: 'manager', project: 'eng-1' }),
}))

vi.mock('../../real/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../real/api')>()
  return {
    ...actual,
    fetchPlans: vi.fn(),
    fetchPreflight: vi.fn(),
    fetchEmergencyStops: vi.fn(),
    fetchSchedules: vi.fn(),
    listThreads: vi.fn(),
    requestEmergencyStop: vi.fn(),
    resolveEmergencyStop: vi.fn(),
    decidePlan: vi.fn(),
  }
})

const api = await import('../../real/api')
const { ApiTransportError } = await import('../../real/transport')
const { RealFeatureServicesCtx } = await import('../../real/service-adapter/provider')
const { createRealFeatureServices } = await import('../../real/service-adapter/index')
const { GovernanceTab } = await import('./tab')

const CAPABILITIES = { version: 1, mode: 'multi-user', capabilities: { projects: { supported: true, available: true } } } as never

function stop(overrides: Partial<EmergencyStopView>): EmergencyStopView {
  return {
    id: 'stop-1',
    engagementId: 'eng-1',
    scope: 'project',
    targetId: null,
    requestedBy: 'user-1',
    outcome: 'acknowledged',
    reason: 'Blue team request',
    concurrencyVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function plan(overrides: Record<string, unknown>) {
  return {
    id: 'plan-1', engagementId: 'eng-1', version: 1, status: 'approved', objective: 'Assess the perimeter',
    methods: ['web'], requestedBy: 'u-owner', decidedBy: null, decidedAt: null, decisionComment: null,
    expiresAt: '2026-10-19T09:00:00.000Z', roeVersion: 2, createdAt: '2026-10-17T09:00:00.000Z',
    ...overrides,
  }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const services = createRealFeatureServices(CAPABILITIES)
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <RealFeatureServicesCtx.Provider value={services}>{children}</RealFeatureServicesCtx.Provider>
    </QueryClientProvider>
  )
  return render(<GovernanceTab engagementId="eng-1" />, { wrapper })
}

beforeEach(() => {
  vi.mocked(api.fetchPlans).mockResolvedValue({ engagementId: 'eng-1', source: 'db', deadlineHours: 24, latestApprovedScopeVersion: 2, plans: [] } as never)
  vi.mocked(api.fetchPreflight).mockResolvedValue({ engagementId: 'eng-1', ok: true, checks: [], source: 'db' } as never)
  vi.mocked(api.listThreads).mockResolvedValue({ engagementId: 'eng-1', threads: [], source: 'db' } as never)
  vi.mocked(api.fetchSchedules).mockResolvedValue({ engagementId: 'eng-1', schedules: [], source: 'db' } as never)
  vi.mocked(api.fetchEmergencyStops).mockResolvedValue({ engagementId: 'eng-1', stops: [], source: 'db' } as never)
  vi.mocked(api.requestEmergencyStop).mockReset()
  vi.mocked(api.resolveEmergencyStop).mockReset().mockImplementation((_e, _s, _r, v) => Promise.resolve(stop({ id: 'stop-1', outcome: 'resolved', concurrencyVersion: v + 1 })))
})

afterEach(() => {
  cleanup()
})

describe('GovernanceTab emergency stops (W10 workspace stop and guarded resolution)', () => {
  it('requests a workspace stop and surfaces the sibling latches recorded in other engagements', async () => {
    vi.mocked(api.requestEmergencyStop).mockResolvedValue(stop({
      id: 'stop-anchor',
      engagementId: 'eng-1',
      scope: 'workspace',
      outcome: 'stopped',
      related: [stop({ id: 'stop-2', engagementId: 'eng-2', scope: 'workspace', outcome: 'acknowledged', reason: 'major incident' })],
    }))
    renderTab()
    await userEvent.selectOptions(await screen.findByLabelText('Stop scope'), 'workspace')
    await userEvent.type(screen.getByLabelText('Reason', { selector: '#estop-reason' }), 'major incident')
    await userEvent.click(screen.getByRole('button', { name: /emergency stop \(workspace\)/i }))
    await waitFor(() => expect(api.requestEmergencyStop).toHaveBeenCalledWith('eng-1', { scope: 'workspace', reason: 'major incident' }))
    const summary = await screen.findByText(/Workspace stop recorded sibling latches/)
    expect(summary.parentElement).toHaveTextContent(/eng-2 — acknowledged/)
    expect(summary.parentElement).toHaveTextContent(/resolved separately/i)
  })

  it('resolves an active stop with the concurrency version the list row carried', async () => {
    vi.mocked(api.fetchEmergencyStops).mockResolvedValue({
      engagementId: 'eng-1',
      stops: [stop({ outcome: 'acknowledged', concurrencyVersion: 3 })],
      source: 'db',
    } as never)
    renderTab()
    const input = await screen.findByLabelText('Resolution reason for stop stop-1')
    await userEvent.type(input, 'infrastructure all-clear')
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    await waitFor(() => expect(api.resolveEmergencyStop).toHaveBeenCalledWith('eng-1', 'stop-1', 'infrastructure all-clear', 3))
  })

  it('keeps the resolve button disabled while the row reason is empty', async () => {
    vi.mocked(api.fetchEmergencyStops).mockResolvedValue({
      engagementId: 'eng-1',
      stops: [stop({ outcome: 'unknown', concurrencyVersion: 1 })],
      source: 'db',
    } as never)
    renderTab()
    expect(await screen.findByLabelText('Resolution reason for stop stop-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeDisabled()
  })
})

describe('GovernanceTab plan decisions (W09 independent, version-pinned)', () => {
  it('approves a proposed plan with the version the reviewer read', async () => {
    vi.mocked(api.fetchPlans).mockResolvedValue({
      engagementId: 'eng-1', source: 'db', deadlineHours: 24, latestApprovedScopeVersion: 2,
      plans: [plan({ id: 'plan-9', version: 3, status: 'proposed', expiresAt: null })],
    } as never)
    vi.mocked(api.decidePlan).mockResolvedValue(plan({ id: 'plan-9', version: 3, status: 'approved', decidedBy: 'u-reviewer' }) as never)
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(api.decidePlan).toHaveBeenCalledWith('eng-1', 'plan-9', 'approved', 3))
  })

  it('shows the server refusal of a stale decision in the server’s own words', async () => {
    vi.mocked(api.fetchPlans).mockResolvedValue({
      engagementId: 'eng-1', source: 'db', deadlineHours: 24, latestApprovedScopeVersion: 2,
      plans: [plan({ id: 'plan-9', version: 3, status: 'proposed', expiresAt: null })],
    } as never)
    vi.mocked(api.decidePlan).mockRejectedValue(new ApiTransportError(409, 'conflict', 'Plan version changed since it was read; reload before deciding.'))
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    expect(await screen.findByText('Plan version changed since it was read; reload before deciding.')).toBeInTheDocument()
  })
})
