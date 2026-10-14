/**
 * Session grant lifecycle (ticket 46, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Explicit, revocable, time-bound per-user grants with one authorization
 * seam: a grant covers ONE session for ONE user and never raises
 * project-wide permissions, and a connection state is not an access grant.
 * The interactive-command handler re-checks the grant at `now >= expiresAt`
 * (absolute instants from the injected clock), so commands are denied even
 * with no C2 page mounted and before the next 15-second sweep — the sweep is
 * a backstop, never a grace period: it removes expired grants, expires their
 * approved requests and records the audit rows without terminating the
 * connected session. The factory registers {@link createGrantLifecycle} once,
 * so deadline events continue without any screen mounted and a demo reset
 * re-arms them against the fresh dataset.
 */
import { can as policyCan, projectAccessible } from '../../auth/policy'
import { DEMO_TZ, formatDemoInstant, parseDemoInstant, type Scheduler } from '../../domain/clock'
import type { Db } from '../../data'
import type { DbAuthority } from '../../domain/database'
import type { Clock, Instant, RequestContext, ServiceResult } from '../../domain/service'

/** Audit display labels for the actor's role (kept local to avoid a store cycle). */
const ROLE_LABEL: Record<string, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }

/** Reason floors mirrored from the access drawer (20) and the decision modal (MIN_REASON / 2). */
const MIN_REQUEST_REASON = 20
const MIN_DECISION_NOTE = 10
/** Grant length bound (minutes); the console offers 30/60, the inbox default is 30. */
const MAX_GRANT_MINUTES = 120
/** Sweep cadence; matches the legacy mounted watch so displays stay coherent. */
export const GRANT_SWEEP_MS = 15_000

/** Legacy correlation derivation for RT-2026-014 access events (matches the seeded audit). */
const corrFor = (projectId: string, obj: string) => (projectId === 'RT-2026-014' && /^(SS|AR)-/.test(obj) ? 'COR-014-01' : undefined)

/** Transcript time-of-day stamp (HH:MM:SS in the demo timezone) from the injected clock. */
const tickOf = (clock: Clock) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: DEMO_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(clock.now()))

const notAvailable = (kind: 'session' | 'session-request', id: string) => ({
  ok: false as const,
  failure: { kind: 'not-found' as const, message: `${kind === 'session' ? 'Session' : 'Access request'} ${id} is not available for your account.`, entity: { kind, id } },
})

/* ───────────── Request ───────────── */

export interface GrantRequestInput { sessionId: string; mode: 'read-only' | 'interactive'; duration: string; reason: string }
export interface GrantRequestOutcome { requestId: string; sessionId: string; projectId: string }

/**
 * The access REQUEST: membership is the existence boundary (a non-member
 * gets `not-found`, no leak), the role needs the `interactive` action, a
 * reason is required and one pending request per user/session is a conflict.
 * One atomic commit: request + Pending audit + approver notice.
 */
export function requestSessionAccessTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, input: GrantRequestInput): ServiceResult<GrantRequestOutcome> {
  const db = authority.snapshot()
  const s = db.sessions.find((x) => x.id === input.sessionId)
  const project = s ? db.projects.find((p) => p.id === s.projectId) : undefined
  if (!s || !projectAccessible(project, ctx.actor)) return notAvailable('session', input.sessionId)
  if (!policyCan(ctx.actor, 'interactive', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_LABEL[ctx.actor.role]}) cannot request interactive access.`, entity: { kind: 'session', id: s.id, projectId: s.projectId } } }
  }
  if (input.reason.trim().length < MIN_REQUEST_REASON) {
    return { ok: false, failure: { kind: 'validation', message: `Explain in at least ${MIN_REQUEST_REASON} characters why this access is needed.`, entity: { kind: 'session-request', id: s.id, projectId: s.projectId } } }
  }
  const pending = db.sessionRequests.find((r) => r.sessionId === s.id && r.by === ctx.actor.id && r.status === 'pending')
  if (pending) {
    return { ok: false, failure: { kind: 'conflict', message: `Request ${pending.id} is already pending approval.`, entity: { kind: 'session-request', id: pending.id, projectId: s.projectId } } }
  }
  const requestId = 'AR-' + String(db.counters.request + 1).padStart(3, '0')
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    d.counters.request++
    d.sessionRequests.unshift({ id: requestId, sessionId: s.id, projectId: s.projectId, by: ctx.actor.id, reason: input.reason.trim(), mode: input.mode, duration: input.duration, status: 'pending', at })
    d.audit.unshift({ corr: corrFor(s.projectId, s.id), id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Requested session access', obj: s.id, projectId: s.projectId, result: 'Pending', reason: input.reason.trim() })
    d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + clock.now() % 10000, group: 'todo', text: `Session access request ${requestId} is pending`, projectId: s.projectId, at, read: false, to: { name: 'c2-session', id: s.id }, category: 'sessions' })
  })
  return { ok: true, data: { requestId, sessionId: s.id, projectId: s.projectId } }
}

/* ───────────── Decision ───────────── */

export type GrantDecision = 'approved' | 'rejected' | 'changes'
export interface GrantDecisionInput { requestId: string; decision: GrantDecision; note: string; minutes?: number }
export interface GrantDecisionOutcome { requestId: string; sessionId: string; projectId: string; status: GrantDecision; grantExpiresAt?: Instant }

/**
 * The DECISION: never self-review (four-eyes), approver role required, a
 * decision note is required and only a pending request can be decided.
 * Approval binds ONE per-user grant on that session: any previous grant for
 * the same user is replaced, the expiry is `now + minutes` as an absolute
 * instant from the injected clock, and the grant never touches other
 * sessions or project-wide permissions.
 */
export function decideSessionRequestTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, input: GrantDecisionInput): ServiceResult<GrantDecisionOutcome> {
  const db = authority.snapshot()
  const r = db.sessionRequests.find((x) => x.id === input.requestId)
  const project = r ? db.projects.find((p) => p.id === r.projectId) : undefined
  if (!r || !projectAccessible(project, ctx.actor)) return notAvailable('session-request', input.requestId)
  if (r.by === ctx.actor.id) {
    return { ok: false, failure: { kind: 'forbidden', message: 'You cannot review your own request — an independent reviewer must decide it.', entity: { kind: 'session-request', id: r.id, projectId: r.projectId } } }
  }
  if (!policyCan(ctx.actor, 'approveAccess', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_LABEL[ctx.actor.role]}) cannot decide access requests.`, entity: { kind: 'session-request', id: r.id, projectId: r.projectId } } }
  }
  if (r.status !== 'pending') {
    return { ok: false, failure: { kind: 'conflict', message: `Request ${r.id} is already ${r.status}.`, entity: { kind: 'session-request', id: r.id, projectId: r.projectId } } }
  }
  if (input.note.trim().length < MIN_DECISION_NOTE) {
    return { ok: false, failure: { kind: 'validation', message: 'A decision reason is required.', entity: { kind: 'session-request', id: r.id, projectId: r.projectId } } }
  }
  const minutes = input.minutes ?? 30
  if (input.decision === 'approved' && (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_GRANT_MINUTES)) {
    return { ok: false, failure: { kind: 'validation', message: `Grant duration must be between 1 and ${MAX_GRANT_MINUTES} minutes.`, entity: { kind: 'session-request', id: r.id, projectId: r.projectId } } }
  }
  const now = clock.now()
  const expiresAt = now + minutes * 60_000
  const at = formatDemoInstant(now)
  const tick = tickOf(clock)
  const expires = formatDemoInstant(expiresAt)
  authority.commit(ctx.corr, (d) => {
    const x = d.sessionRequests.find((y) => y.id === r.id)!
    x.status = input.decision
    x.decidedBy = ctx.actor.id
    x.note = input.note.trim()
    if (input.decision === 'approved') {
      const s = d.sessions.find((y) => y.id === x.sessionId)!
      s.grants = s.grants.filter((g) => g.user !== x.by)
      s.grants.push({ user: x.by, perm: x.mode, expires, by: ctx.actor.id })
      s.transcript.push({ ts: tick, who: 'system', text: `${x.mode} access granted to ${x.by} by ${ctx.actor.id}.` })
    }
    d.audit.unshift({ corr: corrFor(r.projectId, x.sessionId), id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: `${input.decision === 'approved' ? 'Approved' : input.decision === 'rejected' ? 'Rejected' : 'Requested changes on'} session access`, obj: x.sessionId, projectId: r.projectId, result: 'Success', reason: input.note.trim() })
    d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + clock.now() % 10000, group: 'update', text: `Session access ${r.id} ${input.decision === 'changes' ? 'needs changes' : input.decision}`, projectId: r.projectId, at, read: false, to: { name: 'c2-session', id: x.sessionId }, category: 'sessions' })
  })
  return { ok: true, data: { requestId: r.id, sessionId: r.sessionId, projectId: r.projectId, status: input.decision, ...(input.decision === 'approved' ? { grantExpiresAt: expiresAt } : {}) } }
}

/* ───────────── Revocation ───────────── */

export interface GrantRevokeInput { sessionId: string; user: string; reason?: string }
export interface GrantRevokeOutcome { sessionId: string; user: string }

/**
 * The REVOCATION: immediate and revocable by design — actors drop their own
 * grant freely, another user's grant needs the `approveAccess` action, a
 * reason is always required and revoking a non-existent grant is a conflict.
 * The session itself stays connected (revocation ≠ termination).
 */
export function revokeGrantTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, input: GrantRevokeInput): ServiceResult<GrantRevokeOutcome> {
  const db = authority.snapshot()
  const s = db.sessions.find((x) => x.id === input.sessionId)
  const project = s ? db.projects.find((p) => p.id === s.projectId) : undefined
  if (!s || !projectAccessible(project, ctx.actor)) return notAvailable('session', input.sessionId)
  if (!s.grants.some((g) => g.user === input.user)) {
    return { ok: false, failure: { kind: 'conflict', message: `${input.user} does not hold an access grant on ${s.id}.`, entity: { kind: 'session', id: s.id, projectId: s.projectId } } }
  }
  if (input.user !== ctx.actor.id && !policyCan(ctx.actor, 'approveAccess', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: "Only an approver (Red Team Manager, Reviewer or Organization Admin) can revoke another user's access.", entity: { kind: 'session', id: s.id, projectId: s.projectId } } }
  }
  const reason = (input.reason || '').trim()
  if (!reason) {
    return { ok: false, failure: { kind: 'validation', message: 'A reason for the revocation is required.', entity: { kind: 'session', id: s.id, projectId: s.projectId } } }
  }
  const at = formatDemoInstant(clock.now())
  const tick = tickOf(clock)
  authority.commit(ctx.corr, (d) => {
    const x = d.sessions.find((y) => y.id === s.id)!
    x.grants = x.grants.filter((g) => g.user !== input.user)
    x.transcript.push({ ts: tick, who: 'system', text: `Access for ${input.user} revoked by ${ctx.actor.id}.` })
    d.audit.unshift({ corr: corrFor(s.projectId, s.id), id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Revoked session access', obj: s.id, projectId: s.projectId, result: 'Success', reason })
  })
  return { ok: true, data: { sessionId: s.id, user: input.user } }
}

/* ───────────── Interactive commands ───────────── */

export interface SessionCommandInput { sessionId: string; label: string }
export interface SessionCommandOutcome { sessionId: string }

/**
 * The interactive COMMAND — the handler IS the watch enforcement: the actor
 * needs a live interactive grant on this connected session and the command
 * is denied at `now >= expiresAt`, before any sweep and with no console
 * mounted. On success the transcript, last-observed and audit rows commit
 * atomically.
 */
export function sessionCommandTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, input: SessionCommandInput): ServiceResult<SessionCommandOutcome> {
  const db = authority.snapshot()
  const s = db.sessions.find((x) => x.id === input.sessionId)
  const project = s ? db.projects.find((p) => p.id === s.projectId) : undefined
  if (!s || !projectAccessible(project, ctx.actor)) return notAvailable('session', input.sessionId)
  if (s.state !== 'connected') {
    return { ok: false, failure: { kind: 'conflict', message: `Session is ${s.state} — interactive input is unavailable.`, entity: { kind: 'session', id: s.id, projectId: s.projectId } } }
  }
  const g = s.grants.find((x) => x.user === ctx.actor.id)
  if (!g || g.perm !== 'interactive') {
    return { ok: false, failure: { kind: 'forbidden', message: 'Interactive access requires an approved, time-limited grant on this session.', entity: { kind: 'session', id: s.id, projectId: s.projectId } } }
  }
  const deadline = parseDemoInstant(g.expires)
  if (deadline !== undefined && clock.now() >= deadline) {
    return { ok: false, failure: { kind: 'forbidden', message: `Interactive access expired at ${g.expires} — request a new grant to continue.`, entity: { kind: 'session', id: s.id, projectId: s.projectId } } }
  }
  const at = formatDemoInstant(clock.now())
  const tick = tickOf(clock)
  authority.commit(ctx.corr, (d) => {
    const x = d.sessions.find((y) => y.id === s.id)!
    x.last = at
    x.transcript.push({ ts: tick, who: 'user', text: `[simulated] ${input.label}` }, { ts: tick, who: 'target', text: 'Demo data — simulated, sanitized output.' })
    d.audit.unshift({ corr: corrFor(s.projectId, s.id), id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Session action (simulated)', obj: s.id, projectId: s.projectId, result: 'Success', reason: input.label })
  })
  return { ok: true, data: { sessionId: s.id } }
}

/* ───────────── Deadline sweep + lifecycle ───────────── */

export interface GrantExpiryOutcome { sessionIds: string[]; users: string[] }
type GrantTarget = { sessionId: string; user: string }

const dueGrants = (db: Db, now: Instant, only?: GrantTarget): GrantTarget[] => {
  const out: GrantTarget[] = []
  db.sessions.forEach((s) => s.grants.forEach((g) => {
    if (only && (only.sessionId !== s.id || only.user !== g.user)) return
    const at = parseDemoInstant(g.expires)
    if (at !== undefined && now >= at) out.push({ sessionId: s.id, user: g.user })
  }))
  return out
}

const expireCommit = (d: Db, sessionId: string, user: string, at: string, tick: string, reason: string) => {
  const s = d.sessions.find((x) => x.id === sessionId)
  if (!s || !s.grants.some((g) => g.user === user)) return // revoked while the expiry was in flight
  s.grants = s.grants.filter((g) => g.user !== user)
  d.sessionRequests.forEach((r) => { if (r.sessionId === sessionId && r.by === user && r.status === 'approved') r.status = 'expired' })
  s.transcript.push({ ts: tick, who: 'system', text: `Interactive grant for ${user} expired.` })
  d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: 'System', role: 'System', action: 'Session grant expired', obj: sessionId, projectId: s.projectId, result: 'Warning', reason })
}

/**
 * The deadline sweep: removes every grant at or past its expiry (absolute
 * instants — `now >= expiresAt`, no grace period), expires the approved
 * request behind it and records the transcript line and a Warning audit row,
 * while the session itself stays connected (connection is not an access
 * grant). Idempotent: with nothing due it commits nothing.
 */
export function sweepExpiredGrants(authority: DbAuthority, clock: Clock, corr: string): ServiceResult<GrantExpiryOutcome> {
  const db = authority.snapshot()
  const now = clock.now()
  const due = dueGrants(db, now)
  if (due.length === 0) return { ok: true, data: { sessionIds: [], users: [] } }
  const at = formatDemoInstant(now)
  const tick = tickOf(clock)
  authority.commit(corr, (d) => {
    due.forEach(({ sessionId, user }) => expireCommit(d, sessionId, user, at, tick, `Grant deadline reached for ${user}`))
  })
  return { ok: true, data: { sessionIds: [...new Set(due.map((x) => x.sessionId))], users: due.map((x) => x.user) } }
}

/**
 * The immediate single-grant expiry behind the console's demo control and the
 * in-flight command interrupt: removes one user's grant on one session NOW
 * (the demo deliberately jumps ahead of the stored deadline), expires the
 * approved request behind it and records the transcript/audit rows. Idempotent.
 */
export function expireGrantTransaction(authority: DbAuthority, clock: Clock, corr: string, sessionId: string, user: string): ServiceResult<GrantExpiryOutcome> {
  const db = authority.snapshot()
  if (!db.sessions.find((x) => x.id === sessionId)?.grants.some((g) => g.user === user)) {
    return { ok: true, data: { sessionIds: [], users: [] } }
  }
  const at = formatDemoInstant(clock.now())
  const tick = tickOf(clock)
  authority.commit(corr, (d) => expireCommit(d, sessionId, user, at, tick, `Grant expired (demo) for ${user}`))
  return { ok: true, data: { sessionIds: [sessionId], users: [user] } }
}

export interface GrantLifecycle { rearm(): void; dispose(): void }

/**
 * The canonical deadline lifecycle the factory registers once: a recurring
 * 15-second sweep plus an exact scheduler callback for every live grant, so
 * expiry happens with no C2 screen mounted. Re-armed when the session
 * collection changes (a new grant must get its deadline) and after a demo
 * reset (corr 'reset' publishes against the fresh dataset).
 */
export function createGrantLifecycle(authority: DbAuthority, clock: Clock, scheduler: Scheduler): GrantLifecycle {
  let disposed = false
  let sweepCancel: (() => void) | undefined
  let deadlineCancels: (() => void)[] = []
  const arm = () => {
    if (disposed) return
    sweepCancel?.()
    deadlineCancels.forEach((c) => c())
    deadlineCancels = []
    const tick = (slot: Instant) => {
      if (disposed) return
      sweepExpiredGrants(authority, clock, 'grant-sweep')
      const next = slot + GRANT_SWEEP_MS
      sweepCancel = scheduler.schedule(next, () => tick(next))
    }
    const first = clock.now() + GRANT_SWEEP_MS
    sweepCancel = scheduler.schedule(first, () => tick(first))
    authority.snapshot().sessions.forEach((s) => s.grants.forEach((g) => {
      const at = parseDemoInstant(g.expires)
      if (at !== undefined && at > clock.now()) deadlineCancels.push(scheduler.schedule(at, () => sweepExpiredGrants(authority, clock, 'grant-deadline')))
    }))
  }
  const off = authority.subscribe((cs) => { if (cs.corr === 'reset' || cs.entities.some((e) => e.kind === 'session')) arm() })
  arm()
  return {
    rearm: arm,
    dispose: () => { disposed = true; off(); sweepCancel?.(); deadlineCancels.forEach((c) => c()); deadlineCancels = [] },
  }
}
