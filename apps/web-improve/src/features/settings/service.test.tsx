/**
 * Ticket 56: organization settings handlers and bridge — profile edits
 * persist for the demo session and invalidate the Query views, the members
 * list carries roles/statuses with masking, every organization write is
 * admin-gated at the handler with a renderable reason, and the bridge is
 * observed in both directions: a service write reaches the legacy consumer
 * and the persona projection (the switcher lands on the changed role), while
 * a legacy project mutation refetches the typed members view without a
 * reload. Screen cases pin the migrated org tab: dirty/save through the
 * typed service and the read-only viewer gate.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ConsoleProviders } from '../../state/query'
import { StoreProvider, useServices, useStore, type Store } from '../../store'
import type { ConsoleServices } from '../../domain/service-factory'
import { createDatabaseAuthority } from '../../domain/database'
import { MockClock } from '../../domain/clock'
import type { ActorRef, RequestContext, ServiceResult } from '../../domain/service'
import { getOrgMembers, getOrgProfile, inviteMember, setMemberRole, setMemberStatus, updateOrgProfile, type OrgProfile } from './service'
import { useOrgMembers, useOrgProfile } from './query'
import { routes } from '../../screens/f'

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = '' })

/* ───────────── handler harness ───────────── */
function harness() {
  const clock = new MockClock()
  return { clock, authority: createDatabaseAuthority(clock) }
}
const actor = (id: string, role: ActorRef['role']): ActorRef => ({ id, role })
const ctxOf = (a: ActorRef, projectId = 'all', corr = 't'): RequestContext => ({ actor: a, projectId, corr })
const dana = actor('Dana Whitfield', 'admin')
const alex = actor('Alex Morgan', 'manager')
const pat = actor('Pat Kim', 'reviewer')
const taylor = actor('Taylor Chen', 'operator')
const casey = actor('Casey Nguyen (Client)', 'viewer')

describe('organization profile handler (ticket 56)', () => {
  it('updates the profile in one commit with its audit row and persists for the session', () => {
    const h = harness()
    const res = updateOrgProfile(h.authority, h.clock, ctxOf(dana, 'all', 'org-save'), { name: 'Acme Northwind (Demo)', landing: 'Projects' })
    expect(res.ok).toBe(true)
    const db = h.authority.snapshot()
    expect(db.org.profile).toMatchObject({ name: 'Acme Northwind (Demo)', landing: 'Projects', tz: 'Asia/Ho_Chi_Minh (UTC+7)' })
    expect(db.audit[0]).toMatchObject({ action: 'Updated organization settings', obj: 'ORG', actor: 'Dana Whitfield', reason: 'name, landing' })
    // A fresh read from the same authority observes the committed profile.
    const reread = getOrgProfile(db, ctxOf(dana))
    expect(reread.ok && reread.data?.profile.name).toBe('Acme Northwind (Demo)')
    h.authority.reset()
    expect(h.authority.snapshot().org.profile.name).toBe('Acme Security (Demo)')
  })

  it('validates name, contact format and the workspace default; a refused save commits nothing', () => {
    const h = harness()
    const audits = h.authority.snapshot().audit.length
    expect(updateOrgProfile(h.authority, h.clock, ctxOf(dana), { name: '   ' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: 'Enter an organization name.' }) })
    expect(updateOrgProfile(h.authority, h.clock, ctxOf(dana), { contact: 'not-an-email' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: 'Enter a valid admin contact email.' }) })
    expect(updateOrgProfile(h.authority, h.clock, ctxOf(dana), { defWorkspace: 'WS-03' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: 'A read-only workspace cannot be the default.' }) })
    expect(updateOrgProfile(h.authority, h.clock, ctxOf(dana), { defWorkspace: 'WS-99' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation' }) })
    expect(h.authority.snapshot().org.profile.name).toBe('Acme Security (Demo)')
    expect(h.authority.snapshot().audit.length).toBe(audits)
    h.authority.reset()
  })

  it('is admin-only at the handler with a renderable refusal reason', () => {
    const h = harness()
    expect(updateOrgProfile(h.authority, h.clock, ctxOf(alex), { name: 'Nope' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('Only Organization Admins can edit organization settings') }) })
    expect(updateOrgProfile(h.authority, h.clock, ctxOf(casey), { name: 'Nope' }).ok).toBe(false)
    expect(h.authority.snapshot().org.profile.name).toBe('Acme Security (Demo)')
    h.authority.reset()
  })

  it('masks the admin contact for non-admin readers; admins see it in full', () => {
    const h = harness()
    const masked = getOrgProfile(h.authority.snapshot(), ctxOf(alex))
    const open = getOrgProfile(h.authority.snapshot(), ctxOf(dana))
    expect(masked.ok && open.ok).toBe(true)
    if (masked.ok && open.ok) {
      expect(masked.data.contactMasked).toBe(true)
      expect(masked.data.profile.contact).toMatch(/^d•+@acme-security\.example\.test$/)
      expect(masked.data.profile.contact).not.toContain('dana.whitfield')
      expect(open.data.contactMasked).toBe(false)
      expect(open.data.profile.contact).toBe('dana.whitfield@acme-security.example.test')
    }
    h.authority.reset()
  })
})

describe('organization members handler (ticket 56)', () => {
  it('lists members with seeded roles and statuses; a committed override is observed by fresh reads', () => {
    const h = harness()
    const res = getOrgMembers(h.authority.snapshot(), ctxOf(dana))
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.members).toHaveLength(8)
      expect(res.data.members.find((m) => m.name === 'Taylor Chen')).toMatchObject({ role: 'operator', seededRole: 'operator', overridden: false, locked: false, revoked: false })
      expect(res.data.canEdit).toBe(true)
    }
    const changed = setMemberRole(h.authority, h.clock, ctxOf(dana, 'all', 'role'), 'Taylor Chen', 'reviewer', 'Covering the review backlog')
    expect(changed.ok).toBe(true)
    if (changed.ok) expect(changed.data).toMatchObject({ role: 'reviewer', overridden: true, seededRole: 'operator' })
    expect(h.authority.snapshot().org.members['Taylor Chen']).toMatchObject({ role: 'reviewer' })
    expect(h.authority.snapshot().audit[0]).toMatchObject({ action: 'Changed user role', obj: 'Taylor Chen', reason: expect.stringContaining('operator to reviewer') })
    h.authority.reset()
  })

  it('tracks lock/revoke with reasons and refuses repeats; unlock needs no reason', () => {
    const h = harness()
    expect(setMemberStatus(h.authority, h.clock, ctxOf(dana), 'Riley Brooks', 'revoke', '   ')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('reason is required') }) })
    expect(setMemberStatus(h.authority, h.clock, ctxOf(dana), 'Dana Whitfield', 'lock', 'self')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: 'You cannot change your own account status.' }) })
    const revoked = setMemberStatus(h.authority, h.clock, ctxOf(dana), 'Riley Brooks', 'revoke', 'Offboarding (simulated)')
    expect(revoked.ok).toBe(true)
    if (revoked.ok) expect(revoked.data).toMatchObject({ revoked: true })
    expect(setMemberStatus(h.authority, h.clock, ctxOf(dana), 'Riley Brooks', 'revoke', 'again')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('already revoked') }) })
    expect(h.authority.snapshot().audit[0]).toMatchObject({ action: 'Revoked access', obj: 'Riley Brooks', reason: 'Offboarding (simulated)' })
    // Unlock keeps the revoke history off but clears the lock flag without a reason.
    const locked = setMemberStatus(h.authority, h.clock, ctxOf(dana), 'Taylor Chen', 'lock', 'Shared credentials detected')
    expect(locked.ok).toBe(true)
    const unlocked = setMemberStatus(h.authority, h.clock, ctxOf(dana), 'Taylor Chen', 'unlock', '')
    expect(unlocked.ok).toBe(true)
    if (unlocked.ok) expect(unlocked.data.locked).toBe(false)
    h.authority.reset()
  })

  it('gates every member write to admins with reasons', () => {
    const h = harness()
    const gate = { kind: 'forbidden', message: 'Only Organization Admins can change user access. Ask an admin to make the change.' }
    expect(setMemberRole(h.authority, h.clock, ctxOf(alex), 'Taylor Chen', 'reviewer', 'r')).toEqual({ ok: false, failure: expect.objectContaining(gate) })
    expect(setMemberStatus(h.authority, h.clock, ctxOf(pat), 'Taylor Chen', 'lock', 'r')).toEqual({ ok: false, failure: expect.objectContaining(gate) })
    expect(setMemberRole(h.authority, h.clock, ctxOf(dana), 'Taylor Chen', 'reviewer', '   ')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('reason is required') }) })
    expect(setMemberRole(h.authority, h.clock, ctxOf(dana), 'Nobody', 'reviewer', 'r')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    h.authority.reset()
  })

  it('masks client personnel emails below admin and refuses the list to non-staff', () => {
    const h = harness()
    expect(getOrgMembers(h.authority.snapshot(), ctxOf(taylor))).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('visible to Organization Admins, Red Team Managers and Reviewers') }) })
    const reviewer = getOrgMembers(h.authority.snapshot(), ctxOf(pat))
    const admin = getOrgMembers(h.authority.snapshot(), ctxOf(dana))
    expect(reviewer.ok && admin.ok).toBe(true)
    if (reviewer.ok && admin.ok) {
      expect(reviewer.data.members.find((m) => m.name === 'Casey Nguyen (Client)')!.email).toMatch(/^c•+@northwind\.example\.test$/)
      expect(reviewer.data.members.find((m) => m.name === 'Taylor Chen')!.email).toContain('taylor.chen')
      expect(admin.data.members.find((m) => m.name === 'Casey Nguyen (Client)')!.email).toContain('casey.nguyen')
    }
    h.authority.reset()
  })

  it('records invitations with validation: format, duplicates and org-wide admins', () => {
    const h = harness()
    const ok = inviteMember(h.authority, h.clock, ctxOf(dana), { email: 'new.person@acme-security.example.test', role: 'analyst', project: '', days: '7', note: '' })
    expect(ok.ok).toBe(true)
    expect(h.authority.snapshot().org.invites[0]).toMatchObject({ email: 'new.person@acme-security.example.test', role: 'analyst' })
    expect(h.authority.snapshot().audit[0]).toMatchObject({ action: 'Invited user', obj: 'new.person@acme-security.example.test' })
    expect(inviteMember(h.authority, h.clock, ctxOf(dana), { email: 'new.person@acme-security.example.test', role: 'analyst', project: '', days: '7', note: '' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('already exists or has been invited') }) })
    expect(inviteMember(h.authority, h.clock, ctxOf(dana), { email: 'alex.morgan@acme-security.example.test', role: 'viewer', project: '', days: '7', note: '' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict' }) })
    expect(inviteMember(h.authority, h.clock, ctxOf(dana), { email: 'bad-email', role: 'viewer', project: '', days: '7', note: '' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: 'Enter a valid email address.' }) })
    expect(inviteMember(h.authority, h.clock, ctxOf(dana), { email: 'x@y.test', role: 'admin', project: 'RT-2026-014', days: '7', note: '' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('organization-wide access') }) })
    expect(inviteMember(h.authority, h.clock, ctxOf(alex), { email: 'z@y.test', role: 'viewer', project: '', days: '7', note: '' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden' }) })
    h.authority.reset()
  })
})

/* ───────────── bridge harness (legacy store + services, one authority) ───────────── */
function BridgeProbe({ ready }: { ready: (s: Store, svc: ConsoleServices) => void }) {
  ready(useStore(), useServices())
  return null
}
function mountBridge(me = 'Alex Morgan') {
  let store!: Store
  let svc!: ConsoleServices
  const view = render(
    <StoreProvider>
      <BridgeProbe ready={(s, v) => { store = s; svc = v }} />
    </StoreProvider>,
  )
  if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
  return { store: () => store, svc: () => svc, run: (fn: () => unknown) => act(fn), unmount: view.unmount }
}

describe('bridge both directions for organization settings', () => {
  it('a service profile save is observed by the legacy consumer and the audit history (new → legacy)', async () => {
    const h = mountBridge('Dana Whitfield')
    let res!: ServiceResult<OrgProfile>
    await act(async () => {
      res = await h.svc().settings(dana, 'all').updateProfile(ctxOf(dana, 'all', 'svc'), { name: 'Bridged Org (Demo)' })
    })
    expect(res.ok).toBe(true)
    expect(h.store().db.org.profile.name).toBe('Bridged Org (Demo)')
    expect(h.store().db).toBe(h.svc().authority.snapshot())
    expect(h.store().db.audit[0]).toMatchObject({ action: 'Updated organization settings', obj: 'ORG' })
    h.unmount()
  })

  it('a committed member role change reaches the persona projection — the switcher lands on the new role', async () => {
    const h = mountBridge('Taylor Chen')
    expect(h.store().me.role).toBe('operator')
    await act(async () => {
      await h.svc().settings(dana, 'all').setMemberRole(ctxOf(dana, 'all', 'svc'), 'Taylor Chen', 'reviewer', 'Promoted in settings')
    })
    // The current persona's identity reflects the member change immediately.
    expect(h.store().me.role).toBe('reviewer')
    // ...and it survives a persona round-trip through the switcher.
    h.run(() => h.store().setMe('Casey Nguyen (Client)'))
    h.run(() => h.store().setMe('Taylor Chen'))
    expect(h.store().me.role).toBe('reviewer')
    h.unmount()
  })

  it('a legacy project mutation refetches the typed members view without a reload (legacy → new)', async () => {
    window.location.hash = '#/settings'
    const Probe = () => {
      const store = useStore()
      const services = useServices()
      const qc = useQueryClient()
      void qc
      ready0.store = store
      ready0.svc = services
      return <OrgViews />
    }
    const ready0 = { store: null as Store | null, svc: null as ConsoleServices | null }
    const view = render(
      <StoreProvider>
        <ConsoleProviders>
          <Probe />
        </ConsoleProviders>
      </StoreProvider>,
    )
    const h = { store: () => ready0.store!, run: (fn: () => unknown) => act(fn), unmount: view.unmount }
    await waitFor(() => expect(screen.getByTestId('riley-projects')).toHaveTextContent('RT-2026-014'))
    expect(screen.getByTestId('riley-projects')).not.toHaveTextContent('RT-2026-015')
    // Legacy action (projects domain): adds Riley to RT-2026-015 — the org
    // members view refetches through the bridge and shows the membership.
    const p = h.store().db.projects.find((x) => x.id === 'RT-2026-015')!
    h.run(() => h.store().A.updateProject('RT-2026-015', { members: [...p.members, { user: 'Riley Brooks', role: 'analyst', since: 'Oct 14, 2026' }] }))
    await waitFor(() => expect(screen.getByTestId('riley-projects')).toHaveTextContent('RT-2026-015'))
    h.unmount()
  })
})

/** Renders the typed org views for the bridge probes. */
function OrgProbe({ ready }: { ready: (s: Store, svc: ConsoleServices, qc: QueryClient) => void }) {
  ready(useStore(), useServices(), useQueryClient())
  return <OrgViews />
}

function OrgViews() {  const q = useOrgProfile()
  const m = useOrgMembers()
  return (
    <div>
      <div data-testid="org-name">{q.data?.profile.name ?? 'loading'}</div>
      <div data-testid="org-contact">{q.data?.profile.contact ?? '—'}</div>
      <div data-testid="member-count">{m.data?.members.length ?? '—'}</div>
      <div data-testid="taylor-role">{m.data?.members.find((x) => x.name === 'Taylor Chen')?.role ?? '—'}</div>
      <div data-testid="riley-projects">{m.data?.members.find((x) => x.name === 'Riley Brooks')?.projects.join(',') ?? '—'}</div>
    </div>
  )
}

describe('org Query views (invalidation through the ChangeSet bridge)', () => {
  function mountOrg(me = 'Dana Whitfield') {
    let store!: Store
    let svc!: ConsoleServices
    let qc!: QueryClient
    const view = render(
      <StoreProvider>
        <ConsoleProviders>
          <OrgProbe ready={(s, v, c) => { store = s; svc = v; qc = c }} />
        </ConsoleProviders>
      </StoreProvider>,
    )
    if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
    return { store: () => store, svc: () => svc, qc: () => qc, run: (fn: () => unknown) => act(fn), unmount: view.unmount }
  }

  it('a profile save invalidates the org views: the probe shows the committed name without a reload', async () => {
    const h = mountOrg('Dana Whitfield')
    await waitFor(() => expect(screen.getByTestId('org-name')).toHaveTextContent('Acme Security (Demo)'))
    let res!: unknown
    await act(async () => {
      res = await h.svc().settings(dana, 'all').updateProfile(ctxOf(dana, 'all', 'svc'), { name: 'Renamed Via Service (Demo)' })
    })
    expect(res).toMatchObject({ ok: true })
    await waitFor(() => expect(screen.getByTestId('org-name')).toHaveTextContent('Renamed Via Service (Demo)'))
    h.unmount()
  })

  it('a role change invalidates the members view and the viewer is refused the list with the reason', async () => {
    window.location.hash = '#/settings'
    const h = mountOrg('Casey Nguyen (Client)')
    await waitFor(() => expect(screen.getByTestId('taylor-role')).toHaveTextContent('—')) // forbidden read renders fallbacks
    h.unmount()

    const admin = mountOrg('Dana Whitfield')
    await waitFor(() => expect(screen.getByTestId('taylor-role')).toHaveTextContent('operator'))
    await act(async () => {
      await admin.svc().settings(dana, 'all').setMemberRole(ctxOf(dana, 'all', 'svc'), 'Taylor Chen', 'reviewer', 'Backlog coverage')
    })
    await waitFor(() => expect(screen.getByTestId('taylor-role')).toHaveTextContent('reviewer'))
    admin.unmount()
  })
})

/* ───────────── migrated settings screen (org tab wiring) ───────────── */
function ScreenProbe({ ready }: { ready: (s: Store, svc: ConsoleServices) => void }) {
  ready(useStore(), useServices())
  return null
}
function mountScreenRoute(me = 'Dana Whitfield') {
  let store!: Store
  let svc!: ConsoleServices
  const ui = (node: React.ReactNode) => (
    <StoreProvider>
      <ConsoleProviders>
        <ScreenProbe ready={(s, v) => { store = s; svc = v }} />
        {node}
      </ConsoleProviders>
    </StoreProvider>
  )
  const view = render(ui(null))
  if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
  return {
    store: () => store,
    svc: () => svc,
    run: (fn: () => unknown) => act(fn),
    show: (node: React.ReactNode) => view.rerender(ui(node)),
    unmount: view.unmount,
  }
}

describe('settings org tab on the typed service (ticket 56)', () => {
  it('saves a dirty profile through the typed write and shows the persisted value', async () => {
    window.location.hash = '#/settings'
    const h = mountScreenRoute('Dana Whitfield')
    h.show(<routes.settings />)
    const name = await waitFor(() => screen.getByLabelText('Organization name *')) as HTMLInputElement
    expect(name.value).toBe('Acme Security (Demo)')
    fireEvent.change(name, { target: { value: 'Acme Demonstration (Demo)' } })
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeEnabled()
    await act(async () => { fireEvent.click(save) })
    await waitFor(() => expect(h.store().db.org.profile.name).toBe('Acme Demonstration (Demo)'))
    expect(h.store().db.audit[0]).toMatchObject({ action: 'Updated organization settings', obj: 'ORG', actor: 'Dana Whitfield' })
    await waitFor(() => expect((screen.getByLabelText('Organization name *') as HTMLInputElement).value).toBe('Acme Demonstration (Demo)'))
    h.unmount()
  })

  it('gates the save for non-admins with the refusal reason in the UI', async () => {
    window.location.hash = '#/settings'
    const h = mountScreenRoute('Casey Nguyen (Client)')
    h.show(<routes.settings />)
    await waitFor(() => expect(screen.getByLabelText('Organization name *')).toBeInTheDocument())
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    expect(save.getAttribute('title')).toContain('Only Organization Admins can save')
    // The profile read itself still renders for viewers — only saving is gated.
    expect((screen.getByLabelText('Organization name *') as HTMLInputElement).value).toBe('Acme Security (Demo)')
    // The masked contact keeps the admin's address out of the viewer's DOM.
    expect(document.body.textContent).not.toContain('dana.whitfield@acme-security.example.test')
    h.unmount()
  })
})
