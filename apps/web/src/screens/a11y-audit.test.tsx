/**
 * Ticket 64: accessibility + state audit across the migrated screens.
 *
 * jsdom exposes no pixels or screen readers, so the audit asserts the
 * structural a11y contract on the real routes (the ticket-62/63 precedent):
 * menu triggers are focusable buttons whose menus open with ArrowDown and
 * close with Escape while focus returns to the trigger, accessible names
 * survive wrapping <label>s, route changes are announced once through a
 * single polite live region, and the shared toast region stays the only
 * other one. The screen-reader sweep of the real UI remains a recorded gap
 * (see the ticket's Evidence).
 */
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { createHashRouter, RouterProvider } from 'react-router'
import { mountServices } from '../test/helpers'
import { go } from '../router/navigate'
import { setActiveRouter } from '../router/active'
import { RouteHost } from '../router/host'

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

async function signIn() {
  const button = await screen.findByRole('button', { name: /Alex Morgan/ })
  await userEvent.click(button)
  if (landing !== undefined) window.location.hash = landing
}

afterEach(() => {
  cleanup()
  setActiveRouter(null)
  window.location.hash = ''
})

describe('menu keyboard operability on real routes (project detail)', () => {
  it('the project section buttons are real buttons: they take keyboard focus and Enter opens the section', async () => {
    mountApp('#/project/RT-2026-014')
    await signIn()
    const scope = await screen.findByRole('button', { name: 'Scope & ROE' })
    expect(scope.tagName).toBe('BUTTON')
    scope.focus()
    expect(scope).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(window.location.hash).toContain('tab=scope'))
  })
})

describe('menu keyboard operability on real routes (projects table)', () => {
  it('the row More-actions trigger is a focusable button and its menu is keyboard-operable', async () => {
    mountApp('#/projects')
    await signIn()
    await screen.findByRole('table', {}, { timeout: 5000 })
    const trigger = screen.getByLabelText('More actions for RT-2026-014')
    expect(trigger.tagName).toBe('BUTTON')
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    await screen.findByRole('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(screen.getAllByRole('menuitem')[0]).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

describe('accessible names on the real settings route', () => {
  it('Theme and Table-density segmented options keep their own names inside the wrapping labels', async () => {
    mountApp('#/overview')
    await signIn()
    await screen.findByRole('heading', { name: /system overview/i })
    act(() => { go('settings', { tab: 'notifications' }) })
    await screen.findByText('Notification preferences')
    const theme = screen.getByText('Theme').closest('label')!
    expect(theme.querySelector('button[aria-label="Light (default)"]')).not.toBeNull()
    expect(theme.querySelector('button[aria-label="Dark"]')).not.toBeNull()
    expect(theme.querySelector('button[aria-label="System"]')).not.toBeNull()
    const density = screen.getByText('Table density').closest('label')!
    expect(density.querySelector('button[aria-label="Comfortable"]')).not.toBeNull()
    expect(density.querySelector('button[aria-label="Compact"]')).not.toBeNull()
  })
})

describe('announcements and state (shell)', () => {
  it('announces each route change once through a single polite region and stays silent on same-page tab changes', async () => {
    mountApp('#/overview')
    await signIn()
    await screen.findByRole('heading', { name: /system overview/i })
    expect(screen.getAllByTestId('route-announcer')).toHaveLength(1)
    const announcer = screen.getByTestId('route-announcer')
    // Sign-in lands on the System Overview, so the first announcement names that route.
    expect(announcer).toHaveTextContent('Navigated to Overview')
    act(() => { go('projects') })
    await waitFor(() => expect(announcer).toHaveTextContent('Navigated to Projects'))
    act(() => { go('project', { id: 'RT-2026-014' }) })
    await waitFor(() => expect(announcer).toHaveTextContent('Navigated to Projects RT-2026-014'))
    // Same page + id (tab/filter change only): no second, duplicated output.
    act(() => { go('project', { id: 'RT-2026-014', tab: 'scope' }) })
    await screen.findByRole('button', { name: 'Scope & ROE' })
    expect(announcer.textContent).toBe('Navigated to Projects RT-2026-014')
  })

  it('keeps the shared toast region as one polite live region next to the route announcer', async () => {
    mountApp('#/overview')
    await signIn()
    await screen.findByRole('heading', { name: /system overview/i })
    // One announcer; the toast container is a single fixed polite region.
    // (The migrated notice center contributes its own status region — ticket 59.)
    expect(screen.getAllByTestId('route-announcer')).toHaveLength(1)
    const toasts = document.querySelectorAll('div[aria-live="polite"].fixed')
    expect(toasts).toHaveLength(1)
    expect(toasts[0].className).toContain('bottom-4')
  })
})
