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
import { projectAccessible } from '../../domain/policy'
import { USERS, type Db } from '../../data'
import { formatDemoInstant } from '../../domain/clock'
import type { DbAuthority } from '../../domain/database'
import type { Clock, RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { Audit, Integration, OrgInvite, OrgProfile, Policy, Retention, Role } from '../../domain/entities'

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
function auditRow(d: Db, ctx: RequestContext, at: string, action: string, obj: string, result: string, reason: string, projectId = '') {
  d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action, obj, projectId, result, reason })
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

/* ───────────── Retention (ticket 58) ───────────── */

/**
 * One retention read: the seeded policies, the committed legal holds and the
 * retention-relevant audit slice. Holds live in `db.org` (the ticket 56
 * workspace state) so a hold placed here persists for the demo session,
 * commits atomically with its audit row and demo reset restores the seed.
 * Every control stays clearly simulated — saving or deleting records
 * configuration/audit rows and never destroys seeded data.
 */
export interface RetentionRead {
  policies: Retention[]
  /** Retention ids currently under a legal hold (blocks scheduled deletion). */
  holds: string[]
  /** Retention-relevant audit rows, scoped and sensitive-filtered, newest first. */
  history: Audit[]
  /** UI hint; every mutation re-checks the role at the handler. */
  canEdit: boolean
}

/** The retention history slice: this tab's lifecycle plus project closure events. */
const RETENTION_HISTORY = /Closed project|Reopen|export|deliver|hold|archive|Retention|Deleted under policy/i

export function getRetention(db: Db, ctx: RequestContext): ServiceResult<RetentionRead> {
  if (!STAFF.includes(ctx.actor.role)) {
    return { ok: false, failure: { kind: 'forbidden', message: 'Retention policies are visible to Organization Admins, Red Team Managers and Reviewers. Ask an admin if you need access.' } }
  }
  return {
    ok: true,
    data: {
      policies: db.retention,
      holds: [...db.org.holds],
      history: sensitiveAuditMask(db, ctx, db.audit.filter((a) => RETENTION_HISTORY.test(a.action)).slice(0, 12)),
      canEdit: ctx.actor.role === 'admin',
    },
  }
}

/**
 * Sensitive audit masking (policy PM-7): a row whose object references
 * sensitive evidence hides its reason below Organization Admin — the object
 * id stays a legal reference while the capture content is masked by role.
 */
function sensitiveAuditMask(db: Db, ctx: RequestContext, rows: Audit[]): Audit[] {
  if (ctx.actor.role === 'admin') return rows
  const sensitive = new Set(db.evidence.filter((e) => e.sensitive).map((e) => e.id))
  return rows.map((a) => (sensitive.has(a.obj) ? { ...a, reason: '•••• (sensitive evidence masked)' } : a))
}

/** Validated retention policy patch; `undefined` fields keep the committed value. */
export interface RetentionPatch { period?: string; label?: string }
const PERIOD_RE = /^\d{1,3} (month|year)s$/

/**
 * Saves one retention policy's period/label. Admin-only, validated (a
 * positive period such as “24 months”, a non-empty classification label) and
 * audited in the same commit. The write records configuration only —
 * enforcement of expiry windows is a backend concern this demo never fakes.
 */
export function updateRetention(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, patch: RetentionPatch): ServiceResult<Retention> {
  if (ctx.actor.role !== 'admin') return { ok: false, failure: { kind: 'forbidden', message: 'Only Organization Admins can change retention policies. Ask an admin to make the change.' } }
  const db = authority.snapshot()
  const r = db.retention.find((x) => x.id === id)
  if (!r) return { ok: false, failure: { kind: 'not-found', message: `No retention policy ${id}.` } }
  const period = patch.period !== undefined ? patch.period.trim() : r.period
  const label = patch.label !== undefined ? patch.label.trim() : r.label
  if (!PERIOD_RE.test(period)) return { ok: false, failure: { kind: 'validation', message: 'Enter a retention period such as “24 months”.' } }
  if (!label) return { ok: false, failure: { kind: 'validation', message: 'A classification label is required.' } }
  if (period === r.period && label === r.label) return { ok: false, failure: { kind: 'conflict', message: `${r.name} already has these values.` } }
  const at = formatDemoInstant(clock.now())
  const changed = [period !== r.period ? `period ${period}` : '', label !== r.label ? `label ${label}` : ''].filter(Boolean).join(', ')
  authority.commit(ctx.corr, (d) => {
    const row = d.retention.find((x) => x.id === id)!
    row.period = period
    row.label = label
    auditRow(d, ctx, at, 'Updated retention policy (simulated)', id, 'Success', changed)
  })
  return { ok: true, data: authority.snapshot().retention.find((x) => x.id === id)! }
}

/**
 * Places or releases a legal hold. Admin-only; both directions need a reason
 * (the legal basis on placement, the justification for lifting it) and a
 * repeat is a conflict. The hold flag is the session-persistent org state, so
 * the block survives navigation and persona switches until demo reset.
 */
export function setRetentionHold(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, held: boolean, reason: string): ServiceResult<Retention> {
  if (ctx.actor.role !== 'admin') return { ok: false, failure: { kind: 'forbidden', message: 'Only Organization Admins can place or release legal holds. Ask an admin.' } }
  if (!reason.trim()) return { ok: false, failure: { kind: 'validation', message: held ? 'A legal basis is required to place a hold.' : 'A reason is required to release a hold.' } }
  const db = authority.snapshot()
  const r = db.retention.find((x) => x.id === id)
  if (!r) return { ok: false, failure: { kind: 'not-found', message: `No retention policy ${id}.` } }
  if (held === db.org.holds.includes(id)) return { ok: false, failure: { kind: 'conflict', message: `${r.name} already ${held ? 'has' : 'has no'} legal hold.` } }
  const at = formatDemoInstant(clock.now())
  const projectId = r.scope.startsWith('RT') ? r.scope : ''
  authority.commit(ctx.corr, (d) => {
    d.org.holds = held ? [...d.org.holds, id] : d.org.holds.filter((x) => x !== id)
    auditRow(d, ctx, at, held ? 'Placed legal hold (simulated)' : 'Released legal hold (simulated)', id, 'Success', reason.trim(), projectId)
  })
  return { ok: true, data: authority.snapshot().retention.find((x) => x.id === id)! }
}

/**
 * Deletes under policy — explicitly simulated: the commit records the policy
 * state as “Deleted (simulated)”, never destroying seeded demo data, and
 * appends the audited deletion row. Admin-only, reason-required, blocked
 * while a legal hold is active and before the retention window expires.
 */
export function deleteRetentionData(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, reason: string): ServiceResult<Retention> {
  if (ctx.actor.role !== 'admin') return { ok: false, failure: { kind: 'forbidden', message: 'Only Organization Admins can delete under policy. Ask an admin to make the change.' } }
  if (!reason.trim()) return { ok: false, failure: { kind: 'validation', message: 'A reason is required to delete under policy.' } }
  const db = authority.snapshot()
  const r = db.retention.find((x) => x.id === id)
  if (!r) return { ok: false, failure: { kind: 'not-found', message: `No retention policy ${id}.` } }
  if (db.org.holds.includes(id)) return { ok: false, failure: { kind: 'conflict', message: 'A legal hold is active, so deletion is blocked. Release the hold first.' } }
  if (r.state !== 'Expired') return { ok: false, failure: { kind: 'conflict', message: 'Not yet due for deletion under the policy.' } }
  const at = formatDemoInstant(clock.now())
  const projectId = r.scope.startsWith('RT') ? r.scope : ''
  authority.commit(ctx.corr, (d) => {
    const row = d.retention.find((x) => x.id === id)!
    row.state = 'Deleted (simulated)'
    auditRow(d, ctx, at, 'Deleted under policy (simulated)', id, 'Success', reason.trim(), projectId)
  })
  return { ok: true, data: authority.snapshot().retention.find((x) => x.id === id)! }
}

/* ───────────── Canonical audit history (ticket 58) ───────────── */

/** Correlation id of one audit row (typed rows carry corr; seeded rows derive it). */
export function auditCorr(a: Audit): string {
  return a.corr || 'COR-' + a.id.replace(/\D/g, '').padStart(4, '0')
}

/** One audit-history query: every field is an optional narrowing filter. */
export interface AuditQuery { q?: string; actor?: string; action?: string; project?: string; result?: string; origin?: '' | 'human' | 'ai'; corr?: string; kind?: '' | 'estop' }

/** One audit-history read: the filtered rows plus the filter option universes. */
export interface AuditRead {
  /** Newest-first filtered rows (the tab paginates for display). */
  items: Audit[]
  total: number
  options: { actors: string[]; actions: string[]; results: string[]; corrs: string[] }
  /** Export gate: Organization Admins and Reviewers only (baseline policy). */
  canExport: boolean
}

/**
 * The canonical audit history read. Both commit paths land here through the
 * one authority — legacy actions (`A.audit` commits `corr: 'legacy'`) and
 * typed feature handlers append rows to the same collection — so this read is
 * the single searchable history. Scoped projection (baseline): workspace-level
 * rows are organization-internal and admin-only; every other visible row
 * names a project in the reader's scope. Sensitive masking (PM-7) applies to
 * rows referencing sensitive evidence.
 */
export function getAudit(db: Db, ctx: RequestContext, query: AuditQuery = {}): ServiceResult<AuditRead> {
  if (!STAFF.includes(ctx.actor.role)) {
    return { ok: false, failure: { kind: 'forbidden', message: 'The audit log is visible to Organization Admins, Red Team Managers and Reviewers. Ask an admin if you need access.' } }
  }
  const admin = ctx.actor.role === 'admin'
  const accessible = new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
  const base = sensitiveAuditMask(db, ctx, db.audit.filter((a) => admin || (a.projectId && accessible.has(a.projectId))))
  const q = (query.q || '').toLowerCase()
  const isAi = (a: Audit) => a.actor === 'AI Operator'
  const rows = base.filter((a) =>
    (!query.actor || a.actor === query.actor) &&
    (!query.action || a.action === query.action) &&
    (!query.project || a.projectId === query.project) &&
    (!query.result || a.result === query.result) &&
    (!query.origin || (query.origin === 'ai' ? isAi(a) : !isAi(a))) &&
    (!query.corr || auditCorr(a) === query.corr) &&
    (!query.kind || /^Emergency stop/i.test(a.action)) &&
    (!q || `${a.id} ${auditCorr(a)} ${a.actor} ${a.action} ${a.obj} ${a.reason}`.toLowerCase().includes(q)))
  return {
    ok: true,
    data: {
      items: rows,
      total: rows.length,
      options: {
        actors: [...new Set(base.map((a) => a.actor))],
        actions: [...new Set(base.map((a) => a.action))],
        results: [...new Set(base.map((a) => a.result))],
        corrs: [...new Set(base.map((a) => auditCorr(a)))].filter((c) => /^COR-\d{3}-\d{2}$/.test(c)),
      },
      canExport: admin || ctx.actor.role === 'reviewer',
    },
  }
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
  /* Ticket 58: retention controls + canonical audit history. */
  getRetention(ctx: RequestContext): Promise<ServiceResult<RetentionRead>>
  getAudit(ctx: RequestContext, query: AuditQuery): Promise<ServiceResult<AuditRead>>
  updateRetention(ctx: RequestContext, id: string, patch: RetentionPatch): Promise<ServiceResult<Retention>>
  setRetentionHold(ctx: RequestContext, id: string, held: boolean, reason: string): Promise<ServiceResult<Retention>>
  deleteRetentionData(ctx: RequestContext, id: string, reason: string): Promise<ServiceResult<Retention>>
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
    getRetention: (ctx) => guard(() => getRetention(authority.snapshot(), ctx)),
    getAudit: (ctx, query) => guard(() => getAudit(authority.snapshot(), ctx, query)),
    updateRetention: (ctx, id, patch) => Promise.resolve(updateRetention(authority, clock, ctx, id, patch)),
    setRetentionHold: (ctx, id, held, reason) => Promise.resolve(setRetentionHold(authority, clock, ctx, id, held, reason)),
    deleteRetentionData: (ctx, id, reason) => Promise.resolve(deleteRetentionData(authority, clock, ctx, id, reason)),
  }
}
