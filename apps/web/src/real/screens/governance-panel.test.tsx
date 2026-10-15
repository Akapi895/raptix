/**
 * W10/ADR-0074: the governance panel offers the workspace stop scope, surfaces
 * the sibling latches a workspace stop recorded in other owned engagements,
 * and resolves stops with the concurrency version the row actually carried —
 * a stale resolver is refused by the server instead of silently overwriting.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import type { EmergencyStopView } from '../api'

const requestEmergencyStop = vi.fn()
const resolveEmergencyStop = vi.fn()

vi.mock('../api', () => ({
  ACTIVE_STOP_OUTCOMES: ['requested', 'acknowledged', 'stopped', 'failed', 'unknown'],
  bindPlan: vi.fn(),
  cancelSchedule: vi.fn(),
  comparePlans: vi.fn(),
  createSchedule: vi.fn(),
  decidePlan: vi.fn(),
  fetchEmergencyStops: (...a: unknown[]) => fetchEmergencyStops(...a),
  fetchPlans: () => Promise.resolve({ deadlineHours: 24, plans: [] }),
  fetchPreflight: () => Promise.resolve({ ok: true, checks: [] }),
  fetchSchedules: () => Promise.resolve({ schedules: [] }),
  listThreads: () => Promise.resolve({ threads: [] }),
  proposePlan: vi.fn(),
  requestEmergencyStop: (...a: unknown[]) => requestEmergencyStop(...a),
  rescheduleSchedule: vi.fn(),
  resolveEmergencyStop: (...a: unknown[]) => resolveEmergencyStop(...a),
  revisePlan: vi.fn(),
  savePlan: vi.fn(),
}))

const fetchEmergencyStops = vi.fn()

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

async function renderPanel(): Promise<void> {
  const { RealGovernancePanel } = await import('./governance-panel')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<RealGovernancePanel engagementId="eng-1" />, { wrapper })
}

beforeEach(() => {
  requestEmergencyStop.mockReset()
  resolveEmergencyStop.mockReset().mockImplementation((_e: string, _s: string, _r: string, v: number) => Promise.resolve(stop({ id: 'stop-1', outcome: 'resolved', concurrencyVersion: v + 1 })))
  fetchEmergencyStops.mockReset().mockImplementation(() => Promise.resolve({ engagementId: 'eng-1', stops: [], source: 'db' }))
})

afterEach(() => {
  cleanup()
})

describe('RealGovernancePanel (W10 workspace stop and guarded resolution)', () => {
  it('requests a workspace stop and surfaces the sibling latches recorded in other engagements', async () => {
    requestEmergencyStop.mockResolvedValue(stop({
      id: 'stop-anchor',
      engagementId: 'eng-1',
      scope: 'workspace',
      outcome: 'stopped',
      related: [
        stop({ id: 'stop-2', engagementId: 'eng-2', scope: 'workspace', outcome: 'acknowledged', reason: 'major incident' }),
      ],
    }))
    await renderPanel()
    await userEvent.selectOptions(await screen.findByLabelText('Stop scope'), 'workspace')
    await userEvent.type(screen.getByLabelText('Reason', { selector: '#estop-reason' }), 'major incident')
    await userEvent.click(screen.getByRole('button', { name: /emergency stop \(workspace\)/i }))
    await waitFor(() => expect(requestEmergencyStop).toHaveBeenCalledWith('eng-1', { scope: 'workspace', reason: 'major incident' }))
    const summary = await screen.findByText(/Workspace stop recorded sibling latches/)
    expect(summary.parentElement).toHaveTextContent(/eng-2 — acknowledged/)
    expect(summary.parentElement).toHaveTextContent(/resolved separately/i)
  })

  it('resolves an active stop with the concurrency version the list row carried', async () => {
    fetchEmergencyStops.mockResolvedValue({
      engagementId: 'eng-1',
      stops: [stop({ outcome: 'acknowledged', concurrencyVersion: 3 })],
      source: 'db',
    })
    await renderPanel()
    const input = await screen.findByLabelText('Resolution reason for stop stop-1')
    await userEvent.type(input, 'infrastructure all-clear')
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    await waitFor(() => expect(resolveEmergencyStop).toHaveBeenCalledWith('eng-1', 'stop-1', 'infrastructure all-clear', 3))
  })

  it('keeps the resolve button disabled while the row reason is empty', async () => {
    fetchEmergencyStops.mockResolvedValue({
      engagementId: 'eng-1',
      stops: [stop({ outcome: 'unknown', concurrencyVersion: 1 })],
      source: 'db',
    })
    await renderPanel()
    expect(await screen.findByLabelText('Resolution reason for stop stop-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeDisabled()
  })
})
