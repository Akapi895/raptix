/**
 * Ticket 62: responsive coverage audit across the migrated route groups.
 *
 * jsdom has no layout engine, so the 768/1024/1280/1440 behavior is asserted
 * structurally (the ticket-08 precedent): the responsive classes that
 * implement each breakpoint stay on the migrated surfaces, critical controls
 * carry no responsive-hide variants, overflow containers keep horizontal
 * scrolling instead of clipping, and overlay surfaces stay inside the
 * viewport. The pixel-level width/light-dark sweep of the real UI remains a
 * recorded gap (see the ticket's Evidence).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createHashRouter, RouterProvider } from 'react-router'
import { mountServices } from '../test/helpers'
import { go, selectProject } from '../router/navigate'
import { setActiveRouter } from '../router/active'
import { RouteHost } from '../router/host'
import { DTable } from '../ui/d-shared'

/** The route the test wants after sign-in; sign-in itself lands on the System Overview. */
let landing: string | undefined

function mountApp(hash?: string) {
  landing = hash
  if (hash !== undefined) window.location.hash = hash
  const router = createHashRouter([
    { path: '*', element: <RouteHost />, errorElement: <div />, hydrateFallbackElement: null },
  ])
  setActiveRouter(router)
  return mountServices(<RouterProvider router={router} />)
}

function signIn() {
  fireEvent.click(screen.getByRole('button', { name: /Alex Morgan/ }))
  if (landing !== undefined) window.location.hash = landing
}


afterEach(() => {
  cleanup()
  setActiveRouter(null)
  window.location.hash = ''
})

describe('shell chrome (every route group)', () => {
  it('keeps the 768/1024/1280/1440 breakpoint classes on the sidebar, header and overlay surfaces', async () => {
    // The header Ask AI control lives on project routes, so the chrome is checked there.
    mountApp('#/project/RT-2026-014')
    signIn()
    await screen.findByRole('button', { name: 'Overview' })
    // Sidebar: desktop rail from lg, mobile drawer below lg.
    const rail = screen.getByRole('complementary')
    expect(rail.className).toContain('hidden')
    expect(rail.className).toContain('lg:flex')
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' })
    expect(drawer.parentElement!.className).toContain('lg:hidden')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument())
    // Header: hamburger below lg, full search only from md, workspace switcher from xl.
    expect(screen.getByRole('button', { name: 'Open menu' }).className).toContain('lg:hidden')
    expect(screen.getByRole('button', { name: 'Search (Ctrl+K)' }).className).toContain('max-md:hidden')
    expect(screen.getByRole('button', { name: 'Search' }).className).toContain('md:hidden')
    const ws = screen.getByRole('button', { name: /Workspace: Raptix Workspace/ })
    expect(ws.parentElement!.className).toContain('hidden')
    expect(ws.parentElement!.className).toContain('xl:block')
    // AI-mode chip, Ask AI and profile collapse to icons below xl / 1500px.
    const askAi = screen.getByRole('button', { name: 'Ask AI' })
    expect(askAi.className).toContain('max-xl:!px-3')
    expect(askAi.querySelector('span[class*="max-xl:hidden"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Account menu' }).querySelector('[class*="xl:block"]')).not.toBeNull()
    // Migrated overlays stay full-width under their breakpoint: copilot drawer and notices panel.
    fireEvent.click(askAi)
    const copilot = await screen.findByRole('dialog', { name: 'Ask AI' })
    expect(copilot.className).toContain('w-full')
    expect(copilot.className).toContain('max-w-[420px]')
    fireEvent.click(copilot.querySelector('button[aria-label="Close Ask AI"]')!)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ask AI' })).not.toBeInTheDocument())
    fireEvent.click(screen.getByTestId('notice-bell'))
    const panel = await screen.findByTestId('notice-panel')
    expect(panel.className).toContain('fixed')
    expect(panel.className).toContain('sm:absolute')
    expect(panel.className).toContain('sm:w-[420px]')
  })
})

describe('shared table contract (projects group)', () => {
  it('keeps container scroll and the column hide classes on the portfolio table', async () => {
    mountApp('#/projects')
    signIn()
    const table = await screen.findByRole('table')
    expect(table.parentElement!.className).toContain('overflow-x-auto')
    expect(table.className).toContain('min-w-[640px]')
    expect(screen.queryByRole('columnheader', { name: 'Client' })).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Updated' }).className).toContain('max-md:hidden')
  })
})

describe('project detail (projects group)', () => {
  it('keeps the project section buttons and the critical header controls visible', async () => {
    mountApp('#/project/RT-2026-014')
    signIn()
    await screen.findByRole('button', { name: 'Overview' })
    for (const name of ['Scope & ROE', 'Findings', 'Reports']) expect(screen.getByRole('button', { name })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Emergency Stop' }).className).not.toMatch(/(^|\s)hidden(\s|$)/)
    expect(screen.getByRole('button', { name: 'Ask AI' }).className).not.toMatch(/(^|\s)hidden(\s|$)/)
  })

  it('keeps the team members table on container scroll and the shared DTable on sticky-first-column container scroll', async () => {
    mountApp('#/project/RT-2026-014?tab=team')
    signIn()
    const table = await screen.findByRole('table')
    expect(table.parentElement!.className).toContain('overflow-x-auto')
    expect(screen.getByRole('columnheader', { name: 'Permissions' }).className).toContain('max-md:hidden')
    // DTable is shared by the agents/assets screens (API-backed there), so its
    // scroll contract is asserted on the component directly.
    render(
      <DTable
        rowKey={(x: string) => x}
        rows={['RT-2026-014']}
        cols={[
          { key: 'id', header: 'ID', render: (x) => x },
          { key: 'perm', header: 'Permissions', render: () => 'View, execute', hideBelow: 'md' },
        ]}
      />,
    )
    const dt = screen.getAllByRole('table').find((t) => t.className.includes('min-w-[720px]'))!
    expect(dt.parentElement!.className).toContain('max-h-[62vh]')
    expect(dt.parentElement!.className).toContain('overflow-auto')
    const firstTh = dt.querySelector('thead th')!
    expect(firstTh.className).toContain('sticky')
    expect(firstTh.className).toContain('left-0')
    expect(dt.querySelectorAll('thead th')[1]!.className).toContain('max-md:hidden')
  })
})

describe('project wizard (planning group)', () => {
  it('keeps the step rail horizontally scrollable and collapses the form grids to one column below md/xl', async () => {
    mountApp('#/project-new')
    signIn()
    await screen.findByLabelText(/Project Name/)
    expect(screen.getByLabelText('Project creation steps').className).toContain('overflow-x-auto')
    expect(document.querySelector('main [class*="md:grid-cols-2"]')).not.toBeNull()
    expect(document.querySelector('main [class*="xl:grid-cols-[minmax(0,1fr)_320px]"]')).not.toBeNull()
  })
})

describe('operation live workspace (operations group)', () => {
  it('uses the wide layout, collapse-at-xl panes and wrapped strips; the dock scrolls its console', async () => {
    mountApp('#/overview')
    signIn()
    await screen.findByRole('heading', { name: /system overview/i })
    act(() => { go('operation', { id: 'OP-014', tab: 'live' }) })
    const steps = await screen.findByRole('list', { name: 'Operation steps' })
    for (const cls of ['grid-cols-2', 'sm:grid-cols-3', 'lg:grid-cols-4', '2xl:grid-cols-6']) expect(steps.className).toContain(cls)
    const main = document.getElementById('main')!
    expect(main).toHaveAttribute('data-wide')
    expect(main.className).toContain('p-0')
    const workspace = screen.getByRole('complementary', { name: 'AI Copilot' }).parentElement!
    expect(workspace.className).toContain('grid-cols-1')
    expect(workspace.className).toContain('xl:grid-cols-[minmax(0,1fr)_340px]')
    expect(document.querySelector('[aria-label="Health strip"]')!.className).toContain('flex-wrap')
    expect(screen.getByRole('region', { name: 'Operation dock' }).querySelector('[role="log"]')!.className).toContain('overflow-auto')
  })
})

describe('AI operator workspace (AI group)', () => {
  it('falls back to drawers for the rail and inspector below 1280 and keeps panes min-w-0', async () => {
    // A conversation pane exists only for an open conversation; CV-014-03 belongs to the project RT-2026-014.
    mountApp('#/ai-operator/CV-014-03')
    signIn()
    act(() => { selectProject('RT-2026-014') })
    act(() => { window.location.hash = '#/ai-operator/CV-014-03' })
    await waitFor(() => expect(document.querySelector('[aria-label="Conversation"]')).not.toBeNull())
    expect(document.querySelector('[aria-label="Conversation"]')!.className).toContain('min-w-0')
    fireEvent.click(screen.getByRole('button', { name: 'Conversations' }))
    const rail = await screen.findByRole('dialog', { name: 'Conversations & plans' })
    expect(rail.className).toContain('w-full')
    expect(rail.style.maxWidth).toBe('380px')
    fireEvent.click(rail.querySelector('button[aria-label="Close"]')!)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Conversations & plans' })).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Show Context' }))
    const insp = await screen.findByRole('dialog', { name: 'Context inspector' })
    expect(insp.style.maxWidth).toBe('460px')
  })
})

describe('findings, C2, reports and settings (their groups)', () => {
  it('findings: the all-projects stat cards step down by breakpoint and the filters stay in one panel', async () => {
    mountApp('#/findings')
    signIn()
    await screen.findByRole('list', { name: 'Findings' })
    const stats = screen.getByRole('button', { name: /^Total findings/ }).parentElement!
    expect(stats.className).toContain('grid-cols-2')
    expect(stats.className).toContain('xl:grid-cols-6')
    expect(screen.getByLabelText('Project')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeTruthy()
  })

  it('c2: collapses the infrastructure KPI strip to two columns below lg', async () => {
    mountApp('#/c2')
    signIn()
    await screen.findByRole('tablist')
    const strip = document.querySelector('[class*="grid-cols-2"][class*="lg:grid-cols-4"]')!
    expect(strip.className).toContain('grid-cols-2')
  })

  it('settings: scrolls the ten-tab bar and keeps the permission matrix on container scroll', async () => {
    mountApp('#/settings')
    signIn()
    const tabs = await screen.findByRole('tablist')
    expect(tabs.className).toContain('overflow-x-auto')
    fireEvent.click(screen.getByRole('tab', { name: 'Users & roles' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Roles & permissions' }))
    await screen.findByText('Legend:')
    const table = screen.getByRole('table')
    expect(table.parentElement!.className).toContain('overflow-x-auto')
    expect(table.className).toContain('min-w-[860px]')
  })
})

describe('demo surfaces (scenarios group, outside the shell)', () => {
  it('keeps the wide scenario matrix on container scroll', async () => {
    mountApp('#/scenarios')
    const table = await screen.findByRole('table')
    expect(table.parentElement!.className).toContain('overflow-x-auto')
    expect(table.className).toContain('min-w-[920px]')
  })
})
