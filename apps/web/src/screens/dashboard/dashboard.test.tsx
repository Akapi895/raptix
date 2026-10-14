/**
 * Command Center tests (ticket 14). The pure domain functions (readiness,
 * completion, eligibility, attention queue) are pinned to the seed's baseline
 * expectations at this new site; the aggregate read service is scope-checked
 * (no data across projects or non-member projects, superseded reads resolve
 * unavailable); the mounted dashboard reads services/Query only — persona and
 * project switches re-read the new scope, a legacy createProject refreshes
 * the aggregate through the ChangeSet bridge, and quick actions reach the
 * correct routes.
 */
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHashRouter, RouterProvider } from 'react-router'
import { seed } from '../../data'
import { createConsoleServices } from '../../domain/service-factory'
import type { ActorRef, RequestContext } from '../../domain/service'
import { consoleKeys } from '../../state/keys'
import { useAuthStore, useProjectStore } from '../../state/stores'
import { selectProject } from '../../router/navigate'
import { createProjectTransaction } from '../../features/wizard/service'
import { mountServices } from '../../test/helpers'
import { aggregateFor, dashboardForScope, readDashboard } from './service'
import { attentionItems, completion, dashboardKpis, eligibility, formatCountdown, grantMinutesLeft, readiness } from './domain'
import { Dashboard } from '../../screens/a-dashboard'
import { useDashboard } from './use-dashboard'

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = '' })

const ALEX: ActorRef = { id: 'Alex Morgan', role: 'manager' }
const RILEY: ActorRef = { id: 'Riley Brooks', role: 'analyst' }
let corrSeq = 0
const ctxOf = (actor: ActorRef, projectId: string): RequestContext => ({ actor, projectId, corr: `corr-${++corrSeq}` })

function mountDashboard() {
  window.location.hash = '#/command-center'
  const pendingStates: boolean[] = []
  function PendingProbe() { pendingStates.push(useDashboard().isPending); return null }
  const router = createHashRouter([
    { path: '*', element: <><PendingProbe /><Dashboard /></>, errorElement: <div />, hydrateFallbackElement: null },
  ])
  const view = mountServices(<RouterProvider router={router} />)
  return { view, svc: view.svc, client: view.qc, pendingStates }
}

describe('readiness/completion domain functions (baseline expectations)', () => {
  it('readiness scores RT-2026-014 at 5/6 gates: agents 2/3 is the failing gate', () => {
    const ds = aggregateFor(seed(), ALEX, 'RT-2026-014')
    const rd = readiness(ds, 'RT-2026-014')
    expect(rd.items.map((i) => [i.id, i.ok, i.detail])).toEqual([
      ['r1', true, 'ROE-014-v2 · approved'],
      ['r2', true, '12 approved'],
      ['r3', true, 'Robin Vale — +1 (555) 010-0014'],
      ['r4', false, '2/3 connected'],
      ['r5', true, 'PL-021 v1.2'],
      ['r6', true, 'Latest preflight passed'],
    ])
    expect(rd.done).toBe(5)
    expect(rd.total).toBe(6)
    expect(rd.pct).toBe(83)
  })

  it('readiness of the draft project fails every gate', () => {
    const ds = aggregateFor(seed(), ALEX, 'RT-2026-017')
    const rd = readiness(ds, 'RT-2026-017')
    expect(rd.done).toBe(0)
    expect(rd.pct).toBe(0)
    expect(rd.items.every((i) => !i.ok)).toBe(true)
  })

  it('completion matches the objective/report/closure baseline for RT-2026-014', () => {
    const ds = aggregateFor(seed(), ALEX, 'RT-2026-014')
    const cp = completion(ds, 'RT-2026-014')
    expect(cp).toEqual({
      pct: 29, objPct: 42, ops: 2, opsDone: 1,
      confirmed: 1, suggested: 1, inReview: 0,
      repLabel: 'Draft', delivered: false, closeDone: 2, closeTotal: 5,
    })
  })

  it('completion of the draft project counts only the vacuously-passed closure checks', () => {
    const ds = aggregateFor(seed(), ALEX, 'RT-2026-017')
    const cp = completion(ds, 'RT-2026-017')
    expect(cp.objPct).toBe(0)
    expect(cp.repLabel).toBe('Draft')
    expect(cp.closeDone).toBe(4)
    expect(cp.closeTotal).toBe(5)
    expect(cp.pct).toBe(16)
  })

  it('eligibility reflects execution state: active while running, locked by ROE, ready otherwise', () => {
    expect(eligibility(aggregateFor(seed(), ALEX, 'RT-2026-014'), 'RT-2026-014')).toMatchObject({ kind: 'active', label: 'Execution active', tone: 'cyan' })
    const locked = eligibility(aggregateFor(seed(), ALEX, 'RT-2026-017'), 'RT-2026-017')
    expect(locked.kind).toBe('locked')
    expect(locked.label).toBe('Execution locked — ROE not approved')
    expect(locked.reasons.map((r) => r.text)).toEqual([
      'Project is a draft',
      'ROE-017-v1 is draft, not approved',
      '0 approved assets in scope',
      'No emergency contact on the ROE',
    ])
    const p = seed().projects.find((x) => x.id === 'RT-2026-014')!
    const base = { ...p, id: 'RT-X', status: 'approved' as const, roeStatus: 'approved' as const, roeVersion: 'ROE-X-v1' }
    const ds = { ...aggregateFor(seed(), ALEX, ''), projects: [base], operations: [], agents: [{ ...seed().agents[0], projectId: 'RT-X', status: 'online' as const }], assets: [{ ...seed().assets[0], projectId: 'RT-X' }] }
    expect(eligibility(ds, 'RT-X')).toMatchObject({ kind: 'ready', label: 'Ready for preflight', tone: 'ok' })
    const withReadyOp = { ...ds, operations: [{ ...seed().operations[5], projectId: 'RT-X', status: 'ready' as const }] }
    expect(eligibility(withReadyOp, 'RT-X')).toMatchObject({ kind: 'eligible', label: 'Eligible to start' })
    expect(eligibility({ ...ds, projects: [{ ...base, status: 'closed' as const }] }, 'RT-X')).toMatchObject({ kind: 'closed', label: 'Read-only — project closed' })
  })

  it('KPIs, attention ordering and grant countdowns keep their baseline semantics', () => {
    const ds = aggregateFor(seed(), ALEX, '')
    expect(dashboardKpis(ds)).toEqual({
      activeProjects: 3, accessibleProjects: 6,
      running: 2, totalOps: 6,
      reviewPlans: 1, otherApprovals: 2,
      healthyAgents: 8, totalAgents: 9, offlineAgents: 1,
      liveSessions: 3, trackedSessions: 4,
      openFindings: 2, aiSuggested: 1, criticalOrHigh: 1,
    })
    const items = attentionItems(ds, ALEX)
    expect(items.map((i) => i.tone)).toEqual(['bad', 'bad', 'bad', 'warn', 'warn', 'warn'])
    expect(items.map((i) => i.title)).toEqual([
      'Agent WIN-LAB-03 is offline',
      'RT-2026-016 has no approved ROE (draft)',
      'PT-2026-006 has no approved ROE (pending)',
      'Plan PL-022 awaiting approval',
      'Riley Brooks requests interactive access to SS-042',
      'C2 node lab-relay-02 is degraded',
    ])
    expect(items[0].to).toEqual({ page: 'agent', id: 'AG-009' })
    expect(items[3].cta).toBe('View plan')
    const grant = seed().sessions.find((s) => s.id === 'SS-041')!.grants[0]
    const now = Date.parse('2026-10-13T10:42:00+07:00')
    expect(grantMinutesLeft(grant.expires, now)).toBe(33)
    expect(formatCountdown(33)).toBe('expires in 33 min')
    expect(formatCountdown(90)).toBe('expires in 1 h 30 min')
    expect(formatCountdown(0)).toBe('expired')
    expect(formatCountdown(undefined)).toBe('time unknown')
  })
})

describe('aggregate read scoping', () => {
  it('the all-projects view aggregates only accessible projects plus workspace-level rows', () => {
    const ds = aggregateFor(seed(), RILEY, '')
    expect(ds.projects.map((p) => p.id)).toEqual(['RT-2026-014'])
    expect(ds.findings.map((f) => f.id)).toEqual(['FD-011', 'FD-012'])
    expect(ds.agents.map((a) => a.id)).toEqual(['AG-007', 'AG-008', 'AG-009', 'AG-012', 'AG-013'])
    expect(ds.sessions.map((s) => s.id)).toEqual(['SS-041', 'SS-042', 'SS-040'])
    expect(ds.c2Nodes.map((n) => n.id)).toEqual(['C2-01', 'C2-02', 'C2-03', 'C2-04'])
    expect(ds.audit.every((a) => a.projectId === 'RT-2026-014')).toBe(true)
  })

  it('the selected-project view narrows to exactly that project', () => {
    const ds = aggregateFor(seed(), ALEX, 'RT-2026-015')
    expect(ds.projects.map((p) => p.id)).toEqual(['RT-2026-015'])
    expect(ds.operations.map((o) => o.id)).toEqual(['OP-015'])
    expect(ds.agents.map((a) => a.id)).toEqual(['AG-010', 'AG-011'])
    expect(ds.c2Nodes.map((n) => n.id)).toEqual(['C2-01', 'C2-03'])
  })

  it('a selected project the actor cannot access yields an empty aggregate — no leaked records', () => {
    const ds = aggregateFor(seed(), RILEY, 'RT-2026-015')
    for (const key of ['projects', 'operations', 'agents', 'assets', 'sessions', 'findings', 'reports', 'plans', 'approvals', 'audit', 'toolEvents', 'c2Nodes'] as const) {
      expect(ds[key]).toEqual([])
    }
  })

  it('a read superseded by an aborted signal resolves unavailable instead of returning data', async () => {
    const svc = createConsoleServices()
    const ctrl = new AbortController()
    const pending = readDashboard(svc, ctxOf(ALEX, ''), ctrl.signal)
    ctrl.abort()
    const res = await pending
    expect(res).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'unavailable' }) })
    svc.dispose()
  })

  it('a scope-bound read never retargets to another project, even with a foreign request context', async () => {
    const svc = createConsoleServices()
    const res = await dashboardForScope(svc, RILEY, 'RT-2026-014').read(ctxOf(ALEX, 'RT-2026-015'))
    expect(res.ok && res.data.projects.map((p) => p.id)).toEqual(['RT-2026-014'])
    svc.dispose()
  })
})

describe('mounted dashboard (services/Query only)', () => {
  it('renders a loading state before the aggregate read resolves', async () => {
    const h = mountDashboard()
    expect(h.pendingStates[0]).toBe(true)
    await screen.findByText(/All projects · 6 accessible · signed in as Alex Morgan/)
    expect(h.pendingStates[h.pendingStates.length - 1]).toBe(false)
    expect(screen.getByText('Aggregate view')).toBeInTheDocument()
    h.view.unmount()
  })

  it('renders the all-projects aggregate with attention queue entries from the typed read', async () => {
    const h = mountDashboard()
    await screen.findByText(/All projects · 6 accessible/)
    expect(screen.getByText('Agent WIN-LAB-03 is offline')).toBeInTheDocument()
    expect(screen.getByText('PT-2026-006 has no approved ROE (pending)')).toBeInTheDocument()
    expect(screen.getByText('C2 node lab-relay-02 is degraded')).toBeInTheDocument()
    expect(screen.getByText('Riley Brooks requests interactive access to SS-042')).toBeInTheDocument()
    h.view.unmount()
  })

  it('switching persona re-reads the aggregate for the new scope and never shows inaccessible data', async () => {
    const h = mountDashboard()
    await screen.findByText(/All projects · 6 accessible/)
    expect(screen.getByText('Plan PL-022 awaiting approval')).toBeInTheDocument()
    act(() => { useAuthStore.getState().setMe('Riley Brooks') })
    await screen.findByText(/All projects · 1 accessible · signed in as Riley Brooks/)
    expect(screen.queryByText('Plan PL-022 awaiting approval')).not.toBeInTheDocument()
    expect(screen.getByText('Agent WIN-LAB-03 is offline')).toBeInTheDocument()
    const staleKey = consoleKeys.view('dashboard', { actor: 'Alex Morgan', role: 'manager', project: 'all' })
    // gcTime 0 drops the unobserved previous-scope entry, so no screen can read the old scope's data
    expect(h.client().getQueryData(staleKey)).toBeUndefined()
    h.view.unmount()
  })

  it('switching project shows only that project and a late stale response cannot restore the previous scope', async () => {
    const h = mountDashboard()
    await screen.findByText(/All projects · 6 accessible/)
    act(() => { selectProject('RT-2026-015') })
    expect(await screen.findByText('Cloud Security Assessment · Fabrikam Cloud (Demo)')).toBeInTheDocument()
    expect(screen.queryByText('OP-014')).not.toBeInTheDocument()
    const staleKey = consoleKeys.view('dashboard', { actor: 'Alex Morgan', role: 'manager', project: 'all' })
    expect(h.client().getQueryData(staleKey)).toBeUndefined()
    act(() => { selectProject('all') })
    await screen.findByText(/All projects · 6 accessible/)
    expect(screen.getAllByText('OP-014').length).toBeGreaterThan(0)
    h.view.unmount()
  })

  it('renders readiness and completion panels from the pure domain functions', async () => {
    const h = mountDashboard()
    await screen.findByText(/All projects/)
    act(() => { selectProject('RT-2026-014') })
    expect(await screen.findByText('Execution Readiness')).toBeInTheDocument()
    expect(screen.getByText('5/6 gates passed')).toBeInTheDocument()
    expect(screen.getByText('Project Completion')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()
    h.view.unmount()
  })

  it('an inaccessible selected project renders an explicit empty state with no record content', async () => {
    const h = mountDashboard()
    await screen.findByText(/All projects/)
    act(() => { useAuthStore.getState().setMe('Riley Brooks') })
    await screen.findByText(/All projects · 1 accessible · signed in as Riley Brooks/)
    act(() => { useProjectStore.getState().setPid('RT-2026-015') })
    expect(await screen.findByText('This project is not available for your role')).toBeInTheDocument()
    expect(screen.queryByText('Cloud lab configuration drift')).not.toBeInTheDocument()
    h.view.unmount()
  })

  it('a project creation transaction publishes through the bridge and refreshes the aggregate view', async () => {
    const h = mountDashboard()
    await screen.findByText(/All projects · 6 accessible/)
    act(() => {
      createProjectTransaction(h.svc().authority, h.svc().clock, ctxOf(ALEX, 'all'), {
        name: 'Isolation Probe', id: 'RT-2026-018', client: 'Probe Client (Demo)', type: 'Red Team', desc: '', start: 'Oct 13, 2026', end: 'Nov 13, 2026', tz: 'UTC+07:00', owner: 'Alex Morgan', tags: [],
        goal: '', objectives: [{ text: 'Probe', criteria: 'Probe' }], metrics: '', unit: '', reportReq: '', scopeDesc: '', window: 'Mon–Fri, 9:00 AM–5:00 PM (UTC+7)', limits: [],
        emergency: 'Robin Vale — +1 (555) 010-0014', channel: '', roeFile: '', approver: 'Pat Kim',
        assets: [{ name: 'probe-01', ident: 'probe-01.example.test', type: 'Host', scope: 'in' }], members: [],
      }, false)
    })
    act(() => { selectProject('RT-2026-018') })
    await screen.findByText(/Isolation Probe · Probe Client \(Demo\)/)
    act(() => { useProjectStore.getState().setPid('all') })
    await screen.findByText(/All projects · 7 accessible/)
    h.view.unmount()
  })

  it('quick actions and KPI links navigate to the correct routes', async () => {
    const h = mountDashboard()
    await screen.findByText(/All projects/)
    fireEvent.click(screen.getAllByRole('button', { name: 'Create Project' })[0])
    await waitFor(() => expect(window.location.hash).toBe('#/project-new'))
    fireEvent.click(screen.getByRole('button', { name: /Running Operations/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/operations'))
    fireEvent.click(screen.getByRole('button', { name: 'Open agent' }))
    await waitFor(() => expect(window.location.hash).toBe('#/agent/AG-009'))
    h.view.unmount()
  })

  it('a failing aggregate read surfaces the error state and recovers on retry', async () => {
    const h = mountDashboard()
    await screen.findByText(/All projects/)
    const snap = vi.spyOn(h.svc().authority, 'snapshot').mockImplementation(() => { throw new Error('authority offline') })
    await act(async () => { await h.client().invalidateQueries() })
    expect(await screen.findByText('authority offline')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
    snap.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/All projects · 6 accessible/)).toBeInTheDocument()
    h.view.unmount()
  })
})
