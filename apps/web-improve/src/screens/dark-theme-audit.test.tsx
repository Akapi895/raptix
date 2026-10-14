/**
 * Ticket 63: dark-theme parity audit across the migrated route groups.
 *
 * jsdom renders no pixels, so parity is asserted structurally (the
 * ticket-62 precedent): the dark class lands on <html> through the shared
 * theme store, every migrated surface stays token-colored (a sweep fails on
 * any Tailwind palette shade that assumes a light backdrop unless it sits
 * inside a [data-paper] print simulation), the dashboard severity chart maps
 * to --c-* tokens only, the always-dark console accents are actually
 * registered as theme tokens, and toggle/persistence/reset stays coherent
 * across the header and settings consumers. The pixel-level light/dark
 * contrast sweep of the real UI remains a recorded gap (ticket Evidence).
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHashRouter, RouterProvider } from 'react-router'
import { mountServices } from '../test/helpers'
import { go } from '../router/navigate'
import { useThemeStore } from '../state/stores'
import { setActiveRouter } from '../router/active'
import { RouteHost } from '../router/host'

/* The token registry itself (css: false stubs CSS imports, so read the source;
   vitest runs with the app root as cwd). */
const themeCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

function mountApp(hash?: string) {
  if (hash !== undefined) window.location.hash = hash
  const router = createHashRouter([
    { path: '*', element: <RouteHost />, errorElement: <div />, hydrateFallbackElement: null },
  ])
  setActiveRouter(router)
  return mountServices(<RouterProvider router={router} />)
}

function signIn() {
  fireEvent.click(screen.getByRole('button', { name: /Alex Morgan/ }))
}

/* Palette shades are theme-independent in Tailwind: mid-tones like
   slate-500/amber-50 assume a light backdrop and stay unreadable on the dark
   panels. Token classes (--c-*) re-map per theme, so they are the only
   allowed colors outside the intentional fixed-light print simulations. */
const LIGHT_ASSUMING = /(?:text|bg|border)-(?:gray|slate|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/

function lightAssumingOutsidePaper() {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[class]'))
    .filter((el) => LIGHT_ASSUMING.test(el.getAttribute('class') || ''))
    .filter((el) => !el.closest('[data-paper]'))
    .map((el) => el.getAttribute('class'))
}

/* One representative surface per route group (router manifest slices). */
const SWEEP: { hash: string; see: () => Promise<unknown>; auth?: boolean }[] = [
  { hash: '#/command-center', see: () => screen.findByRole('heading', { name: /command center/i }) },
  { hash: '#/projects', see: () => screen.findByRole('table') },
  { hash: '#/project/RT-2026-014', see: () => screen.findByRole('tab', { name: 'Overview' }) },
  { hash: '#/operation/OP-014?tab=live', see: () => screen.findByRole('list', { name: 'Operation steps' }) },
  { hash: '#/agents', see: () => screen.findByRole('table') },
  { hash: '#/findings', see: () => screen.findByRole('table') },
  { hash: '#/report-preview/REP-014', see: () => screen.findByText('Table of contents') },
  { hash: '#/ai-operator', see: () => screen.findByText('All Projects view') },
  { hash: '#/c2', see: () => screen.findByRole('tablist') },
  { hash: '#/settings', see: () => screen.findByRole('tablist') },
  { hash: '#/scenarios', see: () => screen.findByRole('table'), auth: false },
]

afterEach(() => {
  cleanup()
  setActiveRouter(null)
  window.location.hash = ''
})

describe('dark-mode sweep (every route group)', () => {
  // Eleven full app mounts in one test: it sits at vitest's default 5s
  // per-test budget under full-suite parallel load (timed out on this box
  // even on the untouched base), so it gets its own larger budget. No
  // assertion is changed (ticket 64 audit-stability note).
  it('renders dark via the shared store with token colors only outside the print simulations', async () => {
    for (const s of SWEEP) {
      mountApp(s.hash)
      if (s.auth !== false) signIn()
      await s.see()
      act(() => { useThemeStore.getState().setTheme('dark') })
      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(lightAssumingOutsidePaper()).toEqual([])
      cleanup()
      setActiveRouter(null)
      window.location.hash = ''
    }
  }, 20000)
})

describe('print simulations (intentional fixed-light surfaces)', () => {
  it('marks the report preview paper and template thumbnails with data-paper', async () => {
    mountApp('#/report-preview/REP-014')
    signIn()
    await screen.findByText('Table of contents')
    act(() => { useThemeStore.getState().setTheme('dark') })
    const paper = document.querySelector('[data-paper]')!
    expect(paper.querySelector('section')!.className).toContain('bg-white')
    // The scan tolerates the paper itself and nothing else.
    const outside = lightAssumingOutsidePaper()
    expect(outside).toEqual([])
    // Template thumbnails carry the same marker (reports → Templates tab).
    act(() => { go('reports', { tab: 'templates' }) })
    const cards = await screen.findAllByLabelText(/View details for/)
    expect(cards.length).toBeGreaterThanOrEqual(1)
    expect(document.querySelectorAll('[data-paper]').length).toBeGreaterThanOrEqual(1)
    expect(lightAssumingOutsidePaper()).toEqual([])
  })
})

describe('charts and the always-dark console', () => {
  it('maps the dashboard severity chart to --c-* tokens with no hex colors', async () => {
    mountApp('#/command-center')
    signIn()
    await screen.findByRole('heading', { name: /command center/i })
    act(() => { useThemeStore.getState().setTheme('dark') })
    const high = screen.getByText('High').closest('li')!
    expect(high.firstElementChild!.getAttribute('style')).toContain('var(--c-orange)')
    const critical = screen.getByText('Critical').closest('li')!
    expect(critical.firstElementChild!.getAttribute('style')).toContain('var(--c-bad)')
    for (const el of document.body.querySelectorAll('[style]')) {
      expect(el.getAttribute('style')!).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/)
    }
  })

  it('keeps the operation dock fixed-dark and registers its accent tokens', async () => {
    mountApp('#/command-center')
    signIn()
    await screen.findByRole('heading', { name: /command center/i })
    act(() => { go('operation', { id: 'OP-014', tab: 'live' }) })
    await screen.findByRole('list', { name: 'Operation steps' })
    act(() => { useThemeStore.getState().setTheme('dark') })
    const dock = screen.getByRole('region', { name: 'Operation dock' })
    expect(dock.className).toContain('bg-console')
    expect(dock.className).toContain('text-console-fg')
    const log = dock.querySelector('[aria-label="Simulated operation event stream"]')!
    expect(log.querySelector('span.text-console-info')).not.toBeNull()
    for (const name of ['info', 'warn', 'bad']) {
      expect(themeCss).toMatch(new RegExp(`--c-console-${name}:\\s*#`))
      expect(themeCss).toMatch(new RegExp(`--color-console-${name}:\\s*var\\(--c-console-${name}\\)`))
    }
    expect(themeCss).toMatch(/--c-orange:\s*#/)
    expect(themeCss).toMatch(/--color-orange:\s*var\(--c-orange\)/)
    expect(themeCss).toMatch(/:root\.dark\s*\{[\s\S]*?--c-bg:/)
  })
})

describe('theme toggle, persistence and reset across consumers', () => {
  it('header and settings write the same store; provider remount restores light', async () => {
    mountApp('#/command-center')
    signIn()
    await screen.findByRole('heading', { name: /command center/i })
    // Header consumer (account menu segmented control).
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    const menu = screen.getByRole('menu')
    fireEvent.click(within(menu).getByRole('button', { name: 'Dark' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    fireEvent.click(document.querySelector('.fixed.inset-0.z-40')!)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    // The choice persists across navigation (single theme authority).
    act(() => { go('settings', { tab: 'notifications' }) })
    await screen.findByText('Notification preferences')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    // Settings consumer applies through the same store on save. (Ticket 64:
    // the Segmented buttons keep their own accessible names inside the
    // wrapping <label>, so the option is reachable by role + name.)
    const themeField = within(screen.getByText('Theme').closest('label')!)
    fireEvent.click(themeField.getByRole('button', { name: 'Light (default)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    // A fresh provider mount resets the theme to the light default.
    cleanup()
    setActiveRouter(null)
    window.location.hash = ''
    mountApp('#/command-center')
    signIn()
    await screen.findByRole('heading', { name: /command center/i })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
