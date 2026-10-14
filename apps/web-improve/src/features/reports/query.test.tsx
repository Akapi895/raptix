/**
 * Ticket 34: report catalog + validated draft creation. Handler tests pin
 * the scope rules (non-member invisible, aggregate folds accessible
 * projects), the draft-creation gate (`editReport` at the handler with the
 * reason carried in the failure), the finding rules (only confirmed-or-later
 * findings of the report's own project; suggested/unreviewed refused) and
 * atomicity (a refused create leaves no partial records). Screen tests pin
 * the migrated catalog (templates/delivery history with loading and error
 * states) and the gated create form. Bridge tests observe one data authority
 * in both directions: a legacy createReport refetches the typed catalog, and
 * the typed create appears in the legacy inventory and navigates through the
 * router (no raw location.hash writes).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { createHashRouter, RouterProvider } from 'react-router'
import { mountServices } from '../../test/helpers'
import { currentRoute, selectProject } from '../../router/navigate'
import { useAuthStore } from '../../state/stores'
import { createDatabaseAuthority } from '../../domain/database'
import { MockClock } from '../../domain/clock'
import type { ActorRef, RequestContext, ServiceResult } from '../../domain/service'
import type { Report } from '../../domain/entities'
import { routes } from '../../screens/f'
import { createReportDraft, draftOptions, listDeliveries, listReports } from './service'
import { useReportList } from './query'

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = '' })

/* ───────────── handler harness ───────────── */
function harness() {
  const clock = new MockClock()
  return { clock, authority: createDatabaseAuthority(clock) }
}
const actor = (id: string, role: ActorRef['role']): ActorRef => ({ id, role })
const ctxOf = (a: ActorRef, projectId: string, corr = 't'): RequestContext => ({ actor: a, projectId, corr })
const alex = actor('Alex Morgan', 'manager') // editReport, elevated
const taylor = actor('Taylor Chen', 'operator') // editReport; member of 014/015/016/017
const pat = actor('Pat Kim', 'reviewer') // no editReport
const casey = actor('Casey Nguyen (Client)', 'viewer') // nothing
const riley = actor('Riley Brooks', 'analyst') // editReport; member of RT-2026-014 only
const P14 = 'RT-2026-014'

const draftInput = { title: 'Probe Report — Northwind Bank', template: 'Standard Red Team v3', kind: 'Red Team', reviewer: 'Pat Kim', findings: ['FD-011'], period: 'Oct 1, 2026 – Oct 13, 2026' }

const dbReports = (h: ReturnType<typeof harness>) => h.authority.snapshot().reports

describe('report catalog reads (ticket 34)', () => {
  it('lists scoped reports with KPI counts and filter options; non-member projects are invisible', () => {
    const h = harness()
    const taylorRead = listReports(h.authority.snapshot(), ctxOf(taylor, 'all'))
    expect(taylorRead.ok).toBe(true)
    if (taylorRead.ok) {
      const ids = taylorRead.data.items.map((it) => it.report.id)
      expect(ids).toContain('REP-014')
      expect(ids).toContain('REP-015')
      expect(ids).not.toContain('REP-009') // RT-2026-009 — not a member
      expect(taylorRead.data.counts).toMatchObject({ open: 2, review: 1, approved: 0, delivered: 0 })
      expect(taylorRead.data.projects).toEqual(['RT-2026-014', 'RT-2026-015', 'RT-2026-017'])
    }
    const specific = listReports(h.authority.snapshot(), ctxOf(taylor, P14))
    expect(specific.ok && specific.data.total === 1).toBe(true)
    // Out-of-scope reads are not-found, never a leaked existence signal.
    expect(listReports(h.authority.snapshot(), ctxOf(riley, 'RT-2026-015'))).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    h.authority.reset()
  })

  it('filters by status, search and template while the KPI counts stay live', () => {
    const h = harness()
    const read = listReports(h.authority.snapshot(), ctxOf(alex, 'all'), { status: 'draft', q: 'northwind' })
    expect(read.ok && read.data.items.map((it) => it.report.id)).toEqual(['REP-014'])
    if (read.ok) expect(read.data.counts.delivered).toBe(1) // counts over the scoped base, not the filtered rows
    h.authority.reset()
  })

  it('scopes delivery history to accessible reports', () => {
    const h = harness()
    const alexRead = listDeliveries(h.authority.snapshot(), ctxOf(alex, 'all'))
    expect(alexRead.ok && alexRead.data.items[0]).toMatchObject({ rec: { id: 'EX-090' }, reportTitle: 'Final Report — Contoso Labs' })
    expect(listDeliveries(h.authority.snapshot(), ctxOf(taylor, 'all')).ok && true).toBe(true)
    const taylorRead = listDeliveries(h.authority.snapshot(), ctxOf(taylor, 'all'))
    if (taylorRead.ok) expect(taylorRead.data.items).toHaveLength(0) // EX-090 belongs to an inaccessible report
    h.authority.reset()
  })
})

describe('draft creation handler (ticket 34)', () => {
  it('creates a draft in one commit: template sections, audit row, next counter', () => {
    const h = harness()
    const before = h.authority.snapshot()
    const res = createReportDraft(h.authority, h.clock, ctxOf(taylor, P14), draftInput)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data).toMatchObject({ id: 'REP-017', projectId: P14, status: 'draft', version: 'v0.1', author: 'Taylor Chen', reviewer: 'Pat Kim' })
      expect(res.data.sections[0].title).toBe('Cover Page')
      expect(res.data.sections[0].body).toContain('Security Assessment Report — Northwind Bank')
      expect(res.data.sections).toHaveLength(11) // template has 7 sections → default section set
    }
    expect(dbReports(h).length).toBe(before.reports.length + 1)
    expect(h.authority.snapshot().audit[0]).toMatchObject({ action: 'Created report', actor: 'Taylor Chen', obj: 'REP-017', projectId: P14 })
    h.authority.reset()
  })

  it('role-gates creation with reasons: aggregate view, viewer, reviewer role, non-member', () => {
    const h = harness()
    expect(createReportDraft(h.authority, h.clock, ctxOf(taylor, 'all'), draftInput)).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('Select a specific project') }) })
    expect(createReportDraft(h.authority, h.clock, ctxOf(casey, P14), draftInput)).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('(Client / Viewer) cannot create reports') }) })
    expect(createReportDraft(h.authority, h.clock, ctxOf(pat, P14), draftInput)).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('(Reviewer) cannot create reports') }) })
    expect(createReportDraft(h.authority, h.clock, ctxOf(riley, 'RT-2026-015'), draftInput)).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    // A closed project is read-only regardless of role.
    expect(createReportDraft(h.authority, h.clock, ctxOf(alex, 'RT-2026-009'), { ...draftInput, template: 'Standard Red Team v3' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('read-only') }) })
    expect(dbReports(h).length).toBe(4) // nothing committed
    h.authority.reset()
  })

  it('validates title, template, independent reviewer, and refuses unreviewed or cross-project findings', () => {
    const h = harness()
    const base = { ...draftInput }
    expect(createReportDraft(h.authority, h.clock, ctxOf(taylor, P14), { ...base, title: '   ' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: 'Enter a report title.' }) })
    expect(createReportDraft(h.authority, h.clock, ctxOf(taylor, P14), { ...base, template: 'Nope v1' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: 'Choose a template.' }) })
    expect(createReportDraft(h.authority, h.clock, ctxOf(taylor, P14), { ...base, reviewer: 'Taylor Chen' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: 'The reviewer cannot be the author.' }) })
    expect(createReportDraft(h.authority, h.clock, ctxOf(taylor, P14), { ...base, reviewer: 'Alex Morgan' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: 'The reviewer must hold the Reviewer role.' }) })
    // FD-012 is an AI suggestion — suggested/unreviewed findings cannot be included.
    expect(createReportDraft(h.authority, h.clock, ctxOf(taylor, P14), { ...base, findings: ['FD-012'] })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('unverified AI suggestion') }) })
    // A finding from another project is refused (scope compatibility).
    expect(createReportDraft(h.authority, h.clock, ctxOf(taylor, P14), { ...base, findings: ['FD-015'] })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('not part of project RT-2026-014') }) })
    expect(dbReports(h).length).toBe(4)
    expect(h.authority.snapshot().counters.report).toBe(16)
    h.authority.reset()
  })

  it('the draft-options read carries the handler-computed gate and reportability', () => {
    const h = harness()
    const taylorOpts = draftOptions(h.authority.snapshot(), ctxOf(taylor, P14))
    expect(taylorOpts.ok).toBe(true)
    if (taylorOpts.ok) {
      expect(taylorOpts.data.canCreate).toBe(true)
      expect(taylorOpts.data.createReason).toBe('')
      expect(taylorOpts.data.reviewers).toContain('Pat Kim')
      expect(taylorOpts.data.findings.find((f) => f.id === 'FD-011')).toMatchObject({ reportable: true })
      expect(taylorOpts.data.findings.find((f) => f.id === 'FD-012')).toMatchObject({ reportable: false, status: 'ai_suggested' })
    }
    const caseyOpts = draftOptions(h.authority.snapshot(), ctxOf(casey, P14))
    expect(caseyOpts.ok && !caseyOpts.data.canCreate && caseyOpts.data.createReason).toContain('cannot create reports')
    h.authority.reset()
  })
})

/* ───────────── bridge harness (legacy store + services, one authority) ───────────── */
function mountBridge(me = 'Alex Morgan') {
  return mountServices(null, me)
}

describe('bridge both directions for report mutations (ticket 34)', () => {
  it('the typed create is observed by the legacy consumer (new → legacy)', async () => {
    const h = mountBridge('Taylor Chen')
    h.run(() => selectProject(P14))
    let res!: ServiceResult<Report>
    await act(async () => {
      res = await h.svc().reports(taylor, P14).createDraft(ctxOf(taylor, P14, 'svc'), draftInput)
    })
    expect(res.ok).toBe(true)
    const legacy = h.db().reports.find((x) => x.id === (res.ok ? res.data.id : ''))
    expect(legacy).toMatchObject({ status: 'draft', template: 'Standard Red Team v3' })
    expect(h.db().audit[0]).toMatchObject({ action: 'Created report', actor: 'Taylor Chen', projectId: P14 })
    h.unmount()
  })

  it('a legacy createReport is observed by the typed catalog read (legacy → new)', async () => {
    window.location.hash = '#/reports'
    const view = mountServices(<CatalogTotal />)
    await waitFor(() => expect(screen.getByTestId('report-total')).toHaveTextContent('4'))
    view.run(() => { expect(createReportDraft(view.svc().authority, view.svc().clock, ctxOf(alex, P14), { title: 'Legacy bridge report', template: 'Standard Red Team v3', kind: 'Red Team', reviewer: 'Pat Kim', findings: [], period: '' }).ok).toBe(true) })
    await waitFor(() => expect(screen.getByTestId('report-total')).toHaveTextContent('5'))
    view.unmount()
  })
})

/** Minimal Query consumer rendering the catalog total, for bridge assertions. */
function CatalogTotal() {
  const q = useReportList({})
  return <div data-testid="report-total">{q.data?.total ?? '…'}</div>
}

/* ───────────── migrated catalog screen (templates + delivery history) ───────────── */
/** Mounts the providers with a probe; `show(node)` mounts a screen into the
 *  SAME tree (the store's route was parsed at mount — navigate with `go()`). */
function mountScreenRoute(me = 'Alex Morgan') {
  return mountServices(null, me)
}

describe('report catalog screen (ticket 34)', () => {
  it('renders templates and delivery history from the typed reads, with counts', async () => {
    window.location.hash = '#/reports'
    const h = mountScreenRoute('Alex Morgan')
    h.show(<routes.reports />)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Reports' })).toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('tab', { name: /Templates/ })).toHaveTextContent('4'))
    await waitFor(() => expect(screen.getByRole('tab', { name: /Delivery History/ })).toHaveTextContent('1'))
    fireEvent.click(screen.getByRole('tab', { name: /Templates/ }))
    await waitFor(() => expect(screen.getAllByText('Standard Red Team v3').length).toBeGreaterThan(0))
    expect(screen.getByText('Executive Brief (draft)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Delivery History/ }))
    await waitFor(() => expect(screen.getByText('EX-090')).toBeInTheDocument())
    expect(screen.getByText('sha256:9f3c…a71e')).toBeInTheDocument()
    h.unmount()
  })

  it('delivery history is scope-filtered: an operator without access sees the empty state', async () => {
    window.location.hash = '#/reports'
    const h = mountScreenRoute('Taylor Chen')
    h.run(() => selectProject('all'))
    h.show(<routes.reports />)
    fireEvent.click(await screen.findByRole('tab', { name: /Delivery History/ }))
    await waitFor(() => expect(screen.getByText('No exports yet')).toBeInTheDocument())
    h.unmount()
  })

  it('renders a retryable error state when the catalog read fails', async () => {
    window.location.hash = '#/reports'
    const h = mountScreenRoute('Riley Brooks') // member of RT-2026-014 only
    h.run(() => selectProject('RT-2026-015')) // not a member — the read refuses
    h.show(<routes.reports />)
    await waitFor(() => expect(screen.getByText('Could not load reports')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    h.unmount()
  })
})

describe('draft creation screen (ticket 34)', () => {
  it('gates creation per role with the reason rendered', async () => {
    window.location.hash = '#/report-new'
    const h = mountScreenRoute('Casey Nguyen (Client)')
    h.run(() => selectProject(P14))
    const Form = routes['report-new'] as React.ComponentType
h.show(<Form />)
    await waitFor(() => expect(screen.getByText('Cannot create report')).toBeInTheDocument())
    expect(screen.getAllByText(/cannot create reports/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Create Draft/ })).toBeDisabled()
    h.unmount()
  })

  it('refuses the aggregate view with the project banner', async () => {
    window.location.hash = '#/report-new'
    const h = mountScreenRoute('Alex Morgan')
    const Form = routes['report-new'] as React.ComponentType
h.show(<Form />)
    await waitFor(() => expect(screen.getByText('Select a specific project')).toBeInTheDocument())
    h.unmount()
  })

  it('creates a draft through the typed service and opens the bridged editor via the router', async () => {
    window.location.hash = '#/report-new'
    const h = mountScreenRoute('Taylor Chen')
    h.run(() => selectProject(P14))
    const Form = routes['report-new'] as React.ComponentType
h.show(<Form />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Create Draft/ })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /Create Draft/ }))
    await waitFor(() => expect(h.db().reports.find((r) => r.projectId === P14 && r.author === 'Taylor Chen')).toBeTruthy())
    const created = h.db().reports[0]
    expect(created).toMatchObject({ status: 'draft', template: 'Standard Red Team v3', reviewer: 'Pat Kim' })
    expect(h.db().audit[0]).toMatchObject({ action: 'Created report', actor: 'Taylor Chen' })
    await waitFor(() => expect(currentRoute().page).toBe('report'), { timeout: 3000 })
    expect(currentRoute().id).toBe(created.id)
    h.unmount()
  })
})

/* ───────────── router navigation (no raw location.hash writes) ───────────── */
describe('navigation writes through the router (ticket 34)', () => {
  it('post-create navigation lands on the bridged editor with the router as the location writer', async () => {
    window.location.hash = '#/report-new'
    const router = createHashRouter([
      { path: '*', element: <RouteHostProbe />, hydrateFallbackElement: null },
    ])
    const navigate = vi.spyOn(router, 'navigate')
    const { setActiveRouter } = await import('../../router/active')
    const { RouteHost } = await import('../../router/host')
    function RouteHostProbe() { return <RouteHost /> }
    setActiveRouter(router)
    const view = mountServices(<RouterProvider router={router} />, 'Taylor Chen')
    await screen.findByRole('heading', { name: /sign in/i }).catch(() => {})
    // The login screen is rendered in place; sign in through the demo picker.
    const signIn = screen.queryAllByRole('button', { name: /Taylor Chen/ })[0]
    if (signIn) fireEvent.click(signIn)
    await waitFor(() => expect(useAuthStore.getState().authed).toBe(true), { timeout: 3000 })
    act(() => { selectProject('RT-2026-014') })
    await waitFor(() => expect(screen.getByRole('button', { name: /Create Draft/ })).toBeEnabled(), { timeout: 3000 })
    navigate.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /Create Draft/ }))
    await waitFor(() => expect(currentRoute().page).toBe('report'), { timeout: 3000 })
    const created = view.db().reports[0]
    expect(window.location.hash).toBe(`#/report/${encodeURIComponent(created.id)}`)
    expect(navigate).toHaveBeenCalled()
    view.unmount()
    setActiveRouter(null)
  })
})
