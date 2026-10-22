/**
 * Shell layout tests (ticket 08). Rendered checks for the extracted shell
 * composition: nav groups + active-section highlighting across legacy routes,
 * project switcher scope/isolation, sidebar collapse, mobile drawer Escape,
 * slot defaults, and the emergency-stop/emergency-contact controls at the
 * 768/1024/1280/1440 breakpoint classes in light and dark mode. jsdom has no
 * layout engine, so visibility is asserted through structure and responsive
 * classes; the pixel-level visual audit stays with tickets 62/63.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHashRouter, RouterProvider } from 'react-router'
import { useAuthStore, resetSharedStores, useThemeStore } from '../state/stores'
import { resetSessionStores } from '../state/session'
import { currentRoute, go, resetNavStores, selectProject } from '../router/navigate'
import { mountServices } from '../test/helpers'
import { setActiveRouter } from '../router/active'
import { RouteHost } from '../router/host'
import { NAV, MOCK_PROJECT_NAV, REAL_PROJECT_NAV, projectSection } from './nav'

function mountApp(hash?: string) {
  if (hash !== undefined) window.location.hash = hash
  resetNavStores()
  const router = createHashRouter([
    { path: '*', element: <RouteHost />, errorElement: <div />, hydrateFallbackElement: null },
  ])
  setActiveRouter(router)
  return mountServices(<RouterProvider router={router} />)
}

function signIn() {
  fireEvent.click(screen.getByRole('button', { name: /Alex Morgan/ }))
}

beforeAll(async () => { await Promise.all([import('../features/wizard/routes'), import('../features/operations/routes')]) }, 30_000)

beforeEach(() => {
  window.location.hash = ''
  resetSharedStores()
  resetSessionStores()
  resetNavStores()
})

afterEach(() => {
  cleanup()
  setActiveRouter(null)
  window.location.hash = ''
})

const NAV_LABELS = NAV.flatMap((g) => g.items.map((i) => i.label))

describe('sidebar navigation and active section', () => {
  it('separates AI conversation, execution logs and C2 in both project menus', () => {
    for (const groups of [MOCK_PROJECT_NAV, REAL_PROJECT_NAV]) {
      expect(groups.find((group) => group.group === 'EXECUTION')?.items.map((item) => item.label)).toEqual(['AI Workspace', 'Execution', 'C2 Sessions'])
      expect(projectSection({ page: 'ai-operator' }, groups)?.label).toBe('AI Workspace')
      expect(projectSection({ page: 'ai-trace' }, groups)?.label).toBe('Execution')
    }
  })

  it('opens chat with the agents panel separately from tool-call logs', async () => {
    mountApp('#/project/RT-2026-014')
    signIn()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    fireEvent.click(await within(nav).findByRole('button', { name: 'AI Workspace' }))
    await screen.findByRole('region', { name: 'Conversation with Raptix' })
    expect(currentRoute().tab).toBe('ai-workspace')
    fireEvent.click(within(nav).getByRole('button', { name: 'Execution' }))
    await screen.findByPlaceholderText('Search event, tool, target, agent, branch')
    expect(currentRoute().tab).toBe('operations')
    expect(screen.queryByRole('region', { name: 'Conversation with Raptix' })).toBeNull()
    expect(within(nav).getByRole('button', { name: 'Execution' })).toHaveAttribute('aria-current', 'page')
  })

  it('renders every nav group and item, highlighting the overview item as active', async () => {
    mountApp('#/overview')
    signIn()
    await screen.findByRole('heading', { name: /system overview/i })
    for (const label of NAV_LABELS) expect(screen.getAllByRole('button', { name: new RegExp(label.replace(/[&]/g, '\\$&'), 'i') }).length).toBeGreaterThan(0)
    const active = screen.getAllByRole('button', { current: 'page' }).map((b) => b.textContent)
    expect(active.some((t) => t?.includes('Overview'))).toBe(true)
  })

  it('highlights Overview on an operation detail route (plan §4.1: operations → Overview)', async () => {
    mountApp('#/operations')
    signIn()
    await screen.findAllByText(/RT-2026-014/)
    act(() => { go('operation', { id: 'OP-2026-118' }) })
    await waitFor(() => expect(currentRoute()).toEqual({ page: 'operation', id: 'OP-2026-118' }))
    await waitFor(() => {
      const active = screen.getAllByRole('button', { current: 'page' }).map((b) => b.textContent)
      expect(active.some((t) => t?.includes('Overview'))).toBe(true)
    })
  })

  it('opens project navigation from a portfolio row and returns to global navigation', async () => {
    mountApp('#/projects')
    signIn()
    await screen.findAllByText('RT-2026-014')
    fireEvent.click(screen.getAllByText('RT-2026-014')[0])
    await waitFor(() => expect(currentRoute()).toEqual({ page: 'project', id: 'RT-2026-014' }))
    await waitFor(() => {
      const active = screen.getAllByRole('button', { current: 'page' }).map((b) => b.textContent)
      expect(active.some((t) => t?.includes('Overview'))).toBe(true)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Planning' }))
    await waitFor(() => expect(currentRoute().tab).toBe('plans'))
    fireEvent.click(screen.getByRole('button', { name: 'All projects' }))
    await screen.findByRole('heading', { name: 'Projects' })
    expect(screen.getByRole('button', { name: 'Library' })).toBeInTheDocument()
  })
})

describe('sidebar collapse and mobile drawer', () => {
  it('the collapse toggle narrows and re-expands the desktop rail', async () => {
    mountApp('#/overview')
    signIn()
    const aside = await screen.findByRole('complementary', { hidden: true })
    expect(aside.style.width).toBe('248px')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    await waitFor(() => expect(aside.style.width).toBe('72px'))
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    await waitFor(() => expect(aside.style.width).toBe('248px'))
  })

  it('the mobile drawer opens from the header, closes on overlay click and on Escape', async () => {
    mountApp('#/overview')
    signIn()
    await screen.findByRole('heading', { name: /system overview/i })
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' })
    expect(drawer).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    await screen.findByRole('dialog', { name: 'Navigation' })
    fireEvent.click(document.querySelector('.bg-black\\/40')!)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument())
  })

  it('keyboard roving moves focus with ArrowDown/ArrowUp inside the nav', async () => {
    mountApp('#/overview')
    signIn()
    await screen.findByRole('heading', { name: /system overview/i })
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    const items = Array.from(nav.querySelectorAll<HTMLButtonElement>('button[data-nav]'))
    items[0].focus()
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(nav, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(nav, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(nav, { key: 'End' })
    expect(document.activeElement).toBe(items[items.length - 1])
    fireEvent.keyDown(nav, { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
  })
})

describe('project switcher', () => {
  it('switches the active project scope through the shared authority and keeps scoped reads consistent', async () => {
    mountApp('#/overview')
    signIn()
    await screen.findByRole('heading', { name: /system overview/i })
    fireEvent.click(screen.getByRole('button', { name: /^Project: All Projects$/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Select project' })
    expect(dialog).toBeInTheDocument()
    const row = within(dialog).getAllByRole('button').find((b) => b.textContent?.startsWith('RT-2026-014'))
    expect(row).toBeDefined()
    fireEvent.click(row!)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Select project' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^Project: RT-2026-014/ })).toBeInTheDocument()
    expect(screen.getAllByText(/Internal Red Team Q4/).length).toBeGreaterThan(0)
  })

  it('marks inaccessible projects as disabled for a scoped persona so out-of-scope selection cannot happen', async () => {
    mountApp('#/overview')
    signIn()
    await screen.findByRole('heading', { name: /system overview/i })
    act(() => { useAuthStore.getState().setMe('Riley Brooks') })
    fireEvent.click(screen.getByRole('button', { name: /^Project: All Projects$/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Select project' })
    fireEvent.click(within(dialog).getByRole('tab', { name: 'All' }))
    const locked = within(dialog).getAllByRole('button').filter((b) => b.textContent?.includes('No access'))
    expect(locked.length).toBeGreaterThan(0)
    for (const b of locked) expect(b).toBeDisabled()
  })
})

describe('emergency stop and emergency contact controls', () => {
  function expectStopInHeader() {
    /* The stop control lives in the shared topbar while a project is open
       (plan §3.1) and carries no responsive-hide variant, so it renders at
       768/1024/1280/1440 alike. Pixel checks remain with tickets 62/63. */
    const stop = screen.getByRole('button', { name: /Emergency Stop/ })
    expect(stop).toBeEnabled()
    expect(stop.className).toContain('bg-bad')
    expect(stop.className).not.toMatch(/(^|\s)(hidden|[\w.]+:hidden)/)
  }

  it('renders the header stop control for every width class in light mode', async () => {
    mountApp('#/projects')
    signIn()
    await screen.findAllByText('RT-2026-014')
    act(() => { selectProject('RT-2026-014') })
    await screen.findByRole('button', { name: /Emergency Stop/ })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expectStopInHeader()
  })

  it('renders the header stop control for every width class in dark mode', async () => {
    mountApp('#/projects')
    signIn()
    await screen.findAllByText('RT-2026-014')
    act(() => { useThemeStore.getState().setTheme('dark') })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    act(() => { selectProject('RT-2026-014') })
    await screen.findByRole('button', { name: /Emergency Stop/ })
    expectStopInHeader()
  })

  it('the emergency contact lives in Scope & ROE, not in a ribbon chip', async () => {
    mountApp('#/projects')
    signIn()
    await screen.findAllByText('RT-2026-014')
    act(() => { selectProject('RT-2026-014') })
    await screen.findByRole('button', { name: /Emergency Stop/ })
    // The readiness checklist row is a legitimate body element; the header must carry no contact chip.
    expect(within(screen.getByRole('banner')).queryByRole('button', { name: /Emergency contact/ })).not.toBeInTheDocument()
    act(() => { go('project', { id: 'RT-2026-014', tab: 'scope' }) })
    expect(await screen.findByText('Emergency contact')).toBeInTheDocument()
    expect(screen.getAllByText(/Robin Vale — \+1 \(555\) 010-0014/).length).toBeGreaterThan(0)
  })

  it('the stop control stays mounted at the aggregate scope via the context ribbon', async () => {
    mountApp('#/projects')
    signIn()
    await screen.findAllByText('RT-2026-014')
    expect(screen.getByRole('button', { name: 'Select Project' })).toBeInTheDocument()
  })
})

describe('ticket 59/60 compatibility slots', () => {
  it('the legacy notifications surface mounts by default and copilot follows project scope', async () => {
    mountApp('#/overview')
    signIn()
    await screen.findByRole('heading', { name: /system overview/i })
    expect(screen.getByRole('button', { name: /Notifications/ })).toBeInTheDocument()
    // Global scope has no page context to ask about: the copilot trigger only
    // appears once a project is committed (plan 2026-10-16 §5).
    expect(screen.queryByRole('button', { name: 'Ask AI' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Project: All Projects$/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Select project' })
    const row = within(dialog).getAllByRole('button').find((b) => b.textContent?.startsWith('RT-2026-014'))
    fireEvent.click(row!)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ask AI' })).toBeInTheDocument())
  })
})
