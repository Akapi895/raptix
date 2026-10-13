/**
 * Operation preflight policy and execution eligibility (ticket 26, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Deterministic, React-free domain functions: the eight canonical check
 * identities (PRE-01..PRE-08) are re-derived from the canonical records on
 * every call — never stored as an approval and never trusted from a stale
 * snapshot. The legacy store helper and the typed handlers both delegate here,
 * so a scope revision (ticket 21) that clears `preflightAt` is observed by
 * every entry point on the next derivation.
 *
 * Real enforcement replaces the baseline placeholders (execution ledger G-1,
 * G-2): PRE-04 evaluates the operation's scheduled start — or the request
 * instant for a manual start — against the ROE window in the project
 * timezone, and PRE-07 requires a plan-linked operation to hold a valid plan
 * approval at canonical state (rejected/expired/missing plans fail; an
 * approval still in review blocks as `review`).
 */
import { APR, planVer } from '../../data'
import type { Db } from '../../data'
import type { Agent, Asset, Operation, Project } from '../../domain/entities'
import type { Instant } from '../../domain/service'
import type { Route } from '../../router/history'
import { formatDemoInstant } from '../../domain/clock'

/** Project timezone offset (Asia/Ho_Chi_Minh, UTC+7): display/window checks only. */
export const PROJECT_TZ_OFFSET_MS = 7 * 60 * 60 * 1000

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * Normalizes a datetime-local value at the service boundary: the absolute
 * instant (true epoch ms) of that wall-clock time in the project timezone.
 * Undefined for anything that is not a real calendar instant.
 */
export function scheduleInstantOf(v: string | undefined): Instant | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec((v || '').trim())
  if (!m) return undefined
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]]
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return undefined
  const instant = Date.UTC(y, mo - 1, d, h, mi) - PROJECT_TZ_OFFSET_MS
  const wall = new Date(instant + PROJECT_TZ_OFFSET_MS)
  if (wall.getUTCMonth() !== mo - 1 || wall.getUTCDate() !== d) return undefined
  return instant
}

/** UTC+7 wall-clock projection of an instant — the canonical `Operation.schedule` string. */
export function scheduleLabelOf(instant: Instant): string {
  const w = new Date(instant + PROJECT_TZ_OFFSET_MS)
  return `${w.getUTCFullYear()}-${pad2(w.getUTCMonth() + 1)}-${pad2(w.getUTCDate())}T${pad2(w.getUTCHours())}:${pad2(w.getUTCMinutes())}`
}

/**
 * The one ROE window rule (Mon–Fri, 9:00 AM–5:00 PM project time) over an
 * absolute instant. The screen-layer helper delegates its wall-clock input.
 */
export function roeWindowIssue(project: Pick<Project, 'window'> | undefined, instant: Instant): string {
  const w = new Date(instant + PROJECT_TZ_OFFSET_MS)
  const day = w.getUTCDay()
  const hour = w.getUTCHours() + w.getUTCMinutes() / 60
  return day >= 1 && day <= 5 && hour >= 9 && hour < 17
    ? ''
    : `Start time is outside the ROE window (${project?.window || 'Mon–Fri, 9:00 AM–5:00 PM (UTC+7)'}).`
}

/* ───────────── The eight preflight checks ───────────── */

export type CheckState = 'pass' | 'fail' | 'review'
export interface Check { code: string; label: string; state: CheckState; detail: string; fix?: string; fixRoute?: Route; reason?: string }

export const preflightPass = (c: Check[]) => c.every((x) => x.state === 'pass')

/** The scheduled start as an absolute instant, from either storage form. */
function startInstantOf(op: Operation): Instant | undefined {
  if (op.scheduleAt) { const t = Date.parse(op.scheduleAt); return Number.isNaN(t) ? undefined : t }
  return op.schedule && op.schedule !== 'now' ? scheduleInstantOf(op.schedule) : undefined
}

/**
 * Derives the eight checks from canonical state at the calling instant.
 * Missing or cross-project records fail their check instead of crashing or
 * passing — every failure carries an observable reason and a fix link, and no
 * failed or pending check can pass the execution gate (`preflightPass`).
 */
export function computePreflightChecks(db: Db, op: Operation, now: Instant): Check[] {
  const p = db.projects.find((x) => x.id === op.projectId)
  const pb = db.playbooks.find((x) => x.id === op.playbookId)
  const plan = op.planId ? db.plans.find((x) => x.id === op.planId) : undefined
  const targets = op.assets.map((id) => db.assets.find((a) => a.id === id)).filter(Boolean) as Asset[]
  const missingAssets = op.assets.filter((id) => !db.assets.some((a) => a.id === id))
  const foreign = targets.filter((a) => a.projectId !== op.projectId)
  const outT = targets.filter((a) => a.scope !== 'in')
  const ags = op.agents.map((id) => db.agents.find((a) => a.id === id)).filter(Boolean) as Agent[]
  const missingAgents = op.agents.filter((id) => !db.agents.some((a) => a.id === id))
  const bad = ags.filter((a) => a.status !== 'online' || (a.op && a.op !== op.id) || a.projectId !== op.projectId)
  const R = (page: string, tab?: string, id?: string): Route => ({ page, tab, id })
  const pendingScope = p ? db.approvals.some((a) => a.projectId === p.id && a.status === 'pending' && a.type === APR.scope) : false
  const pendingOther = p ? db.approvals.some((a) => a.projectId === p.id && a.status === 'pending' && a.type === APR.plan) : false
  return [
    p && ['approved', 'active'].includes(p.status)
      ? { code: 'PRE-01', label: 'Project selected and approved', state: 'pass', detail: `${p.id} — ${p.name}` }
      : p
        ? { code: 'PRE-01', label: 'Project selected and approved', state: 'fail', detail: 'The project has not been approved.', fix: 'Open approvals', fixRoute: R('project', 'team', p.id), reason: 'Cannot start: the project is not approved. Open Team & approvals to finish.' }
        : { code: 'PRE-01', label: 'Project selected and approved', state: 'fail', detail: `Project ${op.projectId} does not exist.`, reason: 'Cannot start: the operation is not attached to a real project.' },
    p && p.roeStatus === 'approved' && !pendingScope
      ? { code: 'PRE-02', label: 'ROE approved and current version', state: 'pass', detail: `${p.roeVersion} — approved` }
      : { code: 'PRE-02', label: 'ROE approved and current version', state: 'fail', detail: pendingScope ? 'A scope change is waiting for re-approval.' : p ? 'The Rules of Engagement are not approved or no longer valid.' : 'No project record — the ROE cannot be verified.', fix: p ? 'Open ROE' : undefined, fixRoute: p ? R('project', 'scope', p.id) : undefined, reason: 'Execution is blocked: this project has no approved ROE. Open Scope & ROE to resolve.' },
    targets.length === 0
      ? { code: 'PRE-03', label: 'Targets inside approved scope', state: 'fail', detail: missingAssets.length ? `Selected targets are not in the asset inventory: ${missingAssets.join(', ')}` : 'No target assets selected.', fix: 'Review assets', fixRoute: R('assets'), reason: missingAssets.length ? 'Execution is blocked: a selected target record does not exist.' : undefined }
      : missingAssets.length
        ? { code: 'PRE-03', label: 'Targets inside approved scope', state: 'fail', detail: `Selected targets are not in the asset inventory: ${missingAssets.join(', ')}`, fix: 'Review assets', fixRoute: R('assets'), reason: 'Execution is blocked: a selected target record does not exist.' }
        : foreign.length
        ? { code: 'PRE-03', label: 'Targets inside approved scope', state: 'fail', detail: `Targets belong to another project: ${foreign.map((a) => `${a.name} (${a.projectId})`).join(', ')}`, fix: 'Review assets', fixRoute: R('assets'), reason: 'Execution is blocked: targets must belong to the operation\'s project.' }
        : outT.length
          ? { code: 'PRE-03', label: 'Targets inside approved scope', state: 'fail', detail: `Assets outside the allowed scope: ${outT.map((a) => a.name).join(', ')}`, fix: 'Review assets', fixRoute: R('assets') }
          : { code: 'PRE-03', label: 'Targets inside approved scope', state: 'pass', detail: `${targets.length} in-scope assets: ${targets.map((a) => a.name).join(', ')}` },
    ((): Check => {
      const label = 'Inside the allowed time window'
      const start = startInstantOf(op)
      if (start != null) {
        if (start <= now) return { code: 'PRE-04', label, state: 'fail', detail: `The scheduled start (${scheduleLabelOf(start)}) has passed. Reschedule or start manually once every check passes.`, fix: 'Reschedule', fixRoute: R('operation-schedule', undefined, op.id), reason: 'Execution is blocked: the scheduled start is in the past.' }
        const win = p ? roeWindowIssue(p, start) : 'No project record — the window cannot be verified.'
        if (win) return { code: 'PRE-04', label, state: 'fail', detail: win, fix: 'Reschedule', fixRoute: R('operation-schedule', undefined, op.id), reason: 'Execution is blocked: the scheduled start is outside the ROE window.' }
        return { code: 'PRE-04', label, state: 'pass', detail: `Scheduled start ${scheduleLabelOf(start)} (UTC+7) is inside ${p?.window || 'the ROE window'}.` }
      }
      const win = p ? roeWindowIssue(p, now) : 'No project record — the window cannot be verified.'
      if (win) return { code: 'PRE-04', label, state: 'fail', detail: `Manual start now would be outside the ROE window. ${win}`, fix: 'Reschedule', fixRoute: R('operation-schedule', undefined, op.id), reason: 'Execution is blocked: the current time is outside the ROE window. Choose a start inside it.' }
      return { code: 'PRE-04', label, state: 'pass', detail: `${p?.window || 'ROE window'} — now ${formatDemoInstant(now)}` }
    })(),
    pb && pb.status === 'approved'
      ? { code: 'PRE-05', label: 'Playbook approved and versioned', state: 'pass', detail: `${pb.name} v${pb.version}` }
      : { code: 'PRE-05', label: 'Playbook approved and versioned', state: 'fail', detail: op.playbookId ? `Playbook ${op.playbookId} is missing or not ready for use.` : 'The playbook is not ready for use.', fix: 'Choose another playbook', fixRoute: R('playbooks'), reason: 'Execution is blocked: no approved playbook backs this operation.' },
    ags.length === 0
      ? { code: 'PRE-06', label: 'Agents healthy and not in conflict', state: 'fail', detail: 'No agents assigned.', fix: 'Replace agent', fixRoute: R('agents') }
      : missingAgents.length
        ? { code: 'PRE-06', label: 'Agents healthy and not in conflict', state: 'fail', detail: `Assigned agents are not in the inventory: ${missingAgents.join(', ')}`, fix: 'Replace agent', fixRoute: R('agents'), reason: 'Execution is blocked: an assigned agent record is missing.' }
        : bad.length
          ? { code: 'PRE-06', label: 'Agents healthy and not in conflict', state: 'fail', detail: `Agents unavailable, in use elsewhere or foreign to the project: ${bad.map((a) => a.id).join(', ')}`, fix: 'Replace agent', fixRoute: R('agents') }
          : { code: 'PRE-06', label: 'Agents healthy and not in conflict', state: 'pass', detail: `${ags.map((a) => a.id).join(', ')} connected and compatible` },
    ((): Check => {
      const label = 'Required approvals in place'
      if (op.planId) {
        if (!plan) return { code: 'PRE-07', label, state: 'fail', detail: `Linked plan ${op.planId} is missing. Re-link an approved plan.`, fix: 'Review plan', fixRoute: R('ai-plan-review', undefined, op.planId), reason: 'Execution is blocked: the linked plan record does not exist.' }
        const v = planVer(plan)
        if (plan.status === 'approved' || plan.status === 'executed') return { code: 'PRE-07', label, state: 'pass', detail: `Plan ${plan.id} ${v} approved.` }
        if (plan.status === 'in_review' || plan.status === 'proposed') return { code: 'PRE-07', label, state: 'review', detail: `AI plan ${plan.id} ${v} is ${plan.status.replace('_', ' ')} — approval required.`, fix: 'Review plan', fixRoute: R('ai-plan-review', undefined, plan.id), reason: 'Waiting for plan approval before execution.' }
        if (plan.status === 'rejected') return { code: 'PRE-07', label, state: 'fail', detail: `AI plan ${plan.id} ${v} was rejected — execution requires an approved plan.`, fix: 'Review plan', fixRoute: R('ai-plan-review', undefined, plan.id), reason: 'Execution is blocked: the linked plan approval was rejected.' }
        return { code: 'PRE-07', label, state: 'fail', detail: `AI plan ${plan.id} ${v} is ${plan.status.replace('_', ' ')} — a valid plan approval is required. Re-approve the plan under the current ROE.`, fix: 'Review plan', fixRoute: R('ai-plan-review', undefined, plan.id), reason: 'Execution is blocked: the plan approval is no longer valid.' }
      }
      if (pendingOther) return { code: 'PRE-07', label, state: 'review', detail: 'Another approval request is open for this project.', fix: 'Open approvals', fixRoute: p ? R('project', 'team', p.id) : undefined }
      return { code: 'PRE-07', label, state: 'pass', detail: 'No open approval requests. Manual planless operations are allowed under policy.' }
    })(),
    p && p.emergency
      ? { code: 'PRE-08', label: 'Emergency contact defined', state: 'pass', detail: p.emergency }
      : { code: 'PRE-08', label: 'Emergency contact defined', state: 'fail', detail: p ? 'No emergency contact on file.' : 'No project record — no emergency contact can be verified.', fix: p ? 'Update ROE' : undefined, fixRoute: p ? R('project', 'scope', p.id) : undefined },
  ]
}

/* ───────────── Execution eligibility (project-level labels) ───────────── */

export type EligKind = 'locked' | 'ready' | 'eligible' | 'active' | 'closed'
export interface Reason { text: string; to?: Route }
export const projectAgentsOnline = (db: Db, pid: string) => db.agents.filter((a) => a.projectId === pid && (a.status === 'online' || a.status === 'idle'))

/** Project-level execution eligibility label, derived from canonical state. */
export function eligibility(db: Db, pid: string): { kind: EligKind; label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' | 'cyan'; reasons: Reason[] } {
  const p = db.projects.find((x) => x.id === pid)
  if (!p) return { kind: 'locked', label: 'No project selected', tone: 'neutral', reasons: [] }
  if (p.status === 'closed') return { kind: 'closed', label: 'Read-only — project closed', tone: 'neutral', reasons: [] }
  const reasons: Reason[] = []
  const approvedAssets = db.assets.filter((a) => a.projectId === pid && a.scope === 'in').length
  if (!['approved', 'active', 'review', 'paused'].includes(p.status)) reasons.push({ text: `Project is ${p.status === 'draft' ? 'a draft' : 'not approved'}`, to: { page: 'project', id: pid } })
  if (p.roeStatus !== 'approved') reasons.push({ text: `${p.roeVersion} is ${p.roeStatus === 'none' ? 'missing' : p.roeStatus}, not approved`, to: { page: 'project', id: pid, tab: 'scope' } })
  if (approvedAssets === 0) reasons.push({ text: '0 approved assets in scope', to: { page: 'assets' } })
  if (!p.emergency) reasons.push({ text: 'No emergency contact on the ROE', to: { page: 'project', id: pid, tab: 'scope' } })
  if (reasons.length) return { kind: 'locked', label: p.roeStatus !== 'approved' ? 'Execution locked — ROE not approved' : 'Execution locked', tone: 'bad', reasons }
  if (db.operations.some((o) => o.projectId === pid && ['running', 'paused'].includes(o.status))) return { kind: 'active', label: 'Execution active', tone: 'cyan', reasons: [] }
  const agentsOk = projectAgentsOnline(db, pid).length
  if (!agentsOk) reasons.push({ text: 'No connected project agents', to: { page: 'agents' } })
  const ready = db.operations.some((o) => o.projectId === pid && o.status === 'ready')
  if (ready) return { kind: 'eligible', label: 'Eligible to start', tone: 'ok', reasons }
  return { kind: 'ready', label: reasons.length ? 'Ready for preflight (agents needed)' : 'Ready for preflight', tone: reasons.length ? 'warn' : 'ok', reasons }
}
