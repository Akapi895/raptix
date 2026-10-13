/**
 * Ticket 46: session grant lifecycle — explicit, revocable, time-bound
 * per-user grants. The request/decision/revocation handlers enforce
 * membership, role, the self-review refusal and required reasons (refusals
 * commit nothing); the command handler denies interactive commands at
 * `now >= expiresAt` — deadline−1/deadline/deadline+1 against absolute
 * instants, with no console mounted and before any sweep; the sweep removes
 * expired records without a grace period while the session stays connected
 * (connection ≠ grant); the lifecycle continues with no C2 page mounted,
 * survives repeated mounting and demo reset; and the bridge works both
 * directions (typed decisions reach the legacy screens, legacy actions reach
 * the typed reads).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createElement, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConsoleProviders } from '../../state/query'
import { StoreProvider, useServices, useStore, type Store } from '../../store'
import { createConsoleServices, type ConsoleServices } from '../../domain/service-factory'
import type { Clock, RequestContext } from '../../domain/service'
import { routes } from '../../screens/h'
import {
  decideSessionRequestTransaction, requestSessionAccessTransaction, revokeGrantTransaction,
  sessionCommandTransaction, sweepExpiredGrants,
} from './grants'

afterEach(cleanup)

const MIN = 60_000
const alex = { id: 'Alex Morgan', role: 'manager' as const }
const taylor = { id: 'Taylor Chen', role: 'operator' as const }
const riley = { id: 'Riley Brooks', role: 'analyst' as const }
const ctx = (actor: RequestContext['actor'] = alex, projectId = 'RT-2026-014', corr = 't'): RequestContext => ({ actor, projectId, corr })
const clockAt = (t: number): Clock => ({ now: () => t })

let svc!: ConsoleServices
afterEach(() => { svc?.dispose() })

function Probe({ ready }: { ready: (s: Store, v: ConsoleServices) => void }) {
  ready(useStore(), useServices())
  return null
}

function mount(hash: string, me = 'Alex Morgan') {
  let store!: Store
  let services!: ConsoleServices
  window.location.hash = hash
  const page = hash.replace(/^#\//, '').split(/[/?]/)[0]
  const Screen = routes[page] ?? routes.c2
  const view = render(
    <StoreProvider>
      <ConsoleProviders>
        <Probe ready={(s, v) => { store = s; services = v }} />
        <Screen />
      </ConsoleProviders>
    </StoreProvider>,
  )
  if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
  return { store: () => store, svc: () => services, run: (fn: () => unknown) => act(fn), unmount: view.unmount }
}

/** Mounts the shell behind a toggle, so the C2 page can be unmounted while the provider (and the lifecycle) stays up. */
function mountToggle(me = 'Taylor Chen') {
  let store!: Store
  let services!: ConsoleServices
  let setOn!: (on: boolean) => void
  window.location.hash = '#/c2'
  function Switch() {
    const [on, set] = useState(false)
    setOn = set
    return on ? createElement(routes['c2-console']) : null
  }
  const view = render(
    <StoreProvider>
      <ConsoleProviders>
        <Probe ready={(s, v) => { store = s; services = v }} />
        <Switch />
      </ConsoleProviders>
    </StoreProvider>,
  )
  if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
  // setPid must run while the route is not a detail page (its redirect branch).
  act(() => { store.setPid('RT-2026-014') })
  return {
    store: () => store, svc: () => services,
    show: () => act(() => { store.go('c2-console', { id: 'SS-041' }); setOn(true) }),
    hide: () => act(() => setOn(false)),
    unmount: view.unmount,
  }
}

const approveRiley = (services: ConsoleServices, minutes = 30) =>
  decideSessionRequestTransaction(services.authority, services.clock, ctx(), { requestId: 'AR-012', decision: 'approved', note: 'Confirmed web profile findings', minutes })
const session = (id: string) => svc.authority.snapshot().sessions.find((s) => s.id === id)!
const request = (id: string) => svc.authority.snapshot().sessionRequests.find((r) => r.id === id)!

describe('grant requests (ticket 46: gated, reason-required, per user/session)', () => {
  it('refuses viewer/analyst roles, non-members, short reasons and duplicates — committing nothing', () => {
    svc = createConsoleServices()
    const before = svc.authority.snapshot().sessionRequests.map((r) => r.id)
    const input = { sessionId: 'SS-042', mode: 'interactive' as const, duration: '1 hour', reason: 'Validate step 8 output on the domain controller.' }
    const viewer = requestSessionAccessTransaction(svc.authority, svc.clock, ctx({ id: 'Casey Nguyen (Client)', role: 'viewer' }), input)
    expect(!viewer.ok && viewer.failure.kind).toBe('forbidden')
    const analyst = requestSessionAccessTransaction(svc.authority, svc.clock, ctx(riley), input)
    expect(!analyst.ok && analyst.failure.message).toContain('Your role (Analyst) cannot request interactive access.')
    const nonMember = requestSessionAccessTransaction(svc.authority, svc.clock, ctx(riley, 'RT-2026-015'), { ...input, sessionId: 'SS-043' })
    expect(!nonMember.ok && nonMember.failure.kind).toBe('not-found')
    const short = requestSessionAccessTransaction(svc.authority, svc.clock, ctx(taylor), { ...input, reason: 'need access' })
    expect(!short.ok && short.failure.kind).toBe('validation')
    const ok = requestSessionAccessTransaction(svc.authority, svc.clock, ctx(taylor), input)
    expect(ok.ok && ok.data.requestId).toBe('AR-013')
    const duplicate = requestSessionAccessTransaction(svc.authority, svc.clock, ctx(taylor), input)
    expect(!duplicate.ok && duplicate.failure.message).toContain('AR-013 is already pending')
    expect(svc.authority.snapshot().sessionRequests.map((r) => r.id)).toEqual(['AR-013', ...before])
    expect(request('AR-013')).toMatchObject({ sessionId: 'SS-042', by: 'Taylor Chen', status: 'pending' })
    expect(svc.authority.snapshot().audit[0]).toMatchObject({ action: 'Requested session access', obj: 'SS-042', result: 'Pending', actor: 'Taylor Chen' })
  })
})

describe('grant decisions (ticket 46: independent review, approver role, time-bound grant)', () => {
  it('refuses self-review, non-approvers, short notes and decided requests', () => {
    svc = createConsoleServices()
    const self = decideSessionRequestTransaction(svc.authority, svc.clock, ctx(riley), { requestId: 'AR-012', decision: 'approved', note: 'Confirmed web profile findings' })
    expect(!self.ok && self.failure.message).toContain('independent reviewer')
    const operator = decideSessionRequestTransaction(svc.authority, svc.clock, ctx(taylor), { requestId: 'AR-012', decision: 'approved', note: 'Confirmed web profile findings' })
    expect(!operator.ok && operator.failure.kind).toBe('forbidden')
    const shortNote = decideSessionRequestTransaction(svc.authority, svc.clock, ctx(), { requestId: 'AR-012', decision: 'rejected', note: 'nope' })
    expect(!shortNote.ok && shortNote.failure.kind).toBe('validation')
    const decided = decideSessionRequestTransaction(svc.authority, svc.clock, ctx(), { requestId: 'AR-011', decision: 'approved', note: 'Already decided earlier today' })
    expect(!decided.ok && decided.failure.kind).toBe('conflict')
    expect(request('AR-012').status).toBe('pending')
  })

  it('approval binds one per-user grant with an absolute expiry and leaves other grants untouched', () => {
    svc = createConsoleServices()
    const now = svc.clock.now()
    const res = approveRiley(svc)
    expect(res.ok && res.data.grantExpiresAt).toBe(now + 30 * MIN)
    expect(session('SS-042').grants).toEqual([{ user: 'Riley Brooks', perm: 'interactive', expires: 'Oct 13, 2026, 11:12 AM (UTC+7)', by: 'Alex Morgan' }])
    expect(session('SS-041').grants.map((g) => g.user)).toEqual(['Taylor Chen']) // per user/session: SS-041 untouched
    expect(request('AR-012')).toMatchObject({ status: 'approved', decidedBy: 'Alex Morgan' })
    expect(session('SS-042').transcript.some((l) => l.text === 'interactive access granted to Riley Brooks by Alex Morgan.')).toBe(true)
  })
})

describe('deadline authorization (ticket 46: denied at now >= expiresAt, handler-enforced)', () => {
  it('allows at deadline−1 and denies at deadline and deadline+1, before any sweep', () => {
    svc = createConsoleServices()
    const approved = approveRiley(svc)
    const deadline = approved.ok ? approved.data.grantExpiresAt! : 0
    const cmd = (t: number) => sessionCommandTransaction(svc.authority, clockAt(t), ctx(riley), { sessionId: 'SS-042', label: 'List exposed routes (simulated)' })
    expect(cmd(deadline - MIN).ok).toBe(true)
    const atDeadline = cmd(deadline)
    expect(!atDeadline.ok && atDeadline.failure.kind).toBe('forbidden')
    expect(!atDeadline.ok && atDeadline.failure.message).toContain('expired')
    expect(cmd(deadline + MIN).ok).toBe(false)
    expect(session('SS-042').transcript.filter((l) => l.who === 'user').length).toBe(1) // denied commands commit nothing
  })

  it('the sweep removes the expired grant without a grace period while the session stays connected', () => {
    svc = createConsoleServices()
    const approved = approveRiley(svc)
    const deadline = approved.ok ? approved.data.grantExpiresAt! : 0
    expect(sweepExpiredGrants(svc.authority, clockAt(deadline - MIN), 't').ok && session('SS-042').grants.length).toBe(1)
    const swept = sweepExpiredGrants(svc.authority, clockAt(deadline), 't')
    expect(swept.ok && swept.data).toEqual({ sessionIds: ['SS-042'], users: ['Riley Brooks'] })
    expect(session('SS-042').grants).toEqual([])
    expect(request('AR-012').status).toBe('expired')
    expect(session('SS-042').state).toBe('connected') // connection ≠ grant
    expect(session('SS-042').transcript.some((l) => l.text === 'Interactive grant for Riley Brooks expired.')).toBe(true)
    expect(svc.authority.snapshot().audit[0]).toMatchObject({ action: 'Session grant expired', obj: 'SS-042', result: 'Warning' })
    const again = sweepExpiredGrants(svc.authority, clockAt(deadline + MIN), 't')
    expect(again.ok && again.data.sessionIds).toEqual([]) // idempotent
  })
})

describe('revocation (ticket 46: reason-required, self-allowed, approver-gated for others)', () => {
  it('revokes own grants with a reason, refuses reasonless/foreign revocations, and is idempotent', () => {
    svc = createConsoleServices()
    const noReason = revokeGrantTransaction(svc.authority, svc.clock, ctx(taylor), { sessionId: 'SS-041', user: 'Taylor Chen' })
    expect(!noReason.ok && noReason.failure.kind).toBe('validation')
    const own = revokeGrantTransaction(svc.authority, svc.clock, ctx(taylor), { sessionId: 'SS-041', user: 'Taylor Chen', reason: 'Step complete — handing back control' })
    expect(own.ok).toBe(true)
    expect(session('SS-041').grants).toEqual([])
    expect(session('SS-041').state).toBe('connected')
    expect(session('SS-041').transcript.some((l) => l.text === 'Access for Taylor Chen revoked by Taylor Chen.')).toBe(true)
    const repeat = revokeGrantTransaction(svc.authority, svc.clock, ctx(taylor), { sessionId: 'SS-041', user: 'Taylor Chen', reason: 'Repeat' })
    expect(!repeat.ok && repeat.failure.kind).toBe('conflict')
    expect(approveRiley(svc).ok).toBe(true)
    const foreign = revokeGrantTransaction(svc.authority, svc.clock, ctx(taylor), { sessionId: 'SS-042', user: 'Riley Brooks', reason: 'Operator cannot revoke others' })
    expect(!foreign.ok && foreign.failure.kind).toBe('forbidden')
    const approver = revokeGrantTransaction(svc.authority, svc.clock, ctx(), { sessionId: 'SS-042', user: 'Riley Brooks', reason: 'Review step is done' })
    expect(approver.ok && session('SS-042').grants).toEqual([])
  })
})

describe('canonical lifecycle (ticket 46: deadlines without screens, reset, no duplicates)', () => {
  it('expires the seeded grant with no screen mounted, without a grace period or terminating the session', () => {
    svc = createConsoleServices()
    svc.clock.advance(33 * MIN)
    expect(session('SS-041').grants).toEqual([])
    expect(request('AR-011').status).toBe('expired')
    expect(session('SS-041').state).toBe('connected')
    const lines = () => session('SS-041').transcript.filter((l) => l.text === 'Interactive grant for Taylor Chen expired.').length
    expect(lines()).toBe(1)
    svc.clock.advance(15 * MIN)
    expect(lines()).toBe(1) // repeated sweeps never duplicate the record
  })

  it('demo reset re-arms the lifecycle against the fresh dataset', () => {
    svc = createConsoleServices()
    svc.clock.advance(33 * MIN)
    expect(session('SS-041').grants).toEqual([])
    svc.reset()
    expect(session('SS-041').grants.map((g) => g.user)).toEqual(['Taylor Chen'])
    svc.clock.advance(33 * MIN)
    expect(session('SS-041').grants).toEqual([])
  })

  it('expiry continues with no C2 page mounted and a remount shows the locked console exactly once', async () => {
    const h = mountToggle()
    h.show()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show host summary' })).toBeEnabled())
    h.hide() // no C2 page mounted — the factory lifecycle keeps running
    act(() => { h.svc().clock.advance(33 * MIN) })
    expect(h.store().db.sessions.find((s) => s.id === 'SS-041')!.grants).toEqual([])
    h.show()
    await waitFor(() => expect(screen.getByLabelText('Command input')).toBeDisabled())
    expect(h.store().db.sessions.find((s) => s.id === 'SS-041')!.transcript.filter((l) => l.text === 'Interactive grant for Taylor Chen expired.').length).toBe(1)
    h.unmount()
  })
})

describe('bridge proof (ticket 46: both directions)', () => {
  it('a typed decision reaches the mounted legacy sessions view', async () => {
    const h = mount('#/c2?tab=sessions', 'Riley Brooks')
    await waitFor(() => expect(screen.getAllByText('SS-042').length).toBeGreaterThan(0))
    h.run(() => { expect(approveRiley(h.svc()).ok).toBe(true) })
    await waitFor(() => expect(screen.getAllByText(/Interactive until/).length).toBeGreaterThan(0))
    expect(screen.queryByText('Pending request')).not.toBeInTheDocument()
    h.unmount()
  })

  it('a legacy request reaches the typed reads', async () => {
    const h = mount('#/c2?tab=sessions', 'Taylor Chen')
    h.run(() => {
      const r = h.store().A.requestSessionAccess('SS-042', 'interactive', '1 hour', 'Validate step 8 output on the domain controller.')
      expect(r.ok).toBe(true)
    })
    const read = await h.svc().c2(taylor, 'RT-2026-014').requests({ actor: taylor, projectId: 'RT-2026-014', corr: 't' })
    expect(read.ok && read.data.items.some((x) => x.id === 'AR-013' && x.status === 'pending')).toBe(true)
    h.unmount()
  })
})
