import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { USERS, APR, type Db, type Project, type Step, type Finding, type Role, type Agent, type Group, type Plan, type PlanStatus, type AiMode, type Session, type SeedVariant, type ToolEvent } from './data'
import { signIn, signOut } from './auth/persona'
import { can as policyCan, projectAccessible, readOnlyContext, ROLE_LABEL } from './auth/policy'
import type { CanAction } from './domain/permissions'
import { ServicesProvider, useServices } from './state/services'
// eslint-disable-next-line react-refresh/only-export-components
export { useServices } from './state/services'
// Ticket 38 append: the legacy AI actions delegate to the feature-local chat
// handlers (src/features/aichat); this layer keeps the demo's response
// orchestration only.
import { createChatHandlers } from './features/aichat/handlers'
import {
  resetDemo as demoResetDemo,
  emergencyStop as demoEmergencyStop, retryStop as demoRetryStop, resolveStop as demoResolveStop,
  sendChat as demoSendChat, stopChat as demoStopChat,
  loseAgent as demoLoseAgent, restoreAgent as demoRestoreAgent, fastForward as demoFastForward,
  terminateSession as demoTerminateSession,
} from './features/demo/runtime'
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
  confirmCloseTransaction, reopenProjectTransaction, requestCloseTransaction,
} from './features/closure/service'
// Ticket 67 enabler E: the stop transitions delegate to the demo runtime —
// its typed-handler imports live there now.
// Ticket 37 append: the legacy export/delivery actions delegate to the typed
// report handlers (one audited implementation for both entry points).
import { deliverReportVersion, exportReportVersion, type DeliveryInput } from './features/reports/service'
// Ticket 26 append: the preflight derivation and the start gate live in the
// operations feature. (Ticket 67 retired the store's computePreflight wrapper
// and its demo-anchor: callers derive the eight checks at the factory clock's
// instant via computePreflightChecks.)
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
import { useAuthStore, useProjectStore, useThemeStore, useToastStore, useUiStore, type CopilotCtx, type Toast } from './state/stores'
// Ticket 67 enabler A: the provider's transient UI state (confirm dialog,
// dirty/unsaved guard, demo logs, stale marks, filters, stop outcome, AI
// busy, loading) is backed by the session Zustand authority; this context
// reads/writes it like the shared authorities above.
import { useSessionStore, type ConfirmOpts, type LogLine } from './state/session'
// Ticket 67 enabler B: navigation (the guarded go, the raw router forward,
// the route projection and the auth navigation) is hosted by the canonical
// router module; this context forwards to it with an unchanged Store surface.
import { currentRoute, go as navGo, navigationEpoch, navRawRoute, selectProject, useRoute } from './router/navigate'
import { isKnownPage, OUTSIDE_SHELL, type Route } from './router/history'
import { hhmm, stamp, today } from './domain/demo-clock'

/* ───────────── Simulated clock (UTC+7) ───────────── */
/* Ticket 67 enabler C: the demo wall-clock projection (hhmm/hhmm12/stamp/
   today, one T0 anchor) is hosted by src/domain/demo-clock.ts — the store,
   the C2 service and the screens share the single anchor. */
const pad = (n: number) => String(n).padStart(2, '0')

/* ───────────── Roles ───────────── */
/* Ticket 67: the store's ROLE_LABEL definition moved to the auth policy
   authority (src/auth/policy.ts) — every consumer resolves it there. */
type Persona = (typeof USERS)[number]

/** Membership policy seam (ticket 06): forwards to the shared permissions interface. */
export function canAccessProject(db: Db, me: Persona, projectId: string) {
  return projectAccessible(db.projects.find((x) => x.id === projectId), { id: me.name, role: me.role })
}

/* ───────────── Project closure checklist ───────────── */
/* Ticket 22: the derivation lives in the closure handlers
   (src/features/closure/service.ts) — one canonical, never-stored checklist
   for the typed request/confirm handlers. Ticket 65 retired the store's
   re-export and ticket 67 moved the last consumer (the closure suite's
   completion % probe) next to the derivation it pins. The close console adds
   its agent-reservation row through closePanelItems; the waiver stays a
   request-time input. */

/* ───────────── Session state ───────────── */
/* Ticket 67 enabler A: LogLine/ConfirmOpts and the transient UI state they
   describe are hosted by the session authority (src/state/session.ts); this
   file keeps only the context seam and the demo runtime. */

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

export function StoreProvider({ children }: { children: ReactNode }): ReactElement {
  return <ServicesProvider><LegacyStoreProjection>{children}</LegacyStoreProjection></ServicesProvider>
}

function LegacyStoreProjection({ children }: { children: ReactNode }): ReactElement {
  const services = useServices()
  const navEpochRef = useRef(navigationEpoch())
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
  /* The route is the router module's projection (ticket 67 enabler B) — the
     one router subscription lives in useRoute; this context only reads it. */
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const setPidRaw = useProjectStore((s) => s.setPid)
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const toasts = useToastStore((s) => s.toasts)
  const toast = useToastStore((s) => s.toast)
  /* Confirm dialog, dirty/unsaved guard, demo logs, stale marks, filters,
     stop outcome, AI busy and the loading flag are the session Zustand
     authority (ticket 67 enabler A); the context forwards to it so legacy
     and migrated consumers observe one state. */
  const loading = useSessionStore((s) => s.loading)
  const confirmState = useSessionStore((s) => s.confirmState)
  const confirm = useSessionStore((s) => s.confirm)
  const closeConfirm = useSessionStore((s) => s.closeConfirm)
  const dirty = useSessionStore((s) => s.dirty)
  const setDirty = useSessionStore((s) => s.setDirty)
  const clearDirty = useSessionStore((s) => s.clearDirty)
  const unsaved = useSessionStore((s) => s.unsaved)
  const closeUnsaved = useSessionStore((s) => s.closeUnsaved)
  const guarded = useSessionStore((s) => s.guarded)
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
  const stopOutcome = useSessionStore((s) => s.stopOutcome)
  const setStopOutcome = useSessionStore((s) => s.setStopOutcome)
  const aiBusy = useSessionStore((s) => s.aiBusy)
  /* The demo runtime (ticket 67 enabler E) owns the dataset-bound delayed
     callbacks and the AI response timers: the provider registers its
     services on mount and `resetDemo` disposes the runtime's timers, so a
     stale callback never applies pre-reset state to the reseeded dataset
     (and a callback outliving its mount stays bound to that mount's own
     authority). */
  const logs = useSessionStore((s) => s.logs)
  const pushLogS = useSessionStore((s) => s.pushLog)
  const staleOps = useSessionStore((s) => s.staleOps)
  const setStale = useSessionStore((s) => s.setStale)
  const persistFilters = useSessionStore((s) => s.persistFilters)
  const setFilter = useSessionStore((s) => s.setFilter)

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

  /* The dirty/unsaved guard (setDirty/guarded/closeUnsaved) is the session
     authority's (ticket 67 enabler A): it reads synchronous store state, so
     the old dirtyRef staleness hazard cannot recur — a "dirty cleared first,
     then navigate" redirect is never held by the unsaved modal. */

  /* navigation — the router is the single location writer (ticket 07). The
     guarded go, the raw router forward (with the router-less fallback for
     test mounts), the route projection and the guarded project selection
     live in the canonical router module (ticket 67 enablers B/C); this
     context forwards them unchanged. The forwards scope their writes to this
     mount's epoch: a captured closure that outlives the provider (a screen's
     delayed redirect) must not move a later mount's route — the
     provider-local setRoute used to no-op after unmount. */
  const go: Store['go'] = (page, opts) => navGo(page, opts, navEpochRef.current)
  const setPid: Store['setPid'] = (id) => selectProject(id, navEpochRef.current)

  /* Auth writes forward to the shared auth authority via the auth feature
     actions (ticket 06); navigation forwards to the router module (ticket 07). */
  const login = (o?: string) => {
    signIn(useAuthStore.getState().meName, o)
    /* Safe return destination: the guard renders login in place for protected
       URLs, so signing in reveals the requested route without a redirect.
       Public and unknown destinations go home. */
    const r = currentRoute()
    if (isKnownPage(r.page) && r.page !== 'login' && !OUTSIDE_SHELL.has(r.page)) {
      clearDirty()
      return
    }
    navRawRoute({ page: 'command-center' }, navEpochRef.current)
  }
  const logout = () => { signOut(); navRawRoute({ page: 'login' }, navEpochRef.current) }

  /* Ticket 67 wave 2: the demo reset (timers disposal, reseed, log rebuild,
     transient session/UI/toast clears and the final toast) lives in the demo
     runtime; this entry is a one-line delegate until the store retires. */
  const resetDemo: Store['resetDemo'] = (scenario) => demoResetDemo(scenario)

  const audit: Actions['audit'] = (action, obj, projectId, result = 'Success', reason = '') =>
    mutate((d) => { d.audit.unshift({ corr: projectId === 'RT-2026-014' && /^(SS|AR)-/.test(obj) ? 'COR-014-01' : undefined, id: 'AU-' + ++d.counters.audit, at: stamp(), actor: me.name, role: ROLE_LABEL[me.role], action, obj, projectId, result, reason }) })
  const notify: Actions['notify'] = (text, projectId, to, group = 'update', category) =>
    mutate((d) => { d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + Date.now() % 10000, group, text, projectId, at: stamp(), read: false, to, category }) })

  const pushLog = (opId: string, line: Omit<LogLine, 'id' | 'ts'>) =>
    pushLogS(opId, line, hhmm() + ':' + pad(new Date().getSeconds()))

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
      context and Query consumers observe. The demo's response orchestration
      lives in the demo runtime (ticket 67 enabler E). The proposal invariant
      (requirement 5) lives in the handler: no action here can start an
      operation, approve a plan or allow a tool call. */

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
       immediate response, never a passive status. The demo's simulated
       outcome switch and the tracked delays (disposed on demo reset) live in
       the demo runtime (ticket 67 enabler E); these entries delegate. */
    emergencyStop: (scope, id, reason) => demoEmergencyStop(scope, id, reason),
    retryStop: () => demoRetryStop(),
    resolveStop: (outcome) => demoResolveStop(outcome),
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
    /* The agent loss/restore, fast-forward and session-termination
       simulations are the demo's outcome engine (ticket 67 enabler E) — the
       runtime owns their commits, log mirrors, notices and tracked delays. */
    loseAgent: (agentId) => demoLoseAgent(agentId),
    restoreAgent: (agentId) => demoRestoreAgent(agentId),
    fastForward: (opId) => demoFastForward(opId),

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

    /* ── AI Operator (ticket 38: handlers own the data; the demo's response
       orchestration — busy flag + 900 ms timer, disposed on stop and demo
       reset — lives in the demo runtime (ticket 67 enabler E); the handler
       enforces the proposal invariant. ──) */
    createConversation: (projectId, mode = aiMode) => {
      const res = createChatHandlers(services, { id: me.name, role: me.role }, 'all').create(projectId, mode)
      return res.ok ? res.data.id : ''
    },
    togglePinConv: (convId) => { createChatHandlers(services, { id: me.name, role: me.role }, 'all').setPinned(convId) },
    sendChat: (convId, text) => demoSendChat(convId, text),
    stopChat: (convId) => demoStopChat(convId),
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
    terminateSession: (sessionId, reason) => demoTerminateSession(sessionId, reason),
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

  const value: Store = {
    db, me, setMe: setMeName, authed, login, logout, org, route, go, pid, project, setPid, scoped, accessible, readOnly, can, theme, setTheme, loading,
    toast, toasts, confirm, confirmState, closeConfirm, setDirty, dirty, unsaved, closeUnsaved, guarded,
    switcherOpen, setSwitcherOpen, noticesOpen, setNoticesOpen, copilotOpen, copilotCtx, setCopilotOpen, aiMode, setAiMode, aiBusy,
    logs, now: stamp, staleOps, setStale, persistFilters, setFilter, resetDemo, stopOutcome, setStopOutcome, A,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
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
