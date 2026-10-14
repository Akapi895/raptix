/**
 * Demo execution-outcome runtime (ticket 67 enabler E — ADR-0067).
 *
 * The legacy store context kept the demo's simulated outcome engine as
 * `A.*` entries: the emergency-stop acknowledgement switch, the AI chat's
 * 900 ms response timer, the agent loss/restore and fast-forward
 * simulations and the session-revoking delay. They are not operator
 * controls — they commit observable demo state through the one authority
 * on delayed timers, disposed on stop and demo reset. They live here so
 * screens can leave the store context; the provider initializes the
 * runtime with its services and the legacy `A.*` entries delegate to these
 * functions (one implementation, two entry points) until the store
 * retires.
 *
 * Every scheduled timer captures the runtime instance it was created with:
 * a callback that outlives its provider mount commits to that mount's own
 * authority (orphaned, invisible) — the same isolation the provider's
 * closure-bound `later` used to give, and the navigation module's
 * mount-epoch guard gives for routes.
 */
import { USERS } from '../../data'
import { useAuthStore } from '../../state/stores'
import { useSessionStore, type LogLine } from '../../state/session'
import { hhmm, stamp } from '../../domain/demo-clock'
import { ROLE_LABEL } from '../../auth/policy'
import { createChatHandlers } from '../aichat/handlers'
import {
  acknowledgeEmergencyStopTransaction, failEmergencyStopTransaction, finalizeEmergencyStopTransaction,
  requestEmergencyStopTransaction, resolveStopTransaction, unknownEmergencyStopTransaction,
} from '../estop/service'
import type { ActorRef } from '../../domain/service'
import type { ConsoleServices } from '../../domain/service-factory'
import type { Db } from '../../data'

/* ───────────── Runtime registration ───────────── */

interface DemoRuntime {
  services: ConsoleServices
  pending: Set<number>
  aiTimers: Map<string, number>
}

let rt: DemoRuntime | null = null

/** Initializes the runtime with the provider's services (per-mount lifecycle). */
export function initDemoRuntime(services: ConsoleServices): () => void {
  rt = { services, pending: new Set(), aiTimers: new Map() }
  return () => { if (rt?.services === services) rt = null }
}

/** Disposes the current runtime's tracked timers (demo reset). */
export function resetDemoRuntime() {
  if (!rt) return
  rt.pending.forEach((t) => window.clearTimeout(t))
  rt.pending.clear()
  rt.aiTimers.clear()
}

function demand(): DemoRuntime {
  if (!rt) throw new Error('The demo runtime is not initialized (no provider mount).')
  return rt
}

/** Dataset-bound delayed callback bound to its creating runtime; demo reset disposes it so a stale callback never applies pre-reset state to the reseeded dataset. */
function later(r: DemoRuntime, fn: (r: DemoRuntime) => void, ms: number): number {
  const t = window.setTimeout(() => { r.pending.delete(t); fn(r) }, ms)
  r.pending.add(t)
  return t
}

/* ───────────── Context helpers (bound to one runtime) ───────────── */

const USERS_BY_NAME: Record<string, (typeof USERS)[number]> = Object.fromEntries(USERS.map((u) => [u.name, u]))

/** The current persona: the seeded identity with the committed org role override, read synchronously from the one authority. */
function currentActor(r: DemoRuntime): ActorRef {
  const meName = useAuthStore.getState().meName
  const ov = r.services.authority.snapshot().org.members[meName]?.role
  return { id: meName, role: ov ?? USERS_BY_NAME[meName]!.role }
}

/** Legacy request context for the demo commits: the persona is captured at call time, so a later switch never retargets a mutation. */
function actorCtx(r: DemoRuntime, projectId: string) {
  return { actor: currentActor(r), projectId, corr: 'legacy' }
}

function mutate(r: DemoRuntime, fn: (d: Db) => void) {
  r.services.authority.commit('legacy', fn)
}

function audit(r: DemoRuntime, action: string, obj: string, projectId: string, result = 'Success', reason = '') {
  const me = currentActor(r)
  mutate(r, (d) => {
    d.audit.unshift({ corr: projectId === 'RT-2026-014' && /^(SS|AR)-/.test(obj) ? 'COR-014-01' : undefined, id: 'AU-' + ++d.counters.audit, at: stamp(), actor: me.id, role: ROLE_LABEL[me.role], action, obj, projectId, result, reason })
  })
}

function notify(r: DemoRuntime, text: string, projectId: string, to: { name: string; id?: string }, group: 'todo' | 'update' | 'system' = 'update', category?: NonNullable<Db['notices'][number]['category']>) {
  mutate(r, (d) => { d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + Date.now() % 10000, group, text, projectId, at: stamp(), read: false, to, category }) })
}

function pushLog(opId: string, line: Omit<LogLine, 'id' | 'ts'>) {
  const pad = (n: number) => String(n).padStart(2, '0')
  useSessionStore.getState().pushLog(opId, line, hhmm() + ':' + pad(new Date().getSeconds()))
}

/* ───────────── Emergency stop (the demo outcome switch) ───────────── */

/**
 * Requests the emergency stop through the typed handler (the immediate
 * visible commit) and schedules the simulated acknowledgement outcome from
 * the session's stop-outcome switch — the stop banner never shows success
 * that did not happen.
 */
export function emergencyStop(scope: 'operation' | 'project' | 'workspace', id: string, reason: string) {
  const r = demand()
  const res = requestEmergencyStopTransaction(r.services.authority, r.services.clock, actorCtx(r, scope === 'project' ? id : ''), { scope, id, reason })
  if (!res.ok) return
  const affectedP = res.data.projectId
  res.data.operations.forEach((opId) => pushLog(opId, { level: 'ERROR', agent: '—', stepId: '—', text: `EMERGENCY STOP requested by ${currentActor(r).id}: ${reason} — waiting for agent acknowledgement` }))
  const outcome = useSessionStore.getState().stopOutcome
  later(r, (rr) => {
    if (outcome === 'fail') { failEmergencyStopTransaction(rr.services.authority, rr.services.clock, actorCtx(rr, affectedP), { scope, id }); return }
    if (outcome === 'unknown') { unknownEmergencyStopTransaction(rr.services.authority, rr.services.clock, actorCtx(rr, affectedP), { scope, id }); return }
    acknowledgeEmergencyStopTransaction(rr.services.authority, rr.services.clock, actorCtx(rr, affectedP), { scope, id, reason })
    later(rr, (rrr) => { finalizeEmergencyStopTransaction(rrr.services.authority, rrr.services.clock, actorCtx(rrr, affectedP), { scope, id }) }, 2000)
  }, 1800)
}

/** Retries the stop with the acknowledgement outcome re-armed. */
export function retryStop() {
  const r = demand()
  const s = r.services.authority.snapshot().stopState
  if (!s) return
  useSessionStore.getState().setStopOutcome('ack')
  emergencyStop(s.scope, s.id, s.reason + ' (retry)')
}

/** Resolves the stop banner state through the typed handler. */
export function resolveStop(outcome: 'confirmed-stopped' | 'dismiss') {
  const r = demand()
  resolveStopTransaction(r.services.authority, r.services.clock, actorCtx(r, ''), outcome)
}

/* ───────────── AI chat (the demo response orchestration) ───────────── */

export function sendChat(convId: string, text: string) {
  const r = demand()
  const session = useSessionStore.getState()
  if (!text.trim() || session.aiBusy) return
  const chatApi = createChatHandlers(r.services, currentActor(r), 'all')
  const res = chatApi.send(convId, text)
  if (!res.ok) return
  session.setAiBusy(convId)
  const timer = later(r, (rr) => {
    rr.aiTimers.delete(convId)
    chatApi.respond(convId, text)
    useSessionStore.getState().setAiBusy(null)
  }, 900)
  r.aiTimers.set(convId, timer)
}

export function stopChat(convId: string) {
  const r = demand()
  const timer = r.aiTimers.get(convId)
  if (timer === undefined) return
  window.clearTimeout(timer)
  r.aiTimers.delete(convId)
  useSessionStore.getState().setAiBusy(null)
  createChatHandlers(r.services, currentActor(r), 'all').stop(convId)
}

/* ───────────── Agent + step simulations ───────────── */

export function loseAgent(agentId: string) {
  const r = demand()
  const ag = r.services.authority.snapshot().agents.find((a) => a.id === agentId)!
  mutate(r, (d) => { const a = d.agents.find((x) => x.id === agentId)!; a.status = 'lost'; a.lastSeen = stamp(); d.operations.forEach((o) => o.steps.forEach((s) => { if (s.agent === agentId && s.status === 'running') { s.status = 'unknown'; s.output = 'Result unknown because the agent lost connection.' } })); d.sessions.forEach((s) => { if (s.agentId === agentId && s.state === 'connected') s.state = 'disconnected' }) })
  mutate(r, (d) => d.branches.forEach((b) => { if (b.agent === agentId && ['running', 'queued', 'waiting_approval', 'pending'].includes(b.state)) { b.state = b.state === 'running' ? 'unknown' : 'paused'; b.lastEvent = `${agentId} disconnected — branch ${b.state}`; b.timeline.push({ at: stamp(), text: `${agentId} lost heartbeat (simulated)` }) } }))
  if (ag.op) pushLog(ag.op, { level: 'ERROR', agent: agentId, stepId: '—', text: `Lost connection to ${agentId} — running steps are now “Unknown”.` })
  notify(r, `${agentId} disconnected while running ${ag.op || 'an operation'}`, ag.projectId, { name: 'agent', id: agentId }, 'update', 'agents')
  audit(r, 'Agent disconnected', agentId, ag.projectId, 'Warning')
}

export function restoreAgent(agentId: string) {
  const r = demand()
  mutate(r, (d) => { const a = d.agents.find((x) => x.id === agentId)!; a.status = 'online'; a.lastSeen = stamp(); d.sessions.forEach((s) => { if (s.agentId === agentId && s.state === 'disconnected') s.state = 'connected' }) })
}

export function fastForward(opId: string) {
  const r = demand()
  mutate(r, (d) => {
    const o = d.operations.find((x) => x.id === opId)!
    o.steps.forEach((s) => { if (['running', 'pending'].includes(s.status)) { s.status = 'ok'; s.ts = s.ts === '—' ? hhmm() : s.ts; s.dur = s.dur === '—' ? '01:00' : s.dur; s.output = s.output.startsWith('No output') || s.output.startsWith('Waiting') ? 'Sanitized output. No sensitive content.' : s.output } })
  })
  pushLog(opId, { level: 'INFO', agent: '—', stepId: '—', text: 'Simulation fast-forward: remaining steps completed.' })
}

/* ───────────── C2 session termination ───────────── */

export function terminateSession(sessionId: string, reason: string) {
  const r = demand()
  const s = r.services.authority.snapshot().sessions.find((x) => x.id === sessionId)!
  mutate(r, (d) => { const x = d.sessions.find((y) => y.id === sessionId)!; x.state = 'revoking'; x.transcript.push({ ts: hhmm() + ':00', who: 'system', text: `Termination requested by ${currentActor(r).id}: ${reason}` }) })
  audit(r, 'Terminated session', sessionId, s.projectId, 'Success', reason)
  later(r, (rr) => mutate(rr, (d) => { const x = d.sessions.find((y) => y.id === sessionId)!; if (x.state === 'revoking') { x.state = 'terminated'; x.grants = []; x.transcript.push({ ts: hhmm() + ':00', who: 'system', text: 'Session terminated. All grants revoked.' }) } }), 2000)
}
