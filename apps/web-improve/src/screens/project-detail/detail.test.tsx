/**
 * Project detail tests (ticket 20). The migrated shell reads one typed
 * canonical detail read through Query: overview readiness/completion/
 * eligibility reuse the dashboard's pure domain functions (pinned baseline),
 * direct detail URLs select the correct project and sync the switcher,
 * unknown and out-of-scope projects expose no record content, tab state and
 * old aliases survive back/forward, scope switches and the dirty guard, and
 * membership edits are permission-gated with reasons. Unmigrated secondary
 * panels keep rendering through the bridged legacy store (ticket 23 owns
 * their migration), including the viewer redaction banner.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHashRouter, RouterProvider } from 'react-router'
import { seed } from '../../data'
import { setActiveRouter } from '../../router/active'
import { StoreProvider, useServices, useStore, type Store } from '../../store'
import type { ActorRef } from '../../domain/service'
import { createConsoleServices, type ConsoleServices } from '../../domain/service-factory'
import { ConsoleProviders } from '../../state/query'
import { ProjectPage } from '../b-detail'
import { detailFor, projectDetailForScope } from './service'
import { aggregateFor } from '../dashboard/service'
import { readiness, completion, eligibility } from '../dashboard/domain'

afterEach(() => { cleanup(); vi.restoreAllMocks(); setActiveRouter(null); window.location.hash = '' })

const ALEX: ActorRef = { id: 'Alex Morgan', role: 'manager' }
const RILEY: ActorRef = { id: 'Riley Brooks', role: 'analyst' }

let lastView: { unmount(): void } | null = null

/** Mounts the detail page for a hash deep link inside the store + Query + a hash router. */
function mountProject(hash: string, opts: { me?: string; wire?: (svc: ConsoleServices) => void } = {}) {
  lastView?.unmount()
  window.location.hash = hash
  let store!: Store
  function StoreCapture() { store = useStore(); return null }
  const wired = new WeakSet<ConsoleServices>()
  const router = createHashRouter([
    // Wire capture lives inside the router element so tests can intercept
    // forScope before the detail read creates its scope-bound service.
    { path: '*', element: <><StoreCapture /><WireCapture ready={(svc) => { if (opts.wire && !wired.has(svc)) { wired.add(svc); opts.wire(svc) } }} /><ProjectPage /></>, errorElement: <div />, hydrateFallbackElement: null },
  ])
  // The detail page navigates through the store, which forwards to the active
  // data router — the same single-writer wiring the real App installs.
  setActiveRouter(router)
  const view = render(
    <StoreProvider>
      <ConsoleProviders>
        <RouterProvider router={router} />
      </ConsoleProviders>
    </StoreProvider>,
  )
  lastView = view
  const me = opts.me
  if (me && me !== 'Alex Morgan') act(() => { store.setMe(me) })
  return { view, store: () => store }
}

function WireCapture({ ready }: { ready: (svc: ConsoleServices) => void }) {
  ready(useServices())
  return null
}

describe('overview readiness/completion reuse the dashboard domain functions', () => {
  it('detailFor matches the dashboard projections verbatim and fails closed out of scope', () => {
    const d = detailFor(seed(), ALEX, 'RT-2026-014')!
    const ds = aggregateFor(seed(), ALEX, 'RT-2026-014')
    expect(d.readiness).toEqual(readiness(ds, 'RT-2026-014'))
    expect(d.completion).toEqual(completion(ds, 'RT-2026-014'))
    expect(d.eligibility).toEqual(eligibility(ds, 'RT-2026-014'))
    // An actor without membership gets no partial content.
    expect(detailFor(seed(), RILEY, 'RT-2026-015')).toBeUndefined()
    expect(detailFor(seed(), ALEX, 'RT-2026-999')).toBeUndefined()
  })

  it('the mounted overview renders the dashboard-pinned readiness/completion baseline', async () => {
    mountProject('#/project/RT-2026-014')
    expect(await screen.findByText('Internal Red Team Q4')).toBeInTheDocument()
    // Readiness: 5/6 gates met — agents 2/3 is the failing gate (dashboard baseline).
    expect(screen.getByText('5/6 ready. Can reach 100% before anything runs.')).toBeInTheDocument()
    expect(screen.getByText('ROE-014-v2 · approved')).toBeInTheDocument()
    expect(screen.getByText('2/3 connected')).toBeInTheDocument()
    // Completion rows: the pinned RT-2026-014 baseline.
    expect(screen.getByText('42% average')).toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.getByText('1 confirmed · 0 in review · 1 AI-suggested (unverified)')).toBeInTheDocument()
    expect(screen.getByText('2/5')).toBeInTheDocument()
  })

  it('the canonical read collapses foreign and unknown projects to not-found', async () => {
    const svc = createConsoleServices()
    const foreign = await projectDetailForScope(svc, RILEY, 'RT-2026-015').read({ actor: RILEY, projectId: 'RT-2026-015', corr: 'pd-f1' })
    expect(foreign).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    const unknown = await projectDetailForScope(svc, ALEX, 'RT-2026-999').read({ actor: ALEX, projectId: 'RT-2026-999', corr: 'pd-f2' })
    expect(unknown).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    const mine = await projectDetailForScope(svc, ALEX, 'RT-2026-014').read({ actor: ALEX, projectId: 'RT-2026-014', corr: 'pd-f3' })
    expect(mine.ok && mine.data.project.id).toBe('RT-2026-014')
    svc.dispose()
  })
})

describe('deep links and blocked states', () => {
  it('a direct detail URL selects the correct project, tab and switcher scope', async () => {
    const h = mountProject('#/project/RT-2026-015?tab=operations')
    expect(await screen.findByText('Cloud Security Assessment')).toBeInTheDocument()
    expect(await screen.findByText('OP-015')).toBeInTheDocument()
    expect(screen.queryByText('OP-014')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Operations/ })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(h.store().pid).toBe('RT-2026-015'))
  })

  it('a project outside the actor scope and an unknown id expose no record content', async () => {
    mountProject('#/project/RT-2026-015', { me: 'Riley Brooks' })
    expect(await screen.findByText('Project not found')).toBeInTheDocument()
    expect(screen.queryByText('Cloud Security Assessment')).not.toBeInTheDocument()
    expect(screen.queryByText('Fabrikam Cloud (Demo)')).not.toBeInTheDocument()
    expect(screen.queryByText('Sam Patel')).not.toBeInTheDocument()
    expect(screen.queryByText('ROE-015-v1')).not.toBeInTheDocument()

    mountProject('#/project/RT-2026-999')
    expect(await screen.findByText(/does not exist or is not in the list you can view/)).toBeInTheDocument()
    expect(screen.queryByText('Internal Red Team Q4')).not.toBeInTheDocument()
  })

  it('a transient read failure offers retry instead of the blocked state', async () => {
    let fail = true
    mountProject('#/project/RT-2026-014', {
      wire: (svc) => {
        const orig = svc.forScope.bind(svc)
        vi.spyOn(svc, 'forScope').mockImplementation((actor, project) => {
          const ps = orig(actor, project)
          return { ...ps, get: async (...args) => (fail ? { ok: false as const, failure: { kind: 'unavailable' as const, message: 'The console service is temporarily unavailable.' } } : ps.get(...args)) }
        })
      },
    })
    expect(await screen.findByText('The project detail could not be loaded')).toBeInTheDocument()
    expect(screen.getByText('The console service is temporarily unavailable.')).toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Internal Red Team Q4')).toBeInTheDocument()
  })

  it('entering a detail URL with the switcher on all reads once and keeps the page mounted', async () => {
    let reads = 0
    mountProject('#/project/RT-2026-014', {
      wire: (svc) => {
        const orig = svc.forScope.bind(svc)
        vi.spyOn(svc, 'forScope').mockImplementation((actor, project) => {
          const ps = orig(actor, project)
          return { ...ps, get: (...args) => { reads++; return ps.get(...args) } }
        })
      },
    })
    expect(await screen.findByText('Internal Red Team Q4')).toBeInTheDocument()
    expect(screen.getByText('5/6 ready. Can reach 100% before anything runs.')).toBeInTheDocument()
    // The guarded setPid flash used to unmount this page mid-read (the shell
    // swaps children while loading), dropping the fetched detail (gcTime 0)
    // and refetching after the 450ms loading timer — twice the reads and a
    // race with the URL's own render. The raw selection write must not.
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    expect(reads).toBe(1)
  })
})

describe('tab state, aliases and guards', () => {
  it('tab selection survives back/forward through the router', async () => {
    mountProject('#/project/RT-2026-014')
    await screen.findByText('Internal Red Team Q4')
    fireEvent.click(screen.getByRole('tab', { name: /Findings/ }))
    await waitFor(() => expect(window.location.hash).toContain('tab=findings'))
    expect(screen.getByRole('tab', { name: /Findings/ })).toHaveAttribute('aria-selected', 'true')
    act(() => { window.history.back() })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true'))
    act(() => { window.history.forward() })
    await waitFor(() => expect(screen.getByRole('tab', { name: /Findings/ })).toHaveAttribute('aria-selected', 'true'))
  })

  it('old tab aliases resolve to their canonical panels', async () => {
    mountProject('#/project/RT-2026-014?tab=members')
    await screen.findByText('Internal Red Team Q4')
    expect(await screen.findByText(/Approval requests \(\d+\)/)).toBeInTheDocument()

    mountProject('#/project/RT-2026-014?tab=roe')
    await screen.findByText('Internal Red Team Q4')
    expect(await screen.findByText('Effective version')).toBeInTheDocument()
  })

  it('switching scope projects preserves the tab and selects the new project', async () => {
    const h = mountProject('#/project/RT-2026-014?tab=findings')
    await screen.findByText('Internal Red Team Q4')
    act(() => { h.store().setPid('RT-2026-016') })
    expect(await screen.findByText('Retail Perimeter Review')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Findings/ })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('No findings yet')).toBeInTheDocument()
    expect(screen.queryByText('Internal Red Team Q4')).not.toBeInTheDocument()
  })

  it('a dirty form holds tab navigation behind the unsaved-changes guard', async () => {
    const h = mountProject('#/project/RT-2026-014')
    await screen.findByText('Internal Red Team Q4')
    act(() => { h.store().setDirty(true) })
    fireEvent.click(screen.getByRole('tab', { name: /Operations/ }))
    expect(h.store().unsaved).not.toBeNull()
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    act(() => { h.store().unsaved!.next() })
    expect(await screen.findByRole('tab', { name: /Operations/ })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('scope and team panels on the typed read', () => {
  it('scope metadata renders from the canonical slices', async () => {
    mountProject('#/project/RT-2026-014?tab=scope')
    await screen.findByText('Internal Red Team Q4')
    expect(await screen.findByText('Effective version')).toBeInTheDocument()
    expect(screen.getAllByText('ROE-014-v2').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Robin Vale — +1 (555) 010-0014').length).toBeGreaterThan(0)
  })

  it('membership edits are permission-gated with reasons for a member without the role', async () => {
    mountProject('#/project/RT-2026-014?tab=team', { me: 'Riley Brooks' })
    await screen.findByText('Internal Red Team Q4')
    const why = 'Only a Red Team Manager or Organization Admin can manage members.'
    expect(screen.getAllByText(why).length).toBeGreaterThan(0)
    const add = screen.getByRole('button', { name: 'Add Member' })
    expect(add).toBeDisabled()
    expect(add).toHaveAttribute('title', why)
    expect(screen.queryByLabelText('Role of Taylor Chen')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Remove Taylor Chen')).toBeDisabled()
  })

  it('a manager can change a member role and the canonical project updates', async () => {
    const h = mountProject('#/project/RT-2026-014?tab=team')
    await screen.findByText('Internal Red Team Q4')
    fireEvent.change(screen.getByLabelText('Role of Taylor Chen'), { target: { value: 'reviewer' } })
    await waitFor(() => {
      const member = h.store().db.projects.find((p) => p.id === 'RT-2026-014')!.members.find((m) => m.user === 'Taylor Chen')
      expect(member?.role).toBe('reviewer')
    })
  })
})

describe('unmigrated panels keep working through the bridge', () => {
  it('operations and audit tabs render their bridged legacy tables', async () => {
    mountProject('#/project/RT-2026-014?tab=audit')
    await screen.findByText('Internal Red Team Q4')
    expect(await screen.findByText(/Immutable log for RT-2026-014/)).toBeInTheDocument()
    expect(screen.getByText('Blocked tool call')).toBeInTheDocument()

    mountProject('#/project/RT-2026-014?tab=operations')
    expect(await screen.findByText('2 operations in RT-2026-014')).toBeInTheDocument()
    expect(screen.getByText('OP-014')).toBeInTheDocument()
  })

  it('the viewer redaction path still renders (fixed conditional-hook site)', async () => {
    mountProject('#/project/RT-2026-014?tab=evidence', { me: 'Casey Nguyen (Client)' })
    await screen.findByText('Internal Red Team Q4')
    expect(await screen.findByText('Sensitive content is redacted')).toBeInTheDocument()
    expect(screen.getByText('Redacted (sensitive)')).toBeInTheDocument()
    expect(screen.queryByText('evidence-027.png')).not.toBeInTheDocument()
  })
})
