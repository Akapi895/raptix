/**
 * Infrastructure in real mode: the selected engagement scopes every read, nothing is read before an engagement is chosen,
 * the summary counts come from the reads the panels use, and an unconfigured provider is named in the summary, never a zero.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  route: { page: 'infrastructure', tab: undefined as string | undefined, engagementId: undefined as string | undefined },
  pid: 'all',
  setPid: vi.fn(),
  go: vi.fn(),
  fleet: vi.fn(),
  grants: vi.fn(),
  surface: vi.fn(),
  campaigns: vi.fn(),
}))

vi.mock('../../../router/navigate', () => ({
  go: (...args: unknown[]) => hooks.go(...args),
  useRoute: () => hooks.route,
}))

vi.mock('../../../state/stores', () => ({
  useProjectStore: (selector: (state: { pid: string; setPid: (pid: string) => void }) => unknown) => selector({ pid: hooks.pid, setPid: hooks.setPid }),
}))

vi.mock('../../projects', () => ({
  useRealProjects: () => ({ list: { data: [{ id: 'RT-2026-014', displayName: 'Viettel lab' }], isError: false, error: null } }),
}))

vi.mock('../../operations', () => ({
  RuntimeFleetTab: () => <p>fleet panel</p>,
  useRuntimeFleet: (engagementId: string) => hooks.fleet(engagementId),
}))
vi.mock('../../c2', () => ({
  InfrastructureCard: () => <p>listeners panel</p>,
  ConsoleCard: () => <p>console panel</p>,
  GrantsCard: () => <p>grants panel</p>,
  RealCampaignsPanel: () => <p>campaigns panel</p>,
  useProviderGrants: (engagementId: string) => hooks.grants(engagementId),
  useProviderSurface: (engagementId: string) => hooks.surface(engagementId),
  useRealCampaigns: (engagementId: string) => hooks.campaigns(engagementId),
}))

const ok = <T,>(data: T) => ({ isPending: false, isError: false, error: null, data })
const failed = (message: string) => ({ isPending: false, isError: true, error: new Error(message), data: undefined })

async function renderPage(options: { engagementId?: string; tab?: string } = {}) {
  hooks.route.engagementId = options.engagementId
  hooks.route.tab = options.tab
  hooks.pid = options.engagementId ?? 'all'
  const { RealInfrastructureRoute } = await import('./real-infrastructure')
  return render(<RealInfrastructureRoute />)
}

afterEach(() => {
  cleanup()
  hooks.fleet.mockReset()
  hooks.grants.mockReset()
  hooks.surface.mockReset()
  hooks.campaigns.mockReset()
  hooks.go.mockReset()
  hooks.setPid.mockReset()
})

describe('real infrastructure', () => {
  it('reads nothing and shows no tab until an engagement is selected', async () => {
    await renderPage()
    expect(screen.getByText('Choose the engagement whose runtime agents, C2 infrastructure and campaigns you want to see.')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Runtime agents' })).toBeNull()
    expect(hooks.fleet).not.toHaveBeenCalled()
    expect(hooks.grants).not.toHaveBeenCalled()
  })

  it('scopes the summary and the open panel to the selected engagement', async () => {
    hooks.fleet.mockReturnValue(ok({ counts: { threads: 3, activeRuns: 2 } }))
    hooks.grants.mockReturnValue(ok({ bounds: { minHours: 1, maxHours: 24 }, grants: [{ id: 'G1', status: 'requested' }, { id: 'G2', status: 'approved' }] }))
    hooks.surface.mockReturnValue(failed('C2 provider not configured'))
    hooks.campaigns.mockReturnValue(ok({ campaigns: [] }))
    await renderPage({ engagementId: 'RT-2026-014', tab: 'grants' })
    expect(hooks.fleet).toHaveBeenCalledWith('RT-2026-014')
    expect(screen.getByRole('tab', { name: 'Grants' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('grants panel')).toBeTruthy()
    expect(screen.getByText('Grants awaiting decision').closest('[class*="rounded-xl"]')).toHaveTextContent('1')
    expect(screen.getByText('Active runs').closest('[class*="rounded-xl"]')).toHaveTextContent('2')
  })

  it('names the missing C2 provider in the summary instead of showing a count', async () => {
    hooks.fleet.mockReturnValue(ok({ counts: { threads: 0, activeRuns: 0 } }))
    hooks.grants.mockReturnValue(ok({ bounds: { minHours: 1, maxHours: 24 }, grants: [] }))
    hooks.surface.mockReturnValue(failed('C2 provider not configured'))
    hooks.campaigns.mockReturnValue(ok({ campaigns: [] }))
    await renderPage({ engagementId: 'RT-2026-014', tab: 'sessions' })
    expect(screen.getByText('C2 provider not configured')).toBeTruthy()
    expect(screen.getByText('console panel')).toBeTruthy()
  })

  it('opens the runtime agents tab when the URL names no known tab', async () => {
    hooks.fleet.mockReturnValue(ok({ counts: { threads: 0, activeRuns: 0 } }))
    hooks.grants.mockReturnValue(ok({ bounds: { minHours: 1, maxHours: 24 }, grants: [] }))
    hooks.surface.mockReturnValue(failed('C2 provider not configured'))
    hooks.campaigns.mockReturnValue(ok({ campaigns: [] }))
    await renderPage({ engagementId: 'RT-2026-014', tab: 'unknown' })
    expect(screen.getByRole('tab', { name: 'Runtime agents' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('fleet panel')).toBeTruthy()
  })

  it('writes a tab choice into the URL with the engagement it belongs to', async () => {
    hooks.fleet.mockReturnValue(ok({ counts: { threads: 0, activeRuns: 0 } }))
    hooks.grants.mockReturnValue(ok({ bounds: { minHours: 1, maxHours: 24 }, grants: [] }))
    hooks.surface.mockReturnValue(failed('C2 provider not configured'))
    hooks.campaigns.mockReturnValue(ok({ campaigns: [] }))
    await renderPage({ engagementId: 'RT-2026-014' })
    fireEvent.click(screen.getByRole('tab', { name: 'Campaigns' }))
    expect(hooks.go).toHaveBeenCalledWith('infrastructure', { engagementId: 'RT-2026-014', tab: 'campaigns' })
  })
})
