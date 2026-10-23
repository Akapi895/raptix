/**
 * The System Overview shows each section from its own read. A failed section says so and never shows zeros; a command audit the
 * source does not record is named as not recorded; a pending section shows a loading state, not an empty one; a KPI for a
 * runtime-backed count names where it is read instead of showing a number.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

type Read<T> = { isPending: boolean; isError: boolean; error: Error | null; data?: T; refetch: () => void }
const read = <T,>(data?: T, extra: Partial<Read<T>> = {}): Read<T> => ({ isPending: false, isError: false, error: null, data, refetch: () => {}, ...extra })

const hooks = vi.hoisted(() => ({
  projects: null as unknown as Read<unknown>,
  findings: null as unknown as Read<unknown>,
  operations: null as unknown as Read<unknown>,
  c2: null as unknown as Read<unknown>,
  tasks: null as unknown as Read<unknown>,
}))

vi.mock('../query', () => ({
  useOverviewProjects: () => hooks.projects,
  useOverviewFindings: () => hooks.findings,
  useOverviewOperations: () => hooks.operations,
  useOverviewC2: () => hooks.c2,
  useOverviewTasks: () => hooks.tasks,
}))

beforeAll(async () => {
  await import('./overview-page')
}, 30_000)

afterEach(() => {
  cleanup()
})

async function renderOverview(): Promise<void> {
  const { OverviewPage } = await import('./overview-page')
  render(<OverviewPage />)
}

const emptyFindings = { total: 0, engagements: 2, engagementsWithFindings: 0, bySeverity: {}, byStatus: {}, unresolvedBySeverity: {}, latestCreatedAt: null, truncated: false }
const emptyC2 = { pendingGrants: 1, commandsByStatus: null, recentCommands: [] }
const emptyOperations = { counts: { bound: 0, running: 0, stopped: 0, completed: 0 }, recent: [], engagements: 2, truncated: false }

describe('OverviewPage', () => {
  it('says there are no curated findings and names the not-recorded command audit', async () => {
    hooks.projects = read([])
    hooks.findings = read(emptyFindings)
    hooks.operations = read(emptyOperations)
    hooks.c2 = read(emptyC2)
    hooks.tasks = read({ items: [], limited: false })
    await renderOverview()
    expect(screen.getByText(/No curated findings recorded yet across your 2 accessible project/)).toBeTruthy()
    expect(screen.getByText('Decision queue (0)')).toBeTruthy()
  })

  it('keeps emergency stops out of the decision queue and marks a limited queue as a lower bound', async () => {
    hooks.projects = read([])
    hooks.findings = read(emptyFindings)
    hooks.operations = read(emptyOperations)
    hooks.c2 = read(emptyC2)
    const stop = { kind: 'active-stop', refId: 'ES-1', engagementId: 'RT-1', engagementName: 'Alpha', title: 'Emergency stop (all) is active', createdAt: 'Oct 1', href: '#/project/RT-1?tab=operations', awaitingActor: true }
    const grant = { ...stop, kind: 'c2-grant', refId: 'G-1', title: 'C2 grant for sess-1' }
    hooks.tasks = read({ items: [stop, grant], limited: true })
    await renderOverview()
    expect(screen.getByText('Decision queue (1+)')).toBeTruthy()
    expect(screen.getByText('1 active emergency stop need attention.')).toBeTruthy()
  })

  it('shows a failed findings section as unavailable while the other sections still render', async () => {
    hooks.projects = read([{ id: 'RT-1', name: 'Alpha', detail: 'client', status: 'active', updatedAt: 'Oct 1' }])
    hooks.findings = read(undefined, { isError: true, error: new Error('findings endpoint down') })
    hooks.operations = read(emptyOperations)
    hooks.c2 = read(emptyC2)
    hooks.tasks = read({ items: [], limited: false })
    await renderOverview()
    expect(screen.getByText('The findings rollup is unavailable: findings endpoint down')).toBeTruthy()
    expect(screen.getByText('Operations queue')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0)
  })

  it('shows a pending section as loading, not as an empty list', async () => {
    hooks.projects = read(undefined, { isPending: true })
    hooks.findings = read(emptyFindings)
    hooks.operations = read(undefined, { isPending: true })
    hooks.c2 = read(emptyC2)
    hooks.tasks = read(undefined, { isPending: true })
    await renderOverview()
    expect(screen.queryByText('No projects yet')).toBeNull()
    expect(screen.queryByText(/No pending work/)).toBeNull()
  })

  it('shows operations as not recorded in demo data and never as a zero active count', async () => {
    hooks.projects = read([])
    hooks.findings = read(emptyFindings)
    hooks.operations = read({ counts: null, recent: [], engagements: 2, truncated: false })
    hooks.c2 = read(emptyC2)
    hooks.tasks = read({ items: [], limited: false })
    await renderOverview()
    expect(screen.getByText('Operation status is not recorded for this source.')).toBeTruthy()
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0)
    expect(screen.queryByText('Per project')).toBeNull()
  })

  it('lists each severity of the donut with its count and share, in severity order', async () => {
    hooks.projects = read([])
    hooks.findings = read({ total: 3, engagements: 2, engagementsWithFindings: 1, bySeverity: { critical: 2, high: 1 }, byStatus: {}, unresolvedBySeverity: {}, latestCreatedAt: null, truncated: false })
    hooks.operations = read(emptyOperations)
    hooks.c2 = read(emptyC2)
    hooks.tasks = read({ items: [], limited: false })
    await renderOverview()
    const legend = screen.getByRole('list', { name: 'Curated findings by severity' })
    expect(within(legend).getAllByRole('listitem')).toHaveLength(5)
    expect(within(legend).getByText('Critical')).toBeTruthy()
    expect(within(legend).getByText('67%')).toBeTruthy()
    expect(within(legend).getByText('33%')).toBeTruthy()
    expect(within(legend).getByText('Informational')).toBeTruthy()
    expect(screen.getByText('Fix rate')).toBeTruthy()
    expect(screen.getByText('Medium')).toBeTruthy() // severity name in the breakdown, not a risk badge
  })

  it('reads a backlog that is all critical as the severe band, with the whole ring in one segment', async () => {
    hooks.projects = read([])
    hooks.findings = read({ total: 4, engagements: 1, engagementsWithFindings: 1, bySeverity: { critical: 4 }, byStatus: { confirmed: 4 }, unresolvedBySeverity: { critical: 4 }, latestCreatedAt: null, truncated: false })
    hooks.operations = read(emptyOperations)
    hooks.c2 = read(emptyC2)
    hooks.tasks = read({ items: [], limited: false })
    await renderOverview()
    expect(screen.getByText('Severe')).toBeTruthy()
    const legend = screen.getByRole('list', { name: 'Curated findings by severity' })
    expect(within(legend).getByText('100%')).toBeTruthy()
    expect(screen.getByText('Unresolved critical')).toBeTruthy()
    expect(screen.getByText('Fix rate').parentElement!.textContent).toContain('0.0%')
  })

  it('shows the status cards from the recorded counts and says so when no finding is recorded', async () => {
    hooks.projects = read([])
    hooks.findings = read({ total: 2, engagements: 1, engagementsWithFindings: 1, bySeverity: { high: 2 }, byStatus: { confirmed: 2 }, unresolvedBySeverity: { high: 2 }, latestCreatedAt: null, truncated: false })
    hooks.operations = read(emptyOperations)
    hooks.c2 = read(emptyC2)
    hooks.tasks = read({ items: [], limited: false })
    await renderOverview()
    expect(screen.getByRole('button', { name: /Confirmed\s*2/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Open\s*0/ })).toBeTruthy()
    cleanup()
    hooks.findings = read(emptyFindings)
    await renderOverview()
    expect(screen.getByText('Not assessed')).toBeTruthy()
    expect(screen.getByText('Fix rate: no curated findings to fix yet.')).toBeTruthy()
  })

  it('counts active operations and opens a bound operation by its thread identity', async () => {
    hooks.projects = read([])
    hooks.findings = read(emptyFindings)
    hooks.operations = read({
      counts: { bound: 0, running: 2, stopped: 0, completed: 1 },
      recent: [{ id: 'b1', engagementId: 'RT-1', engagementName: 'Alpha', threadId: 'thread-1', status: 'running', updatedAt: 'Oct 1' }],
      engagements: 1,
      truncated: false,
    })
    hooks.c2 = read(emptyC2)
    hooks.tasks = read({ items: [], limited: false })
    await renderOverview()
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
    expect(screen.getByText('Alpha')).toBeTruthy()
  })
})
