import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { seed, BRANCH_TERMINAL, type BranchState, USERS, APR, type Db, type Project, type Operation, type Step, type Finding, type Role, type Asset, type Agent, type Group, type Plan, type PlanStep, type PlanStatus, type AiMode, type Session, type SessionPerm, type SeedVariant, type ToolEvent, type Conversation } from './data'

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
export interface Route { page: string; id?: string; tab?: string }
const parseHash = (): Route => {
  const h = window.location.hash.replace(/^#\/?/, '')
  if (!h) return { page: 'login' }
  const [path, qs] = h.split('?')
  const [page, id] = path.split('/')
  const tab = qs ? new URLSearchParams(qs).get('tab') || undefined : undefined
  return { page: page || 'login', id: id ? decodeURIComponent(id) : undefined, tab }
}
const toHash = (r: Route) => `#/${r.page}${r.id ? '/' + encodeURIComponent(r.id) : ''}${r.tab ? '?tab=' + r.tab : ''}`

/* ───────────── Roles ───────────── */
export const ROLE_LABEL: Record<Role, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }
export type Persona = (typeof USERS)[number]

export function canAccessProject(db: Db, me: Persona, projectId: string) {
  const p = db.projects.find((x) => x.id === projectId)
  if (!p) return false
  if (me.role === 'admin' || me.role === 'manager' || me.role === 'reviewer') return true
  return p.members.some((m) => m.user === me.name)
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
export type CheckState = 'pass' | 'fail' | 'review'
export interface Check { code: string; label: string; state: CheckState; detail: string; fix?: string; fixRoute?: Route; reason?: string }
export function computePreflight(db: Db, op: Operation): Check[] {
  const p = db.projects.find((x) => x.id === op.projectId)!
  const pb = db.playbooks.find((x) => x.id === op.playbookId)
  const plan = op.planId ? db.plans.find((x) => x.id === op.planId) : undefined
  const targets = op.assets.map((id) => db.assets.find((a) => a.id === id)).filter(Boolean) as Asset[]
  const outT = targets.filter((a) => a.scope !== 'in')
  const ags = op.agents.map((id) => db.agents.find((a) => a.id === id)).filter(Boolean) as Agent[]
  const bad = ags.filter((a) => a.status !== 'online' || (a.op && a.op !== op.id) || a.projectId !== p.id)
  const projOk = ['approved', 'active'].includes(p.status)
  const roeOk = p.roeStatus === 'approved'
  const pendingScope = db.approvals.some((a) => a.projectId === p.id && a.status === 'pending' && a.type === APR.scope)
  const R = (page: string, tab?: string, id?: string): Route => ({ page, tab, id })
  const planBlock = plan && plan.status !== 'approved' && plan.status !== 'executed'
  const pendingOther = db.approvals.some((a) => a.projectId === p.id && a.status === 'pending' && a.type === APR.plan)
  return [
    projOk
      ? { code: 'PRE-01', label: 'Project selected and approved', state: 'pass', detail: `${p.id} — ${p.name}` }
      : { code: 'PRE-01', label: 'Project selected and approved', state: 'fail', detail: 'The project has not been approved.', fix: 'Open approvals', fixRoute: R('project', 'team', p.id), reason: 'Cannot start: the project is not approved. Open Team & approvals to finish.' },
    roeOk && !pendingScope
      ? { code: 'PRE-02', label: 'ROE approved and current version', state: 'pass', detail: `${p.roeVersion} — approved` }
      : { code: 'PRE-02', label: 'ROE approved and current version', state: 'fail', detail: pendingScope ? 'A scope change is waiting for re-approval.' : 'The Rules of Engagement are not approved or no longer valid.', fix: 'Open ROE', fixRoute: R('project', 'scope', p.id), reason: 'Execution is blocked: this project has no approved ROE. Open Scope & ROE to resolve.' },
    targets.length === 0
      ? { code: 'PRE-03', label: 'Targets inside approved scope', state: 'fail', detail: 'No target assets selected.', fix: 'Review assets', fixRoute: R('assets') }
      : outT.length
        ? { code: 'PRE-03', label: 'Targets inside approved scope', state: 'fail', detail: `Assets outside the allowed scope: ${outT.map((a) => a.name).join(', ')}`, fix: 'Review assets', fixRoute: R('assets') }
        : { code: 'PRE-03', label: 'Targets inside approved scope', state: 'pass', detail: `${targets.length} in-scope assets: ${targets.map((a) => a.name).join(', ')}` },
    { code: 'PRE-04', label: 'Inside the allowed time window', state: 'pass', detail: `${p.window} — now ${hhmm12()} (UTC+7)` },
    pb && pb.status === 'approved'
      ? { code: 'PRE-05', label: 'Playbook approved and versioned', state: 'pass', detail: `${pb.name} v${pb.version}` }
      : { code: 'PRE-05', label: 'Playbook approved and versioned', state: 'fail', detail: 'The playbook is not ready for use.', fix: 'Choose another playbook', fixRoute: R('playbooks') },
    ags.length === 0
      ? { code: 'PRE-06', label: 'Agents healthy and not in conflict', state: 'fail', detail: 'No agents assigned.', fix: 'Replace agent', fixRoute: R('agents') }
      : bad.length
        ? { code: 'PRE-06', label: 'Agents healthy and not in conflict', state: 'fail', detail: `Agents unavailable or in use elsewhere: ${bad.map((a) => a.id).join(', ')}`, fix: 'Replace agent', fixRoute: R('agents') }
        : { code: 'PRE-06', label: 'Agents healthy and not in conflict', state: 'pass', detail: `${ags.map((a) => a.id).join(', ')} connected and compatible` },
    planBlock
      ? { code: 'PRE-07', label: 'Required approvals in place', state: 'review', detail: `AI plan ${plan!.id} ${plan!.ver ?? 'v' + plan!.version} is ${plan!.status.replace('_', ' ')} — approval required.`, fix: 'Review plan', fixRoute: R('ai-plan-review', undefined, plan!.id), reason: 'Waiting for plan approval before execution.' }
      : pendingOther
        ? { code: 'PRE-07', label: 'Required approvals in place', state: 'review', detail: 'Another approval request is open for this project.', fix: 'Open approvals', fixRoute: R('project', 'team', p.id) }
        : { code: 'PRE-07', label: 'Required approvals in place', state: 'pass', detail: plan ? `Plan ${plan.id} v${plan.version} approved.` : 'No open approval requests.' },
    p.emergency
      ? { code: 'PRE-08', label: 'Emergency contact defined', state: 'pass', detail: p.emergency }
      : { code: 'PRE-08', label: 'Emergency contact defined', state: 'fail', detail: 'No emergency contact on file.', fix: 'Update ROE', fixRoute: R('project', 'scope', p.id) },
  ]
}
export const preflightPass = (c: Check[]) => c.every((x) => x.state === 'pass')

/* ───────────── Project closure checklist ───────────── */
export function closureChecklist(db: Db, pid: string) {
  const ops = db.operations.filter((o) => o.projectId === pid)
  const fs = db.findings.filter((f) => f.projectId === pid)
  const reps = db.reports.filter((r) => r.projectId === pid)
  const appr = db.approvals.filter((a) => a.projectId === pid && a.status === 'pending' && a.type !== APR.close)
  const running = ops.filter((o) => ['running', 'paused'].includes(o.status))
  const openF = fs.filter((f) => ['draft', 'review', 'returned'].includes(f.status))
  const delivered = reps.some((r) => r.status === 'delivered')
  const live = db.sessions.filter((s) => s.projectId === pid && ['connected', 'available', 'awaiting', 'suspended', 'revoking'].includes(s.state))
  return [
    { id: 'c1', label: 'No running or paused operations', ok: running.length === 0, detail: running.length ? `Still open: ${running.map((o) => o.id).join(', ')}` : 'All operations have ended or are drafts', fix: { page: 'project', tab: 'operations', id: pid } as Route },
    { id: 'c1b', label: 'No live C2 sessions', ok: live.length === 0, detail: live.length ? `Live: ${live.map((s) => s.id).join(', ')}` : 'No live sessions', fix: { page: 'c2', id: undefined } as Route },
    { id: 'c2', label: 'Findings reviewed per policy', ok: openF.length === 0, detail: openF.length ? `${openF.length} findings not reviewed: ${openF.map((f) => f.id).join(', ')}` : `${fs.length} findings handled`, fix: { page: 'project', tab: 'findings', id: pid } as Route },
    { id: 'c3', label: 'Final report approved and delivered', ok: delivered, detail: delivered ? 'A report is Delivered' : 'No report has been delivered', fix: { page: 'project', tab: 'reports', id: pid } as Route },
    { id: 'c4', label: 'No outstanding required approvals', ok: appr.length === 0, detail: appr.length ? `${appr.length} requests pending` : 'No open requests', fix: { page: 'project', tab: 'team', id: pid } as Route },
  ]
}


/* ───────────── V3: eligibility, readiness, completion ───────────── */
export type EligKind = 'locked' | 'ready' | 'eligible' | 'active' | 'closed'
export interface Reason { text: string; to?: Route }
export function projectAgentsOnline(db: Db, pid: string) { return db.agents.filter((a) => a.projectId === pid && (a.status === 'online' || a.status === 'idle')) }
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
export interface Toast { id: number; kind: 'ok' | 'warn' | 'bad' | 'info'; text: string }
export interface CopilotCtx { kind: string; id?: string; label: string }

/* ───────────── Context ───────────── */
export type CanAction = 'createProject' | 'approve' | 'editScope' | 'run' | 'createFinding' | 'reviewFinding' | 'editReport' | 'approveReport' | 'requestClose' | 'confirmClose' | 'reopen' | 'admin' | 'viewSensitive' | 'estop' | 'plan' | 'approvePlan' | 'interactive' | 'approveAccess' | 'terminate'
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
  submitApproval: (projectId: string, type: string, note: string, diff?: string) => void
  withdrawApproval: (id: string) => void
  decideApproval: (id: string, decision: 'approved' | 'returned', note: string) => Res
  editScope: (projectId: string, patch: Partial<Pick<Project, 'window' | 'emergency' | 'methods' | 'restrictions' | 'desc'>>, reason?: string) => void
  updateProject: (projectId: string, patch: Partial<Project>) => void
  addAssets: (projectId: string, list: { name: string; ident: string; type: string; os: string; owner: string; scope: 'in' | 'out'; source: string; ip?: string }[]) => { needsApproval: boolean }
  setAssetScope: (assetId: string, scope: Asset['scope']) => void
  assignAgent: (agentId: string, projectId: string) => void
  setAgentStatus: (agentId: string, s: Agent['status']) => void
  saveGroup: (g: Partial<Group> & { name: string; projectId: string }) => string
  removeFromGroup: (groupId: string, agentId: string) => void
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
  deliverReport: (id: string, recipient: string) => Res
  requestClose: (pid: string) => void
  confirmClose: (approvalId: string) => void
  reopen: (pid: string, reason: string) => void
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

const bumpRoe = (v: string) => v.replace(/v(\d+)$/, (_, n) => `v${+n + 1}`)
const bumpVer = (p: Plan) => { const m = (p.ver ?? `v${p.version}`).match(/^v(\d+)(?:\.(\d+))?$/); return m ? `v${m[1]}.${(+(m[2] ?? 0)) + 1}` : `v${p.version + 1}` }

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Db>(() => seed())
  const dbRef = useRef(db)
  dbRef.current = db
  const mutate = useCallback((fn: (d: Db) => void) => {
    const next = structuredClone(dbRef.current)
    fn(next)
    dbRef.current = next
    setDb(next)
  }, [])

  const [meName, setMeName] = useState('Alex Morgan')
  const me = USERS.find((u) => u.name === meName)!
  const [authed, setAuthed] = useState(() => !!window.location.hash && parseHash().page !== 'login')
  const [org, setOrg] = useState('Acme Security (Demo)')
  const [route, setRoute] = useState<Route>(() => parseHash())
  const [pid, setPidRaw] = useState<string>('all')
  const [theme, setThemeS] = useState<'dark' | 'light'>('light')
  const [loading, setLoading] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmState, setConfirmState] = useState<ConfirmOpts | null>(null)
  const [dirty, setDirtyS] = useState(false)
  const saveRef = useRef<(() => void) | undefined>(undefined)
  const [unsaved, setUnsaved] = useState<Store['unsaved']>(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [noticesOpen, setNoticesOpenRaw] = useState(false)
  const [copilotOpen, setCopilotOpenRaw] = useState(false)
  const [copilotCtx, setCopilotCtx] = useState<CopilotCtx | null>(null)
  const [aiMode, setAiMode] = useState<AiMode>('propose')
  const [stopOutcome, setStopOutcome] = useState<'ack' | 'fail' | 'unknown'>('ack')
  const stopOutRef = useRef(stopOutcome); stopOutRef.current = stopOutcome
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const aiTimers = useRef(new Map<string, number>())
  const [logs, setLogs] = useState<Record<string, LogLine[]>>({})
  const [staleOps, setStaleOps] = useState<Record<string, boolean>>({})
  const [persistFilters, setPF] = useState<Record<string, any>>({})
  const setFilter = useCallback((k: string, v: any) => setPF((s) => ({ ...s, [k]: v })), [])

  const setNoticesOpen = (b: boolean) => { setNoticesOpenRaw(b); if (b) setCopilotOpenRaw(false) }
  const setCopilotOpen: Store['setCopilotOpen'] = (open, ctx) => { setCopilotOpenRaw(open); if (open) { setNoticesOpenRaw(false); if (ctx) setCopilotCtx(ctx) } }

  const setTheme = (t: 'dark' | 'light') => {
    setThemeS(t)
    document.documentElement.classList.toggle('dark', t === 'dark')
  }

  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  const accessible = useMemo(() => db.projects.filter((p) => canAccessProject(db, me, p.id)), [db, me])
  const project = pid === 'all' ? null : db.projects.find((p) => p.id === pid) || null
  const scoped = useCallback(
    <T extends { projectId: string }>(arr: T[]) => {
      const ids = new Set(accessible.map((p) => p.id))
      return arr.filter((x) => (pid === 'all' ? ids.has(x.projectId) || x.projectId === '' : x.projectId === pid))
    },
    [accessible, pid],
  )

  const readOnly = (projectId?: string) => {
    const p = db.projects.find((x) => x.id === (projectId || pid))
    if (!p) return false
    return p.status === 'closed' || p.status === 'cancelled' || me.role === 'viewer'
  }
  const can: Store['can'] = (a, projectId) => {
    const p = db.projects.find((x) => x.id === (projectId || pid))
    if (p && (p.status === 'closed' || p.status === 'cancelled') && a !== 'reopen' && a !== 'viewSensitive') return false
    const r = me.role
    switch (a) {
      case 'createProject': return r === 'admin' || r === 'manager'
      case 'approve': return r === 'reviewer' || r === 'admin'
      case 'editScope': return r === 'admin' || r === 'manager'
      case 'run': return r === 'manager' || r === 'operator'
      case 'createFinding': return r === 'manager' || r === 'operator' || r === 'analyst'
      case 'reviewFinding': return r === 'manager' || r === 'reviewer'
      case 'editReport': return r === 'manager' || r === 'operator' || r === 'analyst'
      case 'approveReport': return r === 'reviewer'
      case 'requestClose': return r === 'manager'
      case 'confirmClose': return r === 'reviewer' || r === 'admin'
      case 'reopen': return r === 'admin'
      case 'admin': return r === 'admin'
      case 'viewSensitive': return r !== 'viewer'
      case 'estop': return r === 'manager' || r === 'admin'
      case 'plan': return r === 'manager' || r === 'operator'
      case 'approvePlan': return r === 'reviewer' || r === 'admin'
      case 'interactive': return r === 'manager' || r === 'operator'
      case 'approveAccess': return r === 'manager' || r === 'admin' || r === 'reviewer'
      case 'terminate': return r === 'manager' || r === 'admin'
    }
  }

  /* dirty guard */
  const setDirty = useCallback((on: boolean, save?: () => void) => { setDirtyS(on); saveRef.current = on ? save : undefined }, [])
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  const guarded = useCallback((fn: () => void) => {
    if (dirtyRef.current) setUnsaved({ next: fn, save: saveRef.current })
    else fn()
  }, [])
  const closeUnsaved = () => setUnsaved(null)

  /* navigation */
  const navRaw = useCallback((page: string, opts?: { id?: string; tab?: string }) => {
    const r: Route = { page, id: opts?.id, tab: opts?.tab }
    setDirtyS(false); saveRef.current = undefined
    setRoute(r)
    window.location.hash = toHash(r)
    document.querySelector('main')?.scrollTo?.(0, 0)
  }, [])
  const go = useCallback((page: string, opts?: { id?: string; tab?: string }) => guarded(() => navRaw(page, opts)), [guarded, navRaw])

  useEffect(() => {
    const on = () => setRoute(parseHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
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
      setRoute((r) => {
        if (r.page === 'project' && id === 'all') { const nr = { page: 'projects' }; window.location.hash = toHash(nr); return nr }
        if (r.page === 'project') { const nr = { ...r, id }; window.location.hash = toHash(nr); return nr }
        if (DETAIL_MAP[r.page]) { const nr = { page: DETAIL_MAP[r.page] }; window.location.hash = toHash(nr); return nr }
        return r
      })
    })
  }, [pid, guarded])

  const login = (o?: string) => {
    if (o) setOrg(o)
    setAuthed(true)
    navRaw('command-center')
  }
  const logout = () => { setAuthed(false); navRaw('login') }

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
    const next = seed(scenario)
    dbRef.current = next
    setDb(next)
    setLogs(buildLogs(next))
    setStaleOps({}); setPF({}); setPidRaw('all'); setDirtyS(false); saveRef.current = undefined
    setConfirmState(null); setUnsaved(null); setCopilotOpenRaw(false); setNoticesOpenRaw(false); setAiBusy(null)
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

  /* ───────── AI mock ───────── */
  const pickPlaybook = (p: Project, text: string, d: Db) => {
    const t = text.toLowerCase()
    const id = /detect|signal|soc|siem/.test(t) ? 'PB-002' : /cloud|config|iam/.test(t) || p.type === 'Assessment' ? 'PB-003' : 'PB-001'
    return d.playbooks.find((x) => x.id === id && x.status === 'approved') || d.playbooks.find((x) => x.status === 'approved')!
  }
  const buildPlanRecord = (d: Db, p: Project, text: string, convId: string, prev?: Plan): Plan => {
    const pb = pickPlaybook(p, text, d)
    const inScope = d.assets.filter((a) => a.projectId === p.id && a.scope === 'in').slice(0, 3)
    const ags = d.agents.filter((a) => a.projectId === p.id && a.status === 'online' && (!a.op || a.op === prev?.opId)).slice(0, 2)
    const names = pb.steps
    const steps: PlanStep[] = names.map((name, i) => ({
      id: 'P' + pad(i + 1), name, technique: pb.techniques[i % pb.techniques.length], asset: inScope.length ? inScope[i % inScope.length].name : '—', agent: ags.length ? ags[i % ags.length].id : '—',
      tool: ['host-info-collector', 'account-enumerator', 'group-enumerator', 'service-mapper', 'web-profiler', 'credential-validator (lab)', 'task-reviewer', 'data-sampler', 'remote-service-check', 'defense-sim (safe)', 'collector-sim', 'cleanup-summarizer'][i % 12],
      risk: /simulate|validate/i.test(name) ? 'medium' : 'low', needsApproval: /simulate|validate/i.test(name), rationale: `Supports the project objectives using only approved, in-scope targets.`,
    }))
    const id = 'PL-' + String(++d.counters.plan).padStart(3, '0')
    const plan: Plan = {
      id, projectId: p.id, title: `${pb.name} plan`, version: prev ? prev.version + 1 : 1, status: 'proposed', author: 'AI Operator', requestedBy: me.name, reviewer: d.projects.find((x) => x.id === p.id)?.members.find((m) => m.role === 'reviewer')?.user || 'Pat Kim',
      created: stamp(), updated: stamp(), playbookId: pb.id, assets: inScope.map((a) => a.id), agents: ags.map((a) => a.id), steps,
      rationale: `Runs the approved “${pb.name}” playbook (${names.length} steps) against ${inScope.length} in-scope assets using ${ags.length} healthy project agents. This is a proposal only; nothing runs until a reviewer approves it.`,
      risks: steps.filter((s) => s.needsApproval).length ? [`${steps.filter((s) => s.needsApproval).length} steps simulate sensitive behavior and need explicit approval.`] : ['No elevated risks identified.'],
      roeVersion: p.roeVersion, prevPlanId: prev?.id, conversationId: convId,
    }
    d.plans.unshift(plan)
    return plan
  }

  const aiRespond = (convId: string, text: string) => {
    const d0 = dbRef.current
    const conv = d0.conversations.find((c) => c.id === convId)!
    const p = d0.projects.find((x) => x.id === conv.projectId)!
    const t = text.toLowerCase()
    const outAsset = d0.assets.find((a) => a.projectId === p.id && a.scope === 'out' && t.includes(a.name.toLowerCase()))
    const otherProj = d0.projects.find((x) => x.id !== p.id && (t.includes(x.id.toLowerCase()) || t.includes(x.client.split(' ')[0].toLowerCase()) && x.client !== p.client))
    const otherAsset = d0.assets.find((a) => a.projectId !== p.id && a.projectId && t.includes(a.name.toLowerCase()))
    const wantsPlan = /plan|run|discover|scan|assess|map|validate|test|enumerat|check|propose|draft/.test(t)
    const wantsExec = /execute|start|launch|go ahead/.test(t)
    mutate((d) => {
      const c = d.conversations.find((x) => x.id === convId)!
      const add = (m: Omit<Conversation['messages'][number], 'id' | 'at'>) => c.messages.push({ id: 'm' + Math.random().toString(36).slice(2, 7), at: stamp(), ...m })
      c.updated = stamp()
      const blockTool = (target: string, reason: string, tool = 'service-mapper') => {
        const id = 'TL-' + String(d.toolEvents.length + 1).padStart(2, '0') + Math.random().toString(36).slice(2, 4)
        d.toolEvents.unshift({ id, conversationId: convId, projectId: p.id, tool, target, params: 'scope=services', state: 'denied', at: stamp(), reason })
        d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at: stamp(), actor: 'AI Operator', role: 'System', action: 'Blocked tool call', obj: target, projectId: p.id, result: 'Denied', reason })
        return id
      }
      if (otherProj || otherAsset) {
        add({ role: 'ai', kind: 'blocked', text: `I can only work with data from ${p.id}. Information about other projects isn’t available in this conversation. Switch projects if you have access.`, toolId: blockTool(otherAsset?.name || otherProj!.id, 'Project isolation — cross-project data requested.') })
        return
      }
      if (outAsset) {
        add({ role: 'ai', kind: 'blocked', text: `I can’t do that. ${outAsset.name} is out of scope under ${p.roeVersion}, so the tool call was blocked.`, toolId: blockTool(outAsset.name, `Out of scope — asset is excluded by ${p.roeVersion}.`) })
        return
      }
      if (c.mode === 'observe') {
        const ops = d.operations.filter((o) => o.projectId === p.id)
        const run = ops.filter((o) => o.status === 'running')
        add({ role: 'ai', text: `Observe mode — read-only. ${p.id} is ${p.status} with ${d.assets.filter((a) => a.projectId === p.id && a.scope === 'in').length} in-scope assets, ${run.length} running operation${run.length === 1 ? '' : 's'} and ${d.findings.filter((f) => f.projectId === p.id).length} findings. Switch to Propose mode if you want me to draft a plan.` })
        return
      }
      if (p.roeStatus !== 'approved') {
        add({ role: 'ai', kind: 'blocked', text: `I can draft a plan, but execution is blocked: ${p.id} has no approved ROE (${p.roeVersion} is ${p.roeStatus}). Get the ROE approved first.` })
        if (wantsPlan) { const pl = buildPlanRecord(d, p, text, convId); pl.status = 'draft'; pl.risks = ['ROE is not approved — this plan cannot be approved or executed.']; add({ role: 'ai', kind: 'plan', planId: pl.id, text: `Drafted ${pl.id}. It stays in Draft until the ROE is approved.` }) }
        return
      }
      if (wantsExec && c.mode !== 'execution') {
        add({ role: 'ai', text: 'Execution needs Approved Execution mode and an approved plan. Switch modes, then ask me to execute the approved plan.' })
        return
      }
      if (wantsExec) {
        const ap = d.plans.find((x) => x.projectId === p.id && x.status === 'approved' && !x.opId)
        add({ role: 'ai', text: ap ? `Plan ${ap.id} v${ap.version} is approved. Open it to create the operation and run preflight; I will not start anything without your confirmation.` : 'There is no approved plan waiting to run. Ask me to propose a plan and send it for approval first.', kind: ap ? 'plan' : undefined, planId: ap?.id })
        return
      }
      if (wantsPlan) {
        const pl = buildPlanRecord(d, p, text, convId)
        add({ role: 'ai', kind: 'plan', planId: pl.id, text: `I proposed plan ${pl.id} using the approved “${d.playbooks.find((x) => x.id === pl.playbookId)!.name}” playbook (${pl.steps.length} steps, ${pl.assets.length} in-scope assets). This is a proposal only; nothing has run.` })
        return
      }
      add({ role: 'ai', text: `I can answer questions about ${p.id} or draft a plan from approved playbooks. Try “Plan an internal discovery run for the in-scope hosts.”` })
    })
  }

  /* ───────── Actions ───────── */
  const A: Actions = {
    audit, notify,
    markNoticesRead: () => mutate((d) => d.notices.forEach((n) => (n.read = true))),

    createProject: (dr, submit) => {
      const id = dr.id
      const hasScope = dr.assets.some((a) => a.scope === 'in') && !!dr.emergency && !!dr.window
      const status = submit && hasScope ? 'pending' : 'draft'
      mutate((d) => {
        d.projects.unshift({
          id, name: dr.name, client: dr.client, owner: dr.owner, type: dr.type, status, start: dr.start, end: dr.end, tz: dr.tz, desc: dr.desc, pinned: false,
          roeStatus: status === 'pending' ? 'pending' : 'draft', roeVersion: `ROE-${id.slice(-3)}-v1`, window: dr.window, emergency: dr.emergency,
          methods: ['Service discovery', 'Approved TTP simulation'], restrictions: dr.limits,
          objectives: dr.objectives.filter((o) => o.text).map((o, i) => ({ id: 'o' + (i + 1), text: o.text, criteria: o.criteria, owner: dr.owner, progress: 0 })),
          members: [{ user: dr.owner, role: 'manager', since: today() }, ...dr.members.filter((m) => m.user !== dr.owner).map((m) => ({ ...m, since: today() }))],
          updated: stamp(),
        })
        dr.assets.forEach((a, i) => d.assets.push({ id: `AS-${id.slice(-3)}${i + 1}`, name: a.name, ident: a.ident, ip: '203.0.113.' + (100 + i), type: a.type, os: '—', owner: dr.client, projectId: id, scope: a.scope === 'out' ? 'out' : 'pending', source: 'Manual', updated: stamp() }))
        if (status === 'pending') d.approvals.unshift({ id: 'APR-' + ++d.counters.approval, projectId: id, type: APR.create, by: dr.owner, reviewer: dr.approver, at: stamp(), status: 'pending', note: 'Requesting approval of ROE v1.', diff: `New ROE: ${dr.window}; ${dr.assets.filter((a) => a.scope === 'in').length} assets in scope.` })
      })
      audit(status === 'pending' ? 'Created project and submitted for approval' : 'Created draft project', id, id)
      if (status === 'pending') notify(`${id} is waiting for your ROE approval`, id, { name: 'project', id }, 'todo', 'approvals')
      setPidRaw(id)
      return id
    },
    submitApproval: (projectId, type, note, diff) => {
      mutate((d) => {
        const p = d.projects.find((x) => x.id === projectId)!
        if (type === APR.create) { p.status = 'pending'; p.roeStatus = 'pending' }
        d.approvals.unshift({ id: 'APR-' + ++d.counters.approval, projectId, type, by: me.name, reviewer: 'Pat Kim', at: stamp(), status: 'pending', note, diff })
      })
      audit('Submitted for approval: ' + type, projectId, projectId)
      notify(`${projectId} is waiting for your approval (${type})`, projectId, { name: 'project', id: projectId }, 'todo', 'approvals')
    },
    withdrawApproval: (id) => mutate((d) => { const a = d.approvals.find((x) => x.id === id)!; a.status = 'withdrawn' }),
    decideApproval: (id, decision, note) => {
      const a = dbRef.current.approvals.find((x) => x.id === id)!
      const p = dbRef.current.projects.find((x) => x.id === a.projectId)!
      if (decision === 'approved' && a.type !== APR.close && !a.type.startsWith('Agent assignment')) {
        if (!p.emergency) return { ok: false, error: 'Cannot approve: the ROE has no emergency contact. Return it for changes with a reason.' }
        const inScope = dbRef.current.assets.some((x) => x.projectId === p.id && ['in', 'pending'].includes(x.scope))
        if (!inScope) return { ok: false, error: 'Cannot approve: the project has no in-scope assets. Return it for changes.' }
      }
      mutate((d) => {
        const ap = d.approvals.find((x) => x.id === id)!
        const pr = d.projects.find((x) => x.id === ap.projectId)!
        ap.status = decision; ap.note = note || ap.note
        if (decision === 'approved') {
          if (ap.type === APR.create) { pr.status = 'approved'; pr.roeStatus = 'approved' }
          if (ap.type === APR.scope) { pr.roeStatus = 'approved'; d.assets.forEach((x) => { if (x.projectId === pr.id && x.scope === 'pending') x.scope = 'in' }) }
          if (ap.type === APR.create) d.assets.forEach((x) => { if (x.projectId === pr.id && x.scope === 'pending') x.scope = 'in' })
          if (ap.type === APR.close) { pr.status = 'closed'; pr.closedAt = stamp() }
          if (ap.type.startsWith('Agent assignment')) { const ag = d.agents.find((x) => x.id === /AG-\d+/.exec(ap.diff || '')?.[0]); if (ag && !ag.projectId) ag.projectId = ap.projectId }
        } else {
          if (ap.type === APR.create) { pr.status = 'rejected'; pr.roeStatus = 'rejected' }
          if (ap.type === APR.scope) pr.roeStatus = 'rejected'
          if (ap.type === APR.close) pr.status = pr.status === 'review' ? 'active' : pr.status
        }
        pr.updated = stamp()
      })
      audit(`${decision === 'approved' ? 'Approved' : 'Returned'}: ${a.type}`, a.projectId, a.projectId, 'Success', note)
      notify(`${a.type} for ${a.projectId} was ${decision === 'approved' ? 'approved' : 'returned'}`, a.projectId, { name: 'project', id: a.projectId }, 'update', 'approvals')
      return { ok: true }
    },
    editScope: (projectId, patch, reason) => {
      const p = dbRef.current.projects.find((x) => x.id === projectId)!
      const needRe = ['approved', 'active'].includes(p.status) && p.roeStatus === 'approved'
      mutate((d) => {
        const pr = d.projects.find((x) => x.id === projectId)!
        Object.assign(pr, patch); pr.updated = stamp()
        if (needRe) {
          pr.roeVersion = bumpRoe(pr.roeVersion)
          pr.roeStatus = 'pending'
          d.approvals.unshift({ id: 'APR-' + ++d.counters.approval, projectId, type: APR.scope, by: me.name, reviewer: 'Pat Kim', at: stamp(), status: 'pending', note: reason || 'Scope / ROE edit', diff: `New version ${pr.roeVersion}` })
          // V3 E2E-08: scope change invalidates approved plans and ready operations (re-validation required)
          d.plans.forEach((pl) => { if (pl.projectId === projectId && pl.status === 'approved') { pl.status = 'expired'; pl.risks = [...pl.risks, `Re-validation required: scope changed (${pr.roeVersion} draft). Re-approve under the new ROE.`] } })
          d.operations.forEach((o) => { if (o.projectId === projectId && o.status === 'ready') { o.status = 'draft'; o.preflightAt = undefined } })
        }
      })
      if (needRe) {
        const cur = dbRef.current
        const nPl = cur.plans.filter((x) => x.projectId === projectId && x.status === 'expired').length
        audit('Approved plans and ready operations invalidated by scope change', projectId, projectId, 'Success', `${nPl} plan(s) need re-approval; ready operations returned to Draft`)
        notify(`Scope change on ${projectId}: approved plans and ready operations need re-validation`, projectId, { name: 'project', id: projectId }, 'update')
      }
      audit(needRe ? 'Edited approved scope' : 'Updated scope', projectId, projectId, 'Success', reason || '')
    },
    updateProject: (projectId, patch) => mutate((d) => { const p = d.projects.find((x) => x.id === projectId)!; Object.assign(p, patch); p.updated = stamp() }),
    addAssets: (projectId, list) => {
      const p = dbRef.current.projects.find((x) => x.id === projectId)!
      const hasOps = dbRef.current.operations.some((o) => o.projectId === projectId && o.status !== 'draft')
      const needsApproval = p.status === 'active' || (hasOps && p.roeStatus === 'approved')
      const initial = ['approved'].includes(p.status) && !hasOps
      mutate((d) => {
        list.forEach((a, i) => {
          const scope: Asset['scope'] = a.scope === 'out' ? 'out' : p.status === 'draft' || p.status === 'pending' || p.status === 'rejected' ? 'pending' : 'pending'
          d.assets.push({ id: `AS-${projectId.slice(-3)}${d.assets.filter((x) => x.projectId === projectId).length + i + 1}${Math.floor(Math.random() * 9)}`, name: a.name, ident: a.ident, ip: a.ip || '203.0.113.' + (120 + i), type: a.type, os: a.os, owner: a.owner, projectId, scope, source: a.source, updated: stamp() })
        })
        if (needsApproval && list.some((a) => a.scope === 'in')) {
          const pr = d.projects.find((x) => x.id === projectId)!
          pr.roeVersion = bumpRoe(pr.roeVersion); pr.roeStatus = 'pending'
          d.plans.forEach((pl) => { if (pl.projectId === projectId && pl.status === 'approved') { pl.status = 'expired'; pl.risks = [...pl.risks, `Re-validation required: scope changed (${pr.roeVersion} draft).`] } })
          d.operations.forEach((o) => { if (o.projectId === projectId && o.status === 'ready') { o.status = 'draft'; o.preflightAt = undefined } })
          d.approvals.unshift({ id: 'APR-' + ++d.counters.approval, projectId, type: APR.scope, by: me.name, reviewer: 'Pat Kim', at: stamp(), status: 'pending', note: `Adding ${list.length} assets to scope.`, diff: `${list.map((a) => a.name).join(', ')} → in scope (${pr.roeVersion})` })
        }
      })
      audit('Added assets', list.map((a) => a.name).join(', '), projectId)
      return { needsApproval: needsApproval && list.some((a) => a.scope === 'in') }
    },
    setAssetScope: (assetId, scope) => { mutate((d) => { const a = d.assets.find((x) => x.id === assetId)!; a.scope = scope; a.updated = stamp() }); audit('Changed asset scope status', assetId, dbRef.current.assets.find((x) => x.id === assetId)!.projectId) },
    assignAgent: (agentId, projectId) => { mutate((d) => { const a = d.agents.find((x) => x.id === agentId)!; a.projectId = projectId }); audit('Assigned agent to project', agentId, projectId) },
    setAgentStatus: (agentId, s) => { mutate((d) => { d.agents.find((x) => x.id === agentId)!.status = s }); audit(s === 'disabled' ? 'Disabled agent' : 'Enabled agent', agentId, dbRef.current.agents.find((x) => x.id === agentId)!.projectId) },
    saveGroup: (g) => {
      const id = g.id || 'GR-' + pad(dbRef.current.groups.length + 1)
      mutate((d) => {
        const ex = d.groups.find((x) => x.id === id)
        if (ex) Object.assign(ex, g, { updated: today() })
        else d.groups.push({ id, name: g.name, projectId: g.projectId, desc: g.desc || '', agents: g.agents || [], owner: g.owner || me.name, policy: g.policy || 'Project use only', updated: today() })
        ;(g.agents || []).forEach((aid) => { const a = d.agents.find((x) => x.id === aid); if (a) { a.group = g.name; if (!a.projectId) a.projectId = g.projectId } })
      })
      audit(g.id ? 'Updated agent group' : 'Created agent group', id, g.projectId)
      return id
    },
    removeFromGroup: (groupId, agentId) => { mutate((d) => { const g = d.groups.find((x) => x.id === groupId)!; g.agents = g.agents.filter((x) => x !== agentId); const a = d.agents.find((x) => x.id === agentId); if (a) a.group = '' }); audit('Removed agent from group', agentId, dbRef.current.groups.find((x) => x.id === groupId)!.projectId) },

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
      const op = dbRef.current.operations.find((o) => o.id === opId)!
      const ok = preflightPass(computePreflight(dbRef.current, op))
      mutate((d) => { const o = d.operations.find((x) => x.id === opId)!; o.preflightAt = stamp(); o.status = ok ? 'ready' : 'draft' })
      audit('Ran preflight', opId, op.projectId, ok ? 'Passed' : 'Failed')
    },
    startOp: (opId) => {
      const op = dbRef.current.operations.find((o) => o.id === opId)!
      if (!preflightPass(computePreflight(dbRef.current, op))) return
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
    emergencyStop: (scope, id, reason) => {
      const inScope = (o: { projectId: string; id: string }) => scope === 'workspace' || (scope === 'project' ? o.projectId === id : o.id === id)
      const affected = dbRef.current.operations.filter((o) => inScope(o) && ['running', 'paused'].includes(o.status))
      const affectedP = scope === 'operation' ? affected[0]?.projectId || '' : scope === 'project' ? id : ''
      mutate((d) => { d.stopState = { scope, id, phase: 'requested', reason, at: stamp(), by: me.name } })
      affected.forEach((o) => pushLog(o.id, { level: 'ERROR', agent: '—', stepId: '—', text: `EMERGENCY STOP requested by ${me.name}: ${reason} — waiting for agent acknowledgement` }))
      audit('Emergency stop requested', scope === 'workspace' ? 'Workspace' : id, affectedP, 'Pending', reason)
      notify(`Emergency stop requested (${scope}) by ${me.name} — awaiting acknowledgement`, affectedP, { name: 'settings', id: undefined }, 'update', 'system')
      const applyStop = () => mutate((d) => {
        d.operations.forEach((o) => {
          if (inScope(o) && ['running', 'paused'].includes(o.status)) { o.status = 'estop'; o.stopReason = reason; o.stopBy = me.name; o.stopAt = stamp(); o.steps.forEach((s) => { if (s.status === 'running') s.status = 'unknown'; if (s.status === 'pending' || s.status === 'review') s.status = 'notrun' }) }
        })
        d.sessions.forEach((s) => {
          const o = d.operations.find((x) => x.id === s.opId)
          if ((scope === 'workspace' || (scope === 'project' && s.projectId === id) || (scope === 'operation' && s.opId === id)) && o && ['connected', 'available', 'suspended', 'awaiting'].includes(s.state)) { s.state = 'revoking'; s.transcript.push({ ts: hhmm() + ':00', who: 'system', text: 'Emergency stop: session access is being revoked.' }) }
        })
      })
      const outcome = stopOutRef.current
      setTimeout(() => {
        if (outcome === 'fail') { mutate((d) => { if (d.stopState) d.stopState.phase = 'failed' }); audit('Emergency stop failed', id, affectedP, 'Failed', 'No acknowledgement — agents did not confirm halt'); return }
        if (outcome === 'unknown') { mutate((d) => { if (d.stopState) d.stopState.phase = 'unknown' }); audit('Emergency stop status unknown', id, affectedP, 'Unknown', 'Acknowledgement timed out'); return }
        applyStop()
        mutate((d) => { if (d.stopState) d.stopState.phase = 'acknowledged' })
        audit('Emergency stop acknowledged', id, affectedP, 'Success', 'Agents confirmed halt')
        setTimeout(() => {
          mutate((d) => {
            d.sessions.forEach((s) => { if (s.state === 'revoking') s.state = 'terminated' })
            d.operations.forEach((o) => { if (o.status === 'estop') o.agents.forEach((aid) => { const a = d.agents.find((x) => x.id === aid); if (a && a.op === o.id) a.op = null }) })
            if (d.stopState) d.stopState.phase = 'stopped'
          })
        }, 2000)
      }, 1800)
    },
    retryStop: () => { const s = dbRef.current.stopState; if (!s) return; setStopOutcome('ack'); stopOutRef.current = 'ack'; A.emergencyStop(s.scope, s.id, s.reason + ' (retry)') },
    resolveStop: (outcome) => {
      const s = dbRef.current.stopState
      if (outcome === 'dismiss') { mutate((d) => { d.stopState = null as any }); return }
      if (!s) return
      audit('Emergency stop confirmed manually', s.id, '', 'Success', 'Operator verified agents halted out-of-band')
      mutate((d) => { if (d.stopState) d.stopState.phase = 'stopped' })
    },
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
    exportReport: (id, format) => {
      const r = dbRef.current.reports.find((x) => x.id === id)!
      mutate((d) => {
        const x = d.reports.find((y) => y.id === id)!
        if (x.status === 'approved') x.status = 'exported'
        d.exportsList.unshift({ id: 'EX-' + (91 + d.exportsList.length), reportId: id, version: x.version, format, by: me.name, at: stamp(), recipient: '—', status: 'Completed', checksum: 'sha256:' + Math.random().toString(16).slice(2, 6) + '…' + Math.random().toString(16).slice(2, 6) })
      })
      audit(`Exported report (${format})`, id, r.projectId)
    },
    deliverReport: (id, recipient) => {
      const r = dbRef.current.reports.find((x) => x.id === id)!
      if (!dbRef.current.exportsList.some((e) => e.reportId === id && e.version === r.version)) return { ok: false, error: 'Cannot deliver: no valid export exists for this version. Export PDF/DOCX first.' }
      if (!['approved', 'exported'].includes(r.status)) return { ok: false, error: 'Cannot deliver: the report has not been approved.' }
      mutate((d) => { const x = d.reports.find((y) => y.id === id)!; x.status = 'delivered'; x.deliveredAt = stamp(); x.updated = stamp(); d.exportsList.filter((e) => e.reportId === id && e.version === x.version).forEach((e) => { e.recipient = recipient; e.status = 'Delivered' }) })
      audit('Marked as delivered', id, r.projectId, 'Success', recipient)
      return { ok: true }
    },
    requestClose: (pid_) => { mutate((d) => { d.approvals.unshift({ id: 'APR-' + ++d.counters.approval, projectId: pid_, type: APR.close, by: me.name, reviewer: 'Pat Kim', at: stamp(), status: 'pending', note: 'Requesting project closure — checklist complete.' }); const p = d.projects.find((x) => x.id === pid_)!; p.status = 'review' }); audit('Requested project closure', pid_, pid_); notify(`${pid_} requested closure — awaiting confirmation`, pid_, { name: 'project', id: pid_ }, 'todo', 'approvals') },
    confirmClose: (apId) => { const ap = dbRef.current.approvals.find((x) => x.id === apId)!; mutate((d) => { const a = d.approvals.find((x) => x.id === apId)!; a.status = 'approved'; const p = d.projects.find((x) => x.id === a.projectId)!; p.status = 'closed'; p.closedAt = stamp(); p.updated = stamp() }); audit('Confirmed project closure', ap.projectId, ap.projectId, 'Success', 'Closure criteria met') },
    reopen: (pid_, reason) => { mutate((d) => { const p = d.projects.find((x) => x.id === pid_)!; p.status = 'active'; p.closedAt = undefined; p.updated = stamp() }); audit('Reopened project', pid_, pid_, 'Success', reason) },
    toggleIntegration: (id) => mutate((d) => { const i = d.integrations.find((x) => x.id === id)!; i.status = i.status === 'connected' ? 'disconnected' : 'connected'; i.updated = stamp(); i.history.unshift(`${stamp()} — ${i.status === 'connected' ? 'Connected' : 'Disconnected'} by ${me.name}`) }),
    decidePlaybookRevision: (id, decision) => mutate((d) => { const p = d.playbooks.find((x) => x.id === id); if (!p || !p.revision) return; if (decision === 'approve') { p.version = p.revision.version; p.steps = p.revision.steps; p.techniques = p.revision.techniques; p.status = 'approved' } p.revision = undefined; p.updated = stamp() }),
    setPlaybookStatus: (id, status) => mutate((d) => { const p = d.playbooks.find((x) => x.id === id); if (p) { p.status = status; p.updated = stamp() } }),
    togglePolicy: (id) => { mutate((d) => { const p = d.policies.find((x) => x.id === id)!; p.enabled = !p.enabled; p.updated = today() }); audit('Changed policy', id, '') },

    /* ── AI Operator ── */
    createConversation: (projectId, mode = aiMode) => {
      const id = 'CV-' + projectId.slice(-3) + '-' + String(dbRef.current.conversations.filter((c) => c.projectId === projectId).length + 1).padStart(2, '0')
      mutate((d) => { d.conversations.unshift({ id, projectId, title: 'New conversation', mode, owner: me.name, updated: stamp(), messages: [] }) })
      return id
    },
    setConversationMode: (convId, mode) => { mutate((d) => { const c = d.conversations.find((x) => x.id === convId); if (c) c.mode = mode }) },
    togglePinConv: (convId) => mutate((d) => { const c = d.conversations.find((x) => x.id === convId); if (c) c.pinned = !c.pinned }),
    sendChat: (convId, text) => {
      if (!text.trim() || aiBusy) return
      mutate((d) => {
        const c = d.conversations.find((x) => x.id === convId)!
        if (c.title === 'New conversation') c.title = text.slice(0, 48)
        c.messages.push({ id: 'u' + Math.random().toString(36).slice(2, 7), role: 'user', text, at: stamp() })
        c.updated = stamp()
      })
      setAiBusy(convId)
      const timer = window.setTimeout(() => {
        aiTimers.current.delete(convId)
        aiRespond(convId, text)
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
      mutate((d) => {
        const c = d.conversations.find((x) => x.id === convId)
        if (!c) return
        c.messages.push({ id: 's' + Math.random().toString(36).slice(2, 7), role: 'system', text: `Response generation stopped by ${me.name}.`, at: stamp() })
        c.updated = stamp()
      })
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
      setTimeout(() => mutate((d) => { const x = d.sessions.find((y) => y.id === sessionId)!; if (x.state === 'revoking') { x.state = 'terminated'; x.grants = []; x.transcript.push({ ts: hhmm() + ':00', who: 'system', text: 'Session terminated. All grants revoked.' }) } }), 2000)
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

export const sevLabel: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Informational' }
export type { PlanStatus, ToolEvent }
