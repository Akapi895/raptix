import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BRANCH_TERMINAL, type BranchState, USERS, APR, type Db, type Project, type Operation, type Step, type Finding, type Role, type Asset, type Agent, type Group, type Plan, type PlanStatus, type AiMode, type Session, type SessionPerm, type SeedVariant, type ToolEvent } from './data'
import { signIn, signOut } from './auth/persona'
import { can as policyCan, projectAccessible, readOnlyContext } from './auth/policy'
import type { CanAction } from './domain/permissions'
import { createConsoleServices, type ConsoleServices } from './domain/service-factory'
import { createChatHandlers } from './features/aichat/handlers'
// Ticket 19 append: the project-creation transaction is feature-local
// (src/features/wizard/service.ts); the legacy action delegates to it.
import { createProjectTransaction } from './features/wizard/service'
// Ticket 21 append: the approval decisions and the scope-revision governance
// transaction are feature-local (src/features/approvals/service.ts); these
// legacy entries delegate to them so refusals and invalidation have one
// implementation for both entry points.
import {
  decideApprovalTransaction, reviseScopeTransaction, submitApprovalTransaction, withdrawApprovalTransaction,
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
import { operationStartGate, runOperationPreflight } from './features/operations/service'
// Ticket 51 append: the asset import transaction (validated, atomic, through
// ticket 21's governance transaction) and the role-gated scope change are
// feature-local (src/features/assets/writes.ts); these legacy entries
// delegate to them so validation, gating and audit have one implementation.
import { changeAssetScopeTransaction, importAssetsTransaction } from './features/assets/writes'
// Ticket 49 append: the allocation/group entries delegate to the typed agent
// write handlers so eligibility, gating and audit have one implementation.
import { assignAgentTransaction, removeFromGroupTransaction, saveGroupTransaction } from './features/agents/writes'
import { resetSharedStores, useAuthStore, useProjectStore, useThemeStore, useToastStore, useUiStore, type CopilotCtx, type Toast } from './state/stores'
import { getActiveRouter } from './router/active'
import { isKnownPage, OUTSIDE_SHELL, parseHash, parseLocation, sameRoute, toHash, toHref, type Route } from './router/history'

export type { CanAction } from './domain/permissions'
export type { CopilotCtx, Toast } from './state/stores'

/* ───────────── Simulated clock (UTC+7) ───────────── */
const T0 = Date.now()
const pad = (n: number) => String(n).padStart(2, '0')
const nowMin = () => 10 * 60 + 42 + Math.floor((Date.now() - T0) / 60000)
export function hhmm() {
  const m = nowMin()
  return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`
}
export function hhmm12() {
  const m = nowMin(), h = Math.floor(m / 60) % 24
  return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? 'AM' : 'PM'}`
}
export const stamp = () => `Oct 13, 2026, ${hhmm12()} (UTC+7)`
export const today = () => 'Oct 13, 2026'

/* ───────────── Route ───────────── */
/* Route codecs and the router location projection live in the router layer
   (ticket 07); the store re-exports the type for legacy consumers. */
export type { Route } from './router/history'

/* ───────────── Roles ───────────── */
export const ROLE_LABEL: Record<Role, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }
export type Persona = (typeof USERS)[number]

/** Membership policy seam (ticket 06): forwards to the shared permissions interface. */
export function canAccessProject(db: Db, me: Persona, projectId: string) {
  return projectAccessible(db.projects.find((x) => x.id === projectId), { id: me.name, role: me.role })
}

export function sessionPerm(db: Db, me: Persona, s: Session): SessionPerm {
  if (me.role === 'viewer' || !canAccessProject(db, me, s.projectId)) return 'none'
  const g = s.grants.find((x) => x.user === me.name)
  return g ? g.perm : 'read-only'
}

export const nextProjectId = (db: Db, prefix = 'RT') => {
  const nums = db.projects.map((p) => p.id.match(/-(\d{3})$/)).filter(Boolean).map((m) => parseInt(m![1]))
  return `${prefix}-2026-${String(Math.max(0, ...nums) + 1).padStart(3, '0')}`
}

/* ───────────── Preflight (8 checks) ───────────── */
/* Ticket 26: the deterministic policy lives in the operations feature
   (src/features/operations/preflight.ts) — the legacy helper delegates to the
   same derivation the typed handlers use, so both entry points observe the
   same canonical checks (and the same scope-revision invalidation). */
export type { Check, CheckState } from './features/operations/preflight'
export { preflightPass } from './features/operations/preflight'
export function computePreflight(db: Db, op: Operation): Check[] {
  return computePreflightChecks(db, op, Date.UTC(2026, 9, 13, 0, nowMin()) - PROJECT_TZ_OFFSET_MS)
}

/* ───────────── Project closure checklist ───────────── */
/* Ticket 22: the derivation moved to the closure handlers
   (src/features/closure/service.ts) — one canonical, never-stored checklist
   for the store consumers (completion %, close panel) and the typed
   request/confirm handlers. The close console adds its agent-reservation
   row through closePanelItems; the waiver stays a request-time input. */
export const closureChecklist = (db: Db, pid: string) => evaluateCloseChecklist(db, pid)


/* ───────────── V3: eligibility, readiness, completion ───────────── */
/* Ticket 26: the eligibility label derivation moved to the operations feature
   (pure domain function); the legacy export delegates for existing consumers. */
export type { EligKind, Reason } from './features/operations/preflight'
export { projectAgentsOnline, eligibility } from './features/operations/preflight'
export interface ReadyItem { id: string; label: string; ok: boolean; detail: string; to?: Route }
export function readiness(db: Db, pid: string) {
  const p = db.projects.find((x) => x.id === pid)
  const assets = db.assets.filter((a) => a.projectId === pid && a.scope === 'in').length
  const ag = db.agents.filter((a) => a.projectId === pid)
  const agOn = ag.filter((a) => a.status === 'online' || a.status === 'idle').length
  const plan = db.plans.find((x) => x.projectId === pid && ['approved', 'executed'].includes(x.status))
  const pf = db.operations.some((o) => o.projectId === pid && (o.preflightAt || o.status === 'ready' || o.status === 'running'))
  const items: ReadyItem[] = [
    { id: 'r1', label: 'ROE approved', ok: p?.roeStatus === 'approved', detail: p ? `${p.roeVersion} · ${p.roeStatus}` : '—', to: { page: 'project', id: pid, tab: 'scope' } },
    { id: 'r2', label: 'Approved assets in scope', ok: assets > 0, detail: `${assets} approved`, to: { page: 'assets' } },
    { id: 'r3', label: 'Emergency contact set', ok: !!p?.emergency, detail: p?.emergency || 'Not set', to: { page: 'project', id: pid, tab: 'scope' } },
    { id: 'r4', label: 'Project agents connected', ok: agOn > 0 && agOn === ag.length, detail: `${agOn}/${ag.length} connected`, to: { page: 'agents' } },
    { id: 'r5', label: 'AI plan approved', ok: !!plan, detail: plan ? `${plan.id} ${plan.ver ?? 'v' + plan.version}` : 'No approved plan', to: { page: 'ai-operator' } },
    { id: 'r6', label: 'Preflight passed', ok: pf, detail: pf ? 'Latest preflight passed' : 'Not run', to: { page: 'operations' } },
  ]
  const done = items.filter((i) => i.ok).length
  return { items, done, total: items.length, pct: Math.round((done / items.length) * 100) }
}
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
  const chk = closureChecklist(db, pid)
  const closeDone = chk.filter((c) => c.ok).length
  const pct = Math.round(objPct * 0.5 + (delivered ? 30 : reps.some((r) => ['approved', 'exported'].includes(r.status)) ? 20 : 0) + (closeDone / chk.length) * 20)
  return { pct, objPct, ops: ops.length, opsDone, confirmed, suggested, inReview, repLabel, delivered, closeDone, closeTotal: chk.length }
}

/* ───────────── Live log ───────────── */
export interface LogLine { id: string; ts: string; level: 'INFO' | 'WARN' | 'ERROR'; agent: string; stepId: string; text: string }

/* ───────────── Modal / toast ───────────── */
export interface ConfirmOpts {
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
export interface OpDraft { name: string; projectId: string; owner: string; desc: string; objective: string; playbookId: string; agents: string[]; assets: string[]; mode: string; schedule: string; needConfirm: boolean; note: string }
export interface FindingDraft { id?: string; projectId: string; title: string; severity: Finding['severity']; owner: string; kind: string; desc: string; scopeNote: string; asset: string; impact: string; rec: string; technique: string; op: string; stepId?: string; evidence: string[]; severityReason: string }

type Res = { ok: boolean; error?: string }
export interface Actions {
  audit: (action: string, obj: string, projectId: string, result?: string, reason?: string) => void
  notify: (text: string, projectId: string, to: { name: string; id?: string }, group?: 'todo' | 'update' | 'system', category?: NonNullable<Db['notices'][number]['category']>) => void
  markNoticesRead: () => void
  createProject: (d: ProjectDraft, submit: boolean) => string
  submitApproval: (projectId: string, type: string, note: string, diff?: string) => Res
  withdrawApproval: (id: string) => Res
  decideApproval: (id: string, decision: 'approved' | 'returned', note: string) => Res
  editScope: (projectId: string, patch: Partial<Pick<Project, 'window' | 'emergency' | 'methods' | 'restrictions' | 'desc'>>, reason?: string) => Res
  updateProject: (projectId: string, patch: Partial<Project>) => void
  addAssets: (projectId: string, list: { name: string; ident: string; type: string; os: string; owner: string; scope: 'in' | 'out'; source: string; ip?: string }[]) => { ok: boolean; needsApproval: boolean; error?: string }
  setAssetScope: (assetId: string, scope: Asset['scope']) => void
  assignAgent: (agentId: string, projectId: string) => Res
  setAgentStatus: (agentId: string, s: Agent['status']) => void
  saveGroup: (g: Partial<Group> & { name: string; projectId: string }) => string
  removeFromGroup: (groupId: string, agentId: string, reason?: string) => Res
  createOperation: (d: OpDraft & { planId?: string }) => string
  updateOperation: (id: string, d: Partial<OpDraft>) => void
  confirmPreflight: (opId: string) => void
  startOp: (opId: string) => void
  pauseOp: (opId: string, reason: string) => void
  resumeOp: (opId: string) => Res
  stopOp: (opId: string, reason: string) => void
  estopOp: (opId: string, reason: string) => void
  emergencyStop: (scope: 'operation' | 'project' | 'workspace', id: string, reason: string) => void
  completeOp: (opId: string) => Res
  loseAgent: (agentId: string) => void
  restoreAgent: (agentId: string) => void
  fastForward: (opId: string) => void
  reviewStep: (opId: string, stepId: string, decision: 'approve' | 'skip' | 'fail', note?: string) => void
  retryStop: () => void
  resolveStop: (outcome: 'confirmed-stopped' | 'dismiss') => void
  createFinding: (d: FindingDraft, submit: boolean) => string
  updateFinding: (id: string, d: Partial<FindingDraft>) => void
  setFindingStatus: (id: string, status: Finding['status'], note?: string) => void
  addRetest: (id: string, r: { result: string; note: string }) => void
  addFindingComment: (id: string, text: string) => void
  attachEvidence: (findingId: string, evidenceId: string) => void
  addEvidence: (e: { name: string; kind: string; source: string; projectId: string; opId?: string; sensitive: boolean; findingId?: string }) => string
  createReport: (d: { projectId: string; title: string; template: string; kind: string; reviewer: string; findings: string[]; period: string }) => string
  saveReportSection: (id: string, sectionId: string, body: string) => void
  setReportFindings: (id: string, ids: string[]) => void
  submitReport: (id: string) => void
  returnReport: (id: string, note: string) => void
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
  setConversationMode: (convId: string, mode: AiMode) => void
  togglePinConv: (convId: string) => void
  sendChat: (convId: string, text: string) => void
  stopChat: (convId: string) => void
  requestPlanApproval: (planId: string) => void
  decidePlan: (planId: string, decision: 'approved' | 'rejected' | 'returned', note: string) => Res
  editPlan: (planId: string, patch: { steps?: Plan['steps']; title?: string }) => void
  discardPlan: (planId: string) => void
  revisePlan: (planId: string, changes: string[], note?: string) => string
  executePlan: (planId: string) => { ok: boolean; opId?: string; error?: string }
  decideTool: (toolId: string, decision: 'allowed' | 'denied', reason?: string) => void
  requestBranchRetry: (branchId: string, reason: string) => void
  reassignBranch: (branchId: string, agentId: string, reason: string) => { ok: boolean; error?: string }
  cancelBranch: (branchId: string, reason: string) => void
  /* C2 & Sessions */
  requestSessionAccess: (sessionId: string, mode: 'read-only' | 'interactive', duration: string, reason: string) => string
  decideSessionRequest: (id: string, decision: 'approved' | 'rejected' | 'changes', note: string, minutes?: number) => void
  terminateSession: (sessionId: string, reason: string) => void
  revokeGrant: (sessionId: string, user: string, reason?: string) => void
  expireGrant: (sessionId: string, user: string) => void
  sessionCommand: (sessionId: string, label: string) => void
  setSessionState: (sessionId: string, state: Session['state']) => void
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

const bumpVer = (p: Plan) => { const m = (p.ver ?? `v${p.version}`).match(/^v(\d+)(?:\.(\d+))?$/); return m ? `v${m[1]}.${(+(m[2] ?? 0)) + 1}` : `v${p.version + 1}` }

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
  const setDirty = useCallback((on: boolean, save?: () => void) => { setDirtyS(on); saveRef.current = on ? save : undefined }, [])
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

  const newSession = (d: Db, o: Operation) => {
    const ag = d.agents.find((a) => a.id === o.agents[0])
    const asset = d.assets.find((a) => a.id === o.assets[0])
    const ch = d.channels.find((c) => c.projectId === o.projectId) || d.channels[0]
    const id = 'SS-' + String(++d.counters.session).padStart(3, '0')
    d.sessions.unshift({ id, projectId: o.projectId, opId: o.id, agentId: ag?.id || '—', asset: asset?.name || '—', kind: 'reverse', channelId: ch?.id || '—', account: 'svc-demo', integrity: 'Standard', state: 'connected', started: stamp(), last: stamp(), grants: [], transcript: [{ ts: hhmm() + ':00', who: 'system', text: `Session established via ${ch?.name || 'channel'} (demo).` }] })
    o.sessionId = id
    return id
  }

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
    /* Ticket 21: submit/withdraw/decide run through the feature-local
       transaction handlers — the four-eyes refusals, the review-information
       checks and the atomic commit live there; this entry only bridges the
       typed ServiceResult to the legacy Res shape. */
    submitApproval: (projectId, type, note, diff) => {
      const res = submitApprovalTransaction(services.authority, services.clock, actorCtx(projectId), { projectId, type, note, diff })
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    withdrawApproval: (id) => {
      const res = withdrawApprovalTransaction(services.authority, services.clock, actorCtx(''), id)
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
    /* Ticket 51: the import path runs through the feature-local import
       transaction — every row is validated before anything commits (one
       invalid/duplicate row refuses the batch), then ticket 21's governance
       transaction commits the valid batch atomically (added assets stay
       pending; a governed scope invalidates at submission). */
    addAssets: (projectId, list) => {
      const res = importAssetsTransaction(services.authority, services.clock, actorCtx(projectId), projectId, list)
      return res.ok
        ? { ok: true, needsApproval: res.data.needsApproval }
        : { ok: false, needsApproval: false, error: res.failure.message }
    },
    /* Ticket 51: scope changes run through the role-gated transaction — the
       handler owns the read-only/role refusals, the audited reason and the
       governed-ROE scope-change request for pending proposals. */
    setAssetScope: (assetId, scope) => { changeAssetScopeTransaction(services.authority, services.clock, actorCtx(''), assetId, scope) },
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
    removeFromGroup: (groupId, agentId, reason) => {
      const res = removeFromGroupTransaction(services.authority, services.clock, actorCtx(''), groupId, agentId, reason)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
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
    confirmPreflight: (opId) => {
      /* Ticket 26: the preflight run is the typed handler — the eight checks
         are re-derived from canonical state there; this entry only binds the
         current persona to the operation's own project. */
      const op = dbRef.current.operations.find((o) => o.id === opId)
      if (!op) return
      runOperationPreflight(services.authority, services.clock, actorCtx(op.projectId), opId)
    },
    startOp: (opId) => {
      const op = dbRef.current.operations.find((o) => o.id === opId)
      /* Ticket 26: the gate is re-derived from canonical state at the handler;
         a refusal (failing check, role, already started) commits nothing. */
      const gate = op ? operationStartGate(services.authority, services.clock, actorCtx(op.projectId), opId) : { ok: false as const }
      if (!gate.ok || !op) return
      mutate((d) => {
        const o = d.operations.find((x) => x.id === opId)!
        o.status = 'running'; o.startedAt = stamp(); o.updated = stamp()
        o.steps.forEach((s, i) => { s.status = i === 0 ? 'running' : 'pending'; s.ts = i === 0 ? hhmm() : '—' })
        o.agents.forEach((aid) => { const a = d.agents.find((x) => x.id === aid)!; a.op = opId })
        const p = d.projects.find((x) => x.id === o.projectId)!
        if (p.status === 'approved') p.status = 'active'
        if (!o.sessionId) newSession(d, o)
        const pl = o.planId ? d.plans.find((x) => x.id === o.planId) : undefined
        if (pl && pl.status === 'approved') pl.status = 'executed'
      })
      audit('Started operation', opId, op.projectId, 'Success', 'Preflight passed')
      pushLog(opId, { level: 'INFO', agent: '—', stepId: '—', text: 'Operation started — preflight passed, scope ' + dbRef.current.projects.find((p) => p.id === op.projectId)!.roeVersion })
    },
    pauseOp: (opId, reason) => { const op = dbRef.current.operations.find((o) => o.id === opId)!; mutate((d) => { const o = d.operations.find((x) => x.id === opId)!; o.status = 'paused'; o.stopReason = reason; o.stopBy = me.name; o.stopAt = stamp(); o.updated = stamp() }); audit('Paused operation', opId, op.projectId, 'Success', reason); pushLog(opId, { level: 'WARN', agent: '—', stepId: '—', text: `Operation paused by ${me.name}` }) },
    resumeOp: (opId) => {
      const op = dbRef.current.operations.find((o) => o.id === opId)!
      const lost = op.agents.filter((a) => dbRef.current.agents.find((x) => x.id === a)?.status !== 'online')
      if (lost.length) return { ok: false, error: `Cannot resume: ${lost.join(', ')} not connected. Restore the connection or replace the agent.` }
      const pl = op.planId ? dbRef.current.plans.find((x) => x.id === op.planId) : undefined
      if (pl && !['approved', 'executed'].includes(pl.status)) return { ok: false, error: `Cannot resume: revised plan ${pl.id} ${pl.ver ?? 'v' + pl.version} needs re-approval.` }
      mutate((d) => { const o = d.operations.find((x) => x.id === opId)!; o.status = 'running'; o.stopReason = undefined; o.updated = stamp() })
      audit('Resumed operation', opId, op.projectId); pushLog(opId, { level: 'INFO', agent: '—', stepId: '—', text: `Operation resumed by ${me.name}` })
      return { ok: true }
    },
    stopOp: (opId, reason) => { const op = dbRef.current.operations.find((o) => o.id === opId)!; mutate((d) => { const o = d.operations.find((x) => x.id === opId)!; o.status = 'cancelled'; o.stopReason = reason; o.stopBy = me.name; o.stopAt = stamp(); o.steps.forEach((s) => { if (s.status === 'running') s.status = 'unknown'; if (s.status === 'pending') s.status = 'notrun' }); o.agents.forEach((aid) => { const a = d.agents.find((x) => x.id === aid); if (a && a.op === opId) a.op = null }); d.sessions.forEach((s) => { if (s.opId === opId && ['connected', 'available', 'awaiting', 'suspended'].includes(s.state)) { s.state = 'terminated'; s.transcript.push({ ts: hhmm() + ':00', who: 'system', text: 'Session terminated: operation stopped.' }) } }) }); audit('Stopped operation', opId, op.projectId, 'Success', reason) },
    estopOp: (opId, reason) => A.emergencyStop('operation', opId, reason),
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
    reviewStep: (opId, stepId, decision, note) => {
      const op = dbRef.current.operations.find((o) => o.id === opId); if (!op) return
      mutate((d) => {
        const s = d.operations.find((o) => o.id === opId)!.steps.find((x) => x.id === stepId)!
        s.status = decision === 'approve' ? 'ok' : decision === 'skip' ? 'notrun' : 'fail'
        s.dur = decision === 'approve' ? '01:20' : '—'
        s.output = decision === 'approve' ? 'Sanitized output. No sensitive content.' : decision === 'skip' ? 'Skipped by operator.' : 'Rejected at review.'
      })
      audit(`Step review: ${decision}`, `${opId}/${stepId}`, op.projectId, 'Success', note || '')
      pushLog(opId, { level: 'INFO', agent: '—', stepId, text: `Step ${stepId} ${decision === 'approve' ? 'approved' : decision === 'skip' ? 'skipped' : 'rejected'} by ${me.name}` })
    },
    completeOp: (opId) => {
      const op = dbRef.current.operations.find((o) => o.id === opId)!
      if (op.steps.some((s) => s.status === 'running')) return { ok: false, error: 'Cannot complete: a step is still running. Wait for it to finish or use Pause.' }
      mutate((d) => {
        const o = d.operations.find((x) => x.id === opId)!
        o.status = 'done'; o.updated = stamp()
        o.steps.forEach((s) => { if (s.status === 'pending') s.status = 'notrun' })
        o.agents.forEach((aid) => { const a = d.agents.find((x) => x.id === aid); if (a && a.op === opId) a.op = null })
        d.sessions.forEach((s) => { if (s.opId === opId && ['connected', 'available', 'suspended'].includes(s.state)) { s.state = 'terminated'; s.transcript.push({ ts: hhmm() + ':00', who: 'system', text: 'Session terminated at operation completion.' }) } })
      })
      audit('Completed operation', opId, op.projectId); pushLog(opId, { level: 'INFO', agent: '—', stepId: '—', text: 'Operation completed' })
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
    updateFinding: (id, dr) => mutate((d) => { const f = d.findings.find((x) => x.id === id)!; Object.assign(f, { title: dr.title ?? f.title, severity: dr.severity ?? f.severity, desc: dr.desc ?? f.desc, impact: dr.impact ?? f.impact, rec: dr.rec ?? f.rec, asset: dr.asset ?? f.asset, technique: dr.technique ?? f.technique, owner: dr.owner ?? f.owner, evidence: dr.evidence ?? f.evidence }); f.updated = stamp(); f.history.push({ at: stamp(), by: me.name, text: 'Content updated' }) }),
    setFindingStatus: (id, status, note) => {
      const f = dbRef.current.findings.find((x) => x.id === id)!
      const txt: Record<string, string> = { review: 'Submitted for review', confirmed: 'Confirmed', returned: 'Returned for changes', remediation: 'Sent to remediation', retest: 'Moved to retest', resolved: 'Marked resolved', draft: 'Moved back to draft' }
      mutate((d) => { const x = d.findings.find((y) => y.id === id)!; x.status = status; x.updated = stamp(); x.history.push({ at: stamp(), by: me.name, text: txt[status] + (note ? `: ${note}` : '') }); if (note && status === 'returned') x.comments.push({ by: me.name, at: stamp(), text: note }) })
      audit(txt[status] || 'Changed status', id, f.projectId, 'Success', note || '')
      if (status === 'returned') notify(`${id} was returned for changes`, f.projectId, { name: 'finding', id }, 'todo')
    },
    addRetest: (id, r) => { mutate((d) => { const f = d.findings.find((x) => x.id === id)!; f.retests.push({ at: stamp(), by: me.name, ...r }); f.history.push({ at: stamp(), by: me.name, text: `Retest: ${r.result}` }); if (r.result === 'Resolved') f.status = 'resolved' }); audit('Retested', id, dbRef.current.findings.find((x) => x.id === id)!.projectId) },
    addFindingComment: (id, text) => mutate((d) => { d.findings.find((x) => x.id === id)!.comments.push({ by: me.name, at: stamp(), text }) }),
    attachEvidence: (findingId, evidenceId) => mutate((d) => { const f = d.findings.find((x) => x.id === findingId)!; if (!f.evidence.includes(evidenceId)) f.evidence.push(evidenceId); const e = d.evidence.find((x) => x.id === evidenceId); if (e) e.findingId = findingId }),
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
    submitReport: (id) => {
      const r = dbRef.current.reports.find((x) => x.id === id)!
      mutate((d) => {
        const x = d.reports.find((y) => y.id === id)!
        if (x.status === 'returned') { const [maj, min] = x.version.replace('v', '').split('.').map(Number); x.version = `v${maj}.${min + 1}` }
        x.status = 'review'; x.updated = stamp()
        x.reviews.push({ at: stamp(), by: me.name, action: 'Submitted for review', note: '', version: x.version })
      })
      audit('Submitted report for review', id, r.projectId); notify(`${id} needs review`, r.projectId, { name: 'report-review', id }, 'todo', 'reports')
    },
    returnReport: (id, note) => { const r = dbRef.current.reports.find((x) => x.id === id)!; mutate((d) => { const x = d.reports.find((y) => y.id === id)!; x.status = 'returned'; x.updated = stamp(); x.reviews.push({ at: stamp(), by: me.name, action: 'Changes requested', note, version: x.version }) }); audit('Requested report changes', id, r.projectId, 'Success', note); notify(`${id} was returned for changes`, r.projectId, { name: 'report', id }, 'todo', 'reports') },
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
    setConversationMode: (convId, mode) => { chatApi.setMode(convId, mode) },
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
      const pl = dbRef.current.plans.find((x) => x.id === planId)!
      mutate((d) => {
        const x = d.plans.find((y) => y.id === planId)!; x.status = 'in_review'; x.updated = stamp(); x.expires = 'Oct 14, 2026, ' + hhmm12() + ' (UTC+7)'
        const c = d.conversations.find((y) => y.id === x.conversationId)
        c?.messages.push({ id: 's' + Math.random().toString(36).slice(2, 7), role: 'system', text: `${x.id} ${x.ver ?? 'v' + x.version} sent to ${x.reviewer} for approval.`, at: stamp() })
      })
      audit('Requested plan approval', planId, pl.projectId)
      notify(`AI plan ${planId} needs review`, pl.projectId, { name: 'ai-plan-review', id: planId }, 'todo', 'plans')
    },
    decidePlan: (planId, decision, note) => {
      const pl = dbRef.current.plans.find((x) => x.id === planId)!
      const p = dbRef.current.projects.find((x) => x.id === pl.projectId)!
      if (pl.requestedBy === me.name && decision === 'approved') return { ok: false, error: 'You cannot approve a plan you requested. Ask another reviewer.' }
      if (decision === 'approved' && p.roeStatus !== 'approved') return { ok: false, error: `Cannot approve: ${p.id} has no approved ROE.` }
      mutate((d) => {
        const x = d.plans.find((y) => y.id === planId)!
        x.status = decision === 'approved' ? 'approved' : decision === 'returned' ? 'draft' : 'rejected'; x.updated = stamp(); x.decision = { by: me.name, at: stamp(), note }
        if (decision === 'approved' && x.prevPlanId) { const prev = d.plans.find((y) => y.id === x.prevPlanId); if (prev && prev.status !== 'executed' && !prev.opId) prev.status = 'superseded' }
        const c = d.conversations.find((y) => y.id === x.conversationId)
        c?.messages.push({ id: 's' + Math.random().toString(36).slice(2, 7), role: 'system', text: `${x.id} ${x.ver ?? 'v' + x.version} ${decision === 'approved' ? 'approved' : decision === 'returned' ? 'returned for changes' : 'rejected'} by ${me.name}${note ? ': ' + note : ''}.`, at: stamp() })
      })
      audit(`${decision === 'approved' ? 'Approved' : decision === 'returned' ? 'Returned' : 'Rejected'} AI plan`, planId, pl.projectId, 'Success', note)
      notify(`AI plan ${planId} was ${decision === 'returned' ? 'returned for changes' : decision}`, pl.projectId, { name: 'ai-plan', id: planId }, 'update', 'plans')
      return { ok: true }
    },
    revisePlan: (planId, changes, note) => {
      const prev = dbRef.current.plans.find((x) => x.id === planId)!
      let newId = ''
      mutate((d) => {
        const old = d.plans.find((x) => x.id === planId)!
        const id = 'PL-' + String(++d.counters.plan).padStart(3, '0')
        newId = id
        const steps = old.steps.map((s) => ({ ...s }))
        changes.forEach((c, i) => { if (/gate|approval/i.test(c) && steps[i % steps.length]) { const st = steps[(steps.length - 1 - i) % steps.length]; st.needsApproval = true; st.risk = st.risk === 'low' ? 'medium' : st.risk } })
        d.plans.unshift({ ...old, id, ver: bumpVer(old), version: old.version + 1, status: 'draft', steps, created: stamp(), updated: stamp(), prevPlanId: old.id, changes, decision: undefined, expires: undefined, requestedBy: me.name, rationale: `${old.rationale} Revised: ${changes.join('; ') || note || 'updated'}.`, roeVersion: d.projects.find((x) => x.id === old.projectId)!.roeVersion })
        // Revision never replaces the plan an operation uses: the approved plan stays pinned; the draft has no operation.
        d.plans.find((y) => y.id === id)!.opId = undefined
        const c = d.conversations.find((y) => y.id === old.conversationId)
        c?.messages.push({ id: 'a' + Math.random().toString(36).slice(2, 7), role: 'ai', kind: 'plan', planId: id, at: stamp(), text: `Revised as ${id} (${bumpVer(old)} draft). ${changes.join('; ')}. It needs approval before it can be used; ${old.id} stays approved and unchanged.` })
      })
      audit('Revised AI plan', newId, prev.projectId, 'Success', changes.join('; '))
      notify(`Revised plan ${newId} needs re-approval`, prev.projectId, { name: 'ai-plan-review', id: newId }, 'todo', 'plans')
      return newId
    },
    editPlan: (planId, patch) => {
      mutate((d) => { const x = d.plans.find((y) => y.id === planId); if (!x || !['draft', 'proposed'].includes(x.status)) return; if (patch.steps) x.steps = patch.steps; if (patch.title) x.title = patch.title; x.updated = stamp() })
      audit('Saved draft plan', planId, dbRef.current.plans.find((x) => x.id === planId)?.projectId || '', 'Success', 'Draft edited')
    },
    discardPlan: (planId) => {
      const pl = dbRef.current.plans.find((x) => x.id === planId); if (!pl || !['draft', 'proposed'].includes(pl.status)) return
      mutate((d) => { d.plans = d.plans.filter((x) => x.id !== planId); d.conversations.forEach((c) => { c.messages = c.messages.filter((m) => m.planId !== planId) }) })
      audit('Discarded draft plan', planId, pl.projectId, 'Success', 'Draft discarded')
    },
    executePlan: (planId) => {
      const pl = dbRef.current.plans.find((x) => x.id === planId)!
      if (pl.status !== 'approved') return { ok: false, error: 'Only an approved plan can be executed.' }
      if (pl.opId && dbRef.current.operations.some((o) => o.id === pl.opId)) return { ok: true, opId: pl.opId }
      const opId = A.createOperation({ name: pl.title, projectId: pl.projectId, owner: me.name, desc: '', objective: '', playbookId: pl.playbookId, agents: pl.agents, assets: pl.assets, mode: 'Manual approval', schedule: '', needConfirm: true, note: '', planId: pl.id })
      return { ok: true, opId }
    },
    decideTool: (toolId, decision, reason) => {
      const t = dbRef.current.toolEvents.find((x) => x.id === toolId)!
      mutate((d) => { const x = d.toolEvents.find((y) => y.id === toolId)!; x.state = decision === 'allowed' ? 'completed' : 'denied'; x.reason = reason || x.reason; if (decision === 'allowed') x.result = 'Demo data — simulated result, sanitized.' })
      mutate((d) => d.branches.forEach((b) => { if (b.toolEventId === toolId) { b.approval = decision === 'allowed' ? 'approved' : 'denied'; b.state = decision === 'allowed' ? 'completed' : 'blocked'; b.lastEvent = decision === 'allowed' ? 'Approved and executed (demo)' : 'Denied by reviewer' } }))
      audit(`${decision === 'allowed' ? 'Allowed' : 'Denied'} tool call`, t.tool, t.projectId, 'Success', reason || '')
    },

    requestBranchRetry: (branchId, reason) => {
      const b = dbRef.current.branches.find((x) => x.id === branchId)!
      mutate((d) => { const x = d.branches.find((y) => y.id === branchId)!; x.pendingRequest = 'retry'; x.approval = 'pending'; x.lastEvent = 'Retry requested — awaiting approval and preflight'; x.timeline.push({ at: stamp(), text: `Retry requested: ${reason}` }) })
      audit('Requested branch retry', branchId, b.projectId, 'Pending', reason)
    },
    reassignBranch: (branchId, agentId, reason) => {
      const d0 = dbRef.current
      const b = d0.branches.find((x) => x.id === branchId)!
      const ag = d0.agents.find((x) => x.id === agentId)
      if (!ag) return { ok: false, error: 'Agent not found.' }
      if (ag.status !== 'online' && ag.status !== 'idle') return { ok: false, error: `${agentId} is not connected. Disconnected agents can't be assigned.` }
      if (ag.projectId && ag.projectId !== b.projectId) return { ok: false, error: `${agentId} belongs to another project.` }
      if (!ag.projectId) return { ok: false, error: `${agentId} is in the shared pool. Request assignment to ${b.projectId} first.` }
      mutate((d) => { const x = d.branches.find((y) => y.id === branchId)!; x.assignLog.push({ at: stamp(), text: `Reassignment ${x.agent} → ${agentId} requested: ${reason}` }); x.pendingRequest = 'reassign'; x.approval = 'pending'; x.lastEvent = `Reassignment to ${agentId} awaiting approval` })
      audit('Requested branch reassignment', branchId, b.projectId, 'Pending', `${b.agent} → ${agentId}: ${reason}`)
      return { ok: true }
    },
    cancelBranch: (branchId, reason) => {
      const b = dbRef.current.branches.find((x) => x.id === branchId)!
      mutate((d) => { const x = d.branches.find((y) => y.id === branchId)!; x.state = 'cancelled'; x.pendingRequest = undefined; x.lastEvent = 'Cancelled by user'; x.timeline.push({ at: stamp(), text: `Cancelled: ${reason}` }) })
      audit('Cancelled branch', branchId, b.projectId, 'Success', reason)
    },

    /* ── C2 & Sessions ── */
    requestSessionAccess: (sessionId, mode, duration, reason) => {
      const s = dbRef.current.sessions.find((x) => x.id === sessionId)!
      const id = 'AR-' + String(dbRef.current.counters.request + 1).padStart(3, '0')
      mutate((d) => { d.counters.request++; d.sessionRequests.unshift({ id, sessionId, projectId: s.projectId, by: me.name, reason, mode, duration, status: 'pending', at: stamp() }) })
      audit('Requested session access', sessionId, s.projectId, 'Pending', reason)
      notify(`Session access request ${id} is pending`, s.projectId, { name: 'c2-session', id: sessionId }, 'todo', 'sessions')
      return id
    },
    decideSessionRequest: (id, decision, note, minutes) => {
      const r = dbRef.current.sessionRequests.find((x) => x.id === id)!
      mutate((d) => {
        const x = d.sessionRequests.find((y) => y.id === id)!; x.status = decision; x.decidedBy = me.name; x.note = note
        if (decision === 'approved') {
          const s = d.sessions.find((y) => y.id === x.sessionId)!
          s.grants = s.grants.filter((g) => g.user !== x.by)
          s.grants.push({ user: x.by, perm: x.mode, expires: 'Oct 13, 2026, ' + (() => { const m = nowMin() + (minutes ?? ((parseInt(x.duration) || 1) * 60)), h = Math.floor(m / 60) % 24; return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? 'AM' : 'PM'}` })() + ' (UTC+7)', by: me.name })
          s.transcript.push({ ts: hhmm() + ':00', who: 'system', text: `${x.mode} access granted to ${x.by} by ${me.name}.` })
        }
      })
      audit(`${decision === 'approved' ? 'Approved' : decision === 'rejected' ? 'Rejected' : 'Requested changes on'} session access`, r.sessionId, r.projectId, 'Success', note)
      notify(`Session access ${id} ${decision === 'changes' ? 'needs changes' : decision}`, r.projectId, { name: 'c2-session', id: r.sessionId }, 'update', 'sessions')
    },
    terminateSession: (sessionId, reason) => {
      const s = dbRef.current.sessions.find((x) => x.id === sessionId)!
      mutate((d) => { const x = d.sessions.find((y) => y.id === sessionId)!; x.state = 'revoking'; x.transcript.push({ ts: hhmm() + ':00', who: 'system', text: `Termination requested by ${me.name}: ${reason}` }) })
      audit('Terminated session', sessionId, s.projectId, 'Success', reason)
      later(() => mutate((d) => { const x = d.sessions.find((y) => y.id === sessionId)!; if (x.state === 'revoking') { x.state = 'terminated'; x.grants = []; x.transcript.push({ ts: hhmm() + ':00', who: 'system', text: 'Session terminated. All grants revoked.' }) } }), 2000)
    },
    revokeGrant: (sessionId, user, reason) => {
      const s = dbRef.current.sessions.find((x) => x.id === sessionId)!
      mutate((d) => { const x = d.sessions.find((y) => y.id === sessionId)!; x.grants = x.grants.filter((g) => g.user !== user); x.transcript.push({ ts: hhmm() + ':00', who: 'system', text: `Access for ${user} revoked by ${me.name}.` }) })
      audit('Revoked session access', sessionId, s.projectId, 'Success', reason || '')
    },
    expireGrant: (sessionId, user) => {
      const s = dbRef.current.sessions.find((x) => x.id === sessionId)!
      mutate((d) => { const x = d.sessions.find((y) => y.id === sessionId)!; x.grants = x.grants.filter((g) => g.user !== user); d.sessionRequests.forEach((r) => { if (r.sessionId === sessionId && r.by === user && r.status === 'approved') r.status = 'expired' }); x.transcript.push({ ts: hhmm() + ':00', who: 'system', text: `Interactive grant for ${user} expired.` }) })
      audit('Session grant expired', sessionId, s.projectId, 'Warning')
    },
    sessionCommand: (sessionId, label) => {
      mutate((d) => { const x = d.sessions.find((y) => y.id === sessionId)!; x.last = stamp(); x.transcript.push({ ts: hhmm() + ':' + pad(new Date().getSeconds()), who: 'user', text: `[simulated] ${label}` }, { ts: hhmm() + ':' + pad(new Date().getSeconds()), who: 'target', text: 'Demo data — simulated, sanitized output.' }) })
      audit('Session action (simulated)', sessionId, dbRef.current.sessions.find((x) => x.id === sessionId)!.projectId, 'Success', label)
    },
    setSessionState: (sessionId, state) => { mutate((d) => { const x = d.sessions.find((y) => y.id === sessionId); if (x) x.state = state }) },
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
export type { PlanStatus, ToolEvent }
