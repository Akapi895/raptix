/** Real bootstrap/project screens against stubbed API responses (ticket 03). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectViewModel } from '@raptix/web-contracts'

// Real data mode for the shared screens embedded in the project detail; the mode is read once at load.
window.history.replaceState(null, '', '/?dataMode=real')
vi.stubEnv('VITE_DATA_MODE', 'real')

const { cleanup, render, screen, waitFor } = await import('@testing-library/react')
const userEvent = (await import('@testing-library/user-event')).default
const { RealModeProvider } = await import('../bootstrap')
const { RealPortfolio } = await import('../../features/projects/views/portfolio-page')
const { RealProjectCreateDialog, RealProjectNewRoute } = await import('../../features/projects/views/create-page')
const { useCreateProjectDialog, showCreateProject } = await import('../create-project-dialog')
const { RealProjectDetail } = await import('../../features/projects/views/detail-page')
const { go } = await import('../../router/navigate')

const CAPS = {
  version: 1,
  mode: 'local-single-user',
  capabilities: { projects: { supported: true, available: true } },
}

function dto(overrides: Partial<ProjectViewModel> = {}): ProjectViewModel {
  return {
    id: 'eng-8f3c92a1',
    workspaceSlug: 'q1-external-assessment',
    displayName: 'Q1 External Assessment',
    targetType: 'web_url',
    targetValue: 'https://target.example.test',
    authorizationConfirmed: true,
    brief: 'Assess the public surface.',
    handoffConfirmedAt: null,
    metadataState: 'verified',
    lifecycleStatus: 'planning',
    findingCount: null,
    assetCount: null,
    activeAgentCount: null,
    createdAt: '2026-10-14T08:00:00.000Z',
    updatedAt: '2026-10-14T09:30:00.000Z',
    ...overrides,
  }
}

function stubApi(list: ProjectViewModel[] = [dto()]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/capabilities')) return new Response(JSON.stringify(CAPS), { status: 200 })
    if (url.includes('/api/engagements/')) return new Response(JSON.stringify(list[0]), { status: 200 })
    if (url.endsWith('/api/engagements') && init?.method === 'POST') return new Response(JSON.stringify(dto({ lifecycleStatus: 'draft' })), { status: 201 })
    if (url.endsWith('/api/engagements')) return new Response(JSON.stringify(list), { status: 200 })
    return new Response('unexpected', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function ui(node: React.ReactElement) {
  return render(<RealModeProvider>{node}</RealModeProvider>)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('RealPortfolio', () => {
  it('renders the real engagements, raw statuses and the unavailable marker for API-absent columns', async () => {
    stubApi()
    ui(<RealPortfolio />)
    await screen.findByText('Q1 External Assessment')
    expect(screen.getByText(/eng-8f3c92a1/)).toBeTruthy()
    expect(screen.getByText(/q1-external-assessment/)).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getByText('Planning')).toBeTruthy()
  })

  it('shows the honest empty state when the server has no engagements', async () => {
    stubApi([])
    ui(<RealPortfolio />)
    expect(await screen.findByText('No engagements yet')).toBeTruthy()
    expect(screen.getByText(/Create the first engagement/)).toBeTruthy()
  })
})

// The dialog renders a full project form against a stubbed API; under a parallel suite run it exceeds the 5s default.
describe('RealProjectCreateDialog', { timeout: 15000 }, () => {
  const openCreate = () => { showCreateProject(); return ui(<RealProjectCreateDialog />) }
  it('auto-derives the workspace slug and requires the authorization confirmation', async () => {
    stubApi()
    openCreate()
    const user = userEvent.setup()
    await user.type(await screen.findByPlaceholderText('e.g. Q1 External Assessment'), 'Q1 External Assessment')
    expect(screen.getByPlaceholderText('q1-external-assessment')).toHaveValue('q1-external-assessment')
    await user.type(screen.getByPlaceholderText('https://target.example.test or 10.20.0.0/24'), 'https://target.example.test')
    await user.type(screen.getByPlaceholderText(/Business context, known constraints/), 'Authorized external assessment of the public surface with a documented scope.')
    expect(screen.getByRole('button', { name: /Create Engagement/ })).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: /Create Engagement/ })).toBeEnabled()
  })

  it('surfaces the server slug rule inline', async () => {
    stubApi()
    openCreate()
    const user = userEvent.setup()
    await user.type(await screen.findByPlaceholderText('e.g. Q1 External Assessment'), 'Q1')
    expect(screen.getAllByText(/3-63 lowercase letters/).length).toBeGreaterThan(0)
  })

  it('POSTs exactly the contract fields and navigates to the created engagement', async () => {
    const fetchMock = stubApi()
    openCreate()
    const user = userEvent.setup()
    await user.type(await screen.findByPlaceholderText('e.g. Q1 External Assessment'), 'Q1 External Assessment')
    await user.type(screen.getByPlaceholderText('https://target.example.test or 10.20.0.0/24'), 'https://target.example.test')
    await user.type(screen.getByPlaceholderText(/Business context, known constraints/), 'Authorized external assessment of the public surface with a documented scope.')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /Create Engagement/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/engagements', expect.objectContaining({ method: 'POST' })))
    const init = (fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/api/engagements') && (c[1] as RequestInit).method === 'POST')?.[1] ?? {}) as RequestInit
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toEqual({
      name: 'q1-external-assessment',
      displayName: 'Q1 External Assessment',
      targetType: 'web_url',
      targetValue: 'https://target.example.test',
      authorizationConfirmed: true,
      brief: 'Authorized external assessment of the public surface with a documented scope.',
    })
    // The planner starts in the project's own AI Workspace tab, not the global workspace route.
    await waitFor(() => expect(globalThis.location.hash).toMatch(/^#\/project\/[^?]+\?tab=ai-workspace$/))
  })
})

describe('project creation popup', () => {
  it('opens over the current page and never renders a separate create page', async () => {
    stubApi()
    go('projects')
    ui(<RealProjectCreateDialog />)
    expect(screen.queryByRole('dialog')).toBeNull()
    showCreateProject()
    expect(await screen.findByRole('dialog', { name: 'New project' })).toBeTruthy()
    expect(globalThis.location.hash).toContain('#/projects')
    useCreateProjectDialog.getState().hide()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('redirects the old #/project-new link to the project list with the popup open', async () => {
    stubApi()
    ui(<><RealProjectNewRoute /><RealProjectCreateDialog /></>)
    expect(await screen.findByRole('dialog', { name: 'New project' })).toBeTruthy()
    expect(useCreateProjectDialog.getState().open).toBe(true)
    expect(globalThis.location.hash).toContain('#/projects')
    useCreateProjectDialog.getState().hide()
  })
})

describe('RealProjectDetail', () => {
  it('restores the requested tab from a project deep link', async () => {
    stubApi()
    go('project', { id: 'eng-8f3c92a1', tab: 'reports' })
    ui(<RealProjectDetail />)
    expect((await screen.findAllByText(/Could not load reports/)).length).toBeGreaterThan(0)
    expect(globalThis.location.hash).toContain('tab=reports')
  })

  it('renders the server identity explicitly and honest unavailability when a tab data source is absent', async () => {
    stubApi()
    go('project', { id: 'eng-8f3c92a1' })
    ui(<RealProjectDetail />)
    await screen.findAllByText('Q1 External Assessment')
    expect(screen.getAllByText('eng-8f3c92a1').length).toBeGreaterThan(0)
    // Reports is integrated since ticket 11; with no report-records source the
    // panel still renders an honest unavailable alert, never demo data.
    go('project', { id: 'eng-8f3c92a1', tab: 'reports' })
    expect((await screen.findAllByText(/Could not load reports/)).length).toBeGreaterThan(0)
  })

  it('composes the onboarding order (Team, Scope & ROE, Planning) with the truthful handoff status', async () => {
    stubApi()
    go('project', { id: 'eng-8f3c92a1' })
    ui(<RealProjectDetail />)
    expect(await screen.findByText('Onboarding')).toBeTruthy()
    expect(screen.getByText(/invite the independent reviewer/)).toBeTruthy()
    expect(screen.getByText(/submit the scope revision and ROE/)).toBeTruthy()
    expect(screen.getByText(/confirm the planning handoff/)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toMatch(/not confirmed yet/)
    await userEvent.click(screen.getByRole('button', { name: /Open Team/ }))
    expect(globalThis.location.hash).toContain('tab=team')
  })

  it('shows the confirmed planning handoff in the onboarding card when the server reports one', async () => {
    stubApi([dto({ handoffConfirmedAt: '2026-10-14T09:00:00.000Z' })])
    go('project', { id: 'eng-8f3c92a1' })
    ui(<RealProjectDetail />)
    expect(await screen.findByText(/Planning handoff:/)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toMatch(/confirmed at/)
  })
})
