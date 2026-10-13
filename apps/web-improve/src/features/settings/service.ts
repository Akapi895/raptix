/**
 * Organization settings handlers (ticket 56, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local handlers for the organization profile and its member list:
 * scope-checked reads and admin-gated writes over the one database authority.
 * The org state (`db.org`) lives in the shared seed, so profile edits, member
 * role/status overrides and invitations persist for the demo session, commit
 * atomically with their audit rows and publish a ChangeSet both the legacy
 * store and Query views observe. Every write captures actor and reason at
 * call time; a refusal commits nothing and returns an explicit failure whose
 * message is safe to render. Member data respects masking rules: the admin
 * contact is masked for non-admin readers and client (viewer-role) member
 * emails are masked for staff below admin — external personnel PII.
 */
import { USERS, type Db } from '../../data'
import { formatDemoInstant } from '../../domain/clock'
import type { DbAuthority } from '../../domain/database'
import type { Clock, RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { Audit, Integration, OrgInvite, OrgProfile, Policy, Role } from '../../domain/entities'

export type { OrgInvite, OrgProfile } from '../../domain/entities'

/** The workspace list is demo display data; only the default choice is state. */
export const WORKSPACES: readonly { id: string; name: string; state: string }[] = [
  { id: 'WS-01', name: 'Raptix Workspace — Production', state: 'Active' },
  { id: 'WS-02', name: 'Raptix Workspace — Test Lab', state: 'Active (current)' },
  { id: 'WS-03', name: 'Archive workspace 2025', state: 'Read-only' },
]

/** Roles allowed to view the users & roles list (the settings tab gate). */
const STAFF: readonly Role[] = ['admin', 'manager', 'reviewer']

const ROLE_TEXT: Record<Role, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** PII masking: keeps the local part's first character and the full domain. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '••••••'
  return `${email[0]}${'•'.repeat(Math.max(3, at - 1))}${email.slice(at)}`
}

/** One organization profile read: settings plus the workspace list. The
 *  admin contact is masked for non-admin readers (they cannot save either). */
export interface OrgProfileRead {
  profile: OrgProfile
  workspaces: typeof WORKSPACES
  contactMasked: boolean
}

/** One member row: the seeded identity plus the committed overrides. */
export interface OrgMemberView {
  name: string
  email: string
  role: Role
  seededRole: Role
  overridden: boolean
  locked: boolean
  revoked: boolean
  /** Project ids the member belongs to (elevated roles reach every project). */
  projects: string[]
  /** Recent audit events for this member (access history view). */
  history: Audit[]
  self: boolean
}

export interface OrgMembersRead {
  members: OrgMemberView[]
  invites: OrgInvite[]
  /** All workspaces' projects (invite project-scope options). */
  projectOptions: { id: string; name: string }[]
  /** Surfaced for UI hints; every mutation re-checks at the handler. */
  canEdit: boolean
}

/** Pure profile read — every authenticated actor may view organization settings. */
export function getOrgProfile(db: Db, ctx: RequestContext): ServiceResult<OrgProfileRead> {
  const admin = ctx.actor.role === 'admin'
  const profile = admin ? db.org.profile : { ...db.org.profile, contact: maskEmail(db.org.profile.contact) }
  return { ok: true, data: { profile, workspaces: WORKSPACES, contactMasked: !admin } }
}

/** Pure members read. Non-staff roles are refused with the tab's reason (no
 *  member data leaks); client personnel emails are masked below admin. */
export function getOrgMembers(db: Db, ctx: RequestContext): ServiceResult<OrgMembersRead> {
  if (!STAFF.includes(ctx.actor.role)) {
    return { ok: false, failure: { kind: 'forbidden', message: 'The user list is visible to Organization Admins, Red Team Managers and Reviewers. Ask an admin if you need access.' } }
  }
  const admin = ctx.actor.role === 'admin'
  const overridden = db.org.members
  const members: OrgMemberView[] = USERS.map((u) => {
    const ov = overridden[u.name]
    return {
      name: u.name,
      email: u.role === 'viewer' && !admin ? maskEmail(u.email) : u.email,
      role: ov?.role ?? u.role,
      seededRole: u.role,
      overridden: !!ov?.role,
      locked: !!ov?.locked,
      revoked: !!ov?.revoked,
      projects: db.projects.filter((p) => p.members.some((m) => m.user === u.name)).map((p) => p.id),
      history: db.audit.filter((a) => a.actor === u.name || a.obj === u.name).slice(0, 20),
      self: u.name === ctx.actor.id,
    }
  })
  return { ok: true, data: { members, invites: db.org.invites, projectOptions: db.projects.map((p) => ({ id: p.id, name: p.name })), canEdit: admin } }
}

/** Workspace-level writes publish the org identity; every commit carries its audit row. */
function auditRow(d: Db, ctx: RequestContext, at: string, action: string, obj: string, result: string, reason: string) {
  d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action, obj, projectId: '', result, reason })
}

/** Validated profile patch; `undefined` fields keep the committed value. */
export interface OrgProfilePatch { name?: string; tz?: string; dateFmt?: string; landing?: string; contact?: string; policy?: string; defWorkspace?: string }

const profileFields: readonly (keyof OrgProfile)[] = ['name', 'tz', 'dateFmt', 'landing', 'contact', 'policy', 'defWorkspace']

/**
 * Updates the organization profile in one atomic commit. Admin-only: any
 * other role is refused with the reason. Validation order: required name,
 * contact format, then the workspace rule (a read-only workspace cannot be
 * the default). A refused save commits nothing.
 */
export function updateOrgProfile(authority: DbAuthority, clock: Clock, ctx: RequestContext, patch: OrgProfilePatch): ServiceResult<OrgProfile> {
  if (ctx.actor.role !== 'admin') {
    return { ok: false, failure: { kind: 'forbidden', message: 'Only Organization Admins can edit organization settings. Ask an admin to make the change.' } }
  }
  const db = authority.snapshot()
  const next: OrgProfile = { ...db.org.profile }
  for (const k of profileFields) if (patch[k] !== undefined) next[k] = patch[k] as string
  if (!next.name.trim()) return { ok: false, failure: { kind: 'validation', message: 'Enter an organization name.' } }
  if (!EMAIL_RE.test(next.contact)) return { ok: false, failure: { kind: 'validation', message: 'Enter a valid admin contact email.' } }
  const ws = WORKSPACES.find((w) => w.id === next.defWorkspace)
  if (!ws) return { ok: false, failure: { kind: 'validation', message: `Unknown workspace ${next.defWorkspace}.` } }
  if (ws.state === 'Read-only') return { ok: false, failure: { kind: 'validation', message: 'A read-only workspace cannot be the default.' } }
  const before = db.org.profile as unknown as Record<string, unknown>
  const after = next as unknown as Record<string, unknown>
  const changed = profileFields.filter((k) => patch[k] !== undefined && after[k] !== before[k])
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    d.org.profile = next
    auditRow(d, ctx, at, 'Updated organization settings', 'ORG', 'Success', changed.join(', '))
  })
  return { ok: true, data: next }
}

/** Member status action; `lock`/`revoke` require a reason, `unlock` does not. */
export type OrgMemberStatusAction = 'lock' | 'unlock' | 'revoke'
const STATUS_TEXT: Record<OrgMemberStatusAction, string> = { lock: 'Disabled account', unlock: 'Re-enabled account', revoke: 'Revoked access' }

/** Resolves a member for a write, or the failure that refuses it. */
function memberOf(name: string): { ok: true; seededRole: Role } | { ok: false; failure: ServiceFailure } {
  const u = USERS.find((x) => x.name === name)
  if (!u) return { ok: false, failure: { kind: 'not-found', message: `No organization member named “${name}”.` } }
  return { ok: true, seededRole: u.role }
}

function freshMember(db: Db, ctx: RequestContext, name: string): OrgMemberView {
  const u = USERS.find((x) => x.name === name)!
  const ov = db.org.members[name]
  return {
    name, email: u.email, role: ov?.role ?? u.role, seededRole: u.role, overridden: !!ov?.role,
    locked: !!ov?.locked, revoked: !!ov?.revoked,
    projects: db.projects.filter((p) => p.members.some((m) => m.user === name)).map((p) => p.id),
    history: db.audit.filter((a) => a.actor === name || a.obj === name).slice(0, 20),
    self: name === ctx.actor.id,
  }
}

/** Changes one member's role. Admin-only, reason-required, audited; the new
 *  permissions apply immediately (the store's persona projection reads it). */
export function setMemberRole(authority: DbAuthority, clock: Clock, ctx: RequestContext, name: string, role: Role, reason: string): ServiceResult<OrgMemberView> {
  if (ctx.actor.role !== 'admin') return { ok: false, failure: { kind: 'forbidden', message: 'Only Organization Admins can change user access. Ask an admin to make the change.' } }
  const m = memberOf(name)
  if (!m.ok) return m
  const db = authority.snapshot()
  const cur = db.org.members[name]?.role ?? m.seededRole
  if (role === cur) return { ok: false, failure: { kind: 'validation', message: `${name} already has the ${ROLE_TEXT[role]} role.` } }
  if (!reason.trim()) return { ok: false, failure: { kind: 'validation', message: 'A reason is required to change a member\'s role.' } }
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    d.org.members[name] = { ...d.org.members[name], role }
    auditRow(d, ctx, at, 'Changed user role', name, 'Success', `${cur} to ${role}. ${reason.trim()}`)
  })
  return { ok: true, data: freshMember(authority.snapshot(), ctx, name) }
}

/** Locks, unlocks or revokes one member. Admin-only; nobody changes their own
 *  account status; lock/revoke require a reason. Revoke hides project
 *  memberships in the UI without deleting the underlying assignments. */
export function setMemberStatus(authority: DbAuthority, clock: Clock, ctx: RequestContext, name: string, action: OrgMemberStatusAction, reason: string): ServiceResult<OrgMemberView> {
  if (ctx.actor.role !== 'admin') return { ok: false, failure: { kind: 'forbidden', message: 'Only Organization Admins can change user access. Ask an admin to make the change.' } }
  if (name === ctx.actor.id) return { ok: false, failure: { kind: 'forbidden', message: 'You cannot change your own account status.' } }
  const m = memberOf(name)
  if (!m.ok) return m
  if (action !== 'unlock' && !reason.trim()) return { ok: false, failure: { kind: 'validation', message: `A reason is required to ${action === 'lock' ? 'disable' : 'revoke'} an account.` } }
  const db = authority.snapshot()
  const ov = db.org.members[name]
  if (action === 'revoke' && ov?.revoked) return { ok: false, failure: { kind: 'conflict', message: `${name}'s access is already revoked.` } }
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    d.org.members[name] = {
      ...d.org.members[name],
      locked: action === 'lock' ? true : action === 'unlock' ? false : ov?.locked,
      revoked: action === 'revoke' ? true : ov?.revoked,
    }
    auditRow(d, ctx, at, STATUS_TEXT[action], name, 'Success', reason.trim())
  })
  return { ok: true, data: freshMember(authority.snapshot(), ctx, name) }
}

/** Payload for a new invitation. */
export interface OrgInviteInput { email: string; role: Role; project: string; days: string; note: string }

/** Sends an invitation. Admin-only; the email must be new (not an existing
 *  member or pending invitation) and an Organization Admin invite cannot be
 *  project-scoped — admins have organization-wide access. */
export function inviteMember(authority: DbAuthority, clock: Clock, ctx: RequestContext, input: OrgInviteInput): ServiceResult<OrgInvite> {
  if (ctx.actor.role !== 'admin') return { ok: false, failure: { kind: 'forbidden', message: 'Only Organization Admins can invite users. Ask an admin to make the change.' } }
  if (!EMAIL_RE.test(input.email)) return { ok: false, failure: { kind: 'validation', message: 'Enter a valid email address.' } }
  const db = authority.snapshot()
  const taken = USERS.some((u) => u.email === input.email) || db.org.invites.some((i) => i.email === input.email)
  if (taken) return { ok: false, failure: { kind: 'conflict', message: 'This email already exists or has been invited.' } }
  if (input.role === 'admin' && input.project) {
    return { ok: false, failure: { kind: 'validation', message: 'Organization Admins have organization-wide access. Clear the project to continue.' } }
  }
  const at = formatDemoInstant(clock.now())
  const invite: OrgInvite = { id: 'INV-' + (db.org.invites.length + 1), ...input, at }
  authority.commit(ctx.corr, (d) => {
    d.org.invites.unshift(invite)
    auditRow(d, ctx, at, 'Invited user', input.email, 'Success', `Role ${ROLE_TEXT[input.role]}`)
  })
  return { ok: true, data: invite }
}

/* ───────────── Integration registry (ticket 57) ───────────── */

/**
 * One integration-registry read. The masked access key is stored masked at
 * the seed boundary and never unmasked here; `siem` is the detection-source
 * summary the analysis screens' indicators derive from, and `canEdit` is the
 * UI hint — every mutation re-checks the role at the handler.
 */
export interface IntegrationsRead {
  integrations: Integration[]
  siem: { id: string; name: string; connected: boolean } | null
  canEdit: boolean
}

/** Registry read: staff-only (the tab gate), masking is never reversed. */
export function getIntegrations(db: Db, ctx: RequestContext): ServiceResult<IntegrationsRead> {
  if (!STAFF.includes(ctx.actor.role)) {
    return { ok: false, failure: { kind: 'forbidden', message: 'Integrations are visible to Organization Admins, Red Team Managers and Reviewers. Ask an admin if you need access.' } }
  }
  const siem = db.integrations.find((i) => i.kind === 'SIEM')
  return {
    ok: true,
    data: {
      integrations: db.integrations,
      siem: siem ? { id: siem.id, name: siem.name, connected: siem.status === 'connected' } : null,
      canEdit: ctx.actor.role === 'admin',
    },
  }
}

/** Connection action: `connect` succeeds a disconnected/failed source;
 *  `disconnect` is the destructive revoke and requires a reason. */
export type IntegrationAction = 'connect' | 'disconnect'

const integrationOf = (db: Db, id: string) => db.integrations.find((x) => x.id === id)
const policyOf = (db: Db, id: string) => db.policies.find((x) => x.id === id)

/** Demo-secret masking: the stored key is only ever the masked tail. */
const maskSecret = (key: string) => '•'.repeat(12) + key.replace(/\s+/g, '').slice(-4)

/**
 * Connects or disconnects one integration. Admin-only (the baseline policy:
 * non-admins request through the audited request flow instead). The outcome
 * is explicitly simulated — no provider call is introduced — and the commit
 * appends the audit row (actor, instant, reason) plus the card's history
 * entry the details drawer renders.
 */
export function setIntegrationConnection(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, action: IntegrationAction, reason: string): ServiceResult<Integration> {
  if (ctx.actor.role !== 'admin') return { ok: false, failure: { kind: 'forbidden', message: 'Only Organization Admins can connect or disconnect integrations. Ask an admin.' } }
  if (action === 'disconnect' && !reason.trim()) return { ok: false, failure: { kind: 'validation', message: 'A reason is required to disconnect an integration.' } }
  const db = authority.snapshot()
  const current = integrationOf(db, id)
  if (!current) return { ok: false, failure: { kind: 'not-found', message: `No integration ${id}.` } }
  if (action === 'connect' && current.status === 'connected') return { ok: false, failure: { kind: 'conflict', message: `${current.name} is already connected.` } }
  if (action === 'disconnect' && current.status !== 'connected') return { ok: false, failure: { kind: 'conflict', message: `${current.name} is not connected.` } }
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    const i = integrationOf(d, id)!
    i.status = action === 'connect' ? 'connected' : 'disconnected'
    i.updated = at
    i.history.unshift(`${at} — ${action === 'connect' ? 'Connected' : 'Disconnected'} by ${ctx.actor.id}`)
    auditRow(d, ctx, at, action === 'connect' ? 'Connected integration' : 'Disconnected integration', id, 'Success', action === 'disconnect' ? reason.trim() : 'Connection check passed (simulated)')
  })
  return { ok: true, data: integrationOf(authority.snapshot(), id)! }
}

/**
 * Token lifecycle (ticket 57): re-entering an access key is the create-once
 * secret flow. Admin-only; the value must be at least 8 characters (the
 * baseline modal rule, enforced again here). The commit stores only the
 * masked form, flips the source back to connected (an expired token is the
 * authfail cause) and the response carries the masked view — the plaintext
 * never enters state, audit rows or the result.
 */
export function updateIntegrationKey(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, key: string): ServiceResult<Integration> {
  if (ctx.actor.role !== 'admin') return { ok: false, failure: { kind: 'forbidden', message: 'Only Organization Admins can update integration keys. Ask an admin.' } }
  if (key.trim().length < 8) return { ok: false, failure: { kind: 'validation', message: 'The key needs at least 8 characters.' } }
  const db = authority.snapshot()
  if (!integrationOf(db, id)) return { ok: false, failure: { kind: 'not-found', message: `No integration ${id}.` } }
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    const i = integrationOf(d, id)!
    i.secret = maskSecret(key)
    i.status = 'connected'
    i.updated = at
    i.history.unshift(`${at} — Re-authenticated by ${ctx.actor.id}`)
    auditRow(d, ctx, at, 'Updated integration key', id, 'Success', 'Key is not stored in the UI')
  })
  return { ok: true, data: integrationOf(authority.snapshot(), id)! }
}

/* ───────────── Policy configuration (ticket 57) ───────────── */

/** One policy-list read: the recorded toggles plus the edit hint. */
export interface PoliciesRead {
  policies: Policy[]
  /** Recent audit rows per policy object id, newest first (the "last change" line). */
  recentAudit: Audit[]
  canEdit: boolean
}

/** Policy list read: viewer roles are refused with the tab's reason. */
export function getPolicies(db: Db, ctx: RequestContext): ServiceResult<PoliciesRead> {
  if (ctx.actor.role === 'viewer') {
    return { ok: false, failure: { kind: 'forbidden', message: 'The Client / Viewer role cannot view organization policies.' } }
  }
  return { ok: true, data: { policies: db.policies, recentAudit: db.audit, canEdit: ctx.actor.role === 'admin' } }
}

/**
 * Enables or disables one organization policy. Admin-only; disabling a
 * control is destructive and requires a reason (enabling restores it without
 * one, matching the baseline). The handler only records the configuration —
 * it never bypasses the enforcement sites (operation preflight, session
 * grants read their own rules), so the compatibility state stays coherent.
 */
export function setPolicyEnabled(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, enabled: boolean, reason: string): ServiceResult<Policy> {
  if (ctx.actor.role !== 'admin') return { ok: false, failure: { kind: 'forbidden', message: 'Only Organization Admins can enable or disable policies. Ask an admin to request the change.' } }
  if (!enabled && !reason.trim()) return { ok: false, failure: { kind: 'validation', message: 'A reason is required to disable a policy.' } }
  const db = authority.snapshot()
  const current = policyOf(db, id)
  if (!current) return { ok: false, failure: { kind: 'not-found', message: `No policy ${id}.` } }
  if (current.enabled === enabled) return { ok: false, failure: { kind: 'conflict', message: `${current.name} is already ${enabled ? 'enabled' : 'disabled'}.` } }
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    const p = policyOf(d, id)!
    p.enabled = enabled
    p.updated = at.split(',').slice(0, 2).join(',')
    auditRow(d, ctx, at, `${enabled ? 'Enabled' : 'Disabled'} policy: ${p.name}`, id, 'Success', enabled ? 'Restored to the recorded default flow' : reason.trim())
  })
  return { ok: true, data: policyOf(authority.snapshot(), id)! }
}

/** Builds the typed organization settings service; `guard` is the factory's
 *  superseded-scope read guard. Reads observe scope cancellation; mutations
 *  capture their context at call time and commit once. */
export interface SettingsService {
  getProfile(ctx: RequestContext): Promise<ServiceResult<OrgProfileRead>>
  getMembers(ctx: RequestContext): Promise<ServiceResult<OrgMembersRead>>
  updateProfile(ctx: RequestContext, patch: OrgProfilePatch): Promise<ServiceResult<OrgProfile>>
  setMemberRole(ctx: RequestContext, name: string, role: Role, reason: string): Promise<ServiceResult<OrgMemberView>>
  setMemberStatus(ctx: RequestContext, name: string, action: OrgMemberStatusAction, reason: string): Promise<ServiceResult<OrgMemberView>>
  inviteMember(ctx: RequestContext, input: OrgInviteInput): Promise<ServiceResult<OrgInvite>>
  /* Ticket 57: integration registry + policy configuration. */
  getIntegrations(ctx: RequestContext): Promise<ServiceResult<IntegrationsRead>>
  getPolicies(ctx: RequestContext): Promise<ServiceResult<PoliciesRead>>
  setIntegrationConnection(ctx: RequestContext, id: string, action: IntegrationAction, reason: string): Promise<ServiceResult<Integration>>
  updateIntegrationKey(ctx: RequestContext, id: string, key: string): Promise<ServiceResult<Integration>>
  setPolicyEnabled(ctx: RequestContext, id: string, enabled: boolean, reason: string): Promise<ServiceResult<Policy>>
}

export function createSettingsService(
  authority: DbAuthority,
  clock: Clock,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): SettingsService {
  return {
    getProfile: (ctx) => guard(() => getOrgProfile(authority.snapshot(), ctx)),
    getMembers: (ctx) => guard(() => getOrgMembers(authority.snapshot(), ctx)),
    updateProfile: (ctx, patch) => Promise.resolve(updateOrgProfile(authority, clock, ctx, patch)),
    setMemberRole: (ctx, name, role, reason) => Promise.resolve(setMemberRole(authority, clock, ctx, name, role, reason)),
    setMemberStatus: (ctx, name, action, reason) => Promise.resolve(setMemberStatus(authority, clock, ctx, name, action, reason)),
    inviteMember: (ctx, input) => Promise.resolve(inviteMember(authority, clock, ctx, input)),
    getIntegrations: (ctx) => guard(() => getIntegrations(authority.snapshot(), ctx)),
    getPolicies: (ctx) => guard(() => getPolicies(authority.snapshot(), ctx)),
    setIntegrationConnection: (ctx, id, action, reason) => Promise.resolve(setIntegrationConnection(authority, clock, ctx, id, action, reason)),
    updateIntegrationKey: (ctx, id, key) => Promise.resolve(updateIntegrationKey(authority, clock, ctx, id, key)),
    setPolicyEnabled: (ctx, id, enabled, reason) => Promise.resolve(setPolicyEnabled(authority, clock, ctx, id, enabled, reason)),
  }
}
