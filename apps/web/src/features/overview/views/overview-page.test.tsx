/**
 * The System Overview shows each section from its own read. A failed section says so and never shows zeros; a command audit the
 * source does not record is named as not recorded; a pending section shows a loading state, not an empty one.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

type Read<T> = { isPending: boolean; isError: boolean; error: Error | null; data?: T; refetch: () => void }
const read = <T,>(data?: T, extra: Partial<Read<T>> = {}): Read<T> => ({ isPending: false, isError: false, error: null, data, refetch: () => {}, ...extra })

const hooks = vi.hoisted(() => ({
  projects: null as unknown as Read<unknown>,
  findings: null as unknown as Read<unknown>,
  c2: null as unknown as Read<unknown>,
  tasks: null as unknown as Read<unknown>,
}))

vi.mock('../query', () => ({
  useOverviewProjects: () => hooks.projects,
  useOverviewFindings: () => hooks.findings,
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

const emptyFindings = { total: 0, engagements: 2, engagementsWithFindings: 0, bySeverity: {}, byStatus: {}, truncated: false }
const emptyC2 = { pendingGrants: 1, commandsByStatus: null, recentCommands: [] }

describe('OverviewPage', () => {
  it('says there are no verified findings and names the not-recorded command audit', async () => {
    hooks.projects = read([])
    hooks.findings = read(emptyFindings)
    hooks.c2 = read(emptyC2)
    hooks.tasks = read([])
    await renderOverview()
    expect(screen.getByText(/No verified findings recorded yet across your 2 accessible project/)).toBeTruthy()
    expect(screen.getByText('The command audit is not recorded for this source.')).toBeTruthy()
    expect(screen.getByText(/Pending session grants: 1/)).toBeTruthy()
  })

  it('shows a failed findings section as unavailable while the other sections still render', async () => {
    hooks.projects = read([{ id: 'RT-1', name: 'Alpha', detail: 'client', status: 'active', updatedAt: 'Oct 1' }])
    hooks.findings = read(undefined, { isError: true, error: new Error('findings endpoint down') })
    hooks.c2 = read(emptyC2)
    hooks.tasks = read([])
    await renderOverview()
    expect(screen.getByText('The findings rollup is unavailable: findings endpoint down')).toBeTruthy()
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0)
  })

  it('shows a pending section as loading, not as an empty list', async () => {
    hooks.projects = read(undefined, { isPending: true })
    hooks.findings = read(emptyFindings)
    hooks.c2 = read(emptyC2)
    hooks.tasks = read(undefined, { isPending: true })
    await renderOverview()
    expect(screen.queryByText('No projects yet')).toBeNull()
    expect(screen.queryByText(/No pending work/)).toBeNull()
  })
})
