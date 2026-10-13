/**
 * Ticket 31: findings inventory read model — scoped accessible findings with
 * severity/tab counts, search/severity/status filters, pagination, role-
 * sensitive detail masking with not-found/forbidden handling, AI suggestions
 * presented as proposals, the legacy→Query bridge (a legacy status change
 * updates the new views without a reload) and creation/detail links that
 * stay functional through the bridge. Plus focused handler tests for the
 * masking/denial edges.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type ComponentType } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ConsoleProviders } from '../../state/query'
import { StoreProvider, useServices, useStore, type Store } from '../../store'
import type { ConsoleServices } from '../../domain/service-factory'
import type { RequestContext } from '../../domain/service'
import { routes } from '../../screens/e'
import { seed } from '../../data'
import { getFinding, listFindings } from './service'

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = '' })

function Probe({ ready }: { ready: (s: Store, svc: ConsoleServices, qc: QueryClient) => void }) {
  const store = useStore()
  const services = useServices()
  const qc = useQueryClient()
  ready(store, services, qc)
  return null
}

/** Mounts the providers, optionally rendering the findings route matching the current hash. */
function mountFindings(me = 'Alex Morgan') {
  let store!: Store
  let svc!: ConsoleServices
  let qc!: QueryClient
  const screenFor = (): ComponentType =>
    window.location.hash.startsWith('#/finding/') ? routes.finding : routes.findings
  const ui = (withScreens: boolean) => {
    const Screen = screenFor()
    return (
      <StoreProvider>
        <ConsoleProviders>
          <Probe ready={(s, v, c) => { store = s; svc = v; qc = c }} />
          {withScreens ? <Screen /> : null}
        </ConsoleProviders>
      </StoreProvider>
    )
  }
  const view = render(ui(false))
  if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
  return {
    store: () => store,
    svc: () => svc,
    qc: () => qc,
    run: (fn: () => unknown) => act(fn),
    show: () => view.rerender(ui(true)),
    unmount: view.unmount,
  }
}

describe('findings inventory (ticket 31)', () => {
  it('lists scoped accessible findings with severity counts; non-member projects are invisible', async () => {
    window.location.hash = '#/findings'
    const h = mountFindings('Riley Brooks') // analyst — member of RT-2026-014 only
    h.show()
    await waitFor(() => expect(screen.getByText('Excessive account privileges (simulated)')).toBeInTheDocument())
    expect(screen.getByText('AI suggestion: possible detection gap on api-01 (unverified)')).toBeInTheDocument()
    expect(screen.queryByText('Cloud lab configuration drift')).not.toBeInTheDocument() // FD-015 — RT-2026-015, not a member
    expect(screen.queryByText('Incomplete network segmentation')).not.toBeInTheDocument() // FD-009 — RT-2026-009
    // Severity KPIs count verified findings only: FD-011 (high) counts, FD-012 (medium, ai_suggested) does not.
    expect(screen.getByRole('button', { name: 'High 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Medium 0' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /AI Suggestions 1/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Confirmed1' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'AI Suggestions1' })).toBeInTheDocument()
    h.unmount()
  })

  it('search, severity and status filters apply to the scoped rows', async () => {
    window.location.hash = '#/findings'
    const h = mountFindings('Taylor Chen') // member of 014/015/016/017
    h.show()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'All3' })).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Search by ID or title…'), { target: { value: 'privileges' } })
    await waitFor(() => expect(screen.getByText('Excessive account privileges (simulated)')).toBeInTheDocument())
    expect(screen.queryByText('Cloud lab configuration drift')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'All1' })).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search by ID or title…'), { target: { value: '' } })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'All3' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: /AI Suggestions/ }))
    await waitFor(() => expect(screen.getByText('AI suggestion: possible detection gap on api-01 (unverified)')).toBeInTheDocument())
    expect(screen.queryByText('Excessive account privileges (simulated)')).not.toBeInTheDocument()
    h.unmount()
  })

  it('paginates the scoped rows across pages', async () => {
    window.location.hash = '#/findings'
    const h = mountFindings('Taylor Chen')
    h.show()
    h.run(() => h.store().setPid('RT-2026-014'))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'All2' })).toBeInTheDocument())
    h.run(() => {
      for (let i = 0; i < 9; i++) {
        h.store().A.createFinding({ projectId: 'RT-2026-014', title: `Pagination probe finding ${i + 1}`, severity: 'low', owner: 'Taylor Chen', kind: 'Configuration / access control', desc: 'd', scopeNote: '', asset: 'web-01', impact: 'i', rec: 'r', technique: '', op: '', evidence: [], severityReason: '' }, false)
      }
    })
    await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeInTheDocument())
    // The nine probes fill page 1; the older seeded suggestion lands on page 2.
    expect(screen.queryByText('AI suggestion: possible detection gap on api-01 (unverified)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.getByText('AI suggestion: possible detection gap on api-01 (unverified)')).toBeInTheDocument())
    h.unmount()
  })

  it('masks sensitive evidence names for roles without viewSensitive and shows them for permitted roles', async () => {
    window.location.hash = '#/finding/FD-011'
    const h = mountFindings('Casey Nguyen (Client)') // viewer — member of RT-2026-014, no viewSensitive
    h.show()
    await waitFor(() => expect(screen.getByText('Excessive account privileges (simulated)')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: /Evidence/ }))
    await waitFor(() => expect(screen.getByText('Sensitive file — redacted')).toBeInTheDocument())
    expect(screen.queryByText('evidence-027.png')).not.toBeInTheDocument()
    expect(screen.getByText('EV-014-02')).toBeInTheDocument() // the opaque reference stays visible
    h.unmount()

    window.location.hash = '#/finding/FD-011'
    const p = mountFindings('Taylor Chen') // operator — viewSensitive granted
    p.show()
    await waitFor(() => expect(screen.getByText('Excessive account privileges (simulated)')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: /Evidence/ }))
    await waitFor(() => expect(screen.getByText('evidence-027.png')).toBeInTheDocument())
    expect(screen.queryByText('Sensitive file — redacted')).not.toBeInTheDocument()
    p.unmount()
  })

  it('shows not-found for a missing or out-of-scope finding without leaking existence', async () => {
    window.location.hash = '#/finding/FD-999'
    const h = mountFindings('Taylor Chen')
    h.show()
    await waitFor(() => expect(screen.getByText('Finding not found')).toBeInTheDocument())
    expect(screen.getByText('ID FD-999 does not exist or is not available for your account.')).toBeInTheDocument()
    h.unmount()

    window.location.hash = '#/finding/FD-015'
    const p = mountFindings('Riley Brooks') // FD-015 is in RT-2026-015 — Riley is not a member
    p.show()
    await waitFor(() => expect(screen.getByText('Finding not found')).toBeInTheDocument())
    expect(screen.queryByText('Cloud lab configuration drift')).not.toBeInTheDocument()
    expect(screen.queryByText('A service role is granted broader permissions than policy allows.')).not.toBeInTheDocument()
    p.unmount()
  })

  it('refuses a cross-project finding without content and offers an explicit switch', async () => {
    window.location.hash = '#/finding/FD-011' // belongs to RT-2026-014
    const h = mountFindings('Sam Patel') // manager — reaches both projects
    h.show()
    await waitFor(() => expect(screen.getByText('Excessive account privileges (simulated)')).toBeInTheDocument())
    // Select RT-2026-015 (the store redirects a detail route to its list), then revisit the finding.
    h.run(() => h.store().setPid('RT-2026-015'))
    h.run(() => h.store().go('finding', { id: 'FD-011' }))
    await waitFor(() => expect(screen.getByText('Finding FD-011 belongs to another project')).toBeInTheDocument())
    expect(screen.getByText(/content from RT-2026-014 is not shown in this context/)).toBeInTheDocument()
    expect(screen.queryByText('Excessive account privileges (simulated)')).not.toBeInTheDocument()
    expect(screen.queryByText('A demo account in the lab holds more privileges than its business role requires.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to RT-2026-014' }))
    await waitFor(() => expect(h.store().pid).toBe('RT-2026-014'))
    // The explicit switch returns to the detail route with the matching scope.
    await waitFor(() => expect(screen.getByText('Excessive account privileges (simulated)')).toBeInTheDocument(), { timeout: 3000 })
    h.unmount()
  })

  it('renders AI suggestions as proposals — never as verified findings', async () => {
    window.location.hash = '#/findings'
    const h = mountFindings('Riley Brooks') // sees RT-2026-014 only: FD-011 verified + FD-012 suggested
    h.show()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'All2' })).toBeInTheDocument())
    // The severity KPI for medium stays 0 although the suggestion itself is medium.
    expect(screen.getByRole('button', { name: 'Medium 0' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /AI Suggestions 1/ })).toBeInTheDocument()
    expect(screen.getByText('unverified — not in counts')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'AI Suggestions1' }))
    await waitFor(() => expect(screen.getByText('AI suggestions are not verified findings')).toBeInTheDocument())
    h.unmount()

    window.location.hash = '#/finding/FD-012'
    const d = mountFindings('Riley Brooks')
    d.show()
    await waitFor(() => expect(screen.getAllByText('AI Suggested — unverified').length).toBeGreaterThan(0))
    expect(screen.getByText(/Proposed by the AI Operator. Not a finding yet/)).toBeInTheDocument()
    const report = screen.getByRole('button', { name: /Add to Report/i })
    expect(report).toBeDisabled()
    expect(report.getAttribute('title')).toContain('AI suggestions are unverified')
    d.unmount()
  })

  it('a legacy status change updates the migrated views without a reload (bridge proof)', async () => {
    window.location.hash = '#/findings'
    const h = mountFindings('Taylor Chen')
    h.show()
    h.run(() => h.store().setPid('RT-2026-014'))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'AI Suggestions1' })).toBeInTheDocument())
    expect(screen.queryByText('Bridge-proof probe')).not.toBeInTheDocument()
    // Legacy action (ticket 32 will replace it) moves the AI suggestion into review.
    h.run(() => h.store().A.setFindingStatus('FD-012', 'review', 'Verified from AI suggestion by a human'))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'AI Suggestions0' })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'In Review1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'In Review1' }))
    await waitFor(() => expect(screen.getByText('AI suggestion: possible detection gap on api-01 (unverified)')).toBeInTheDocument())
    expect(screen.getAllByText('In Review').length).toBeGreaterThan(0)
    h.unmount()
  })

  it('detail and creation links stay functional through the bridge', async () => {
    window.location.hash = '#/findings'
    const h = mountFindings('Taylor Chen')
    h.show()
    h.run(() => h.store().setPid('RT-2026-014')) // a specific project enables Create Finding
    await waitFor(() => expect(screen.getByText('Excessive account privileges (simulated)')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Excessive account privileges (simulated)'))
    await waitFor(() => expect(h.store().route.page).toBe('finding'))
    expect(h.store().route.id).toBe('FD-011')
    h.run(() => h.store().go('findings'))
    await waitFor(() => expect(h.store().route.page).toBe('findings'))
    fireEvent.click(screen.getByRole('button', { name: 'Create Finding' }))
    await waitFor(() => expect(h.store().route.page).toBe('finding-new'))
    h.unmount()
  })
})

describe('findings read handlers', () => {
  const taylor = { id: 'Taylor Chen', role: 'operator' as const }
  const allCtx: RequestContext = { actor: taylor, projectId: 'all', corr: 't' }

  it('excludes AI suggestions from the severity breakdown and workflow KPIs', () => {
    const res = listFindings(seed(), { actor: taylor, projectId: 'RT-2026-014', corr: 't' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.counts.ai).toBe(1)
      expect(res.data.severity.medium).toBe(0) // FD-012 is medium but ai_suggested
      expect(res.data.severity.high).toBe(1)
      expect(res.data.awaitingReview).toBe(0)
      expect(res.data.resolved).toBe(0)
    }
  })

  it('excludes dismissed suggestions only from the ai category', () => {
    const res = listFindings(seed(), { actor: taylor, projectId: 'RT-2026-014', corr: 't' }, { dismissed: ['FD-012'] })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.counts.ai).toBe(0)
      expect(res.data.counts.all).toBe(2) // still visible on the other tabs
    }
  })

  it('denies a non-member specific-project read without leaking existence', () => {
    const riley = { id: 'Riley Brooks', role: 'analyst' as const }
    const res = listFindings(seed(), { actor: riley, projectId: 'RT-2026-015', corr: 't' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.failure.kind).toBe('not-found')
  })

  it('clamps out-of-range pages into the valid range', () => {
    const high = listFindings(seed(), { actor: taylor, projectId: 'RT-2026-014', corr: 't' }, { page: 99 })
    const low = listFindings(seed(), { actor: taylor, projectId: 'RT-2026-014', corr: 't' }, { page: 0 })
    expect(high.ok && low.ok).toBe(true)
    if (high.ok && low.ok) {
      expect(high.data.page).toBe(1)
      expect(low.data.page).toBe(1)
    }
  })

  it('masks sensitive evidence for roles without viewSensitive and keeps references opaque', () => {
    const viewer = { id: 'Casey Nguyen (Client)', role: 'viewer' as const }
    const masked = getFinding(seed(), { actor: viewer, projectId: 'all', corr: 't' }, 'FD-011')
    const open = getFinding(seed(), { actor: taylor, projectId: 'all', corr: 't' }, 'FD-011')
    expect(masked.ok && open.ok).toBe(true)
    if (masked.ok && open.ok) {
      expect(masked.data.evidence[0]).toMatchObject({ ref: 'EV-014-02', masked: true, sensitive: true })
      expect(masked.data.evidence[0].name).toBeUndefined()
      expect(open.data.evidence[0]).toMatchObject({ ref: 'EV-014-02', masked: false, name: 'evidence-027.png' })
      expect(masked.data.canViewSensitive).toBe(false)
      expect(open.data.canViewSensitive).toBe(true)
    }
  })

  it('refuses a cross-project context with the owning project and no content', () => {
    const res = getFinding(seed(), { actor: taylor, projectId: 'RT-2026-015', corr: 't' }, 'FD-011')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.failure.kind).toBe('forbidden')
      expect(res.failure.entity?.projectId).toBe('RT-2026-014')
      expect(res.failure.message).not.toContain('Excessive account privileges')
    }
  })

  it('reports a missing finding as not-found', () => {
    const res = getFinding(seed(), allCtx, 'FD-999')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.failure.kind).toBe('not-found')
  })

  it('resolves the producing step observation for the detail read', () => {
    const res = getFinding(seed(), allCtx, 'FD-011')
    expect(res.ok).toBe(true)
    if (res.ok) {
      // S06 carries the finding's linked evidence (EV-014-02) and shares its technique.
      expect(res.data.step).toMatchObject({ id: 'S06', technique: 'T1078' })
      expect(res.data.project).toMatchObject({ id: 'RT-2026-014', client: 'Northwind Bank (Demo)' })
      expect(res.data.assetId).toBe('AS-0143')
      expect(res.data.operation).toMatchObject({ id: 'OP-014' })
      expect(res.data.inReports.map((r) => r.id)).toEqual(['REP-014'])
    }
  })
})
