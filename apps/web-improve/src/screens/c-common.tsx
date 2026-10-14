import { useRef, type ComponentType } from 'react'
import { Eye, Lock, ShieldX, SearchX, GitBranch } from 'lucide-react'
import { Button, Empty, Status } from '../ui'
import { canAccessProject } from '../auth/policy'
import { go, selectProject, useRoute } from '../router/navigate'
import { useDb, useMe } from '../state/console'
import { useProjectStore } from '../state/stores'
import type { Route } from '../router/history'
import type { Branch, Db, Operation, Plan, Project, Step } from '../data'
import type { PfCheck, PfState } from '../features/operations/checklist'
export { specChecks } from '../features/operations/checklist'
export type { PfCheck, PfState } from '../features/operations/checklist'
import { PROJECT_TZ_OFFSET_MS, draftMinutes, roeWindowIssue } from '../features/operations/service'

/** Operation access gate: checks existence, project access and the selected project */
export function OpGate({ C }: { C: ComponentType<{ op: Operation }> }) {
  const db = useDb()
  const route = useRoute()
  const me = useMe()
  const pid = useProjectStore((s) => s.pid)
  const op = db.operations.find((o) => o.id === route.id)
  if (!op) {
    return (
      <Empty icon={SearchX} title="Operation not found" action={<Button onClick={() => go('operations')}>Back to operations</Button>}>
        Operation {route.id ? <span className="font-mono">{route.id}</span> : ''} does not exist or has been removed.
      </Empty>
    )
  }
  if (!canAccessProject(db, me, op.projectId)) {
    return (
      <Empty icon={Lock} title="You do not have access to this operation" action={<Button onClick={() => go('operations')}>Back to operations</Button>}>
        Operation {op.id} belongs to a project your account has not been granted access to. Ask a project manager to add you to the team.
      </Empty>
    )
  }
  if (pid !== 'all' && pid !== op.projectId) {
    return (
      <Empty icon={ShieldX} title="Operation belongs to a different project" action={<Button variant="primary" onClick={() => selectProject(op.projectId)}>Switch to {op.projectId}</Button>}>
        Operation {op.id} belongs to project {op.projectId}. To avoid mixing data between projects, switch to that project before viewing it.
      </Empty>
    )
  }
  return <C op={op} />
}

/* ───────────── Time helpers (wall-clock UTC+7, encoded as UTC ms) ───────────── */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Parses "Oct 13, 2026, 10:42 AM (UTC+7)" */
export const parseStamp = (s?: string): number | null => {
  const m = /([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}) (AM|PM)/.exec(s || '')
  if (!m) return null
  const mo = MONTHS.indexOf(m[1])
  if (mo < 0) return null
  let h = +m[4] % 12
  if (m[6] === 'PM') h += 12
  return Date.UTC(+m[3], mo, +m[2], h, +m[5])
}
/** Parses a datetime-local value ("2026-10-14T10:00") */
export const schedMs = (v?: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '')
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null
}
export const fmtMs = (ms: number) => {
  const d = new Date(ms)
  const h = d.getUTCHours()
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}, ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'} (UTC+7)`
}
export const fmtSched = (v?: string) => { const ms = schedMs(v); return ms == null ? '' : fmtMs(ms) }
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`)
export function elapsed(op: Operation, nowStamp: string) {
  const a = parseStamp(op.startedAt)
  if (a == null) return '—'
  const endS = op.status === 'running' ? nowStamp : op.status === 'paused' || op.status === 'estop' || op.status === 'cancelled' ? op.stopAt || op.updated : op.updated
  const b = parseStamp(endS)
  if (b == null || b < a) return '—'
  return fmtMin(Math.round((b - a) / 60000))
}

/** ROE window check for a scheduled start (default window: Mon–Fri, 9:00 AM–5:00 PM UTC+7).
 * Delegates to the one canonical rule in the operations service; screen-layer
 * wall-clock values are converted to absolute instants at the boundary. */
export function windowIssue(p: Project | undefined, ms: number | null) {
  if (ms == null) return ''
  return roeWindowIssue(p, ms - PROJECT_TZ_OFFSET_MS)
}

/* ───────────── Step helpers ───────────── */
export function stepCounts(steps: Step[]) {
  const c = { ok: 0, fail: 0, pending: 0, running: 0, notrun: 0, unknown: 0, review: 0, total: steps.length }
  steps.forEach((s) => { c[s.status]++ })
  return c
}
export const progressOf = (steps: Step[]) => {
  if (!steps.length) return null
  const c = stepCounts(steps)
  return Math.round(((c.ok + c.fail) / c.total) * 100)
}

/** Mask for sensitive data depending on permissions */
export const MASK = '••••••••  (sensitive data — masked for your role)'

/** Keeps a snapshot of a value while real-time data is delayed */
export function useFrozen<T>(value: T, frozen: boolean): T {
  const ref = useRef(value)
  if (!frozen) ref.current = value
  return ref.current
}

export const STEP_BORDER: Record<string, string> = {
  ok: 'border-ok/50', fail: 'border-bad/60', pending: 'border-line', running: 'border-cyan', notrun: 'border-line', unknown: 'border-warn/60', review: 'border-warn/60',
}

/** Operation status pill; emergency stop is spelled out */
export const OpStatus = ({ value, size }: { value: string; size?: 'sm' | 'md' }) => <Status kind="op" value={value} size={size} label={value === 'estop' ? 'Emergency stopped' : undefined} />

/* ───────────── V3.1 runtime state + branch links ───────────── */
/** Operation Runtime State (separate from AI mode, eligibility and policy). A step in review pauses new dispatch. */
export const hasReview = (op: Operation) => (op.status === 'running' || op.status === 'paused') && op.steps.some((s) => s.status === 'review')
export const runtimeLabel = (op: Operation) => (hasReview(op) ? 'Paused — Awaiting Review' : op.status === 'estop' ? 'Emergency stopped' : op.status === 'paused' ? 'Paused' : op.status === 'cancelled' ? 'Stopped' : op.status === 'done' ? 'Completed' : op.status === 'running' ? 'Running' : op.status.charAt(0).toUpperCase() + op.status.slice(1))
export const stepBranches = (db: Db, opId: string, stepId: string): Branch[] => db.branches.filter((b) => b.opId === opId && b.stepId === stepId)
export const failedBranches = (db: Db, opId: string): Branch[] => db.branches.filter((b) => b.opId === opId && b.state === 'failed')
export const opGroups = (db: Db, opId: string) => db.branchGroups.filter((g) => g.opId === opId)
/** Conversation linked via the operation's plan */
export const opConversation = (db: Db, op: Operation) => { const pl = op.planId ? db.plans.find((x) => x.id === op.planId) : undefined; return pl ? db.conversations.find((c) => c.id === pl.conversationId) : undefined }

/** Status pill that shows the runtime state (e.g. "Paused — Awaiting Review") and flags failed branches; a failed branch is never shown as plain success. */
export function RuntimeStatus({ op, size }: { op: Operation; size?: 'sm' | 'md' }) {
  const db = useDb()
  const fb = failedBranches(db, op.id).length
  const review = hasReview(op)
  const h = size === 'sm' ? 'h-6' : 'h-7'
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {review ? <span className={`inline-flex ${h} items-center gap-1 whitespace-nowrap rounded-full border border-warn/30 bg-warn-soft px-2.5 text-xs font-semibold text-warn`}><Eye size={12} aria-hidden />Paused — Awaiting Review</span> : <OpStatus value={op.status} size={size} />}
      {op.status === 'done' && fb > 0 && <span className={`inline-flex ${h} items-center whitespace-nowrap rounded-full border border-bad/30 bg-bad-soft px-2.5 text-xs font-semibold text-bad`}>With failures</span>}
      {fb > 0 && <span className={`inline-flex ${h} items-center gap-1 whitespace-nowrap rounded-full border border-bad/30 bg-bad-soft px-2.5 text-xs font-semibold text-bad`}><GitBranch size={12} aria-hidden />{fb} branch{fb === 1 ? '' : 'es'} failed</span>}
    </span>
  )
}

export const planApprovalState = (pl?: Plan): 'none' | 'waiting' | 'approved' | 'rejected' | 'expired' =>
  !pl ? 'none' : pl.status === 'approved' || pl.status === 'executed' ? 'approved' : pl.status === 'in_review' || pl.status === 'proposed' ? 'waiting' : pl.status === 'rejected' ? 'rejected' : pl.status === 'draft' ? 'none' : 'expired'

/* ───────────── Scheduling / conflicts (canonical rule lives in the operations service) ───────────── */
export const stepMinutes = (op: Operation) => draftMinutes(op.steps.length)

/* ───────────── V3 preflight: 8 spec checks with PASS / WARN / FAIL / NOT CHECKED ───────────── */
export interface PfSnap { at: string; roe: string; plan: string; checks: PfCheck[] }
export const PF_LABEL: Record<PfState, string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', nc: 'NOT CHECKED' }
export const PF_TONE: Record<PfState, string> = { pass: 'border-ok/30 bg-ok-soft text-ok', warn: 'border-warn/30 bg-warn-soft text-warn', fail: 'border-bad/30 bg-bad-soft text-bad', nc: 'border-line bg-subtle text-muted' }
export const pfOverall = (cs: PfCheck[]): PfState => (cs.some((c) => c.state === 'fail') ? 'fail' : cs.some((c) => c.state === 'nc') ? 'nc' : cs.some((c) => c.state === 'warn') ? 'warn' : 'pass')
