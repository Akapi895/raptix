/**
 * Project detail tests (ticket 20). The migrated shell reads one typed
 * canonical detail read through Query: overview readiness/completion/
 * eligibility reuse the dashboard's pure domain functions (pinned baseline),
 * direct detail URLs select the correct project and sync the switcher,
 * unknown and out-of-scope projects expose no record content, tab state and
 * old aliases survive back/forward, scope switches and the dirty guard, and
 * membership edits are permission-gated with reasons. Ticket 23: every
 * secondary panel renders the same typed read — the service's project-
 * narrowed slices and derived closure checklist — deep links resolve to the
 * canonical feature routes, a legacy mutation reaches the panels through the
 * change bridge, and the shell files contain no legacy database reader
 * (source assertion), including the viewer redaction banner.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHashRouter, RouterProvider } from 'react-router'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { seed } from '../../data'
import { setActiveRouter } from '../../router/active'
import type { ActorRef } from '../../domain/service'
import { createConsoleServices, type ConsoleServices } from '../../domain/service-factory'
import { resetSharedStores, useProjectStore } from '../../state/stores'
import { resetSessionStores, useSessionStore } from '../../state/session'
import { resetNavStores, go, selectProject } from '../../router/navigate'
import { Sidebar } from '../../shell/sidebar'
import { stamp } from '../../domain/demo-clock'
import { mountServices } from '../../test/helpers'
import { ProjectPage } from '../b-detail'
import { detailFor, projectDetailForScope } from './service'
import { aggregateFor } from '../dashboard/service'
import { readiness, completion, eligibility } from '../dashboard/domain'

afterEach(() => { cleanup(); vi.restoreAllMocks(); setActiveRouter(null); window.location.hash = '' })

beforeEach(() => {
  window.location.hash = ''
  resetSharedStores()
  resetSessionStores()
  resetNavStores()
})

const ALEX: ActorRef = { id: 'Alex Morgan', role: 'manager' }
const RILEY: ActorRef = { id: 'Riley Brooks', role: 'analyst' }

let lastView: { unmount(): void } | null = null

/** Mounts the detail page for a hash deep link inside Services + Query + a hash router. `withSidebar` mounts the real sidebar so nav clicks exercise the dirty guard. */
function mountProject(hash: string, opts: { me?: string; wire?: (svc: ConsoleServices) => void; withSidebar?: boolean } = {}) {
  lastView?.unmount()
  window.location.hash = hash
  resetNavStores()
  const router = createHashRouter([
    { path: '*', element: <>{opts.withSidebar && <Sidebar collapsed={false} setCollapsed={() => {}} mobileOpen={false} closeMobile={() => {}} />}<ProjectPage /></>, errorElement: <div />, hydrateFallbackElement: null },
  ])
  // The detail page navigates through the canonical navigate seam, which
  // forwards to the active data router — the same single-writer wiring the
  // real App installs. `wire` runs once at services capture, before the
  // detail read creates its scope-bound service.
  setActiveRouter(router)
  const h = mountServices(<RouterProvider router={router} />, opts.me, opts.wire)
  lastView = h
  return h
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
    mountProject('#/project/RT-2026-015?tab=operations')
    expect(await screen.findByText('Cloud Security Assessment')).toBeInTheDocument()
    expect(await screen.findByText('OP-015')).toBeInTheDocument()
    expect(screen.queryByText('OP-014')).not.toBeInTheDocument()
    expect(window.location.hash).toContain('tab=operations')
    await waitFor(() => expect(useProjectStore.getState().pid).toBe('RT-2026-015'))
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
    act(() => { go('project', { id: 'RT-2026-014', tab: 'findings' }) })
    await waitFor(() => expect(window.location.hash).toContain('tab=findings'))
    expect(screen.getByText('2 findings in RT-2026-014')).toBeInTheDocument()
    act(() => { window.history.back() })
    await waitFor(() => expect(window.location.hash).not.toContain('tab='))
    act(() => { window.history.forward() })
    await waitFor(() => expect(window.location.hash).toContain('tab=findings'))
    expect(screen.getByText('2 findings in RT-2026-014')).toBeInTheDocument()
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
    mountProject('#/project/RT-2026-014?tab=findings')
    await screen.findByText('Internal Red Team Q4')
    act(() => { selectProject('RT-2026-016') })
    expect(await screen.findByText('Retail Perimeter Review')).toBeInTheDocument()
    expect(window.location.hash).toContain('tab=findings')
    expect(await screen.findByText('No findings yet')).toBeInTheDocument()
    expect(screen.queryByText('Internal Red Team Q4')).not.toBeInTheDocument()
  })

  it('a dirty form holds sidebar navigation behind the unsaved-changes guard', async () => {
    mountProject('#/project/RT-2026-014', { withSidebar: true })
    await screen.findByText('Internal Red Team Q4')
    act(() => { useSessionStore.getState().setDirty(true) })
    fireEvent.click(screen.getByRole('button', { name: 'Execution' }))
    expect(useSessionStore.getState().unsaved).not.toBeNull()
    expect(window.location.hash).not.toContain('tab=')
    act(() => { useSessionStore.getState().unsaved!.next() })
    await waitFor(() => expect(window.location.hash).toContain('tab=operations'))
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
      const member = h.db().projects.find((p) => p.id === 'RT-2026-014')!.members.find((m) => m.user === 'Taylor Chen')
      expect(member?.role).toBe('reviewer')
    })
  })
})

describe('preparation workspace readers', () => {
  it('opens an asset in a centered dialog and closes without leaving Scope & ROE', async () => {
    mountProject('#/project/RT-2026-014?tab=scope')
    fireEvent.click(await screen.findByText('win-dc-01'))
    const dialog = await screen.findByRole('dialog', { name: 'Asset details' })
    expect(await within(dialog).findByText('AS-0143')).toBeInTheDocument()
    expect(within(dialog).getByText('ROE-014-v2')).toBeInTheDocument()
    expect(within(dialog).getByText('OP-014')).toBeInTheDocument()
    expect(window.location.hash).toBe('#/project/RT-2026-014?tab=scope')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Effective version')).toBeInTheDocument()
  })

  it('keeps sensitive evidence redacted inside the asset popup', async () => {
    mountProject('#/project/RT-2026-014?tab=scope', { me: 'Casey Nguyen (Client)' })
    fireEvent.click(await screen.findByText('win-dc-01'))
    const dialog = await screen.findByRole('dialog', { name: 'Asset details' })
    expect(await within(dialog).findByText('Redacted (sensitive)')).toBeInTheDocument()
    expect(within(dialog).queryByText('evidence-027.png')).not.toBeInTheDocument()
  })

  it('reads OPPLAN phases and older versions in place with a matching source view', async () => {
    mountProject('#/project/RT-2026-014?tab=plans')
    expect(await screen.findByRole('heading', { name: 'Execution sequence' })).toBeInTheDocument()
    expect(screen.getByText('Host discovery')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Source (JSON)' }))
    expect(screen.getByText(/"id": "PL-021"/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open OPPLAN PL-020' }))
    expect(await screen.findByRole('heading', { name: 'Execution sequence' })).toBeInTheDocument()
    expect(screen.getByText('First draft of the discovery plan.')).toBeInTheDocument()
    expect(window.location.hash).toBe('#/project/RT-2026-014?tab=plans')
    expect(screen.queryByText('Cloud configuration validation plan')).not.toBeInTheDocument()
  })

  it('holds document switching when an OPPLAN draft contains invalid JSON', async () => {
    mountProject('#/project/RT-2026-014?tab=plans')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit draft' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{invalid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open OPPLAN PL-020' }))
    expect(screen.getByRole('textbox')).toHaveValue('{invalid')
    expect(useSessionStore.getState().unsaved).not.toBeNull()
    await expect(useSessionStore.getState().unsaved!.save!()).rejects.toThrow()
    expect(screen.getByRole('textbox')).toHaveValue('{invalid')
    expect(screen.queryByText(/Draft saved/)).not.toBeInTheDocument()
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

describe('secondary panels on the typed detail read (ticket 23)', () => {
  it('objectives, activity and plans render the service slices for the route project only', async () => {
    mountProject('#/project/RT-2026-014?tab=objectives')
    await screen.findByText('Internal Red Team Q4')
    expect(await screen.findByText('Assess internal discovery exposure in the lab')).toBeInTheDocument()
    // Related operations resolve from the same aggregate slice (both objectives owned by Taylor Chen link OP-013).
    expect(screen.getAllByText('OP-013').length).toBeGreaterThan(0)

    mountProject('#/project/RT-2026-014?tab=activity')
    await screen.findByText('Internal Red Team Q4')
    expect(await screen.findByText('Blocked tool call')).toBeInTheDocument()

    mountProject('#/project/RT-2026-014?tab=plans')
    await screen.findByText('Internal Red Team Q4')
    expect((await screen.findAllByText('Internal environment discovery plan')).length).toBeGreaterThan(0)
    expect(screen.getByText('PL-021')).toBeInTheDocument()
  })

  it('findings, reports and sessions render scoped rows and empty states stay project-scoped', async () => {
    mountProject('#/project/RT-2026-014?tab=findings')
    await screen.findByText('Internal Red Team Q4')
    expect(await screen.findByText('2 findings in RT-2026-014')).toBeInTheDocument()
    expect(screen.getByText('Excessive account privileges (simulated)')).toBeInTheDocument()

    mountProject('#/project/RT-2026-014?tab=reports')
    await screen.findByText('Internal Red Team Q4')
    expect(await screen.findByText('Red Team Q4 Report — Northwind Bank')).toBeInTheDocument()
    mountProject('#/project/RT-2026-014?tab=sessions')
    await screen.findByText('Internal Red Team Q4')
    expect((await screen.findAllByText('win-dc-01')).length).toBeGreaterThan(0)

    // Empty and cross-project scoping on the same panels.
    mountProject('#/project/RT-2026-015?tab=sessions')
    await screen.findByText('Cloud Security Assessment')
    expect(await screen.findByText('SS-043')).toBeInTheDocument()
    expect(screen.queryByText('SS-041')).not.toBeInTheDocument()

    mountProject('#/project/RT-2026-017?tab=sessions')
    await screen.findByText('Draft Review')
    expect(await screen.findByText('No C2 sessions for this project')).toBeInTheDocument()

    mountProject('#/project/RT-2026-017?tab=plans')
    await screen.findByText('Draft Review')
    expect(await screen.findByText('No AI plans for this project')).toBeInTheDocument()
  })

  it('the close console renders the service-derived checklist and delegates the waiver to it', async () => {
    mountProject('#/project/RT-2026-014?tab=close')
    await screen.findByText('Internal Red Team Q4')
    // Ticket 22's derivation, read from the detail service over the same snapshot.
    expect(await screen.findByText('Still open: OP-014')).toBeInTheDocument()
    expect(screen.getByText('Live: SS-041, SS-042')).toBeInTheDocument()
    expect(screen.getByText('No report has been delivered')).toBeInTheDocument()
    // The waiver stays the closure service's rule: the read exposes the
    // precondition and both checklist variants; the panel only selects.
    const d14 = detailFor(seed(), ALEX, 'RT-2026-014')!
    expect(d14.noFindingsWaiverOk).toBe(false)
    const d16 = detailFor(seed(), ALEX, 'RT-2026-016')!
    expect(d16.noFindingsWaiverOk).toBe(true)
    expect(d16.close.find((c) => c.id === 'c3')!.detail).toBe('No report has been delivered')
    expect(d16.closeWaived.find((c) => c.id === 'c3')!.detail).toContain('Waived: approved no-findings closure')
  })

  it('detail links in the migrated panels resolve to the canonical feature routes', async () => {
    mountProject('#/project/RT-2026-014?tab=findings')
    await screen.findByText('Internal Red Team Q4')
    fireEvent.click(await screen.findByText('FD-011'))
    await waitFor(() => expect(window.location.hash).toBe('#/finding/FD-011'))

    mountProject('#/project/RT-2026-014?tab=reports')
    await screen.findByText('Internal Red Team Q4')
    fireEvent.click(await screen.findByText('REP-014'))
    await waitFor(() => expect(window.location.hash).toBe('#/report/REP-014'))

    mountProject('#/project/RT-2026-014?tab=sessions')
    await screen.findByText('Internal Red Team Q4')
    fireEvent.click(await screen.findByText('SS-041'))
    await waitFor(() => expect(window.location.hash).toBe('#/c2-session/SS-041'))
  })

  it('a legacy mutation reaches the migrated panels through the change bridge', async () => {
    const h = mountProject('#/project/RT-2026-014?tab=evidence')
    await screen.findByText('Internal Red Team Q4')
    expect(await screen.findByText('accounts-output.txt')).toBeInTheDocument()
    // The canonical commit publishes a ChangeSet through the shared bridge;
    // the detail view refetches, so the panel updates.
    act(() => {
      h.svc().authority.commit('evidence-probe', (d) => {
        const id = 'EV-' + (400 + d.evidence.length + 1)
        d.evidence.push({ id, name: 'bridge-probe.bin', kind: 'Binary', source: 'Probe', at: stamp(), by: 'Alex Morgan', projectId: 'RT-2026-014', sensitive: false })
        d.audit.unshift({ corr: 'evidence-probe', id: 'AU-' + ++d.counters.audit, at: stamp(), actor: 'Alex Morgan', role: 'Manager', action: 'Uploaded evidence', obj: id, projectId: 'RT-2026-014', result: 'Success', reason: '' })
      })
    })
    expect(await screen.findByText('bridge-probe.bin')).toBeInTheDocument()
  })

  it('the detail shell files read the typed service, never the legacy database', () => {
    const DB_READ = /\bdb\.|[{,]\s*db\s*[,}]/
    for (const f of ['src/screens/b-detail.tsx', 'src/screens/b-detail2.tsx']) {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
      expect(src, f).not.toMatch(DB_READ)
    }
    expect(readFileSync(join(process.cwd(), 'src/screens/b-detail.tsx'), 'utf8')).toMatch(/useProjectDetail\(/)
    expect(readFileSync(join(process.cwd(), 'src/screens/b-detail2.tsx'), 'utf8')).toMatch(/ProjectDetail/)
  })
})
