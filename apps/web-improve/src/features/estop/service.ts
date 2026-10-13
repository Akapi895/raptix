/**
 * Emergency-stop transactions (ticket 22 console migration, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Invariant: an emergency stop is ALWAYS an action with an immediate visible
 * response, never a passive status. Requesting one commits the visible stop
 * state (phase 'requested'), the audit row (result Pending) and the workspace
 * notice in ONE immediate commit — before any simulated acknowledgement
 * delay — so the stop state appears in the same tick as the button press,
 * whatever surface fired it. The store action keeps only the demo's simulated
 * outcome orchestration (tracked delays disposed on reset); every transition
 * runs through these handlers, so legacy actions and typed callers observe
 * the same state. The remaining machine hardening (a manual confirm leaving
 * linked operations untouched — ledger G-10) stays with ticket 28.
 */
import { can } from '../../auth/policy'
import { DEMO_TZ, formatDemoInstant } from '../../domain/clock'
import type { Db } from '../../data'
import type { DbAuthority } from '../../domain/database'
import type { Clock, RequestContext, ServiceResult } from '../../domain/service'
import type { StopState } from '../../domain/entities'

/** Audit display labels for the actor's role (kept local to avoid a store cycle). */
const ROLE_LABEL: Record<string, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }

const stopRef = { kind: 'stop-state' as const, id: 'workspace' }

/** Transcript time-of-day stamp (HH:MM:SS in the demo timezone) from the injected clock. */
const tickOf = (clock: Clock) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: DEMO_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(clock.now()))

type Scope = StopState['scope']

/** The scope matcher shared by every transition (operations and sessions). */
function inScopeOf(scope: Scope, id: string) {
  return (target: { projectId: string; id: string }) => scope === 'workspace' || (scope === 'project' ? target.projectId === id : target.id === id)
}

/** The audit project context of a stop target (workspace stops have none). */
function projectContextOf(db: Db, scope: Scope, id: string): string {
  if (scope === 'project') return id
  if (scope === 'workspace') return ''
  return db.operations.find((o) => o.id === id)?.projectId || ''
}

export interface StopTarget { scope: Scope; id: string }
export interface StopRequestInput extends StopTarget { reason: string }
export interface StopRequestOutcome { operations: string[]; projectId: string }

/**
 * The stop REQUEST — the enforced action behind every Emergency Stop button.
 * Refusals: a missing reason → validation; a role without `estop` →
 * forbidden. On success ONE atomic commit publishes the requested stop
 * state, the Pending audit row and the acknowledgement notice — the
 * immediate visible response — and returns the affected operation ids so
 * callers can mirror them into their own live-log surfaces.
 */
export function requestEmergencyStopTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, input: StopRequestInput): ServiceResult<StopRequestOutcome> {
  const db = authority.snapshot()
  if (!input.reason.trim()) {
    return { ok: false, failure: { kind: 'validation', message: 'A reason is required for an Emergency Stop. It is recorded in the audit log.', entity: stopRef } }
  }
  const project = input.scope === 'workspace' ? undefined
    : input.scope === 'project' ? db.projects.find((x) => x.id === input.id)
      : db.projects.find((x) => x.id === db.operations.find((o) => o.id === input.id)?.projectId)
  if (!can(ctx.actor, 'estop', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_LABEL[ctx.actor.role]}) cannot trigger an Emergency Stop. Ask a Manager or Admin.`, entity: stopRef } }
  }
  const inScope = inScopeOf(input.scope, input.id)
  const affected = db.operations.filter((o) => inScope(o) && ['running', 'paused'].includes(o.status))
  const affectedP = input.scope === 'operation' ? affected[0]?.projectId || '' : input.scope === 'project' ? input.id : ''
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    d.stopState = { scope: input.scope, id: input.id, phase: 'requested', reason: input.reason, at, by: ctx.actor.id }
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Emergency stop requested', obj: input.scope === 'workspace' ? 'Workspace' : input.id, projectId: affectedP, result: 'Pending', reason: input.reason })
    d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + clock.now() % 10000, group: 'update', text: `Emergency stop requested (${input.scope}) by ${ctx.actor.id} — awaiting acknowledgement`, projectId: affectedP, at, read: false, to: { name: 'settings' }, category: 'system' })
  })
  return { ok: true, data: { operations: affected.map((o) => o.id), projectId: affectedP } }
}

/**
 * The agents' acknowledgement: linked operations become emergency-stopped
 * (running steps Unknown, queued steps not run), linked sessions start
 * revoking, and the stop state moves to acknowledged with its audit row —
 * all in the one atomic commit. Operations never restart automatically.
 */
export function acknowledgeEmergencyStopTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, input: StopRequestInput): ServiceResult<StopTarget> {
  const inScope = inScopeOf(input.scope, input.id)
  const at = formatDemoInstant(clock.now())
  const tick = tickOf(clock)
  let affectedP = ''
  authority.commit(ctx.corr, (d) => {
    affectedP = projectContextOf(d, input.scope, input.id)
    d.operations.forEach((o) => {
      if (inScope(o) && ['running', 'paused'].includes(o.status)) {
        o.status = 'estop'; o.stopReason = input.reason; o.stopBy = ctx.actor.id; o.stopAt = at
        o.steps.forEach((s) => { if (s.status === 'running') s.status = 'unknown'; if (s.status === 'pending' || s.status === 'review') s.status = 'notrun' })
      }
    })
    d.sessions.forEach((s) => {
      const o = d.operations.find((x) => x.id === s.opId)
      if ((input.scope === 'workspace' || (input.scope === 'project' && s.projectId === input.id) || (input.scope === 'operation' && s.opId === input.id)) && o && ['connected', 'available', 'suspended', 'awaiting'].includes(s.state)) {
        s.state = 'revoking'; s.transcript.push({ ts: tick, who: 'system', text: 'Emergency stop: session access is being revoked.' })
      }
    })
    if (d.stopState) d.stopState.phase = 'acknowledged'
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Emergency stop acknowledged', obj: input.scope === 'workspace' ? 'Workspace' : input.id, projectId: affectedP, result: 'Success', reason: 'Agents confirmed halt' })
  })
  return { ok: true, data: { scope: input.scope, id: input.id } }
}

/** Releases the revoked sessions and the agents the stopped operations reserved; the stop state completes. */
export function finalizeEmergencyStopTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, input: StopTarget): ServiceResult<StopTarget> {
  authority.commit(ctx.corr, (d) => {
    d.sessions.forEach((s) => { if (s.state === 'revoking') s.state = 'terminated' })
    d.operations.forEach((o) => {
      if (o.status === 'estop') o.agents.forEach((aid) => { const a = d.agents.find((x) => x.id === aid); if (a && a.op === o.id) a.op = null })
    })
    if (d.stopState) d.stopState.phase = 'stopped'
  })
  return { ok: true, data: { scope: input.scope, id: input.id } }
}

/** The simulated failed outcome: no acknowledgement arrived; nothing stopped. */
export function failEmergencyStopTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, input: StopTarget): ServiceResult<StopTarget> {
  const at = formatDemoInstant(clock.now())
  const affectedP = projectContextOf(authority.snapshot(), input.scope, input.id)
  authority.commit(ctx.corr, (d) => {
    if (d.stopState) d.stopState.phase = 'failed'
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Emergency stop failed', obj: input.scope === 'workspace' ? 'Workspace' : input.id, projectId: affectedP, result: 'Failed', reason: 'No acknowledgement — agents did not confirm halt' })
  })
  return { ok: true, data: { scope: input.scope, id: input.id } }
}

/** The simulated unknown outcome: acknowledgement timed out; the real state is uncertain. */
export function unknownEmergencyStopTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, input: StopTarget): ServiceResult<StopTarget> {
  const at = formatDemoInstant(clock.now())
  const affectedP = projectContextOf(authority.snapshot(), input.scope, input.id)
  authority.commit(ctx.corr, (d) => {
    if (d.stopState) d.stopState.phase = 'unknown'
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Emergency stop status unknown', obj: input.scope === 'workspace' ? 'Workspace' : input.id, projectId: affectedP, result: 'Unknown', reason: 'Acknowledgement timed out' })
  })
  return { ok: true, data: { scope: input.scope, id: input.id } }
}

export type StopResolution = 'confirmed-stopped' | 'dismiss'

/**
 * The manual resolution path: dismissing clears the stop state; a manual
 * confirm marks it stopped with an explicit audit row (the operator verified
 * the halt out-of-band). Linked operations are deliberately left untouched —
 * the documented baseline behavior whose hardening belongs to ticket 28.
 */
export function resolveStopTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, outcome: StopResolution): ServiceResult<StopTarget> {
  if (outcome === 'dismiss') {
    authority.commit(ctx.corr, (d) => { d.stopState = null })
    return { ok: true, data: { scope: 'workspace', id: 'workspace' } }
  }
  const s = authority.snapshot().stopState
  if (!s) {
    return { ok: false, failure: { kind: 'conflict', message: 'No emergency stop is in progress to confirm.', entity: stopRef } }
  }
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    if (d.stopState) d.stopState.phase = 'stopped'
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Emergency stop confirmed manually', obj: s.id, projectId: '', result: 'Success', reason: 'Operator verified agents halted out-of-band' })
  })
  return { ok: true, data: { scope: s.scope, id: s.id } }
}
