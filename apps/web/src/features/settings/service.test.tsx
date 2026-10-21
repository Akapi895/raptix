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
 *
 * Ticket 57 appends the integration registry (connect/disconnect with the
 * audited revoke, create-once access-key re-entry) and policy toggles: role
 * gates refuse at the handler with reasons, secrets stay masked, and the
 * bridge reaches the cross-console analysis indicator in both directions.
 *
 * Ticket 58 completes the six settings tabs: retention save/hold/delete stay
 * clearly simulated, validated and admin-gated with the hold persisted in the
 * one database (session-persistent, demo reset restores it), and the audit
 * tab reads the canonical history — search/filter over rows committed by BOTH
 * the legacy actions and the typed feature paths — with scoped and
 * sensitive-evidence masking applied at the handler.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { createDatabaseAuthority } from '../../demo/authority'
import { MockClock } from '../../domain/clock'
import { stamp } from '../../demo/display-clock'
import type { ActorRef, RequestContext, ServiceResult } from '../../domain/service'
import { ROLE_LABEL } from '../../domain/policy'
import { useMe, type Persona } from '../../state/console'
import { useSessionStore } from '../../state/session'
import { mountServices } from '../../test/helpers'
import { getOrgMembers, getOrgProfile, inviteMember, setMemberRole, setMemberStatus, updateOrgProfile, getIntegrations, getPolicies, setIntegrationConnection, setPolicyEnabled, updateIntegrationKey, getRetention, getAudit, updateRetention, setRetentionHold, deleteRetentionData, auditCorr, type OrgProfile } from './service'
import { useIntegrations, useOrgMembers, useOrgProfile, usePolicies } from './query'
import { routes } from '../../screens/f'
import { analysisRoutes } from '../../screens/e-analysis'

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

/* ───────────── bridge harness (canonical persona + services, one authority) ───────────── */
let lastMe: Persona | null = null
function MeProbe() {
  lastMe = useMe()
  return null
}
function mountBridge(me = 'Alex Morgan') {
  return mountServices(<MeProbe />, me)
}

/** Mirrors the store's audited action: one 'legacy' commit with the same row shape. */
function legacyAudit(h: ReturnType<typeof mountServices>, action: string, obj: string, projectId: string, result = 'Success', reason = '') {
  h.svc().authority.commit('legacy', (d) => {
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at: stamp(), actor: 'Dana Whitfield', role: ROLE_LABEL.admin, action, obj, projectId, result, reason })
  })
}

describe('bridge both directions for organization settings', () => {
  it('a service profile save is observed by the canonical snapshot and the audit history (new → canonical)', async () => {
    const h = mountBridge('Dana Whitfield')
    let res!: ServiceResult<OrgProfile>
    await act(async () => {
      res = await h.svc().settings(dana, 'all').updateProfile(ctxOf(dana, 'all', 'svc'), { name: 'Bridged Org (Demo)' })
    })
    expect(res.ok).toBe(true)
    expect(h.db().org.profile.name).toBe('Bridged Org (Demo)')
    expect(h.db()).toBe(h.svc().authority.snapshot())
    expect(h.db().audit[0]).toMatchObject({ action: 'Updated organization settings', obj: 'ORG' })
    h.unmount()
  })

  it('a committed member role change reaches the persona projection — the switcher lands on the new role', async () => {
    const h = mountBridge('Taylor Chen')
    expect(lastMe!.role).toBe('operator')
    await act(async () => {
      await h.svc().settings(dana, 'all').setMemberRole(ctxOf(dana, 'all', 'svc'), 'Taylor Chen', 'reviewer', 'Promoted in settings')
    })
    // The current persona's identity reflects the member change immediately.
    expect(lastMe!.role).toBe('reviewer')
    // ...and it survives a persona round-trip through the switcher.
    h.as('Casey Nguyen (Client)')
    h.as('Taylor Chen')
    expect(lastMe!.role).toBe('reviewer')
    h.unmount()
  })

  it('a canonical project mutation refetches the typed members view without a reload (legacy → new)', async () => {
    window.location.hash = '#/settings'
    const h = mountServices(<OrgViews />)
    await waitFor(() => expect(screen.getByTestId('riley-projects')).toHaveTextContent('RT-2026-014'))
    expect(screen.getByTestId('riley-projects')).not.toHaveTextContent('RT-2026-015')
    // Canonical commit (projects domain): adds Riley to RT-2026-015 — the org
    // members view refetches through the bridge and shows the membership.
    h.run(() => {
      h.svc().authority.commit('legacy', (d) => {
        const p = d.projects.find((x) => x.id === 'RT-2026-015')!
        p.members = [...p.members, { user: 'Riley Brooks', role: 'analyst', since: 'Oct 14, 2026' }]
      })
    })
    await waitFor(() => expect(screen.getByTestId('riley-projects')).toHaveTextContent('RT-2026-015'))
    h.unmount()
  })
})

/** Renders the typed org views for the bridge probes. */
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
    return mountServices(<OrgViews />, me)
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
function mountScreenRoute(me = 'Dana Whitfield') {
  return mountServices(null, me)
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
    await waitFor(() => expect(h.db().org.profile.name).toBe('Acme Demonstration (Demo)'))
    expect(h.db().audit[0]).toMatchObject({ action: 'Updated organization settings', obj: 'ORG', actor: 'Dana Whitfield' })
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

/* ───────────── integration registry + policy configuration (ticket 57) ───────────── */

describe('integration registry handlers (ticket 57)', () => {
  it('gates connect/disconnect to admins; disconnect requires a reason; repeats conflict', () => {
    const h = harness()
    const gate = { kind: 'forbidden', message: 'Only Organization Admins can connect or disconnect integrations. Ask an admin.' }
    expect(setIntegrationConnection(h.authority, h.clock, ctxOf(alex), 'IN-1', 'disconnect', 'Trying')).toEqual({ ok: false, failure: expect.objectContaining(gate) })
    expect(setIntegrationConnection(h.authority, h.clock, ctxOf(casey), 'IN-1', 'connect', '')).toEqual({ ok: false, failure: expect.objectContaining(gate) })
    expect(setIntegrationConnection(h.authority, h.clock, ctxOf(dana), 'IN-1', 'disconnect', '   ')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: 'A reason is required to disconnect an integration.' }) })
    expect(setIntegrationConnection(h.authority, h.clock, ctxOf(dana), 'IN-9', 'connect', '')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    expect(setIntegrationConnection(h.authority, h.clock, ctxOf(dana), 'IN-1', 'connect', '')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('already connected') }) })
    expect(setIntegrationConnection(h.authority, h.clock, ctxOf(dana), 'IN-4', 'disconnect', 'Trying')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('not connected') }) })
    expect(h.authority.snapshot().integrations.find((i) => i.id === 'IN-1')!.status).toBe('connected')
    h.authority.reset()
  })

  it('disconnects with the audited revoke and the card history entry; the summary indicator follows', () => {
    const h = harness()
    const res = setIntegrationConnection(h.authority, h.clock, ctxOf(dana, 'all', 'int-disc'), 'IN-1', 'disconnect', 'Maintenance window (simulated)')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data).toMatchObject({ status: 'disconnected' })
    const db = h.authority.snapshot()
    expect(db.integrations.find((i) => i.id === 'IN-1')!.history[0]).toContain('Disconnected by Dana Whitfield')
    expect(db.audit[0]).toMatchObject({ action: 'Disconnected integration', obj: 'IN-1', actor: 'Dana Whitfield', result: 'Success', reason: 'Maintenance window (simulated)' })
    const read = getIntegrations(db, ctxOf(dana))
    expect(read.ok && read.data?.siem).toMatchObject({ id: 'IN-1', connected: false })
    const back = setIntegrationConnection(h.authority, h.clock, ctxOf(dana), 'IN-1', 'connect', '')
    expect(back.ok).toBe(true)
    const staffRead = getIntegrations(h.authority.snapshot(), ctxOf(pat))
    expect(staffRead.ok && staffRead.data.canEdit).toBe(false)
    h.authority.reset()
  })

  it('re-enters the access key create-once: masked storage, plaintext never committed or returned', () => {
    const h = harness()
    expect(updateIntegrationKey(h.authority, h.clock, ctxOf(alex), 'IN-4', 'super-secret-key-99')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden' }) })
    expect(updateIntegrationKey(h.authority, h.clock, ctxOf(dana), 'IN-4', 'short')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: 'The key needs at least 8 characters.' }) })
    expect(h.authority.snapshot().integrations.find((i) => i.id === 'IN-4')!.status).toBe('authfail')
    const res = updateIntegrationKey(h.authority, h.clock, ctxOf(dana, 'all', 'int-key'), 'IN-4', 'super-secret-key-99')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.secret).toBe('••••••••••••y-99')
    const db = h.authority.snapshot()
    // Create-once: the plaintext key appears nowhere in the committed dataset.
    expect(JSON.stringify(db)).not.toContain('super-secret-key-99')
    expect(db.integrations.find((i) => i.id === 'IN-4')).toMatchObject({ status: 'connected', secret: '••••••••••••y-99' })
    expect(db.audit[0]).toMatchObject({ action: 'Updated integration key', obj: 'IN-4', actor: 'Dana Whitfield', reason: 'Key is not stored in the UI' })
    h.authority.reset()
  })
})

describe('policy configuration handler (ticket 57)', () => {
  it('gates toggles to admins, requires a reason to disable and audits both directions', () => {
    const h = harness()
    expect(setPolicyEnabled(h.authority, h.clock, ctxOf(alex), 'PL-5', true, '')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('Only Organization Admins can enable or disable policies') }) })
    expect(setPolicyEnabled(h.authority, h.clock, ctxOf(dana), 'PL-5', false, '   ')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: 'A reason is required to disable a policy.' }) })
    expect(setPolicyEnabled(h.authority, h.clock, ctxOf(dana), 'PL-99', false, 'x')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    const on = setPolicyEnabled(h.authority, h.clock, ctxOf(dana), 'PL-5', true, '')
    expect(on.ok).toBe(true)
    expect(setPolicyEnabled(h.authority, h.clock, ctxOf(dana), 'PL-5', true, '')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('already enabled') }) })
    const off = setPolicyEnabled(h.authority, h.clock, ctxOf(dana, 'all', 'pol-off'), 'PL-5', false, 'Compensating controls active (simulated)')
    expect(off.ok).toBe(true)
    if (off.ok) expect(off.data).toMatchObject({ enabled: false, updated: 'Oct 13, 2026' })
    const db = h.authority.snapshot()
    expect(db.policies.find((p) => p.id === 'PL-5')!.enabled).toBe(false)
    expect(db.audit[0]).toMatchObject({ action: 'Disabled policy: Time-window override', obj: 'PL-5', actor: 'Dana Whitfield', result: 'Success', reason: 'Compensating controls active (simulated)' })
    // The toggle only records configuration — it never bypasses enforcement,
    // which reads its own preflight/grant rules, not this list.
    expect(getPolicies(db, ctxOf(casey))).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: 'The Client / Viewer role cannot view organization policies.' }) })
    expect(getPolicies(db, ctxOf(taylor)).ok).toBe(true)
    h.authority.reset()
  })
})

describe('bridge for integrations and policies (ticket 57)', () => {
  function IntViews() {
    const q = useIntegrations()
    const p = usePolicies()
    return (
      <div>
        <div data-testid="siem-status">{q.data?.integrations.find((i) => i.id === 'IN-1')?.status ?? '—'}</div>
        <div data-testid="siem-banner">{q.data?.siem?.connected === false ? 'SIEM down' : 'SIEM ok'}</div>
        <div data-testid="pl5">{p.data?.policies.find((x) => x.id === 'PL-5')?.enabled === true ? 'enabled' : 'off'}</div>
      </div>
    )
  }
  function mountInt(me = 'Dana Whitfield') {
    return mountServices(<IntViews />, me)
  }

  it('a canonical integration toggle refetches the typed registry and the SIEM indicator (write → new)', async () => {
    const h = mountInt('Dana Whitfield')
    await waitFor(() => expect(screen.getByTestId('siem-status')).toHaveTextContent('connected'))
    h.run(() => { expect(setIntegrationConnection(h.svc().authority, h.svc().clock, ctxOf(dana, 'all', 'legacy-toggle'), 'IN-1', 'disconnect', 'Legacy toggle (simulated)').ok).toBe(true) })
    await waitFor(() => expect(screen.getByTestId('siem-status')).toHaveTextContent('disconnected'))
    expect(screen.getByTestId('siem-banner')).toHaveTextContent('SIEM down')
    h.unmount()
  })

  it('a canonical policy toggle refetches the typed policy list (write → new)', async () => {
    const h = mountInt('Dana Whitfield')
    await waitFor(() => expect(screen.getByTestId('pl5')).toHaveTextContent('off'))
    h.run(() => { expect(setPolicyEnabled(h.svc().authority, h.svc().clock, ctxOf(dana, 'all', 'legacy-toggle'), 'PL-5', true, '').ok).toBe(true) })
    await waitFor(() => expect(screen.getByTestId('pl5')).toHaveTextContent('enabled'))
    h.unmount()
  })

  it('a typed settings write updates the cross-console analysis indicator (new → canonical consumer)', async () => {
    window.location.hash = '#/analysis?tab=matrix'
    const Analysis = analysisRoutes.analysis
    const h = mountServices(<><MeProbe /><Analysis /></>, 'Taylor Chen')
    await waitFor(() => expect(screen.getByRole('button', { name: /T1078/ })).toHaveTextContent('Executed & Not Detected'))
    await act(async () => {
      await h.svc().settings(dana, 'all').setIntegrationConnection(ctxOf(dana, 'all', 'svc'), 'IN-1', 'disconnect', 'Maintenance window (simulated)')
    })
    // The analysis screen's indicator flips from the settings-side write.
    await waitFor(() => expect(screen.getByText('Detection integration unavailable')).toBeInTheDocument())
    // ...and the canonical snapshot observed the same commit through the one authority.
    expect(h.db().integrations.find((i) => i.id === 'IN-1')!.status).toBe('disconnected')
    expect(h.db().audit[0]).toMatchObject({ action: 'Disconnected integration', obj: 'IN-1' })
    h.unmount()
  })
})

describe('settings integrations and policies tabs on the typed service (ticket 57)', () => {
  it('renders the registry from the typed read and the SIEM banner follows a service disconnect', async () => {
    window.location.hash = '#/settings?tab=integrations'
    const h = mountScreenRoute('Dana Whitfield')
    h.show(<routes.settings />)
    await waitFor(() => expect(screen.getByText('SIEM-Lab')).toBeInTheDocument())
    expect(screen.queryByText('SIEM is not connected')).not.toBeInTheDocument()
    await act(async () => {
      await h.svc().settings(dana, 'all').setIntegrationConnection(ctxOf(dana, 'all', 'svc'), 'IN-1', 'disconnect', 'Maintenance window (simulated)')
    })
    await waitFor(() => expect(screen.getByText('SIEM is not connected')).toBeInTheDocument())
    h.unmount()
  })

  it('gates the registry actions below admin with the refusal reason', async () => {
    window.location.hash = '#/settings?tab=integrations'
    const h = mountScreenRoute('Pat Kim')
    h.show(<routes.settings />)
    await waitFor(() => expect(screen.getByText('SIEM-Lab')).toBeInTheDocument())
    const toggles = [...screen.getAllByRole('button', { name: 'Disconnect' }), ...screen.getAllByRole('button', { name: 'Re-enter key' })]
    expect(toggles.length).toBeGreaterThan(0)
    for (const b of toggles) {
      expect(b).toBeDisabled()
      expect(b.getAttribute('title')).toContain('Only Organization Admins can connect or disconnect integrations')
    }
    h.unmount()
  })

  it('shows the policy "last change" line after a typed toggle and gates reviewer toggles', async () => {
    window.location.hash = '#/settings?tab=policies'
    const h = mountScreenRoute('Dana Whitfield')
    h.show(<routes.settings />)
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Policy switches & session rules' })))
    await waitFor(() => expect(screen.getAllByText('Time-window override').length).toBeGreaterThan(0))
    await act(async () => {
      await h.svc().settings(dana, 'all').setPolicyEnabled(ctxOf(dana, 'all', 'svc'), 'PL-5', true, '')
    })
    await waitFor(() => expect(screen.getByText(/Last change: .* by Dana Whitfield/)).toBeInTheDocument())
    h.unmount()

    const reviewer = mountScreenRoute('Pat Kim')
    reviewer.show(<routes.settings />)
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Policy switches & session rules' })))
    await waitFor(() => expect(screen.getAllByText('Time-window override').length).toBeGreaterThan(0))
    for (const t of screen.getAllByRole('switch', { name: /policy /i })) expect(t).toBeDisabled()
    expect(screen.getByText('Only Organization Admins can enable or disable policies. Ask an admin to request the change.')).toBeInTheDocument()
    reviewer.unmount()
  })
})

/* ───────────── retention handlers (ticket 58) ───────────── */

describe('retention handlers (ticket 58)', () => {
  it('saves a validated policy change, audits it and persists it for the session', () => {
    const h = harness()
    expect(updateRetention(h.authority, h.clock, ctxOf(dana), 'RP-1', { period: 'soon' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: 'Enter a retention period such as “24 months”.' }) })
    expect(updateRetention(h.authority, h.clock, ctxOf(dana), 'RP-1', { label: '   ' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: 'A classification label is required.' }) })
    expect(updateRetention(h.authority, h.clock, ctxOf(dana), 'RP-9', { period: '6 months' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    expect(updateRetention(h.authority, h.clock, ctxOf(dana), 'RP-1', { period: '24 months' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('already has these values') }) })
    const res = updateRetention(h.authority, h.clock, ctxOf(dana, 'all', 'ret-save'), 'RP-1', { period: '18 months', label: 'Internal' })
    expect(res.ok).toBe(true)
    const db = h.authority.snapshot()
    expect(db.retention.find((r) => r.id === 'RP-1')).toMatchObject({ period: '18 months', label: 'Internal' })
    expect(db.audit[0]).toMatchObject({ action: 'Updated retention policy (simulated)', obj: 'RP-1', actor: 'Dana Whitfield', reason: 'period 18 months, label Internal' })
    // A fresh read observes the committed values (session persistence).
    const read = getRetention(db, ctxOf(dana))
    expect(read.ok && read.data?.policies.find((r) => r.id === 'RP-1')).toMatchObject({ period: '18 months', label: 'Internal' })
    h.authority.reset()
    expect(h.authority.snapshot().retention.find((r) => r.id === 'RP-1')).toMatchObject({ period: '24 months' })
  })

  it('gates every retention write to Organization Admins with renderable reasons', () => {
    const h = harness()
    expect(updateRetention(h.authority, h.clock, ctxOf(alex), 'RP-1', { period: '6 months' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: 'Only Organization Admins can change retention policies. Ask an admin to make the change.' }) })
    expect(setRetentionHold(h.authority, h.clock, ctxOf(pat), 'RP-3', true, 'litigation')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('Only Organization Admins can place or release legal holds') }) })
    expect(deleteRetentionData(h.authority, h.clock, ctxOf(casey), 'RP-3', 'please')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden' }) })
    expect(h.authority.snapshot().org.holds).toEqual([])
    expect(h.authority.snapshot().audit.every((a) => !/retention|hold/i.test(a.action))).toBe(true)
    h.authority.reset()
  })

  it('places and releases a session-persistent legal hold; a hold blocks deletion', () => {
    const h = harness()
    expect(setRetentionHold(h.authority, h.clock, ctxOf(dana), 'RP-3', true, '   ')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: 'A legal basis is required to place a hold.' }) })
    const held = setRetentionHold(h.authority, h.clock, ctxOf(dana, 'all', 'ret-hold'), 'RP-3', true, 'Litigation hold (simulated)')
    expect(held.ok).toBe(true)
    expect(h.authority.snapshot().org.holds).toEqual(['RP-3'])
    expect(h.authority.snapshot().audit[0]).toMatchObject({ action: 'Placed legal hold (simulated)', obj: 'RP-3', projectId: 'RT-2026-009', reason: 'Litigation hold (simulated)' })
    expect(setRetentionHold(h.authority, h.clock, ctxOf(dana), 'RP-3', true, 'again')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('already has legal hold') }) })
    expect(deleteRetentionData(h.authority, h.clock, ctxOf(dana), 'RP-3', 'cleanup')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('legal hold is active') }) })
    expect(setRetentionHold(h.authority, h.clock, ctxOf(dana), 'RP-3', false, '  ')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: 'A reason is required to release a hold.' }) })
    const released = setRetentionHold(h.authority, h.clock, ctxOf(dana), 'RP-3', false, 'Matter closed (simulated)')
    expect(released.ok).toBe(true)
    expect(h.authority.snapshot().org.holds).toEqual([])
    expect(h.authority.snapshot().audit[0]).toMatchObject({ action: 'Released legal hold (simulated)', obj: 'RP-3', reason: 'Matter closed (simulated)' })
    h.authority.reset()
    expect(h.authority.snapshot().org.holds).toEqual([])
  })

  it('deletes under policy only when expired, unheld and reasoned — and stays clearly simulated', () => {
    const h = harness()
    expect(deleteRetentionData(h.authority, h.clock, ctxOf(dana), 'RP-3', '   ')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: 'A reason is required to delete under policy.' }) })
    expect(deleteRetentionData(h.authority, h.clock, ctxOf(dana), 'RP-3', 'early')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: 'Not yet due for deletion under the policy.' }) })
    // Stand-in for time passing: the policy becomes due through a committed edit.
    h.authority.commit('test', (d) => { const r = d.retention.find((x) => x.id === 'RP-3')!; r.state = 'Expired' })
    const res = deleteRetentionData(h.authority, h.clock, ctxOf(dana, 'all', 'ret-del'), 'RP-3', 'Retention window elapsed (simulated)')
    expect(res.ok).toBe(true)
    expect(h.authority.snapshot().retention.find((r) => r.id === 'RP-3')).toMatchObject({ state: 'Deleted (simulated)' })
    // Simulated: the seeded demo data itself is never destroyed.
    expect(h.authority.snapshot().findings.some((f) => f.projectId === 'RT-2026-009')).toBe(true)
    expect(h.authority.snapshot().audit[0]).toMatchObject({ action: 'Deleted under policy (simulated)', obj: 'RP-3', result: 'Success', reason: 'Retention window elapsed (simulated)' })
    h.authority.reset()
  })
})

/* ───────────── canonical audit history handler (ticket 58) ───────────── */

describe('canonical audit history handler (ticket 58)', () => {
  it('searches and filters the one history and derives the filter options from the scoped base', () => {
    const h = harness()
    const db = h.authority.snapshot()
    const searched = getAudit(db, ctxOf(dana), { q: 'session' })
    expect(searched.ok).toBe(true)
    if (searched.ok) {
      expect(searched.data.items.length).toBeGreaterThan(0)
      expect(searched.data.items.every((a) => `${a.id} ${auditCorr(a)} ${a.actor} ${a.action} ${a.obj} ${a.reason}`.toLowerCase().includes('session'))).toBe(true)
    }
    const ai = getAudit(db, ctxOf(dana), { origin: 'ai' })
    expect(ai.ok && ai.data!.items.length).toBeGreaterThan(0)
    expect(ai.ok && ai.data!.items.every((a) => a.actor === 'AI Operator')).toBe(true)
    const human = getAudit(db, ctxOf(dana), { origin: 'human' })
    expect(human.ok && human.data!.items.every((a) => a.actor !== 'AI Operator')).toBe(true)
    const corr = getAudit(db, ctxOf(dana), { corr: 'COR-014-01' })
    expect(corr.ok && corr.data!.items.length).toBeGreaterThan(0)
    expect(corr.ok && corr.data!.items.every((a) => auditCorr(a) === 'COR-014-01')).toBe(true)
    const byResult = getAudit(db, ctxOf(dana), { result: 'Pending' })
    expect(byResult.ok && byResult.data!.items.every((a) => a.result === 'Pending')).toBe(true)
    const all = getAudit(db, ctxOf(dana), {})
    expect(all.ok).toBe(true)
    if (all.ok) {
      expect(all.data.total).toBeGreaterThan(1)
      expect(all.data.options.actors).toContain('AI Operator')
      expect(all.data.options.corrs).toContain('COR-014-01')
      expect(all.data.options.results).toContain('Pending')
      expect(all.data.canExport).toBe(true)
      const reviewer = getAudit(db, ctxOf(pat), {})
      expect(reviewer.ok && reviewer.data!.canExport).toBe(true)
    }
    h.authority.reset()
  })

  it('projects the history by scope: workspace-level rows stay admin-only, project rows follow access', () => {
    const h = harness()
    // A migrated feature path commits a workspace-level row (projectId '').
    updateOrgProfile(h.authority, h.clock, ctxOf(dana, 'all', 'org-save'), { name: 'Scoped Audit Probe (Demo)' })
    const admin = getAudit(h.authority.snapshot(), ctxOf(dana), {})
    const manager = getAudit(h.authority.snapshot(), ctxOf(alex), {})
    expect(admin.ok && manager.ok).toBe(true)
    if (admin.ok && manager.ok) {
      expect(admin.data.items.some((a) => a.action === 'Updated organization settings')).toBe(true)
      expect(manager.data.items.some((a) => a.action === 'Updated organization settings')).toBe(false)
      // Project-scoped rows stay visible to the elevated staff reader.
      expect(manager.data.items.some((a) => a.projectId === 'RT-2026-014')).toBe(true)
    }
    expect(getAudit(h.authority.snapshot(), ctxOf(taylor), {})).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('The audit log is visible to Organization Admins, Red Team Managers and Reviewers') }) })
    h.authority.reset()
  })

  it('masks reasons on rows referencing sensitive evidence below admin (PM-7)', () => {
    const h = harness()
    h.authority.commit('test', (d) => { d.audit.unshift({ id: 'AU-T90', at: d.audit[0]!.at, actor: 'Taylor Chen', role: 'Operator', action: 'Uploaded evidence', obj: 'EV-014-02', projectId: 'RT-2026-014', result: 'Success', reason: 'Redacted capture 027 internals' }) })
    const admin = getAudit(h.authority.snapshot(), ctxOf(dana), { actor: 'Taylor Chen' })
    const manager = getAudit(h.authority.snapshot(), ctxOf(alex), { actor: 'Taylor Chen' })
    expect(admin.ok && manager.ok).toBe(true)
    if (admin.ok && manager.ok) {
      const open = admin.data.items.find((a) => a.obj === 'EV-014-02')!
      const masked = manager.data.items.find((a) => a.obj === 'EV-014-02')!
      expect(open.reason).toContain('Redacted capture 027')
      expect(masked.reason).not.toContain('Redacted capture 027')
      expect(masked.reason).toBe('•••• (sensitive evidence masked)')
    }
    h.authority.reset()
  })
})

/* ───────────── one history for both commit paths (ticket 58) ───────────── */

describe('unified audit history for legacy and migrated paths (ticket 58)', () => {
  it('a legacy A.audit row and a typed settings write land in the same getAudit history', async () => {
    const h = mountBridge('Dana Whitfield')
    // Migrated feature path: the typed retention write commits its audit row.
    let res!: ServiceResult<unknown>
    await act(async () => {
      res = await h.svc().settings(dana, 'all').updateRetention(ctxOf(dana, 'all', 'svc'), 'RP-1', { period: '30 months' })
    })
    expect(res.ok).toBe(true)
    // Legacy path: the store's audited action commits through the same authority.
    h.run(() => legacyAudit(h, 'Legacy probe action', 'X-1', 'RT-2026-014', 'Success', 'committed by the legacy seam'))
    const read = getAudit(h.svc().authority.snapshot(), ctxOf(dana, 'all', 'read'), {})
    expect(read.ok).toBe(true)
    if (read.ok) {
      const actions = read.data.items.map((a) => a.action)
      expect(actions).toContain('Updated retention policy (simulated)')
      expect(actions).toContain('Legacy probe action')
    }
    h.unmount()
  })
})

/* ───────────── retention + audit tabs on the typed service (ticket 58) ───────────── */

describe('settings retention and audit tabs on the typed service (ticket 58)', () => {
  it('renders the six required tabs from typed reads and keeps the secondary tabs', async () => {
    window.location.hash = '#/settings'
    const h = mountScreenRoute('Dana Whitfield')
    h.show(<routes.settings />)
    await waitFor(() => expect(screen.getByLabelText('Organization name *')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Users & roles' }))
    await waitFor(() => expect(screen.getAllByText('Taylor Chen').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('tab', { name: 'Integrations' }))
    await waitFor(() => expect(screen.getByText('SIEM-Lab')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Policies' }))
    await waitFor(() => expect(screen.getAllByText('Project creation').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('tab', { name: 'Retention' }))
    await waitFor(() => expect(screen.getByText('Closed project evidence')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Audit log' }))
    await waitFor(() => expect(screen.getByText('Requested interactive session access')).toBeInTheDocument())
    // Retained secondary links keep functioning.
    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }))
    await waitFor(() => expect(screen.getByText('Standard Red Team v3')).toBeInTheDocument())
    h.unmount()
  })

  it('retention tab: save/reset through the typed write and a hold persisted in the one database', async () => {
    window.location.hash = '#/settings?tab=retention'
    const h = mountScreenRoute('Dana Whitfield')
    h.show(<routes.settings />)
    await waitFor(() => expect(screen.getByText('Closed project evidence')).toBeInTheDocument())
    // Wait for the admin persona's refetch (the initial mount fetches as the
    // default persona before setMe; the admin-gated buttons are the signal).
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Edit' })[0]).toBeEnabled())
    // Save: validated period reaches the committed dataset through the service.
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    const period = await waitFor(() => screen.getByLabelText(/Retention period/)) as HTMLInputElement
    expect(period.value).toBe('24 months')
    fireEvent.change(period, { target: { value: '18 months' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    await waitFor(() => expect(h.db().retention.find((r) => r.id === 'RP-1')!.period).toBe('18 months'))
    expect(h.db().audit[0]).toMatchObject({ action: 'Updated retention policy (simulated)', obj: 'RP-1' })
    // Reset restores the committed values into the form.
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    const period2 = screen.getByLabelText(/Retention period/) as HTMLInputElement
    expect(period2.value).toBe('18 months')
    fireEvent.change(period2, { target: { value: '9 months' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect((screen.getByLabelText(/Retention period/) as HTMLInputElement).value).toBe('18 months')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    // Hold: the typed write persists the hold in the org state and audits it.
    // The first control is the expiring banner's button for RP-3 (the banner
    // precedes the table in the DOM).
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Place legal hold' })[0]).toBeEnabled())
    fireEvent.click(screen.getAllByRole('button', { name: 'Place legal hold' })[0])
    expect(useSessionStore.getState().confirmState).not.toBeNull()
    await act(async () => { useSessionStore.getState().confirmState!.onConfirm('Litigation hold (simulated)') })
    await waitFor(() => expect(h.db().org.holds).toEqual(['RP-3']))
    expect(h.db().audit[0]).toMatchObject({ action: 'Placed legal hold (simulated)', obj: 'RP-3' })
    expect(screen.getByText('Legal hold')).toBeInTheDocument()
    h.unmount()
  })

  it('audit tab: search, pagination and a legacy-path row refetching into the typed view', async () => {
    window.location.hash = '#/settings?tab=audit'
    const h = mountScreenRoute('Dana Whitfield')
    h.show(<routes.settings />)
    await waitFor(() => expect(screen.getByText('Requested interactive session access')).toBeInTheDocument())
    expect(screen.getByText('Showing all 8 records')).toBeInTheDocument()
    // Legacy actions append rows; the ChangeSet bridge refetches the typed view.
    for (let i = 1; i <= 6; i++) h.run(() => legacyAudit(h, `Legacy probe ${i}`, 'X-1', 'RT-2026-014', 'Success', 'committed by the legacy seam'))
    await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.getByText('Closed project')).toBeInTheDocument())
    // Search narrows through the handler (the filter is part of the query key).
    fireEvent.change(screen.getByPlaceholderText('Search actor, action, object…'), { target: { value: 'Legacy probe' } })
    await waitFor(() => expect(screen.getByText('Showing all 6 records')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument()
    h.unmount()
  })
})
