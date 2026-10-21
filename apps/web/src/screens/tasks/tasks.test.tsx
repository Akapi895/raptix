/**
 * My Tasks tests (ticket 15). The pure inbox projection is scope-checked:
 * every row comes from the aggregate's accessible projects (no cross-project
 * leak), allow/deny decisions follow the shared policy with self-review
 * restrictions kept visible, and the 24h plan-approval countdown derives from
 * the shared clock. The mounted inbox reads services/Query only — persona and
 * project switches re-read the new scope, task links reach the scoped routes,
 * and a legacy approval mutation appears in the inbox without reload through
 * the ChangeSet bridge.
 */
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHashRouter, RouterProvider } from 'react-router'
import { seed } from '../../demo/seed';
import { APR } from '../../domain/catalog';
import { createConsoleServices } from '../../demo/services';
import type { ActorRef, RequestContext } from '../../domain/service'
import { consoleKeys } from '../../state/keys'
import { useAuthStore, useProjectStore } from '../../state/stores'
import { useSessionStore } from '../../state/session'
import { selectProject } from '../../router/navigate'
import { requestPlanReviewTransaction } from '../../features/plans/service'
import { submitApprovalTransaction } from '../../features/approvals/service'
import { mountServices } from '../../test/helpers'
import { aggregateFor } from '../dashboard/service'
import { formatCountdown } from '../../domain/dashboard'
import { minutesLeft, planExpiry, taskItems } from './domain'
import { readTasks, tasksForScope } from './service'
import { useTasks } from './use-tasks'
import { MyTasks } from '../a-tasks'

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = '' })

const ALEX: ActorRef = { id: 'Alex Morgan', role: 'manager' }
const PAT: ActorRef = { id: 'Pat Kim', role: 'reviewer' }
const RILEY: ActorRef = { id: 'Riley Brooks', role: 'analyst' }
let corrSeq = 0
const ctxOf = (actor: ActorRef, projectId: string): RequestContext => ({ actor, projectId, corr: `corr-${++corrSeq}` })

function mountTasks() {
  window.location.hash = '#/tasks'
  const pendingStates: boolean[] = []
  function PendingProbe() { pendingStates.push(useTasks().isPending); return null }
  const router = createHashRouter([
    { path: '*', element: <><PendingProbe /><MyTasks /></>, errorElement: <div />, hydrateFallbackElement: null },
  ])
  const view = mountServices(<RouterProvider router={router} />)
  return { view, svc: view.svc, client: view.qc, db: view.db, pendingStates }
}

describe('inbox projection scoping (no cross-project leak)', () => {
  it('Riley (analyst, RT-2026-014 member only) sees only that project\'s pending work', () => {
    const s = taskItems(aggregateFor(seed(), RILEY, ''), RILEY)
    expect(s.tasks.map((t) => [t.id, t.kind, t.allowed])).toEqual([['AR-012', 'access', false]])
    expect(s.counts).toEqual({ project: 0, scope: 0, closure: 0, plan: 0, access: 1, report: 0, finding: 0 })
    expect(s.mine).toBe(0)
    // Records from PT-2026-006 (approval), RT-2026-015 (plan, report) never leak.
    expect(s.tasks.every((t) => t.project === 'RT-2026-014')).toBe(true)
    expect(s.tasks[0]!.why).toBe('Session access is decided by a Red Team Manager or Organization Admin.')
  })

  it('the selected-project view narrows to exactly that project\'s decisions', () => {
    const s = taskItems(aggregateFor(seed(), ALEX, 'RT-2026-015'), ALEX)
    expect(s.tasks.map((t) => t.id)).toEqual(['PL-022', 'REP-015'])
    expect(s.tasks.every((t) => t.project === 'RT-2026-015')).toBe(true)
  })

  it('a project the actor cannot access yields an empty inbox', () => {
    const s = taskItems(aggregateFor(seed(), RILEY, 'RT-2026-015'), RILEY)
    expect(s.tasks).toEqual([])
    expect(s.mine).toBe(0)
  })
})

describe('allow/deny decisions and restrictions', () => {
  it('role restrictions stay visible: the manager sees read-only rows with reasons, and the one actionable row', () => {
    const s = taskItems(aggregateFor(seed(), ALEX, ''), ALEX)
    const byId = Object.fromEntries(s.tasks.map((t) => [t.id, t]))
    // APR-061 (project approval): manager cannot approve; PL-022: manager cannot approve plans; REP-015: reviewer only.
    expect(byId['APR-061']).toMatchObject({ kind: 'project', allowed: false, why: 'Project and scope approvals require the Reviewer or Organization Admin role.' })
    expect(byId['PL-022']).toMatchObject({ kind: 'plan', allowed: false, why: 'Plan approval requires the Reviewer or Organization Admin role.', project: 'RT-2026-015' })
    expect(byId['REP-015']).toMatchObject({ kind: 'report', allowed: false, why: 'Report approval requires the Reviewer role.' })
    // AR-012 is the manager's one actionable item.
    expect(byId['AR-012']).toMatchObject({ kind: 'access', allowed: true, to: { page: 'c2-session', id: 'SS-042' } })
    expect(s.mine).toBe(1)
    expect(s.tasks.map((t) => t.to)).toEqual([
      { page: 'project', id: 'PT-2026-006' },
      { page: 'ai-plan-review', id: 'PL-022' },
      { page: 'c2-session', id: 'SS-042' },
      { page: 'report-review', id: 'REP-015' },
    ])
  })

  it('the reviewer can decide project, plan, access and report items across accessible projects', () => {
    const s = taskItems(aggregateFor(seed(), PAT, ''), PAT)
    expect(s.tasks.map((t) => [t.id, t.allowed])).toEqual([['APR-061', true], ['PL-022', true], ['AR-012', true], ['REP-015', true]])
    expect(s.mine).toBe(4)
  })

  it('self-review stays restricted: the requesting reviewer cannot decide their own plan', () => {
    const base = seed().plans.find((p) => p.id === 'PL-022')!
    const own = { ...base, requestedBy: PAT.id }
    const ds = { ...aggregateFor(seed(), PAT, 'RT-2026-015'), plans: [own] }
    const s = taskItems(ds, PAT)
    expect(s.tasks.find((t) => t.id === 'PL-022')).toMatchObject({ id: 'PL-022', allowed: false, why: 'You requested this plan. Another reviewer must decide.' })
    // The reviewer still reaches the report review in the same scope.
    expect(s.mine).toBe(1)
  })

  it('closure requests group under closure with the confirmClose role rule', () => {
    const closure = { id: 'APR-909', projectId: 'RT-2026-014', type: APR.close, by: ALEX.id, reviewer: PAT.id, at: 'Oct 13, 2026, 9:00 AM (UTC+7)', status: 'pending' as const, note: 'Requesting closure', diff: '' }
    const ds = { ...aggregateFor(seed(), PAT, ''), approvals: [closure] }
    const s = taskItems(ds, PAT)
    expect(s.tasks[0]).toMatchObject({ id: 'APR-909', kind: 'closure', allowed: true, to: { page: 'project', id: 'RT-2026-014', tab: 'close' } })
    const riley = taskItems(ds, RILEY)
    expect(riley.tasks.find((t) => t.id === 'APR-909')).toMatchObject({ allowed: false, why: 'Closure is confirmed by a Reviewer or Organization Admin.' })
  })
})

describe('24h plan-approval countdown (shared clock)', () => {
  it('normalizes the seeded expiry at the boundary and derives minutes from an absolute instant', () => {
    const pl = seed().plans.find((p) => p.id === 'PL-021')!
    expect(planExpiry(pl)).toBe(Date.parse('2026-10-14T09:25:00+07:00'))
    const now = Date.parse('2026-10-13T10:42:00+07:00')
    expect(minutesLeft(planExpiry(pl), now)).toBe(1363)
    expect(formatCountdown(minutesLeft(planExpiry(pl), now))).toBe('expires in 22 h 43 min')
  })

  it('an expired window reports expired and a missing deadline reports unknown', () => {
    const now = Date.parse('2026-10-13T10:42:00+07:00')
    expect(formatCountdown(minutesLeft(Date.parse('2026-10-13T09:42:00+07:00'), now))).toBe('expired')
    expect(minutesLeft(undefined, now)).toBeUndefined()
    expect(formatCountdown(undefined)).toBe('time unknown')
  })
})

describe('aggregate inbox read service', () => {
  it('a read superseded by an aborted signal resolves unavailable instead of returning rows', async () => {
    const svc = createConsoleServices()
    const ctrl = new AbortController()
    const pending = readTasks(svc, ctxOf(ALEX, ''), ctrl.signal)
    ctrl.abort()
    const res = await pending
    expect(res).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'unavailable' }) })
    svc.dispose()
  })

  it('a scope-bound read never retargets to another project, even with a foreign request context', async () => {
    const svc = createConsoleServices()
    const res = await tasksForScope(svc, RILEY, 'RT-2026-014').read(ctxOf(ALEX, 'RT-2026-015'))
    expect(res.ok && res.data.summary.tasks.map((t) => t.id)).toEqual(['AR-012'])
    svc.dispose()
  })
})

describe('mounted tasks inbox (services/Query only)', () => {
  it('renders a loading state before the aggregate read resolves', async () => {
    const h = mountTasks()
    expect(h.pendingStates[0]).toBe(true)
    expect(await screen.findByText(/1 actionable by you/)).toBeInTheDocument()
    expect(h.pendingStates[h.pendingStates.length - 1]).toBe(false)
    h.view.unmount()
  })

  it('renders per-persona rows from the typed read, with read-only reasons and gated actions', async () => {
    mountTasks()
    await screen.findByText(/All \(4\)/)
    expect(screen.getByText('Project creation — PT-2026-006')).toBeInTheDocument()
    expect(screen.getByText('PL-022 — Cloud configuration validation plan')).toBeInTheDocument()
    expect(screen.getByText('AR-012 — interactive access to SS-042')).toBeInTheDocument()
    expect(screen.getByText('REP-015 — Cloud Lab Report — Fabrikam Cloud')).toBeInTheDocument()
    expect(screen.getAllByText('Read-only for your role').length).toBe(3)
    expect(screen.getByText(/1 actionable by you/)).toBeInTheDocument()
    // The non-actionable rows keep their controls visibly disabled (inert): 2 approval + 2 plan + 1 report gates.
    expect(document.querySelectorAll('[aria-disabled="true"]').length).toBe(5)
  })

  it('switching persona re-reads the new scope and never shows inaccessible tasks', async () => {
    const h = mountTasks()
    await screen.findByText(/All \(4\)/)
    act(() => { useAuthStore.getState().setMe('Riley Brooks') })
    expect(await screen.findByText('AR-012 — interactive access to SS-042')).toBeInTheDocument()
    expect(screen.queryByText('Project creation — PT-2026-006')).not.toBeInTheDocument()
    expect(screen.queryByText('PL-022 — Cloud configuration validation plan')).not.toBeInTheDocument()
    expect(screen.queryByText('REP-015 — Cloud Lab Report — Fabrikam Cloud')).not.toBeInTheDocument()
    const staleKey = consoleKeys.view('tasks', { actor: 'Alex Morgan', role: 'manager', project: 'all' })
    // gcTime 0 drops the unobserved previous-scope entry, so no screen can read the old scope's rows.
    expect(h.client().getQueryData(staleKey)).toBeUndefined()
    h.view.unmount()
  })

  it('switching project narrows the inbox and a late stale response cannot restore the previous scope', async () => {
    const h = mountTasks()
    await screen.findByText(/All \(4\)/)
    act(() => { selectProject('RT-2026-015') })
    expect(await screen.findByText('PL-022 — Cloud configuration validation plan')).toBeInTheDocument()
    expect(screen.queryByText('Project creation — PT-2026-006')).not.toBeInTheDocument()
    expect(screen.queryByText('AR-012 — interactive access to SS-042')).not.toBeInTheDocument()
    const staleKey = consoleKeys.view('tasks', { actor: 'Alex Morgan', role: 'manager', project: 'all' })
    expect(h.client().getQueryData(staleKey)).toBeUndefined()
    act(() => { selectProject('all') })
    expect(await screen.findByText(/All \(4\)/)).toBeInTheDocument()
    h.view.unmount()
  })

  it('the All/mine and kind filters match accessible canonical records', async () => {
    const h = mountTasks()
    await screen.findByText(/All \(4\)/)
    fireEvent.click(screen.getByRole('button', { name: 'Assigned to me (1)' }))
    expect(screen.getByText('AR-012 — interactive access to SS-042')).toBeInTheDocument()
    expect(screen.queryByText('PL-022 — Cloud configuration validation plan')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All tasks' }))
    await screen.findByText(/All \(4\)/)
    fireEvent.click(screen.getByRole('button', { name: 'Plans (1)' }))
    expect(screen.getByText('PL-022 — Cloud configuration validation plan')).toBeInTheDocument()
    expect(screen.queryByText('AR-012 — interactive access to SS-042')).not.toBeInTheDocument()
    h.view.unmount()
  })

  it('a persona with no actionable rows renders the mine-only empty state with guidance', async () => {
    const h = mountTasks()
    act(() => { useAuthStore.getState().setMe('Riley Brooks') })
    expect(await screen.findByText('AR-012 — interactive access to SS-042')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Assigned to me (0)' }))
    expect(await screen.findByText('Nothing is assigned to your role. Switch to All tasks to see read-only items.')).toBeInTheDocument()
    h.view.unmount()
  })

  it('task links navigate to the correct scoped routes', async () => {
    const h = mountTasks()
    await screen.findByText(/All \(4\)/)
    fireEvent.click(screen.getByRole('button', { name: 'AR-012 — interactive access to SS-042' }))
    await waitFor(() => expect(window.location.hash).toBe('#/c2-session/SS-042'))
    fireEvent.click(screen.getByRole('button', { name: 'PL-022 — Cloud configuration validation plan' }))
    await waitFor(() => expect(window.location.hash).toBe('#/ai-plan-review/PL-022'))
    fireEvent.click(screen.getByRole('button', { name: 'Project creation — PT-2026-006' }))
    await waitFor(() => expect(window.location.hash).toBe('#/project/PT-2026-006'))
    h.view.unmount()
  })

  it('the 24h expiry countdown displays from the shared clock and flags an expired window', async () => {
    const h = mountTasks()
    await screen.findByText(/All \(4\)/)
    // PL-022 has no expiry; the plan created through the request action carries the 24h window.
    expect(screen.queryByText(/expires in 2\d h/)).not.toBeInTheDocument()
    act(() => {
      useAuthStore.getState().setMe('Taylor Chen')
      requestPlanReviewTransaction(h.svc().authority, h.svc().clock, ctxOf({ id: 'Taylor Chen', role: 'operator' }, 'all'), 'PL-023')
    })
    expect(await screen.findByText('PL-023 — External exposure mapping plan')).toBeInTheDocument()
    expect(screen.getByText(/expires in 23 h \d+ min|expires in 24 h/)).toBeInTheDocument()
    // An expired window renders as expired instead of a stale positive countdown.
    act(() => { h.svc().authority.commit('test-expiry', (d) => { d.plans.find((p) => p.id === 'PL-023')!.expires = 'Oct 13, 2026, 9:42 AM (UTC+7)' }) })
    expect(await screen.findByText('expired')).toBeInTheDocument()
    h.view.unmount()
  })

  it('a legacy approval submitted from a project appears in the inbox without reload', async () => {
    const h = mountTasks()
    await screen.findByText(/All \(4\)/)
    act(() => { submitApprovalTransaction(h.svc().authority, h.svc().clock, ctxOf(ALEX, 'RT-2026-014'), { projectId: 'RT-2026-014', type: APR.scope, note: 'Add staging-erp after approval', diff: 'ROE-014-v3: staging-erp moves in scope' }) })
    expect(await screen.findByText('Scope change — RT-2026-014')).toBeInTheDocument()
    expect(screen.getByText('All (5)')).toBeInTheDocument()
    expect(screen.getByText(/staging-erp moves in scope/)).toBeInTheDocument()
    h.view.unmount()
  })

  it('deciding an approval from the inbox commits through the bridge and updates without reload', async () => {
    const h = mountTasks()
    act(() => { useAuthStore.getState().setMe('Pat Kim') })
    expect(await screen.findByText(/4 actionable by you/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Return' })[0])
    expect(useSessionStore.getState().confirmState).not.toBeNull()
    act(() => { useSessionStore.getState().confirmState!.onConfirm('ROE window is not finalized for the exercise.') })
    await waitFor(() => expect(screen.queryByText('Project creation — PT-2026-006')).not.toBeInTheDocument())
    expect(screen.getByText(/All \(3\)/)).toBeInTheDocument()
    expect(h.db().approvals.find((a) => a.id === 'APR-061')!.status).toBe('returned')
    h.view.unmount()
  })

  it('a closed project with no decisions renders the explicit empty state', async () => {
    const h = mountTasks()
    await screen.findByText(/All \(4\)/)
    act(() => { useProjectStore.getState().setPid('RT-2026-009') })
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to System Overview' })).toBeEnabled()
    h.view.unmount()
  })

  it('a failing aggregate read surfaces the error state and recovers on retry', async () => {
    const h = mountTasks()
    await screen.findByText(/All \(4\)/)
    const snap = vi.spyOn(h.svc().authority, 'snapshot').mockImplementation(() => { throw new Error('authority offline') })
    await act(async () => { await h.client().invalidateQueries() })
    expect(await screen.findByText('authority offline')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
    snap.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/All \(4\)/)).toBeInTheDocument()
    h.view.unmount()
  })
})
