import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BRANCH_TERMINAL, type BranchState, USERS, APR, type Db, type Project, type Operation, type Step, type Finding, type Role, type Agent, type Group, type Plan, type PlanStatus, type AiMode, type Session, type SessionPerm, type SeedVariant, type ToolEvent } from './data'
import { signIn, signOut } from './auth/persona'
import { can as policyCan, projectAccessible, readOnlyContext } from './auth/policy'
import type { CanAction } from './domain/permissions'
import { createConsoleServices, type ConsoleServices } from './domain/service-factory'
// Ticket 38 append: the legacy AI actions delegate to the feature-local chat
// handlers (src/features/aichat); this layer keeps the demo's response
// orchestration only.
import { createChatHandlers } from './features/aichat/handlers'
// Ticket 39 append: the plan workbench lifecycle (request/decide/withdraw/
// revise/edit/discard) and the approval-validity gate are feature-local
// transactions (src/features/plans/service.ts); these legacy entries delegate
// to them so the role gates, the self-approval refusal, the current-ROE
// binding check and the absolute 24h expiry have one implementation for both
// entry points.
import {
  decidePlanTransaction, discardPlanTransaction, editPlanDraftTransaction, requestPlanReviewTransaction,
  revisePlanTransaction, withdrawPlanReviewTransaction,
} from './features/plans/service'
// Ticket 40 append: the plan→operation bridge is a feature-local transaction
// (src/features/plans/bridge.ts); the legacy executePlan entry delegates to it
// so the scope/role gates, the approval-validity re-check at binding time and
// the ONE atomic binding commit (operation + plan pin + audit) have one
// implementation for both entry points.
import { createOperationFromPlanTransaction } from './features/plans/bridge'
// Ticket 41 append: the tool/analysis trace read model is feature-local
// (src/features/trace); this layer no longer derives or stores facets.
// Ticket 42 append: the HITL tool decision delegates to the feature-local
// transaction (src/features/trace/writes.ts) so the pending-state gate,
// the four-eyes refusal, the role gate and the persisted resolution record
// have one implementation for both entry points.
import { decideToolEventTransaction } from './features/trace/writes'
// Ticket 19 append: the project-creation transaction is feature-local
// (src/features/wizard/service.ts); the legacy action delegates to it.
import { createProjectTransaction } from './features/wizard/service'
// Ticket 21 append: the approval decisions and the scope-revision governance
// transaction are feature-local (src/features/approvals/service.ts); these
// legacy entries delegate to them so refusals and invalidation have one
// implementation for both entry points.
import {
  decideApprovalTransaction, reviseScopeTransaction, submitApprovalTransaction,
} from './features/approvals/service'
// Ticket 22 append: closure governance (checklist derivation, request/confirm/
// reopen) and the emergency-stop transitions are feature-local handlers; these
// legacy entries delegate to them so the four-eyes rules, the gated resolve
// and the immediate stop response have one implementation for both entry points.
import {
  confirmCloseTransaction, evaluateCloseChecklist, reopenProjectTransaction, requestCloseTransaction,
} from './features/closure/service'
import {
  acknowledgeEmergencyStopTransaction, failEmergencyStopTransaction, finalizeEmergencyStopTransaction,
  requestEmergencyStopTransaction, resolveStopTransaction, unknownEmergencyStopTransaction,
} from './features/estop/service'
// Ticket 37 append: the legacy export/delivery actions delegate to the typed
// report handlers (one audited implementation for both entry points).
import { deliverReportVersion, exportReportVersion, type DeliveryInput } from './features/reports/service'
// Ticket 26 append: the preflight derivation and the start gate live in the
// operations feature; the legacy helpers/actions delegate to the same handlers.
import { computePreflightChecks, PROJECT_TZ_OFFSET_MS, type Check } from './features/operations/preflight'
// Ticket 27: the lifecycle control transitions are feature-local
// handlers; the remaining legacy entries delegate so the gates, the atomic
// agent reservations and the audited outcomes have one implementation for
// both entry points (the store keeps only the demo live-log mirrors). The
// zero-caller confirmPreflight/startOp/reviewStep wrappers were retired by
// ticket 65 — callers resolve the typed handlers directly.
import {
  completeOperation, pauseOperation, resumeOperation, stopOperation,
} from './features/operations/service'
// Ticket 49: the allocation/group entries delegate to the typed agent write
// handlers so eligibility, gating and audit have one implementation. (Ticket 67
// retired the zero-caller removeFromGroup wrapper: group removal resolves the
// typed agents service directly.)
import { assignAgentTransaction, saveGroupTransaction } from './features/agents/writes'
// Ticket 51: asset import/scope changes are feature-local transactions
// (src/features/assets/writes.ts); ticket 65 removed the last store entries
// that forwarded to them, so the store no longer imports the handlers.
// Ticket 46 append: the session grant request/decision/revocation, the
// interactive-command authorization and the single-grant expiry are
// feature-local transactions (src/features/c2/grants); these legacy entries
// delegate to them so the role/self-review gates, the required reasons, the
// per-user time-bound grants and the handler-time deadline checks have one
// implementation for both entry points.
import {
  decideSessionRequestTransaction, expireGrantTransaction, requestSessionAccessTransaction,
  revokeGrantTransaction, sessionCommandTransaction,
} from './features/c2/grants'
import { resetSharedStores, useAuthStore, useProjectStore, useThemeStore, useToastStore, useUiStore, type CopilotCtx, type Toast } from './state/stores'
import { getActiveRouter } from './router/active'
import { isKnownPage, OUTSIDE_SHELL, parseHash, parseLocation, sameRoute, toHash, toHref, type Route } from './router/history'

export type { CanAction } from './domain/permissions'
export type { CopilotCtx } from './state/stores'

/* ───────────── Simulated clock (UTC+7) ───────────── */
const T0 = Date.now()
const pad = (n: number) => String(n).padStart(2, '0')
const nowMin = () => 10 * 60 + 42 + Math.floor((Date.now() - T0) / 60000)
export function hhmm() {
  const m = nowMin()
  return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`
}
const hhmm12 = () => {
  const m = nowMin(), h = Math.floor(m / 60) % 24
  return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? 'AM' : 'PM'}`
}
const stamp = () => `Oct 13, 2026, ${hhmm12()} (UTC+7)`
export const today = () => 'Oct 13, 2026'

/* ───────────── Route ───────────── */
/* Route codecs and the router location projection live in the router layer
   (ticket 07); the store re-exports the type for legacy consumers. */
export type { Route } from './router/history'

/* ───────────── Roles ───────────── */
export const ROLE_LABEL: Record<Role, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }
type Persona = (typeof USERS)[number]

/** Membership policy seam (ticket 06): forwards to the shared permissions interface. */
export function canAccessProject(db: Db, me: Persona, projectId: string) {
  return projectAccessible(db.projects.find((x) => x.id === projectId), { id: me.name, role: me.role })
}

export function sessionPerm(db: Db, me: Persona, s: Session): SessionPerm {
  if (me.role === 'viewer' || !canAccessProject(db, me, s.projectId)) return 'none'
  const g = s.grants.find((x) => x.user === me.name)
  return g ? g.perm : 'read-only'
}

/* ───────────── Preflight (8 checks) ───────────── */
/* Ticket 26: the deterministic policy lives in the operations feature
   (src/features/operations/preflight.ts) — the legacy helper delegates to the
   same derivation the typed handlers use, so both entry points observe the
   same canonical checks (and the same scope-revision invalidation). Ticket 67
   retired the store's type re-exports: consumers import Check/CheckState from
   the feature module directly. */
export function computePreflight(db: Db, op: Operation): Check[] {
  return computePreflightChecks(db, op, Date.UTC(2026, 9, 13, 0, nowMin()) - PROJECT_TZ_OFFSET_MS)
}

/* ───────────── Project closure checklist ───────────── */
/* Ticket 22: the derivation lives in the closure handlers
   (src/features/closure/service.ts) — one canonical, never-stored checklist
   for the store consumers (completion %, close panel) and the typed
   request/confirm handlers. Ticket 65 retires the store's re-export; the
   remaining consumer (completion) resolves the canonical derivation
   directly. The close console adds its agent-reservation row through
   closePanelItems; the waiver stays a request-time input. */


/* ───────────── V3: completion ───────────── */
/* Ticket 26/67: the eligibility label derivation is the operations feature's
   pure domain function (src/features/operations/preflight.ts) — ticket 67
   retired the store's forwarding export; every consumer imports it from the
   feature module directly. */
export function completion(db: Db, pid: string) {
  const p = db.projects.find((x) => x.id === pid)
  const objs = p?.objectives ?? []
  const objPct = objs.length ? Math.round(objs.reduce((a, o) => a + o.progress, 0) / objs.length) : 0
  const ops = db.operations.filter((o) => o.projectId === pid)
  const opsDone = ops.filter((o) => o.status === 'done').length
  const fs = db.findings.filter((f) => f.projectId === pid)
  const confirmed = fs.filter((f) => ['confirmed', 'remediation', 'retest', 'resolved'].includes(f.status)).length
  const suggested = fs.filter((f) => f.status === 'ai_suggested').length
  const inReview = fs.filter((f) => ['draft', 'review', 'returned'].includes(f.status)).length
  const reps = db.reports.filter((r) => r.projectId === pid)
  const delivered = reps.some((r) => r.status === 'delivered')
  const repLabel = delivered ? 'Delivered' : reps.length ? reps.map((r) => r.status).sort()[0].replace(/^./, (c) => c.toUpperCase()) : 'None'
  const chk = evaluateCloseChecklist(db, pid)
  const closeDone = chk.filter((c) => c.ok).length
  const pct = Math.round(objPct * 0.5 + (delivered ? 30 : reps.some((r) => ['approved', 'exported'].includes(r.status)) ? 20 : 0) + (closeDone / chk.length) * 20)
  return { pct, objPct, ops: ops.length, opsDone, confirmed, suggested, inReview, repLabel, delivered, closeDone, closeTotal: chk.length }
}

/* ───────────── Live log ───────────── */
interface LogLine { id: string; ts: string; level: 'INFO' | 'WARN' | 'ERROR'; agent: string; stepId: string; text: string }

/* ───────────── Modal / toast ───────────── */
interface ConfirmOpts {
  title: string; body: ReactNode; confirmLabel: string; danger?: boolean
  reasonLabel?: string; reasonRequired?: boolean; cancelLabel?: string
  onConfirm: (reason: string) => void
}

/* ───────────── Context ───────────── */
export interface Store {
  db: Db
  me: Persona; setMe: (n: string) => void
  authed: boolean; login: (org?: string) => void; logout: () => void; org: string
  route: Route; go: (page: string, opts?: { id?: string; tab?: string }) => void
  pid: string; project: Project | null; setPid: (id: string) => void
  scoped: <T extends { projectId: string }>(arr: T[]) => T[]
  accessible: Project[]
  readOnly: (projectId?: string) => boolean
  can: (a: CanAction, projectId?: string) => boolean
  theme: 'dark' | 'light'; setTheme: (t: 'dark' | 'light') => void
  loading: boolean
  toast: (text: string, kind?: Toast['kind']) => void
  toasts: Toast[]
  confirm: (o: ConfirmOpts) => void
  confirmState: ConfirmOpts | null; closeConfirm: () => void
  setDirty: (on: boolean, save?: () => void) => void
  dirty: boolean
  unsaved: { next: () => void; save?: () => void } | null; closeUnsaved: () => void
  guarded: (fn: () => void) => void
  switcherOpen: boolean; setSwitcherOpen: (b: boolean) => void
  noticesOpen: boolean; setNoticesOpen: (b: boolean) => void
  copilotOpen: boolean; copilotCtx: CopilotCtx | null; setCopilotOpen: (open: boolean, ctx?: CopilotCtx) => void
  aiMode: AiMode; setAiMode: (m: AiMode) => void
  aiBusy: string | null
  logs: Record<string, LogLine[]>
  now: () => string
  staleOps: Record<string, boolean>; setStale: (opId: string, v: boolean) => void
  persistFilters: Record<string, any>; setFilter: (k: string, v: any) => void
  resetDemo: (scenario?: SeedVariant) => void
  stopOutcome: 'ack' | 'fail' | 'unknown'
  setStopOutcome: (o: 'ack' | 'fail' | 'unknown') => void
  A: Actions
}

export interface ProjectDraft {
  name: string; id: string; client: string; type: string; desc: string; start: string; end: string; tz: string; owner: string; tags: string[]
  goal: string; objectives: { text: string; criteria: string }[]; metrics: string; unit: string; reportReq: string
  scopeDesc: string; window: string; limits: string[]; emergency: string; channel: string; roeFile: string; approver: string
  assets: { name: string; ident: string; type: string; scope: 'in' | 'out' }[]
  members: { user: string; role: Role }[]
}
interface OpDraft { name: string; projectId: string; owner: string; desc: string; objective: string; playbookId: string; agents: string[]; assets: string[]; mode: string; schedule: string; needConfirm: boolean; note: string }
interface FindingDraft { id?: string; projectId: string; title: string; severity: Finding['severity']; owner: string; kind: string; desc: string; scopeNote: string; asset: string; impact: string; rec: string; technique: string; op: string; stepId?: string; evidence: string[]; severityReason: string }

type Res = { ok: boolean; error?: string }
interface Actions {
  audit: (action: string, obj: string, projectId: string, result?: string, reason?: string) => void
  notify: (text: string, projectId: string, to: { name: string; id?: string }, group?: 'todo' | 'update' | 'system', category?: NonNullable<Db['notices'][number]['category']>) => void
  markNoticesRead: () => void
  createProject: (d: ProjectDraft, submit: boolean) => string
  submitApproval: (projectId: string, type: string, note: string, diff?: string) => Res
  decideApproval: (id: string, decision: 'approved' | 'returned', note: string) => Res
  editScope: (projectId: string, patch: Partial<Pick<Project, 'window' | 'emergency' | 'methods' | 'restrictions' | 'desc'>>, reason?: string) => Res
  updateProject: (projectId: string, patch: Partial<Project>) => void
  assignAgent: (agentId: string, projectId: string) => Res
  setAgentStatus: (agentId: string, s: Agent['status']) => void
  saveGroup: (g: Partial<Group> & { name: string; projectId: string }) => string
  createOperation: (d: OpDraft & { planId?: string }) => string
  updateOperation: (id: string, d: Partial<OpDraft>) => void
  pauseOp: (opId: string, reason: string) => void
  resumeOp: (opId: string) => Res
  stopOp: (opId: string, reason: string) => void
  emergencyStop: (scope: 'operation' | 'project' | 'workspace', id: string, reason: string) => void
  completeOp: (opId: string) => Res
  loseAgent: (agentId: string) => void
  restoreAgent: (agentId: string) => void
  fastForward: (opId: string) => void
  retryStop: () => void
  resolveStop: (outcome: 'confirmed-stopped' | 'dismiss') => void
  createFinding: (d: FindingDraft, submit: boolean) => string
  setFindingStatus: (id: string, status: Finding['status'], note?: string) => void
  addFindingComment: (id: string, text: string) => void
  addEvidence: (e: { name: string; kind: string; source: string; projectId: string; opId?: string; sensitive: boolean; findingId?: string }) => string
  createReport: (d: { projectId: string; title: string; template: string; kind: string; reviewer: string; findings: string[]; period: string }) => string
  saveReportSection: (id: string, sectionId: string, body: string) => void
  setReportFindings: (id: string, ids: string[]) => void
  approveReport: (id: string) => void
  exportReport: (id: string, format: 'PDF' | 'DOCX') => void
  deliverReport: (id: string, input: DeliveryInput) => Res
  requestClose: (pid: string, input?: { reason?: string; waiverNoFindings?: boolean }) => Res
  confirmClose: (approvalId: string) => Res
  reopen: (pid: string, reason: string) => Res
  toggleIntegration: (id: string) => void
  togglePolicy: (id: string) => void
  setPlaybookStatus: (id: string, status: 'approved' | 'draft' | 'review') => void
  decidePlaybookRevision: (id: string, decision: 'approve' | 'return') => void
  /* AI Operator */
  createConversation: (projectId: string, mode?: AiMode) => string
  togglePinConv: (convId: string) => void
  sendChat: (convId: string, text: string) => void
  stopChat: (convId: string) => void
  requestPlanApproval: (planId: string) => Res
  decidePlan: (planId: string, decision: 'approved' | 'rejected' | 'returned', note: string) => Res
  withdrawPlanReview: (planId: string) => Res
  editPlan: (planId: string, patch: { steps?: Plan['steps']; title?: string }) => Res
  discardPlan: (planId: string) => Res
  revisePlan: (planId: string, changes: string[], note?: string) => string
  executePlan: (planId: string) => { ok: boolean; opId?: string; error?: string }
  decideTool: (toolId: string, decision: 'allowed' | 'denied', reason?: string) => Res
  cancelBranch: (branchId: string, reason: string) => void
  /* C2 & Sessions */
  requestSessionAccess: (sessionId: string, mode: 'read-only' | 'interactive', duration: string, reason: string) => Res & { id?: string }
  decideSessionRequest: (id: string, decision: 'approved' | 'rejected' | 'changes', note: string, minutes?: number) => Res
  terminateSession: (sessionId: string, reason: string) => void
  revokeGrant: (sessionId: string, user: string, reason?: string) => Res
  expireGrant: (sessionId: string, user: string) => void
  sessionCommand: (sessionId: string, label: string) => Res
}

const Ctx = createContext<Store>(null as any)
export const useStore = () => useContext(Ctx)

const ServicesCtx = createContext<ConsoleServices | null>(null)
/** Canonical data authority + service factory (ADR-0067): typed handlers, clock and bridge subscription. */
// eslint-disable-next-line react-refresh/only-export-components
export const useServices = () => useContext(ServicesCtx)!

export function allocation(db: Db, projectId: string) {
  const mine = db.agents.filter((a) => a.projectId === projectId)
  const pool = db.agents.filter((a) => !a.projectId && (a.status === 'online' || a.status === 'idle'))
  const all = [...mine, ...pool]
  const conn = (a: Agent) => a.status === 'online' || a.status === 'idle'
  const busy = all.filter((a) => conn(a) && a.op)
  const avail = all.filter((a) => conn(a) && !a.op)
  const disc = all.filter((a) => !conn(a))
  return { all, mine, pool, busy, avail, disc, total: all.length, connected: all.filter(conn).length, capacity: avail.length }
}
export function groupSummary(db: Db, groupId: string) {
  const bs = db.branches.filter((b) => b.groupId === groupId)
  const n = (st: BranchState) => bs.filter((b) => b.state === st).length
  const done = n('completed'), failed = n('failed')
  const open = bs.filter((b) => !BRANCH_TERMINAL.includes(b.state)).length
  const missing = bs.length - done - failed - n('cancelled') - n('blocked')
  const overall = open > 0 ? (n('unknown') + n('paused') > 0 ? 'Degraded — branches paused or unknown' : 'In progress') : failed + n('blocked') > 0 ? 'Partially Completed' : 'Completed'
  return { bs, total: bs.length, running: n('running'), done, failed, waiting: n('waiting_approval'), queued: n('queued'), paused: n('paused'), unknown: n('unknown'), missing, open, overall, evidence: bs.reduce((a, b) => a + b.evidence.length, 0) }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  /* One data authority (ADR-0067): the context state is a projection of the
     canonical database; every mutation — legacy or service — commits through
     its atomic transaction bridge and publishes the affected identities. */
  const servicesRef = useRef<ConsoleServices | null>(null)
  if (!servicesRef.current) servicesRef.current = createConsoleServices()
  const services = servicesRef.current

  /* The shared authorities are module singletons. Restoring their initial
     values synchronously — before this mount's consumers read them — means
     repeated provider mounts never inherit a previous mount's persona/
     project/UI state (an effect would leave the first render stale). */
  const initedRef = useRef(false)
  if (!initedRef.current) {
    initedRef.current = true
    resetSharedStores()
    /* Deep links no longer auto-authenticate (ticket 07): the auth store is
       the single authorization authority, and the route guard holds the
       requested URL as the safe return destination for unauthenticated visits. */
  }
  const [db, setDb] = useState<Db>(() => services.authority.snapshot())
  const dbRef = useRef(db)
  dbRef.current = db
  useEffect(() => services.authority.subscribe(() => {
    const next = services.authority.snapshot()
    dbRef.current = next
    setDb(next)
  }), [services])
  const mutate = useCallback((fn: (d: Db) => void) => {
    services.authority.commit('legacy', fn)
    dbRef.current = services.authority.snapshot()
  }, [services])

  /* Canonical clock lockstep (ticket 46): the service clock advances with the
     demo wall clock so scheduler-driven deadlines (the grant-expiry lifecycle)
     continue without any C2 screen mounted. Under the test clock the interval
     is fake-timer driven and stays in lockstep with `hhmm()`. */
  useEffect(() => {
    let last = Date.now()
    const i = window.setInterval(() => {
      const elapsed = Date.now() - last
      last = Date.now()
      if (elapsed > 0) services.clock.advance(elapsed)
    }, 15_000)
    return () => clearInterval(i)
  }, [services])

  /* Persona/auth, active project, theme, toasts and transient UI state are the
     shared Zustand authorities (ticket 05); this context forwards to them so
     legacy and migrated consumers observe one state. */
  const meName = useAuthStore((s) => s.meName)
  const setMeName = useAuthStore((s) => s.setMe)
  /* Organization member role overrides (ticket 56) apply to the persona the
     console resolves: the seeded USERS stay the base identity and the settings
     service's committed override (in the one database) takes effect for the
     current persona's role everywhere the legacy seam reads `me`. */
  const baseMe = USERS.find((u) => u.name === meName)!
  const meRoleOv = db.org.members[meName]?.role
  const me = useMemo(() => (meRoleOv ? { ...baseMe, role: meRoleOv } : baseMe), [baseMe, meRoleOv])
  const authed = useAuthStore((s) => s.authed)
  const org = useAuthStore((s) => s.org)
  const [route, setRoute] = useState<Route>(() => parseHash())
  const routeRef = useRef(route)
  routeRef.current = route
  const pid = useProjectStore((s) => s.pid)
  const setPidRaw = useProjectStore((s) => s.setPid)
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const toasts = useToastStore((s) => s.toasts)
  const toast = useToastStore((s) => s.toast)
  const [loading, setLoading] = useState(false)
  const [confirmState, setConfirmState] = useState<ConfirmOpts | null>(null)
  const [dirty, setDirtyS] = useState(false)
  const saveRef = useRef<(() => void) | undefined>(undefined)
  const [unsaved, setUnsaved] = useState<Store['unsaved']>(null)
  const ui = useUiStore((s) => s)
  const switcherOpen = ui.switcherOpen
  const setSwitcherOpen = ui.setSwitcherOpen
  const noticesOpen = ui.noticesOpen
  const setNoticesOpen = ui.setNoticesOpen
  const copilotOpen = ui.copilotOpen
  const copilotCtx = ui.copilotCtx
  const setCopilotOpen = ui.setCopilotOpen
  const aiMode = ui.aiMode
  const setAiMode = ui.setAiMode
  const [stopOutcome, setStopOutcome] = useState<'ack' | 'fail' | 'unknown'>('ack')
  const stopOutRef = useRef(stopOutcome); stopOutRef.current = stopOutcome
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const aiTimers = useRef(new Map<string, number>())
  /* Dataset-bound delayed callbacks; demo reset disposes them so stale
     callbacks never apply pre-reset state to the reseeded dataset. */
  const pendingTimers = useRef(new Set<number>())
  const later = useCallback((fn: () => void, ms: number) => {
    const t = window.setTimeout(() => { pendingTimers.current.delete(t); fn() }, ms)
    pendingTimers.current.add(t)
    return t
  }, [])
  const [logs, setLogs] = useState<Record<string, LogLine[]>>({})
  const [staleOps, setStaleOps] = useState<Record<string, boolean>>({})
  const [persistFilters, setPF] = useState<Record<string, any>>({})
  const setFilter = useCallback((k: string, v: any) => setPF((s) => ({ ...s, [k]: v })), [])

  const accessible = useMemo(() => db.projects.filter((p) => canAccessProject(db, me, p.id)), [db, me])
  const project = pid === 'all' ? null : db.projects.find((p) => p.id === pid) || null
  const scoped = useCallback(
    <T extends { projectId: string }>(arr: T[]) => {
      const ids = new Set(accessible.map((p) => p.id))
      // Specific-project mode denies the whole read when the project is not a
      // membership the actor holds (ledger gap G-12); 'all' aggregates only
      // accessible projects.
      if (pid !== 'all' && !ids.has(pid)) return [] as T[]
      return arr.filter((x) => (pid === 'all' ? ids.has(x.projectId) || x.projectId === '' : x.projectId === pid))
    },
    [accessible, pid],
  )

  const readOnly = (projectId?: string) =>
    readOnlyContext(db.projects.find((x) => x.id === (projectId || pid)), { id: me.name, role: me.role })
  const can: Store['can'] = (a, projectId) =>
    policyCan({ id: me.name, role: me.role }, a, db.projects.find((x) => x.id === (projectId || pid)))

  /* dirty guard */
  const setDirty = useCallback((on: boolean, save?: () => void) => {
    /* The ref is updated here too: a post-write redirect clears its dirty
       state and navigates in the same tick (f-report's submit — "dirty
       cleared first, the unsaved guard must not hold the redirect"), before
       the state update re-renders. Without this the guard would read the
       stale committed-but-not-yet-refetched dirty flag and hold the
       navigation behind the unsaved-changes modal. */
    dirtyRef.current = on
    setDirtyS(on); saveRef.current = on ? save : undefined
  }, [])
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  const guarded = useCallback((fn: () => void) => {
    if (dirtyRef.current) setUnsaved({ next: fn, save: saveRef.current })
    else fn()
  }, [])
  const closeUnsaved = () => setUnsaved(null)

  /* navigation — the router is the single location writer (ticket 07). navRaw
     forwards to the active data router; the fallback branch only serves
     router-less mounts (tests) and keeps the legacy state+hash write. */
  const navRaw = useCallback((r: Route) => {
    setDirtyS(false); saveRef.current = undefined
    const router = getActiveRouter()
    if (router) router.navigate(toHref(r))
    else { setRoute(r); window.location.hash = toHash(r) }
    document.querySelector('main')?.scrollTo?.(0, 0)
  }, [])
  const go = useCallback((page: string, opts?: { id?: string; tab?: string }) => guarded(() => navRaw({ page, id: opts?.id, tab: opts?.tab })), [guarded, navRaw])

  /* The store's route is a projection of the router location, synced through
     the router's own subscription — there is deliberately no window
     hashchange listener here (one listener, owned by the router). */
  useEffect(() => {
    const router = getActiveRouter()
    if (!router) return
    return router.subscribe(() => {
      const next = parseLocation(router.state.location)
      if (!sameRoute(routeRef.current, next)) { routeRef.current = next; setRoute(next) }
    })
  }, [])

  const DETAIL_MAP: Record<string, string> = {
    operation: 'operations', preflight: 'operations', 'operation-schedule': 'operations', finding: 'findings', report: 'reports', 'report-preview': 'reports', 'report-review': 'reports',
    agent: 'agents', asset: 'assets', 'asset-scope': 'assets', playbook: 'playbooks', 'playbook-review': 'playbooks', technique: 'playbooks',
    'ai-plan': 'ai-operator', 'ai-plan-review': 'ai-operator', 'ai-plan-compare': 'ai-operator', 'ai-trace': 'ai-operator', 'ai-history': 'ai-operator',
    'c2-session': 'c2', 'c2-console': 'c2', 'c2-channel': 'c2',
  }
  const setPid = useCallback((id: string) => {
    if (id === pid) { setSwitcherOpen(false); return }
    guarded(() => {
      setDirtyS(false); saveRef.current = undefined
      setPidRaw(id)
      setSwitcherOpen(false)
      setLoading(true)
      setTimeout(() => setLoading(false), 450)
      /* The redirect is computed from the committed route and written once
         through navRaw — never inside a state updater. Writing location.hash
         in a setRoute updater used to land after later navigations and let a
         delayed hashchange clobber the route (execution ledger, ticket 02). */
      const r = routeRef.current
      if (r.page === 'project' && id === 'all') navRaw({ page: 'projects' })
      else if (r.page === 'project') navRaw({ ...r, id })
      else if (DETAIL_MAP[r.page]) navRaw({ page: DETAIL_MAP[r.page] })
    })
  }, [pid, guarded, navRaw])

  /* Auth writes forward to the shared auth authority via the auth feature
     actions (ticket 06); navigation forwards to the router (ticket 07). */
  const login = (o?: string) => {
    signIn(useAuthStore.getState().meName, o)
    /* Safe return destination: the guard renders login in place for protected
       URLs, so signing in reveals the requested route without a redirect.
       Public and unknown destinations go home. */
    const r = routeRef.current
    if (isKnownPage(r.page) && r.page !== 'login' && !OUTSIDE_SHELL.has(r.page)) {
      setDirtyS(false); saveRef.current = undefined
      return
    }
    navRaw({ page: 'command-center' })
  }
  const logout = () => { signOut(); navRaw({ page: 'login' }) }

  const confirm = (o: ConfirmOpts) => setConfirmState(o)

  /* ───────── Helpers ───────── */
  const buildLogs = (d: Db) => {
    const init: Record<string, LogLine[]> = {}
    d.operations.forEach((o) => {
      init[o.id] = o.steps.filter((s) => s.ts !== '—').flatMap((s) => [
        { id: o.id + s.id + 'a', ts: s.ts + ':00', level: 'INFO' as const, agent: s.agent, stepId: s.id, text: `Started step ${s.id} — ${s.name}` },
        ...(s.status === 'running' ? [] : [{ id: o.id + s.id + 'b', ts: s.ts + ':30', level: (s.status === 'fail' ? 'ERROR' : 'INFO') as 'ERROR' | 'INFO', agent: s.agent, stepId: s.id, text: s.status === 'fail' ? `Step ${s.id} failed: ${s.output}` : `Completed step ${s.id} (${s.dur})` }]),
      ])
    })
    return init
  }
  useEffect(() => { setLogs(buildLogs(dbRef.current)) }, [])

  const resetDemo: Store['resetDemo'] = (scenario = 'default') => {
    pendingTimers.current.forEach((t) => window.clearTimeout(t))
    pendingTimers.current.clear()
    aiTimers.current.clear()
    services.reset(scenario)
    dbRef.current = services.authority.snapshot()
    setLogs(buildLogs(dbRef.current))
    setStaleOps({}); setPF({}); setPidRaw('all'); setDirtyS(false); saveRef.current = undefined
    setConfirmState(null); setUnsaved(null); setAiBusy(null)
    useUiStore.getState().clearTransient()
    useToastStore.getState().clear()
    toast(scenario === 'e2e01' ? 'Demo state reset — RT-2026-017 scenario dataset loaded.' : 'Demo state reset.', 'info')
  }

  const audit: Actions['audit'] = (action, obj, projectId, result = 'Success', reason = '') =>
    mutate((d) => { d.audit.unshift({ corr: projectId === 'RT-2026-014' && /^(SS|AR)-/.test(obj) ? 'COR-014-01' : undefined, id: 'AU-' + ++d.counters.audit, at: stamp(), actor: me.name, role: ROLE_LABEL[me.role], action, obj, projectId, result, reason }) })
  const notify: Actions['notify'] = (text, projectId, to, group = 'update', category) =>
    mutate((d) => { d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + Date.now() % 10000, group, text, projectId, at: stamp(), read: false, to, category }) })

  const pushLog = (opId: string, line: Omit<LogLine, 'id' | 'ts'>) =>
    setLogs((l) => ({ ...l, [opId]: [...(l[opId] || []), { ...line, id: Math.random().toString(36).slice(2), ts: hhmm() + ':' + pad(new Date().getSeconds()) }] }))

  const stepsFrom = (names: string[], techs: string[], agents: string[], assets: string[]): Step[] =>
    names.map((name, i) => ({ id: 'S' + pad(i + 1), name, agent: agents.length ? agents[i % agents.length] : '—', asset: assets.length ? assets[i % assets.length] : '—', technique: techs[i % techs.length], status: 'notrun' as const, ts: '—', dur: '—', output: 'Not run.' }))

  /* Ticket 27: the demo's first-session creation moved into the typed start
     handler (startSession) — the run state, the reservations and the session
     commit in one atomic ChangeSet. The step auto-advance simulation below
     stays here: it is the demo's execution outcome engine, not a control. */

  /* ───────── AI chat (ticket 38) ─────────
     Conversations, mode selection and simulated proposal generation are owned
     by the feature-local handlers (src/features/aichat): every commit goes
     through the one authority and publishes the ChangeSet both the legacy
     context and Query consumers observe. This action layer keeps only the
     demo's response orchestration — the single busy flag and the 900 ms
     response timer, disposed on stop and demo reset. The proposal invariant
     (requirement 5) lives in the handler: no action here can start an
     operation, approve a plan or allow a tool call. */
  const chatApi = createChatHandlers(services, { id: me.name, role: me.role }, 'all')

  /* ───────── Actions ───────── */
  /* Legacy request context for the delegating actions: the current persona is
     captured at call time, so a later switch never retargets a mutation. */
  const actorCtx = (projectId: string) => ({ actor: { id: me.name, role: me.role }, projectId, corr: 'legacy' })

  /* ───────── AI plan workbench (ticket 39) ─────────
     The plan lifecycle and approval/expiry policy live in the feature-local
     transactions (src/features/plans); each entry resolves the addressed
     plan's project binding and bridges the typed ServiceResult to the legacy
     Res shape. */
  const planProjectOf = (planId: string): string | undefined => dbRef.current.plans.find((x) => x.id === planId)?.projectId

  const A: Actions = {
    audit, notify,
    markNoticesRead: () => mutate((d) => d.notices.forEach((n) => (n.read = true))),

    createProject: (dr, submit) => {
      /* Ticket 19: the creation transaction (authorization, validation, the
       * one atomic project/assets/approval/notice/audit commit) is owned by
       * the feature-local handler; this legacy action stays the wizard's
       * canonical entry and only wires the current persona + pid switch. */
      const res = createProjectTransaction(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId: '', corr: 'legacy' }, dr, submit)
      if (!res.ok) return ''
      setPidRaw(res.data.id)
      return res.data.id
    },
    /* Ticket 21: submit/decide run through the feature-local
       transaction handlers — the four-eyes refusals, the review-information
       checks and the atomic commit live there; this entry only bridges the
       typed ServiceResult to the legacy Res shape. (Ticket 65 retired the
       zero-caller withdrawApproval wrapper: the submitter-side withdrawal is
       the withdrawApprovalTransaction feature entry.) */
    submitApproval: (projectId, type, note, diff) => {
      const res = submitApprovalTransaction(services.authority, services.clock, actorCtx(projectId), { projectId, type, note, diff })
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    decideApproval: (id, decision, note) => {
      const res = decideApprovalTransaction(services.authority, services.clock, actorCtx(''), id, decision, note)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    editScope: (projectId, patch, reason) => {
      const res = reviseScopeTransaction(services.authority, services.clock, actorCtx(projectId), projectId, { patch, reason })
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    updateProject: (projectId, patch) => mutate((d) => { const p = d.projects.find((x) => x.id === projectId)!; Object.assign(p, patch); p.updated = stamp() }),
    /* Ticket 51: the import path and the scope changes run through the
       feature-local transactions (src/features/assets/writes.ts) — ticket 65
       retired the zero-caller addAssets/setAssetScope wrappers; the catalog
       screens and tests resolve importAssetsTransaction and
       changeAssetScopeTransaction directly. */
    /* Ticket 49: allocation/group entries delegate to the typed transactions
       (src/features/agents/writes) — eligibility (connected, unreserved,
       pool-only, active/approved target), the role gates, the pending-request
       conflict and the audit/notice commit have one implementation for both
       entry points; refusals commit nothing. */
    assignAgent: (agentId, projectId) => {
      const res = assignAgentTransaction(services.authority, services.clock, actorCtx(projectId), agentId, { projectId })
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    setAgentStatus: (agentId, s) => { mutate((d) => { d.agents.find((x) => x.id === agentId)!.status = s }); audit(s === 'disabled' ? 'Disabled agent' : 'Enabled agent', agentId, dbRef.current.agents.find((x) => x.id === agentId)!.projectId) },
    saveGroup: (g) => {
      const res = saveGroupTransaction(services.authority, services.clock, actorCtx(g.projectId), { id: g.id, name: g.name, projectId: g.projectId, desc: g.desc || '', agents: g.agents || [], owner: g.owner || me.name, policy: g.policy || 'Project use only' })
      return res.ok ? res.data.id : ''
    },

    createOperation: (dr) => {
      const p = dbRef.current.projects.find((x) => x.id === dr.projectId)!
      const id = 'OP-' + String(dbRef.current.counters.op + 1).padStart(3, '0')
      const plan = dr.planId ? dbRef.current.plans.find((x) => x.id === dr.planId) : undefined
      const pb = dbRef.current.playbooks.find((x) => x.id === dr.playbookId)
      const assets = dr.assets.map((a) => dbRef.current.assets.find((x) => x.id === a)!).filter(Boolean)
      const steps: Step[] = plan
        ? plan.steps.map((st, i) => ({ id: 'S' + pad(i + 1), name: st.name, agent: st.agent, asset: st.asset, technique: st.technique, status: 'notrun' as const, ts: '—', dur: '—', output: 'Not run.' }))
        : stepsFrom(pb?.steps || [], pb?.techniques || ['T1082'], dr.agents, assets.map((a) => a.name))
      mutate((d) => {
        d.counters.op++
        d.operations.push({ id, projectId: p.id, name: dr.name, status: 'draft', owner: dr.owner, playbookId: dr.playbookId, agents: dr.agents, assets: dr.assets, mode: dr.mode, startedAt: '—', updated: stamp(), steps, planId: dr.planId, schedule: dr.schedule || undefined })
        if (dr.planId) { const pl = d.plans.find((x) => x.id === dr.planId); if (pl) pl.opId = id }
      })
      audit('Created operation (draft)', id, p.id)
      return id
    },
    updateOperation: (id, dr) => {
      mutate((d) => {
        const o = d.operations.find((x) => x.id === id)!
        Object.assign(o, { name: dr.name ?? o.name, owner: dr.owner ?? o.owner, playbookId: dr.playbookId ?? o.playbookId, agents: dr.agents ?? o.agents, assets: dr.assets ?? o.assets, mode: dr.mode ?? o.mode, schedule: dr.schedule ?? o.schedule })
        o.preflightAt = undefined; if (o.status === 'ready') o.status = 'draft'; o.updated = stamp()
        if ((dr.playbookId || dr.agents || dr.assets) && o.status === 'draft' && !o.planId) {
          const pb = d.playbooks.find((x) => x.id === o.playbookId)
          const as = o.assets.map((a) => d.assets.find((x) => x.id === a)!).filter(Boolean)
          o.steps = pb ? stepsFrom(pb.steps, pb.techniques, o.agents, as.map((a) => a.name)) : []
        }
      })
    },
    /* Ticket 26/27: preflight runs and starts resolve through the typed
       handlers (src/features/operations/service.ts) — ticket 65 retired the
       zero-caller confirmPreflight/startOp wrappers; screens and tests invoke
       runOperationPreflight/startOperation directly. The c-console controls
       below keep their delegating entries (the demo live-log mirrors). */
    pauseOp: (opId, reason) => {
      const op = dbRef.current.operations.find((o) => o.id === opId)
      /* Ticket 27: the handler requires a reason and refuses non-running
         operations; the pause state and its attribution commit atomically. */
      if (!op) return
      const res = pauseOperation(services.authority, services.clock, actorCtx(op.projectId), opId, reason)
      if (res.ok) pushLog(opId, { level: 'WARN', agent: '—', stepId: '—', text: `Operation paused by ${me.name}` })
    },
    resumeOp: (opId) => {
      const op = dbRef.current.operations.find((o) => o.id === opId)
      /* Ticket 27: the handler enforces the rechecks (connected agents,
         approved plan, only paused resumes — stopped never resumes). */
      if (!op) return { ok: false, error: 'Operation not found.' }
      const res = resumeOperation(services.authority, services.clock, actorCtx(op.projectId), opId)
      if (!res.ok) return { ok: false, error: res.failure.message }
      pushLog(opId, { level: 'INFO', agent: '—', stepId: '—', text: `Operation resumed by ${me.name}` })
      return { ok: true }
    },
    stopOp: (opId, reason) => {
      const op = dbRef.current.operations.find((o) => o.id === opId)
      /* Ticket 27: the normal stop releases the agent reservations and
         terminates the linked sessions in the same atomic commit as the
         stopped state — one ChangeSet, so the fleet and the operation views
         agree. The reason is required and audited by the handler. */
      if (!op) return
      stopOperation(services.authority, services.clock, actorCtx(op.projectId), opId, reason)
    },
    /* Ticket 22: the stop transitions are typed handlers
       (src/features/estop/service.ts). The request handler commits the
       visible stop state (phase 'requested' + Pending audit + notice) in one
       immediate commit — an emergency stop is always an action with an
       immediate response, never a passive status. This entry keeps only the
       demo's simulated outcome switch and the tracked delays (disposed on
       demo reset), so the stop banner never shows success that did not
       happen. */
    emergencyStop: (scope, id, reason) => {
      const res = requestEmergencyStopTransaction(services.authority, services.clock, actorCtx(scope === 'project' ? id : ''), { scope, id, reason })
      if (!res.ok) return
      const affectedP = res.data.projectId
      res.data.operations.forEach((opId) => pushLog(opId, { level: 'ERROR', agent: '—', stepId: '—', text: `EMERGENCY STOP requested by ${me.name}: ${reason} — waiting for agent acknowledgement` }))
      const outcome = stopOutRef.current
      later(() => {
        if (outcome === 'fail') { failEmergencyStopTransaction(services.authority, services.clock, actorCtx(affectedP), { scope, id }); return }
        if (outcome === 'unknown') { unknownEmergencyStopTransaction(services.authority, services.clock, actorCtx(affectedP), { scope, id }); return }
        acknowledgeEmergencyStopTransaction(services.authority, services.clock, actorCtx(affectedP), { scope, id, reason })
        later(() => { finalizeEmergencyStopTransaction(services.authority, services.clock, actorCtx(affectedP), { scope, id }) }, 2000)
      }, 1800)
    },
    retryStop: () => { const s = dbRef.current.stopState; if (!s) return; setStopOutcome('ack'); stopOutRef.current = 'ack'; A.emergencyStop(s.scope, s.id, s.reason + ' (retry)') },
    resolveStop: (outcome) => { resolveStopTransaction(services.authority, services.clock, actorCtx(''), outcome) },
    /* Ticket 29: step decisions resolve through the typed handler — ticket 65
       retired the zero-caller reviewStep wrapper; the workspace screens and
       tests invoke reviewOperationStep directly. */
    completeOp: (opId) => {
      const op = dbRef.current.operations.find((o) => o.id === opId)
      /* Ticket 27: the handler refuses a running step (baseline invariant) and
         releases the reservations and linked sessions in the same commit. */
      if (!op) return { ok: false, error: 'Operation not found.' }
      const res = completeOperation(services.authority, services.clock, actorCtx(op.projectId), opId)
      if (!res.ok) return { ok: false, error: res.failure.message }
      pushLog(opId, { level: 'INFO', agent: '—', stepId: '—', text: 'Operation completed' })
      return { ok: true }
    },
    loseAgent: (agentId) => {
      const ag = dbRef.current.agents.find((a) => a.id === agentId)!
      mutate((d) => { const a = d.agents.find((x) => x.id === agentId)!; a.status = 'lost'; a.lastSeen = stamp(); d.operations.forEach((o) => o.steps.forEach((s) => { if (s.agent === agentId && s.status === 'running') { s.status = 'unknown'; s.output = 'Result unknown because the agent lost connection.' } })); d.sessions.forEach((s) => { if (s.agentId === agentId && s.state === 'connected') s.state = 'disconnected' }) })
      mutate((d) => d.branches.forEach((b) => { if (b.agent === agentId && ['running', 'queued', 'waiting_approval', 'pending'].includes(b.state)) { b.state = b.state === 'running' ? 'unknown' : 'paused'; b.lastEvent = `${agentId} disconnected — branch ${b.state}`; b.timeline.push({ at: stamp(), text: `${agentId} lost heartbeat (simulated)` }) } }))
      if (ag.op) pushLog(ag.op, { level: 'ERROR', agent: agentId, stepId: '—', text: `Lost connection to ${agentId} — running steps are now “Unknown”.` })
      notify(`${agentId} disconnected while running ${ag.op || 'an operation'}`, ag.projectId, { name: 'agent', id: agentId }, 'update', 'agents')
      audit('Agent disconnected', agentId, ag.projectId, 'Warning')
    },
    restoreAgent: (agentId) => { mutate((d) => { const a = d.agents.find((x) => x.id === agentId)!; a.status = 'online'; a.lastSeen = stamp(); d.sessions.forEach((s) => { if (s.agentId === agentId && s.state === 'disconnected') s.state = 'connected' }) }) },
    fastForward: (opId) => {
      mutate((d) => {
        const o = d.operations.find((x) => x.id === opId)!
        o.steps.forEach((s) => { if (['running', 'pending'].includes(s.status)) { s.status = 'ok'; s.ts = s.ts === '—' ? hhmm() : s.ts; s.dur = s.dur === '—' ? '01:00' : s.dur; s.output = s.output.startsWith('No output') || s.output.startsWith('Waiting') ? 'Sanitized output. No sensitive content.' : s.output } })
      })
      pushLog(opId, { level: 'INFO', agent: '—', stepId: '—', text: 'Simulation fast-forward: remaining steps completed.' })
    },

    createFinding: (dr, submit) => {
      const id = 'FD-' + String(dbRef.current.counters.finding + 1).padStart(3, '0')
      mutate((d) => {
        d.counters.finding++
        d.findings.unshift({
          id, projectId: dr.projectId, title: dr.title, severity: dr.severity, status: submit ? 'review' : 'draft', asset: dr.asset, op: dr.op, technique: dr.technique, owner: dr.owner, date: stamp(), updated: stamp(),
          desc: dr.desc, impact: dr.impact, rec: dr.rec, evidence: dr.evidence, comments: [], history: [{ at: stamp(), by: me.name, text: 'Draft created' }, ...(submit ? [{ at: stamp(), by: me.name, text: 'Submitted for review' }] : [])], retests: [],
        })
        dr.evidence.forEach((e) => { const ev = d.evidence.find((x) => x.id === e); if (ev) ev.findingId = id })
      })
      audit(submit ? 'Created finding and submitted for review' : 'Created draft finding', id, dr.projectId)
      if (submit) notify(`${id} needs review`, dr.projectId, { name: 'finding', id }, 'todo')
      return id
    },
    setFindingStatus: (id, status, note) => {
      const f = dbRef.current.findings.find((x) => x.id === id)!
      const txt: Record<string, string> = { review: 'Submitted for review', confirmed: 'Confirmed', returned: 'Returned for changes', remediation: 'Sent to remediation', retest: 'Moved to retest', resolved: 'Marked resolved', draft: 'Moved back to draft' }
      mutate((d) => { const x = d.findings.find((y) => y.id === id)!; x.status = status; x.updated = stamp(); x.history.push({ at: stamp(), by: me.name, text: txt[status] + (note ? `: ${note}` : '') }); if (note && status === 'returned') x.comments.push({ by: me.name, at: stamp(), text: note }) })
      audit(txt[status] || 'Changed status', id, f.projectId, 'Success', note || '')
      if (status === 'returned') notify(`${id} was returned for changes`, f.projectId, { name: 'finding', id }, 'todo')
    },
    addFindingComment: (id, text) => mutate((d) => { d.findings.find((x) => x.id === id)!.comments.push({ by: me.name, at: stamp(), text }) }),
    addEvidence: (e) => { const id = 'EV-' + (400 + dbRef.current.evidence.length + 1); mutate((d) => { d.evidence.push({ id, name: e.name, kind: e.kind, source: e.source, at: stamp(), by: me.name, projectId: e.projectId, opId: e.opId, findingId: e.findingId, sensitive: e.sensitive }) }); audit('Uploaded evidence', id, e.projectId); return id },

    createReport: (dr) => {
      const id = 'REP-' + String(dbRef.current.counters.report + 1).padStart(3, '0')
      const p = dbRef.current.projects.find((x) => x.id === dr.projectId)!
      mutate((d) => {
        d.counters.report++
        const tpl = d.templates.find((t) => t.name === dr.template)
        const titles = ['Cover Page', 'Executive Summary', 'Scope', 'Methodology', 'Objectives', 'Timeline', 'Operation Narrative', 'Results', 'Detailed Findings', 'Recommendations', 'Appendix']
        d.reports.unshift({
          id, projectId: dr.projectId, title: dr.title, template: dr.template, version: 'v0.1', status: 'draft', author: me.name, reviewer: dr.reviewer, updated: stamp(), findings: dr.findings,
          sections: (tpl?.sections.length && tpl.sections.length > 7 ? tpl.sections : titles).map((t, i) => ({ id: 's' + i, title: t, body: i === 0 ? `Security Assessment Report — ${p.client}` : '' })), reviews: [],
        })
      })
      audit('Created report', id, dr.projectId)
      return id
    },
    saveReportSection: (id, sectionId, body) => mutate((d) => { const r = d.reports.find((x) => x.id === id)!; const s = r.sections.find((x) => x.id === sectionId)!; s.body = body; r.updated = stamp() }),
    setReportFindings: (id, ids) => mutate((d) => { const r = d.reports.find((x) => x.id === id)!; r.findings = ids; r.updated = stamp() }),
    approveReport: (id) => { const r = dbRef.current.reports.find((x) => x.id === id)!; mutate((d) => { const x = d.reports.find((y) => y.id === id)!; x.status = 'approved'; x.updated = stamp(); x.reviews.push({ at: stamp(), by: me.name, action: 'Approved', note: '', version: x.version }) }); audit('Approved report', id, r.projectId) },
    /* Ticket 37: the export/delivery mutations are canonical typed handlers
       (src/features/reports/service.ts); these legacy entries delegate to them
       so every export record, handover stamp and audit row — whatever the entry
       point — comes from the one audited implementation. Both publish the
       ChangeSet the Query delivery history (`report-export` keys) refetches. */
    exportReport: (id, format) => {
      exportReportVersion(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId: 'all', corr: 'legacy' }, id, format)
    },
    deliverReport: (id, input) => {
      const res = deliverReportVersion(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId: 'all', corr: 'legacy' }, id, input)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    /* Ticket 22: closure request/confirm/reopen run through the feature-local
       transaction handlers — the manager gate, the four-eyes confirmation,
       the re-derived checklist at resolve and the audited reopen live there;
       these entries only bridge the typed ServiceResult to the legacy Res. */
    requestClose: (pid_, input) => {
      const res = requestCloseTransaction(services.authority, services.clock, actorCtx(pid_), pid_, { reason: input?.reason ?? '', waiverNoFindings: input?.waiverNoFindings })
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    confirmClose: (apId) => {
      const res = confirmCloseTransaction(services.authority, services.clock, actorCtx(''), apId)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    reopen: (pid_, reason) => {
      const res = reopenProjectTransaction(services.authority, services.clock, actorCtx(pid_), pid_, reason)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    toggleIntegration: (id) => mutate((d) => { const i = d.integrations.find((x) => x.id === id)!; i.status = i.status === 'connected' ? 'disconnected' : 'connected'; i.updated = stamp(); i.history.unshift(`${stamp()} — ${i.status === 'connected' ? 'Connected' : 'Disconnected'} by ${me.name}`) }),
    decidePlaybookRevision: (id, decision) => mutate((d) => { const p = d.playbooks.find((x) => x.id === id); if (!p || !p.revision) return; if (decision === 'approve') { p.version = p.revision.version; p.steps = p.revision.steps; p.techniques = p.revision.techniques; p.status = 'approved' } p.revision = undefined; p.updated = stamp() }),
    setPlaybookStatus: (id, status) => mutate((d) => { const p = d.playbooks.find((x) => x.id === id); if (p) { p.status = status; p.updated = stamp() } }),
    togglePolicy: (id) => { mutate((d) => { const p = d.policies.find((x) => x.id === id)!; p.enabled = !p.enabled; p.updated = today() }); audit('Changed policy', id, '') },

    /* ── AI Operator (ticket 38: handlers own the data; this layer keeps the
       response orchestration only — busy flag + 900 ms timer, disposed on
       stop and demo reset. The handler enforces the proposal invariant. ──) */
    createConversation: (projectId, mode = aiMode) => {
      const res = chatApi.create(projectId, mode)
      return res.ok ? res.data.id : ''
    },
    togglePinConv: (convId) => { chatApi.setPinned(convId) },
    sendChat: (convId, text) => {
      if (!text.trim() || aiBusy) return
      const res = chatApi.send(convId, text)
      if (!res.ok) return
      setAiBusy(convId)
      const timer = later(() => {
        aiTimers.current.delete(convId)
        chatApi.respond(convId, text)
        setAiBusy(null)
      }, 900)
      aiTimers.current.set(convId, timer)
    },
    stopChat: (convId) => {
      const timer = aiTimers.current.get(convId)
      if (timer === undefined) return
      window.clearTimeout(timer)
      aiTimers.current.delete(convId)
      setAiBusy(null)
      chatApi.stop(convId)
    },
    requestPlanApproval: (planId) => {
      const projectId = planProjectOf(planId)
      if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
      const res = requestPlanReviewTransaction(services.authority, services.clock, actorCtx(projectId), planId)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    decidePlan: (planId, decision, note) => {
      const projectId = planProjectOf(planId)
      if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
      const res = decidePlanTransaction(services.authority, services.clock, actorCtx(projectId), planId, decision, note)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    withdrawPlanReview: (planId) => {
      const projectId = planProjectOf(planId)
      if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
      const res = withdrawPlanReviewTransaction(services.authority, services.clock, actorCtx(projectId), planId)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    revisePlan: (planId, changes, note) => {
      const projectId = planProjectOf(planId)
      if (!projectId) return ''
      const res = revisePlanTransaction(services.authority, services.clock, actorCtx(projectId), planId, changes, note)
      return res.ok ? res.data.planId : ''
    },
    editPlan: (planId, patch) => {
      const projectId = planProjectOf(planId)
      if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
      const res = editPlanDraftTransaction(services.authority, services.clock, actorCtx(projectId), planId, patch)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    discardPlan: (planId) => {
      const projectId = planProjectOf(planId)
      if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
      const res = discardPlanTransaction(services.authority, services.clock, actorCtx(projectId), planId)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    executePlan: (planId) => {
      /* Ticket 40: the bridge is the feature-local transaction — the scope
         gate (wrong-project plans cannot bridge), the read-only/role refusal,
         ticket 39's approval-validity rule re-checked at binding time (an
         expired approval refuses even while its stored status reads
         approved) and the idempotent ONE-commit binding (draft operation +
         plan pin + audit) live there. This entry only bridges the typed
         result to the legacy shape. */
      const projectId = planProjectOf(planId)
      if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
      const res = createOperationFromPlanTransaction(services.authority, services.clock, actorCtx(projectId), planId)
      return res.ok ? { ok: true, opId: res.data.opId } : { ok: false, error: res.failure.message }
    },
    decideTool: (toolId, decision, reason) => {
      /* Ticket 42: the HITL decision is the typed handler
         (src/features/trace/writes.ts) — the pending-state gate, the
         four-eyes refusal (a proposal's requester cannot decide it) and
         the role gate, plus the persisted resolution record and the
         audited ONE-commit ChangeSet, have one implementation for both
         entry points; this entry only bridges the typed result and the
         current persona. Policy Allowed is not execution. */
      const projectId = dbRef.current.toolEvents.find((x) => x.id === toolId)?.projectId ?? ''
      const res = decideToolEventTransaction(services.authority, services.clock, actorCtx(projectId), toolId, decision, reason ?? '')
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },

    cancelBranch: (branchId, reason) => {
      const b = dbRef.current.branches.find((x) => x.id === branchId)!
      mutate((d) => { const x = d.branches.find((y) => y.id === branchId)!; x.state = 'cancelled'; x.pendingRequest = undefined; x.lastEvent = 'Cancelled by user'; x.timeline.push({ at: stamp(), text: `Cancelled: ${reason}` }) })
      audit('Cancelled branch', branchId, b.projectId, 'Success', reason)
    },

  /* ── C2 & Sessions (ticket 46: grant lifecycle via the feature-local
     transactions — the role/self-review gates, the required reasons, the
     per-user time-bound grants and the handler-time deadline checks live in
     src/features/c2/grants; these entries only bridge the typed results to
     the legacy shapes and keep the termination-acknowledgement orchestration) ── */
    requestSessionAccess: (sessionId, mode, duration, reason) => {
      const s = dbRef.current.sessions.find((x) => x.id === sessionId)
      if (!s) return { ok: false, error: `Session ${sessionId} does not exist.` }
      const res = requestSessionAccessTransaction(services.authority, services.clock, actorCtx(s.projectId), { sessionId, mode, duration, reason })
      return res.ok ? { ok: true, id: res.data.requestId } : { ok: false, error: res.failure.message }
    },
    decideSessionRequest: (id, decision, note, minutes) => {
      const r = dbRef.current.sessionRequests.find((x) => x.id === id)
      if (!r) return { ok: false, error: `Access request ${id} does not exist.` }
      const res = decideSessionRequestTransaction(services.authority, services.clock, actorCtx(r.projectId), { requestId: id, decision, note, minutes })
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    terminateSession: (sessionId, reason) => {
      const s = dbRef.current.sessions.find((x) => x.id === sessionId)!
      mutate((d) => { const x = d.sessions.find((y) => y.id === sessionId)!; x.state = 'revoking'; x.transcript.push({ ts: hhmm() + ':00', who: 'system', text: `Termination requested by ${me.name}: ${reason}` }) })
      audit('Terminated session', sessionId, s.projectId, 'Success', reason)
      later(() => mutate((d) => { const x = d.sessions.find((y) => y.id === sessionId)!; if (x.state === 'revoking') { x.state = 'terminated'; x.grants = []; x.transcript.push({ ts: hhmm() + ':00', who: 'system', text: 'Session terminated. All grants revoked.' }) } }), 2000)
    },
    revokeGrant: (sessionId, user, reason) => {
      const s = dbRef.current.sessions.find((x) => x.id === sessionId)
      if (!s) return { ok: false, error: `Session ${sessionId} does not exist.` }
      const res = revokeGrantTransaction(services.authority, services.clock, actorCtx(s.projectId), { sessionId, user, reason })
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    expireGrant: (sessionId, user) => {
      const s = dbRef.current.sessions.find((x) => x.id === sessionId)
      if (s) expireGrantTransaction(services.authority, services.clock, 'legacy', sessionId, user)
    },
    sessionCommand: (sessionId, label) => {
      const s = dbRef.current.sessions.find((x) => x.id === sessionId)
      if (!s) return { ok: false, error: `Session ${sessionId} does not exist.` }
      const res = sessionCommandTransaction(services.authority, services.clock, actorCtx(s.projectId), { sessionId, label })
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
  }

  /* ticker: running operation progress */
  const staleRef = useRef(staleOps)
  staleRef.current = staleOps
  useEffect(() => {
    const t = setInterval(() => {
      const cur = dbRef.current
      const ss = cur.stopState
      const frozen = ss && ['requested', 'failed', 'unknown'].includes(ss.phase)
      const running = cur.operations.filter((o) => o.status === 'running' && !staleRef.current[o.id] && !(frozen && (ss!.scope === 'workspace' || o.projectId === ss!.id || o.id === ss!.id)))
      if (!running.length) return
      const logsToPush: [string, Omit<LogLine, 'id' | 'ts'>][] = []
      mutate((d) => {
        running.forEach((ro) => {
          const o = d.operations.find((x) => x.id === ro.id)!
          const ri = o.steps.findIndex((s) => s.status === 'running')
          if (ri >= 0) {
            const s = o.steps[ri]
            if (d.agents.find((a) => a.id === s.agent)?.status === 'lost') return
            s.status = 'ok'; s.dur = '0' + (1 + (ri % 3)) + ':' + pad(10 + ((ri * 17) % 50)); if (s.output.startsWith('Waiting') || s.output.startsWith('Not run') || s.output.startsWith('No output')) s.output = 'Sanitized output. No sensitive content.'
            logsToPush.push([o.id, { level: 'INFO', agent: s.agent, stepId: s.id, text: `Completed step ${s.id} (${s.dur})` }])
          }
          if (o.steps.some((s) => s.status === 'review')) { o.updated = stamp(); return }
          const ni = o.steps.findIndex((s) => s.status === 'pending')
          if (ni >= 0) {
            const s = o.steps[ni]
            if (d.agents.find((a) => a.id === s.agent)?.status === 'lost') return
            s.status = 'running'; s.ts = hhmm(); s.output = 'Waiting for agent result.'
            logsToPush.push([o.id, { level: 'INFO', agent: s.agent, stepId: s.id, text: `Started step ${s.id} — ${s.name}` }])
          }
          if (o.steps.length && o.steps.every((s) => !['running', 'pending', 'review'].includes(s.status)) && o.steps.some((s) => s.status === 'ok')) {
            o.status = 'done'; logsToPush.push([o.id, { level: 'INFO', agent: '—', stepId: '—', text: 'All steps finished — operation completed (simulated)' }])
            o.agents.forEach((aid) => { const a = d.agents.find((x) => x.id === aid); if (a && a.op === o.id) a.op = null })
            d.sessions.forEach((x) => { if (x.opId === o.id && ['connected', 'available', 'suspended'].includes(x.state)) { x.state = 'terminated'; x.transcript.push({ ts: hhmm() + ':00', who: 'system', text: 'Session terminated at operation completion.' }) } })
          }
          o.updated = stamp()
        })
      })
      logsToPush.forEach(([id, l]) => pushLog(id, l))
    }, 4000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const setStale = (opId: string, v: boolean) => setStaleOps((s) => ({ ...s, [opId]: v }))

  const value: Store = {
    db, me, setMe: setMeName, authed, login, logout, org, route, go, pid, project, setPid, scoped, accessible, readOnly, can, theme, setTheme, loading,
    toast, toasts, confirm, confirmState, closeConfirm: () => setConfirmState(null), setDirty, dirty, unsaved, closeUnsaved, guarded,
    switcherOpen, setSwitcherOpen, noticesOpen, setNoticesOpen, copilotOpen, copilotCtx, setCopilotOpen, aiMode, setAiMode, aiBusy,
    logs, now: stamp, staleOps, setStale, persistFilters, setFilter, resetDemo, stopOutcome, setStopOutcome, A,
  }
  return (
    <ServicesCtx.Provider value={services}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </ServicesCtx.Provider>
  )
}

/** Marks a form as having unsaved changes. Call every render with (isDirty, saveDraftFn). */
export function useDirty(isDirty: boolean, save?: () => void) {
  const { setDirty } = useStore()
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    setDirty(isDirty, () => saveRef.current?.())
    return () => setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty])
}

export const sevLabel: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Informational' }
