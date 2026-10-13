/**
 * Ticket 45: C2 overview, channels and session reads on typed services —
 * project scoping without existence leaks (non-member specific-project reads
 * are not-found), channel detail derived from canonical session data,
 * connection health reported separately from access permission, sensitive
 * masking gated on the shared viewSensitive policy action, deep links that
 * resolve, late-response isolation on project switch, and the legacy→Query
 * bridge (a legacy grant decision and the typed estop transitions update the
 * mounted overview without a reload — including the failure/unknown outcomes
 * that must NOT fake a termination).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ConsoleProviders } from '../../state/query'
import { StoreProvider, useServices, useStore, type Store } from '../../store'
import type { ConsoleServices } from '../../domain/service-factory'
import type { RequestContext } from '../../domain/service'
import { routes } from '../../screens/h'
import { seed } from '../../data'
import {
  acknowledgeEmergencyStopTransaction, failEmergencyStopTransaction, finalizeEmergencyStopTransaction,
  requestEmergencyStopTransaction, unknownEmergencyStopTransaction,
} from '../estop/service'
import { getChannel, getOverview, listAudit, listRequests, listSessions } from './service'

beforeEach(() => { window.location.hash = '' })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function Probe({ ready }: { ready: (s: Store, svc: ConsoleServices, qc: QueryClient) => void }) {
  const store = useStore()
  const services = useServices()
  const qc = useQueryClient()
  ready(store, services, qc)
  return null
}

function mountC2(hash: string, me = 'Alex Morgan') {
  let store!: Store
  let svc!: ConsoleServices
  let qc!: QueryClient
  window.location.hash = hash
  const Screen = routes[hash.startsWith('#/c2-channel') ? 'c2-channel' : 'c2']
  const view = render(
    <StoreProvider>
      <ConsoleProviders>
        <Probe ready={(s, v, c) => { store = s; svc = v; qc = c }} />
        <Screen />
      </ConsoleProviders>
    </StoreProvider>,
  )
  if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
  return {
    store: () => store,
    svc: () => svc,
    qc: () => qc,
    run: (fn: () => unknown) => act(fn),
    unmount: view.unmount,
  }
}

const opCtx = (projectId = 'RT-2026-014'): RequestContext => ({ actor: { id: 'Alex Morgan', role: 'manager' }, projectId, corr: 'test' })

describe('C2 overview (ticket 45)', () => {
  it('renders the scoped KPI band and infrastructure from the typed read', async () => {
    const h = mountC2('#/c2')
    await waitFor(() => expect(screen.getByText('2/4')).toBeInTheDocument()) // healthy nodes of the scoped base
    expect(screen.getByRole('tab', { name: 'Access Requests1' })).toBeInTheDocument()
    h.unmount()
  })

  it('a non-member specific-project read is refused without leaking data', async () => {
    const h = mountC2('#/c2', 'Riley Brooks') // analyst — member of RT-2026-014 only
    h.run(() => h.store().setPid('RT-2026-015'))
    await waitFor(() => expect(screen.getByText('C2 data could not be loaded')).toBeInTheDocument())
    expect(screen.getByText('C2 data for this project is not available for your account.')).toBeInTheDocument()
    expect(screen.queryByText('CH-015')).not.toBeInTheDocument()
    expect(screen.queryByText('fabrikam-https')).not.toBeInTheDocument()
    h.unmount()
  })

  it('stop outcomes update sessions without faking termination — failure and unknown leave sessions connected', async () => {
    const h = mountC2('#/c2?tab=sessions')
    await waitFor(() => expect(screen.getAllByText('SS-041').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Connected').length).toBeGreaterThanOrEqual(3)
    h.run(() => { h.store().A.emergencyStop('operation', 'OP-014', 'halt now') })
    await waitFor(() => expect(screen.getByText(/Emergency stop requested/)).toBeInTheDocument())
    // Requested: nothing terminated yet.
    expect(screen.getAllByText('Connected').length).toBeGreaterThanOrEqual(3)
    // Failure outcome: no acknowledgement — the session rows stay connected, never faked to ended.
    h.run(() => failEmergencyStopTransaction(h.svc().authority, h.svc().clock, opCtx(), { scope: 'operation', id: 'OP-014' }))
    await waitFor(() => expect(screen.getByText(/Emergency stop failed/)).toBeInTheDocument())
    expect(screen.getAllByText('Connected').length).toBeGreaterThanOrEqual(3)
    expect(screen.queryByText('Revoking')).not.toBeInTheDocument()
    // Unknown outcome: same — status unknown, sessions untouched.
    h.run(() => unknownEmergencyStopTransaction(h.svc().authority, h.svc().clock, opCtx(), { scope: 'operation', id: 'OP-014' }))
    await waitFor(() => expect(screen.getByText(/Emergency stop status unknown/)).toBeInTheDocument())
    expect(screen.getAllByText('Connected').length).toBeGreaterThanOrEqual(3)
    h.unmount()
  })

  it('acknowledgement and finalization revoke then terminate the linked sessions in the overview', async () => {
    const h = mountC2('#/c2?tab=sessions')
    await waitFor(() => expect(screen.getAllByText('SS-041').length).toBeGreaterThan(0))
    h.run(() => requestEmergencyStopTransaction(h.svc().authority, h.svc().clock, opCtx(), { scope: 'operation', id: 'OP-014', reason: 'halt now' }))
    h.run(() => acknowledgeEmergencyStopTransaction(h.svc().authority, h.svc().clock, opCtx(), { scope: 'operation', id: 'OP-014', reason: 'halt now' }))
    await waitFor(() => expect(screen.getAllByText('Revoking').length).toBeGreaterThanOrEqual(2))
    expect(screen.getByText(/Emergency stop acknowledged/)).toBeInTheDocument()
    h.run(() => finalizeEmergencyStopTransaction(h.svc().authority, h.svc().clock, opCtx(), { scope: 'operation', id: 'OP-014' }))
    await waitFor(() => expect(screen.getAllByText('Terminated').length).toBeGreaterThanOrEqual(2))
    // Out-of-scope session SS-043 is untouched by the scoped stop.
    expect(screen.getAllByText('Connected').length).toBeGreaterThanOrEqual(1)
    h.unmount()
  })
})

describe('sessions tab (ticket 45)', () => {
  it('lists only accessible sessions; links resolve to the session detail route', async () => {
    const h = mountC2('#/c2?tab=sessions', 'Riley Brooks')
    h.run(() => h.store().setPid('RT-2026-014'))
    await waitFor(() => expect(screen.getAllByText('SS-041').length).toBeGreaterThan(0))
    expect(screen.getByText('SS-042')).toBeInTheDocument()
    expect(screen.queryByText('SS-043')).not.toBeInTheDocument() // RT-2026-015 — isolated
    fireEvent.click(screen.getAllByText('SS-041')[0])
    await waitFor(() => expect(window.location.hash).toBe('#/c2-session/SS-041'))
    h.unmount()
  })

  it('reports connection health separately from the actor access grant', async () => {
    const h = mountC2('#/c2?tab=sessions', 'Taylor Chen')
    await waitFor(() => expect(screen.getAllByText('SS-042').length).toBeGreaterThan(0))
    // SS-042 is Connected while this actor's access is Read-only.
    const row = screen.getByText('SS-042').closest('tr')!
    expect(row).toHaveTextContent('Connected')
    expect(row).toHaveTextContent('Read-only')
    // SS-041 carries this actor's interactive grant expiring today.
    const granted = screen.getByText('SS-041').closest('tr')!
    expect(granted).toHaveTextContent('Interactive until')
    expect(granted).toHaveTextContent('Connected')
    h.unmount()
  })

  it('a legacy grant decision refetches the mounted session list through the bridge', async () => {
    const h = mountC2('#/c2?tab=sessions', 'Riley Brooks')
    h.run(() => h.store().setPid('RT-2026-014'))
    await waitFor(() => expect(screen.getAllByText('SS-042').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Pending request').length).toBeGreaterThan(0)
    // Legacy store action (ticket 46 will migrate it): one commit publishes
    // the session + session-request ChangeSets the mounted reads observe.
    h.run(() => h.store().A.decideSessionRequest('AR-012', 'approved', 'Confirmed web profile findings', 30))
    await waitFor(() => expect(screen.getAllByText(/Interactive until/).length).toBeGreaterThan(0))
    expect(screen.queryByText('Pending request')).not.toBeInTheDocument()
    h.unmount()
  })

  it('a legacy access request submitted from the row action reaches the typed reads', async () => {
    const h = mountC2('#/c2?tab=sessions', 'Riley Brooks')
    h.run(() => h.store().setPid('RT-2026-014'))
    await waitFor(() => expect(screen.getAllByText('SS-041').length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByRole('button', { name: 'Request access' })[0])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit request' })).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/Why do you need this access/), { target: { value: 'Validate step 8 output on the domain controller.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }))
    // The legacy action commits through the shared authority (the drawer then
    // navigates to the session detail; return to the overview's sessions tab).
    h.run(() => h.store().go('c2', { tab: 'sessions' }))
    await waitFor(() => expect(screen.getAllByText('Pending request').length).toBeGreaterThanOrEqual(2))
    h.unmount()
  })

  it('filters the scoped rows and resets to the first page', async () => {
    const h = mountC2('#/c2?tab=sessions')
    await waitFor(() => expect(screen.getAllByText('SS-041').length).toBeGreaterThan(0))
    fireEvent.change(screen.getByPlaceholderText('Search session, target, agent…'), { target: { value: 'cloud-app' } })
    await waitFor(() => expect(screen.getByText('SS-043')).toBeInTheDocument())
    expect(screen.queryByText('SS-041')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter by connection'), { target: { value: 'ended' } })
    await waitFor(() => expect(screen.getByText(/No sessions/)).toBeInTheDocument()) // no ended sessions match 'cloud-app'
    fireEvent.change(screen.getByPlaceholderText('Search session, target, agent…'), { target: { value: '' } })
    await waitFor(() => expect(screen.getByText('SS-040')).toBeInTheDocument()) // the ended seeded session
    h.unmount()
  })
})

describe('channels (ticket 45)', () => {
  it('the channels tab links resolve to the channel detail route', async () => {
    const h = mountC2('#/c2?tab=channels')
    await waitFor(() => expect(screen.getAllByText('CH-014').length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText('CH-014')[0])
    await waitFor(() => expect(window.location.hash).toBe('#/c2-channel/CH-014'))
    h.unmount()
  })

  it('derives the channel detail from canonical session data', async () => {
    const h = mountC2('#/c2-channel/CH-014')
    await waitFor(() => expect(screen.getByText(/lab-c2-01/)).toBeInTheDocument())
    expect(screen.getByText('CH-014')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Connected agents/ }))
    await waitFor(() => expect(screen.getByText('WIN-LAB-01')).toBeInTheDocument())
    expect(screen.getByText('LAB-LNX-01')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Related operations/ }))
    await waitFor(() => expect(screen.getByText('OP-014')).toBeInTheDocument())
    expect(screen.queryByText('OP-015')).not.toBeInTheDocument() // other channel
    h.unmount()
  })

  it('a channel of another project is not found out of scope', async () => {
    // Riley (analyst) is not a member of RT-2026-015 — the deep link refuses
    // without leaking the channel's existence. (A project switch from a
    // detail route also redirects to the parent list — setPid semantics.)
    const h = mountC2('#/c2-channel/CH-015', 'Riley Brooks')
    await waitFor(() => expect(screen.getByText('Channel not found')).toBeInTheDocument())
    expect(screen.getAllByText(/No channel "CH-015" in this project/).length).toBeGreaterThan(0)
    expect(screen.queryByText('fabrikam-https')).not.toBeInTheDocument()
    h.unmount()
  })

  it('masks the callback configuration for roles without viewSensitive and reveals it for holders', async () => {
    const viewer = mountC2('#/c2-channel/CH-014', 'Casey Nguyen (Client)')
    await waitFor(() => expect(screen.getByText('••••••••••')).toBeInTheDocument())
    expect(screen.getByText('masked — Organization Admin only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show' })).not.toBeInTheDocument()
    viewer.unmount()
    const admin = mountC2('#/c2-channel/CH-014')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show' })).toBeInTheDocument())
    expect(screen.getByText('••••••••••')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    await waitFor(() => expect(screen.getByText('northwind-https.callback.demo:443')).toBeInTheDocument())
    admin.unmount()
  })
})

describe('requests and audit tabs (ticket 45)', () => {
  it('shows pending requests first and keeps the legacy decision actions working', async () => {
    const h = mountC2('#/c2?tab=requests')
    await waitFor(() => expect(screen.getByText('AR-012')).toBeInTheDocument())
    const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '')
    expect(rows.findIndex((t) => t.includes('AR-012'))).toBeLessThan(rows.findIndex((t) => t.includes('AR-011')))
    h.unmount()
  })

  it('scopes audit views and finds events by correlation id', async () => {
    const h = mountC2('#/c2?tab=audit', 'Riley Brooks')
    h.run(() => h.store().setPid('RT-2026-014'))
    await waitFor(() => expect(screen.getByText('Requested interactive session access')).toBeInTheDocument())
    expect(screen.queryByText('Started operation')).not.toBeInTheDocument() // AU-6 belongs to RT-2026-015 and does not match the access view
    fireEvent.change(screen.getByPlaceholderText('Search or paste COR-014-01…'), { target: { value: 'COR-014-01' } })
    await waitFor(() => expect(screen.getByText('Approved session access')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Policy decisions' }))
    await waitFor(() => expect(screen.getByText('Blocked tool call')).toBeInTheDocument())
    h.unmount()
  })
})

describe('late-response isolation (ticket 45)', () => {
  it('a delayed response for a superseded scope never restores old visibility', async () => {
    let resolveGate!: () => void
    const gate = new Promise<void>((r) => { resolveGate = r })
    const h = mountC2('#/c2')
    const svc = h.svc()
    const orig = svc.c2.bind(svc)
    vi.spyOn(svc, 'c2').mockImplementation((actor, project) => {
      const inner = orig(actor, project)
      if (project !== 'all') return inner
      return { ...inner, overview: async (ctx) => { await gate; return inner.overview(ctx) } }
    })
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument())
    h.run(() => h.store().setPid('RT-2026-014'))
    await waitFor(() => expect(screen.getByText('2/3')).toBeInTheDocument())
    await act(async () => { resolveGate(); await Promise.resolve() })
    expect(screen.getByText('2/3')).toBeInTheDocument()
    expect(screen.queryByText('CH-015')).not.toBeInTheDocument()
    const stale = h.qc().getQueryCache().findAll({ queryKey: ['session'] })
      .find((q) => (q.queryKey[1] as { project?: string }).project === 'all')
    expect(stale?.state.data).toBeUndefined()
    h.unmount()
  })
})

describe('C2 read handlers', () => {
  const alex = { id: 'Alex Morgan', role: 'manager' as const }
  const allCtx: RequestContext = { actor: alex, projectId: 'all', corr: 't' }

  it('overview counts pool agents in aggregate but project agents only in project scope', () => {
    const all = getOverview(seed(), allCtx)
    const p14 = getOverview(seed(), { actor: alex, projectId: 'RT-2026-014', corr: 't' })
    expect(all.ok && p14.ok).toBe(true)
    if (all.ok && p14.ok) {
      expect(all.data.connectedAgents).toBe(8) // every connected agent of accessible projects + pool
      expect(p14.data.connectedAgents).toBe(2) // AG-007 + AG-008; AG-009 is lost, pool excluded
      expect(p14.data.sessionCounts.active).toBe(2)
      expect(p14.data.noC2).toBe(false)
      expect(all.data.nodes.map((n) => n.id)).toContain('C2-04') // unassigned nodes stay visible in aggregate
    }
  })

  it('denies a non-member project overview without leaking node or channel existence', () => {
    const riley = { id: 'Riley Brooks', role: 'analyst' as const }
    const res = getOverview(seed(), { actor: riley, projectId: 'RT-2026-015', corr: 't' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.failure.kind).toBe('not-found')
  })

  it('session filters combine and pages clamp into the valid range', () => {
    const d = seed()
    const filtered = listSessions(d, allCtx, { q: 'web-01', connection: 'connected', type: 'web', access: 'read-only' })
    expect(filtered.ok && filtered.data.items.map((r) => r.id)).toEqual(['SS-042'])
    const high = listSessions(d, allCtx, { page: 99 })
    const low = listSessions(d, allCtx, { page: 0 })
    expect(high.ok && low.ok).toBe(true)
    if (high.ok && low.ok) {
      expect(high.data.page).toBe(1)
      expect(low.data.page).toBe(1)
      expect(high.data.total).toBe(4)
    }
  })

  it('requests sort pending first; audit views partition without cross-project leakage', () => {
    const d = seed()
    const reqs = listRequests(d, allCtx)
    expect(reqs.ok).toBe(true)
    if (reqs.ok) expect(reqs.data.items.map((r) => r.id)).toEqual(['AR-012', 'AR-011'])
    const audit = listAudit(d, { actor: alex, projectId: 'RT-2026-014', corr: 't' }, { view: 'term' })
    expect(audit.ok).toBe(true)
    if (audit.ok) expect(audit.data.total).toBe(0) // no termination events for RT-2026-014 yet
    const denied = listAudit(d, { actor: { id: 'Riley Brooks', role: 'analyst' }, projectId: 'RT-2026-015', corr: 't' }, { view: 'access' })
    expect(denied.ok).toBe(false)
  })

  it('channel detail is not-found out of scope and gates masking on the policy action', () => {
    const d = seed()
    const ok = getChannel(d, { actor: alex, projectId: 'RT-2026-014', corr: 't' }, 'CH-014')
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.data.sessions.map((s) => s.id).sort()).toEqual(['SS-040', 'SS-041', 'SS-042']) // terminated SS-040 stays visible (recorded perm ≠ none)
      expect(ok.data.canViewSensitive).toBe(true)
    }
    const otherProject = getChannel(d, allCtx, 'CH-015')
    expect(otherProject.ok).toBe(true)
    if (otherProject.ok) expect(otherProject.data.channel.projectId).toBe('RT-2026-015')
    const outOfScope = getChannel(d, { actor: { id: 'Riley Brooks', role: 'analyst' }, projectId: 'RT-2026-014', corr: 't' }, 'CH-015')
    expect(outOfScope.ok).toBe(false)
    if (!outOfScope.ok) expect(outOfScope.failure.kind).toBe('not-found')
    const viewer = getChannel(d, { actor: { id: 'Casey Nguyen (Client)', role: 'viewer' }, projectId: 'RT-2026-014', corr: 't' }, 'CH-014')
    expect(viewer.ok).toBe(true)
    if (viewer.ok) {
      expect(viewer.data.canViewSensitive).toBe(false)
      expect(viewer.data.sessions).toEqual([]) // recorded perm none — connection state is separate
    }
  })
})
