/**
 * Tradecraft library read model + revision review (tickets 52–53, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local handlers for the playbook library list, playbook detail,
 * technique detail (52, reads) and the revision-review lifecycle (53,
 * writes). A revision submission preserves the approved active version and
 * only records pending-review metadata; approving is role-gated
 * (`reviewPlaybook`), author-independent and reason-mandatory, and it
 * promotes the reviewed version to the one committed active version in a
 * single atomic commit whose ChangeSet refetches the library views and the
 * legacy store. Pending revisions are never executable selections — the
 * operation wizard reads active versions only.
 *
 * Versioning read model: a playbook's committed state is the active (approved
 * or draft) version; `revision` is a pending candidate that never replaces
 * the active version until a reviewer approves it. Every read describes the
 * active version plus a separate pending-revision projection, so screens
 * distinguish "approved v2.3 in use" from "v2.4 pending review" from
 * canonical state without re-deriving it — and an unapproved revision is
 * never presented as an operation target (read-side guarantee; enforcement
 * stays with the operations features).
 *
 * Sharing scope: 'Organization' items are visible to every actor; items
 * shared with 'Project <id>' to that project's members and elevated roles;
 * team-internal items ('Team only') to elevated roles only. A denied read is
 * `not-found` with no existence leak. The technique catalog is static
 * reference data readable by every signed-in persona; its per-project
 * projections (steps, findings, detection) narrow to the request scope — a
 * specific project the actor cannot access yields an empty projection.
 */
import { can, projectAccessible } from '../../auth/policy'
import { TECHNIQUES, type Db, type Playbook } from '../../data'
import { formatDemoInstant } from '../../domain/clock'
import type { DbAuthority } from '../../domain/database'
import type { DetectState, PlaybookRevision, Severity, StepStatus } from '../../domain/entities'
import type { ActorRef, Clock, RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'

/** Which library tab the list reads: playbooks or simulated adversary profiles. */
export type PlaybookKind = 'playbook' | 'profile'

/** Filter state for the library list (all optional; empty = unfiltered). */
export interface PlaybookListQuery {
  kind?: PlaybookKind
  /** Case-insensitive substring over name + id + description + goal. */
  q?: string
  /** Tactic match: the item covers ≥1 technique of the tactic. */
  tactic?: string
  /** OS match (Windows/Linux). */
  os?: string
  /** One Playbook status value. */
  status?: string
  /** 1-based page; out-of-range values clamp to the valid range. */
  page?: number
  pageSize?: number
}

/** One library card: the active version plus its pending-revision projection. */
export interface PlaybookListItem {
  playbook: Playbook
  /** Pending candidate version, when one awaits a reviewer decision. */
  pendingRevision?: { version: string; by: string; at: string }
}

/** One technique-catalog row for the MITRE ATT&CK tab. */
export interface TechniqueListItem {
  id: string
  name: string
  tactic: string
  platforms: string[]
  /** Visible playbooks exercising the technique (scoped count). */
  usedBy: number
}

/** The whole library read: page + tab badge counts + technique catalog rows. */
export interface PlaybookListRead {
  items: PlaybookListItem[]
  page: number
  pageSize: number
  total: number
  /** Whole-library tab badge counts (never filtered by the active query). */
  counts: { playbooks: number; profiles: number; techniques: number }
  techniques: TechniqueListItem[]
  /** Per-technique detection overlay for the active project (specific scope only). */
  detection?: Record<string, DetectState>
}

export interface LibraryService {
  list(ctx: RequestContext, query?: PlaybookListQuery): Promise<ServiceResult<PlaybookListRead>>
  getPlaybook(ctx: RequestContext, id: string): Promise<ServiceResult<PlaybookDetailRead>>
  getTechnique(ctx: RequestContext, id: string): Promise<ServiceResult<TechniqueDetailRead>>
  /* Ticket 53: the revision-review queue and lifecycle writes. */
  reviewQueue(ctx: RequestContext): Promise<ServiceResult<ReviewQueueRead>>
  proposeRevision(ctx: RequestContext, id: string, input: RevisionInput): Promise<ServiceResult<Playbook>>
  submitForReview(ctx: RequestContext, id: string): Promise<ServiceResult<Playbook>>
  decideRevision(ctx: RequestContext, id: string, decision: RevisionDecision, reason: string): Promise<ServiceResult<RevisionDecisionRead>>
}

const PAGE_SIZE = 12
const MAX_PAGE_SIZE = 60
const ELEVATED: readonly string[] = ['admin', 'manager', 'reviewer']

/** Sharing rule: 'Organization' → everyone; 'Project <id>' → members + elevated; team-internal → elevated only. */
function visibleWithMembership(db: Db, p: Playbook, actor: RequestContext['actor']): boolean {
  if (ELEVATED.includes(actor.role)) return true
  if (p.share === 'Organization') return true
  if (p.share.startsWith('Project ')) {
    return projectAccessible(db.projects.find((x) => x.id === p.share.slice('Project '.length)), actor)
  }
  return false
}

/** The actor-visible slice of the library (active versions only; a pending revision is never a separate item). */
export function visiblePlaybooks(db: Db, ctx: RequestContext): Playbook[] {
  return db.playbooks.filter((p) => visibleWithMembership(db, p, ctx.actor))
}

const pendingOf = (p: Playbook): PlaybookListItem['pendingRevision'] =>
  p.revision ? { version: p.revision.version, by: p.revision.by, at: p.revision.at } : undefined

/**
 * Pure list handler. Tab badge counts always derive from the whole visible
 * base, so they stay live regardless of the active filters; `items` apply
 * kind + filters + page. The technique rows carry scoped used-by counts and
 * the active project's detection overlay (absent in aggregate scope).
 */
export function listLibrary(db: Db, ctx: RequestContext, query: PlaybookListQuery = {}): ServiceResult<PlaybookListRead> {
  const base = visiblePlaybooks(db, ctx)
  const kind = query.kind === 'profile' ? 'profile' : 'playbook'
  const tacticOf = (t: string) => TECHNIQUES.find((x) => x.id === t)?.tactic
  const q = (query.q || '').toLowerCase()
  const rows = base
    .filter((p) => p.kind === kind)
    .filter((p) => !q || (p.name + p.id + p.desc + p.goal).toLowerCase().includes(q))
    .filter((p) => !query.tactic || p.techniques.some((t) => tacticOf(t) === query.tactic))
    .filter((p) => !query.os || p.os.includes(query.os))
    .filter((p) => !query.status || p.status === query.status)
  const pageSize = Math.min(Math.max(1, query.pageSize ?? PAGE_SIZE), MAX_PAGE_SIZE)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.min(Math.max(1, query.page ?? 1), pages)
  const usedBy = (id: string) => base.filter((p) => p.techniques.includes(id)).length
  const techniques = TECHNIQUES
    .filter((t) => (!q || (t.id + t.name).toLowerCase().includes(q)) && (!query.tactic || t.tactic === query.tactic) && (!query.os || t.platforms.includes(query.os)))
    .map((t) => ({ id: t.id, name: t.name, tactic: t.tactic, platforms: t.platforms, usedBy: usedBy(t.id) }))
  const project = visibleProject(db, ctx)
  const detection = project ? db.detection[project.id] : undefined
  return {
    ok: true,
    data: {
      items: rows.slice((page - 1) * pageSize, page * pageSize).map((p) => ({ playbook: p, pendingRevision: pendingOf(p) })),
      page, pageSize, total: rows.length,
      counts: {
        playbooks: base.filter((p) => p.kind === 'playbook').length,
        profiles: base.filter((p) => p.kind === 'profile').length,
        techniques: TECHNIQUES.length,
      },
      techniques,
      detection: detection ? { ...detection } : undefined,
    },
  }
}

/** The active project when the request is specific and the actor may read it. */
function visibleProject(db: Db, ctx: RequestContext) {
  const aggregate = !ctx.projectId || ctx.projectId === 'all'
  if (aggregate) return undefined
  const project = db.projects.find((x) => x.id === ctx.projectId)
  return project && projectAccessible(project, ctx.actor) ? project : undefined
}

export interface PlaybookUsageRef { id: string; projectId: string; label: string; status: string }

/** One playbook detail read: active version, pending revision and scoped usage. */
export interface PlaybookDetailRead {
  playbook: Playbook
  /** The active version is approved — read-only under the review policy. */
  approved: boolean
  /** True when a revision or the initial version awaits a reviewer decision. */
  pending: boolean
  pendingRevision?: PlaybookRevision
  usage: { plans: PlaybookUsageRef[]; operations: PlaybookUsageRef[] }
  usedProjects: { id: string; operations: string[] }[]
  tactics: string[]
  versions: { at: string; title: string; sub: string; tone: 'ok' | 'warn' | 'neutral' }[]
  /** Attach-card compatibility for the active project (specific scope only). */
  compat?: { projectId: string; inScope: number; matching: number; winOnly: boolean }
}

/**
 * Pure detail handler. A playbook outside the actor's sharing scope is
 * `not-found` (indistinguishable from a missing one — no existence leak).
 * Usage stays accessible-project-scoped regardless of the active project,
 * matching the legacy "projects that used it" view.
 */
export function getPlaybook(db: Db, ctx: RequestContext, id: string): ServiceResult<PlaybookDetailRead> {
  const p = db.playbooks.find((x) => x.id === id)
  if (!p || !visibleWithMembership(db, p, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: `Playbook ${id} does not exist or is not available for your account.`, entity: { kind: 'playbook', id } } }
  }
  const accessible = new Set(db.projects.filter((x) => projectAccessible(x, ctx.actor)).map((x) => x.id))
  const plans = db.plans
    .filter((x) => x.playbookId === p.id && accessible.has(x.projectId))
    .map((x) => ({ id: x.id, projectId: x.projectId, label: x.ver || `v${x.version}`, status: x.status }))
  const operations = db.operations
    .filter((o) => o.playbookId === p.id && accessible.has(o.projectId))
    .map((o) => ({ id: o.id, projectId: o.projectId, label: o.name, status: o.status }))
  const usedProjects = [...new Set(operations.map((o) => o.projectId))]
    .map((pid) => ({ id: pid, operations: operations.filter((o) => o.projectId === pid).map((o) => o.id) }))
  const tacticOf = (t: string) => TECHNIQUES.find((x) => x.id === t)?.tactic
  const [maj, min] = p.version.split('.').map(Number)
  const versions = [
    { at: p.updated, title: `v${p.version}: ${p.status === 'approved' ? 'approved' : p.status === 'review' ? 'in review' : 'current draft'}`, sub: p.owner, tone: (p.status === 'approved' ? 'ok' : 'warn') as 'ok' | 'warn' },
    ...(min > 0 ? [{ at: '—', title: `v${maj}.${min - 1}: previous version`, sub: 'Archived', tone: 'neutral' as const }] : []),
  ]
  const project = visibleProject(db, ctx)
  const assets = project ? db.assets.filter((a) => a.projectId === project.id) : []
  const inScopeAssets = assets.filter((a) => a.scope === 'in')
  return {
    ok: true,
    data: {
      playbook: p,
      approved: p.status === 'approved',
      pending: !!p.revision || p.status === 'review',
      pendingRevision: p.revision,
      usage: { plans, operations },
      usedProjects,
      tactics: [...new Set(p.techniques.map(tacticOf).filter((x): x is string => !!x))],
      versions,
      compat: project
        ? { projectId: project.id, inScope: inScopeAssets.length, matching: inScopeAssets.filter((a) => p.os.includes(a.os)).length, winOnly: p.os.length === 1 }
        : undefined,
    },
  }
}

export interface TechniqueStepRef { opId: string; stepId: string; projectId: string; name: string; asset: string; status: StepStatus }

/** One technique detail read: catalog entry + scoped projections. */
export interface TechniqueDetailRead {
  id: string
  name: string
  tactic: string
  platforms: string[]
  desc: string
  playbooks: { id: string; name: string; status: Playbook['status']; pendingRevision?: { version: string; by: string; at: string } }[]
  steps: TechniqueStepRef[]
  findings: { id: string; severity: Severity }[]
  siem: { connected: boolean; name?: string }
  detection: { projectId: string; state: DetectState }[]
}

/**
 * Pure technique detail. The catalog entry itself is reference data readable
 * by every persona; its projections narrow to the request scope (accessible
 * projects in aggregate, only the active project when specific and
 * accessible — a non-member read yields an empty projection).
 */
export function getTechnique(db: Db, ctx: RequestContext, id: string): ServiceResult<TechniqueDetailRead> {
  const t = TECHNIQUES.find((x) => x.id === id)
  if (!t) {
    return { ok: false, failure: { kind: 'not-found', message: `Technique ${id} does not exist in the ATT&CK catalog.`, entity: { kind: 'technique', id } } }
  }
  const accessible = new Set(db.projects.filter((x) => projectAccessible(x, ctx.actor)).map((x) => x.id))
  const aggregate = !ctx.projectId || ctx.projectId === 'all'
  const inScope = (projectId: string) => (aggregate ? accessible.has(projectId) : projectId === ctx.projectId && accessible.has(projectId))
  const playbooks = visiblePlaybooks(db, ctx)
    .filter((p) => p.techniques.includes(t.id))
    .map((p) => ({ id: p.id, name: p.name, status: p.status, pendingRevision: pendingOf(p) }))
  const steps: TechniqueStepRef[] = db.operations
    .filter((o) => inScope(o.projectId))
    .flatMap((o) => o.steps.filter((s) => s.technique === t.id).map((s) => ({ opId: o.id, stepId: s.id, projectId: o.projectId, name: s.name, asset: s.asset, status: s.status })))
  const findings = db.findings
    .filter((f) => f.technique === t.id && inScope(f.projectId))
    .map((f) => ({ id: f.id, severity: f.severity }))
  const siem = db.integrations.find((i) => i.kind === 'SIEM')
  const detProjects = aggregate ? [...accessible] : visibleProject(db, ctx) ? [ctx.projectId] : []
  const detection = detProjects.map((projectId) => ({ projectId, state: db.detection[projectId]?.[t.id] || ('nodata' as DetectState) }))
  return {
    ok: true,
    data: {
      id: t.id, name: t.name, tactic: t.tactic, platforms: t.platforms, desc: t.desc,
      playbooks, steps, findings,
      siem: { connected: siem?.status === 'connected', name: siem?.name },
      detection,
    },
  }
}

/* ═════════════ Revision review (ticket 53) ═════════════ */

const ROLE_TEXT: Record<string, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }

/**
 * Review policy: deciding a revision (or an initial-version review) needs
 * the shared `approve` action — Reviewers and Admins only. Named here so
 * the screen affordance and the handler gate through one policy instead of
 * a role string.
 */
export function reviewPlaybook(actor: ActorRef): boolean {
  return can(actor, 'approve')
}

const canEditPlaybook = (actor: ActorRef) => can(actor, 'editScope')

/** The author whose independence a decision must respect: the revision submitter, or the owner of a playbook in initial review. */
const reviewAuthor = (p: Playbook) => p.revision?.by || p.owner

/** Handler-computed decide gate; empty reason = this actor may decide. */
export function decideGate(p: Playbook, ctx: RequestContext): { canDecide: boolean; decideReason: string } {
  if (!reviewPlaybook(ctx.actor)) {
    return { canDecide: false, decideReason: 'Only Reviewers and Admins can approve or return playbooks.' }
  }
  if (reviewAuthor(p) === ctx.actor.id) {
    return { canDecide: false, decideReason: 'You cannot review your own revision. Ask another reviewer.' }
  }
  return { canDecide: true, decideReason: '' }
}

/** One review-queue row: what awaits a decision plus the handler-computed gate. */
export interface ReviewQueueItem {
  playbookId: string
  name: string
  kind: PlaybookKind
  /** The active version — stays approved and in use until the decision. */
  activeVersion: string
  pending: { kind: 'revision' | 'initial'; version: string; by: string; at: string; summary: string[] }
  canDecide: boolean
  decideReason: string
}

export interface ReviewQueueRead { items: ReviewQueueItem[] }

/** Pure review-queue read over the actor-visible base (sharing rule as for every library read). */
export function reviewQueue(db: Db, ctx: RequestContext): ServiceResult<ReviewQueueRead> {
  const items = visiblePlaybooks(db, ctx)
    .filter((p) => !!p.revision || p.status === 'review')
    .map((p) => {
      const pending = p.revision
        ? { kind: 'revision' as const, version: p.revision.version, by: p.revision.by, at: p.revision.at, summary: p.revision.summary }
        : { kind: 'initial' as const, version: p.version, by: p.owner, at: p.updated, summary: [] }
      const gate = decideGate(p, ctx)
      return { playbookId: p.id, name: p.name, kind: p.kind, activeVersion: p.version, pending, canDecide: gate.canDecide, decideReason: gate.decideReason }
    })
  return { ok: true, data: { items } }
}

export interface RevisionInput {
  /** New version; must be a strict maj.min bump above the active version. */
  version: string
  /** Changelog entries — at least one is required. */
  summary: string[]
  /** Revised step sequence; defaults to the active steps. */
  steps?: string[]
  /** Revised technique list; defaults to the active techniques. */
  techniques?: string[]
}

export type RevisionDecision = 'approve' | 'return'

export interface RevisionDecisionRead {
  playbookId: string
  decision: RevisionDecision
  /** Version the decision applied to. */
  version: string
  /** Active (executable) version after the decision. */
  activeVersion: string
  activated: boolean
}

const VERSION_RE = /^\d+\.\d+$/
const versionKey = (v: string) => {
  const [maj, min] = v.split('.').map(Number)
  return maj * 1000 + min
}
const versionBump = (v: string) => {
  const [maj, min] = v.split('.').map(Number)
  return `${maj}.${min + 1}`
}

const noticeId = (db: Db, clock: Clock) => `N${db.notices.length + 1}-${clock.now() % 100000}`

/** Resolves a playbook for a read or write; out of the sharing scope is `not-found` (no existence leak). */
function resolvePlaybook(db: Db, ctx: RequestContext, id: string): { ok: true; playbook: Playbook } | { ok: false; failure: ServiceFailure } {
  const p = db.playbooks.find((x) => x.id === id)
  if (!p || !visibleWithMembership(db, p, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: `Playbook ${id} does not exist or is not available for your account.`, entity: { kind: 'playbook', id } } }
  }
  return { ok: true, playbook: p }
}

/** Audit row for a review action; the id comes from the database counters inside the commit. */
const auditRow = (at: string, ctx: RequestContext, action: string, obj: string, result: string, reason: string) => ({
  at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action, obj, projectId: '', result, reason,
})

/**
 * Submits a revision proposal in one atomic commit. The approved active
 * version is untouched — only pending-review metadata (`revision`) is
 * recorded, so the version stays in use and read-only. Refusal order:
 * sharing scope → `not-found`; missing `editScope` → `forbidden`; wrong
 * state (not approved / revision already pending) → `conflict`; then the
 * field validations (strict version bump, changelog, steps, catalog
 * techniques). A refused proposal commits nothing.
 */
export function proposeRevision(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, input: RevisionInput): ServiceResult<Playbook> {
  const db = authority.snapshot()
  const r = resolvePlaybook(db, ctx, id)
  if (!r.ok) return r
  const p = r.playbook
  if (!canEditPlaybook(ctx.actor)) {
    return { ok: false, failure: { kind: 'forbidden', message: 'Only Red Team Managers and Admins can change playbooks.', entity: { kind: 'playbook', id } } }
  }
  if (p.status === 'review') {
    return { ok: false, failure: { kind: 'conflict', message: `${id} is already awaiting review — one decision at a time.`, entity: { kind: 'playbook', id } } }
  }
  if (p.status !== 'approved') {
    return { ok: false, failure: { kind: 'conflict', message: `${id} is a draft — submit it for review instead of proposing a revision.`, entity: { kind: 'playbook', id } } }
  }
  if (p.revision) {
    return { ok: false, failure: { kind: 'conflict', message: `Revision v${p.revision.version} is already pending review — one revision at a time.`, entity: { kind: 'playbook', id } } }
  }
  if (!VERSION_RE.test(input.version) || versionKey(input.version) <= versionKey(p.version)) {
    return { ok: false, failure: { kind: 'validation', message: `The revision version must be a bump above v${p.version} (for example v${versionBump(p.version)}).`, entity: { kind: 'playbook', id } } }
  }
  const summary = input.summary.map((s) => s.trim()).filter(Boolean)
  if (!summary.length) {
    return { ok: false, failure: { kind: 'validation', message: 'Add at least one changelog entry describing what changed.', entity: { kind: 'playbook', id } } }
  }
  const steps = (input.steps ?? p.steps).filter(Boolean)
  if (!steps.length) {
    return { ok: false, failure: { kind: 'validation', message: 'A revision needs at least one step.', entity: { kind: 'playbook', id } } }
  }
  const techniques = input.techniques ?? p.techniques
  for (const t of techniques) {
    if (!TECHNIQUES.some((x) => x.id === t)) {
      return { ok: false, failure: { kind: 'validation', message: `Technique ${t} is not in the ATT&CK catalog.`, entity: { kind: 'playbook', id } } }
    }
  }
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    const target = d.playbooks.find((x) => x.id === id)!
    target.revision = { version: input.version, by: ctx.actor.id, at, summary, steps: [...steps], techniques: [...techniques] }
    target.updated = at
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, ...auditRow(at, ctx, 'Submitted playbook revision', `${id} v${input.version}`, 'Pending', summary[0]) })
    d.notices.unshift({ id: noticeId(d, clock), group: 'todo', category: 'approvals', text: `Playbook ${id} v${input.version} is waiting for review`, projectId: '', at, read: false, to: { name: 'playbook-review', id } })
  })
  return { ok: true, data: authority.snapshot().playbooks.find((x) => x.id === id)! }
}

/**
 * Submits a draft playbook for its initial review (the PB-004 flow): a
 * state transition to `review`, never a version change. Refusals mirror
 * {@link proposeRevision}.
 */
export function submitForReview(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string): ServiceResult<Playbook> {
  const db = authority.snapshot()
  const r = resolvePlaybook(db, ctx, id)
  if (!r.ok) return r
  const p = r.playbook
  if (!canEditPlaybook(ctx.actor)) {
    return { ok: false, failure: { kind: 'forbidden', message: 'Only Red Team Managers and Admins can change playbooks.', entity: { kind: 'playbook', id } } }
  }
  if (p.status === 'review') {
    return { ok: false, failure: { kind: 'conflict', message: `${id} is already awaiting review.`, entity: { kind: 'playbook', id } } }
  }
  if (p.status !== 'draft') {
    return { ok: false, failure: { kind: 'conflict', message: `${id} is already approved — propose a revision instead.`, entity: { kind: 'playbook', id } } }
  }
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    const target = d.playbooks.find((x) => x.id === id)!
    target.status = 'review'
    target.updated = at
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, ...auditRow(at, ctx, 'Submitted playbook for review', `${id} v${target.version}`, 'Pending', '') })
    d.notices.unshift({ id: noticeId(d, clock), group: 'todo', category: 'approvals', text: `Playbook ${id} v${target.version} is waiting for review`, projectId: '', at, read: false, to: { name: 'playbook-review', id } })
  })
  return { ok: true, data: authority.snapshot().playbooks.find((x) => x.id === id)! }
}

/**
 * Decides a pending revision (or an initial-version review) in one atomic
 * commit. Refusal order: sharing scope → `not-found`; nothing pending →
 * `conflict`; invalid decision value → `validation`; `reviewPlaybook` role
 * or the author themself → `forbidden`; missing reason → `validation`.
 * Approval promotes the reviewed version to the one committed active
 * version (`version`/`steps`/`techniques`, status `approved`); a return
 * clears the pending candidate and never touches an approved active
 * version, recording the reviewer's note in the audit log and a notice to
 * the author. Operations already pinned to the previous version stay
 * pinned — activation changes only new selections.
 */
export function decideRevision(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, decision: RevisionDecision, reason: string): ServiceResult<RevisionDecisionRead> {
  const db = authority.snapshot()
  const r = resolvePlaybook(db, ctx, id)
  if (!r.ok) return r
  const p = r.playbook
  const rev = p.revision
  if (!rev && p.status !== 'review') {
    return { ok: false, failure: { kind: 'conflict', message: p.status === 'approved' ? `v${p.version} is approved: no pending revision to review.` : 'There is nothing pending review for this playbook.', entity: { kind: 'playbook', id } } }
  }
  if (decision !== 'approve' && decision !== 'return') {
    return { ok: false, failure: { kind: 'validation', message: 'Unknown review decision — approve or return.', entity: { kind: 'playbook', id } } }
  }
  const gate = decideGate(p, ctx)
  if (!gate.canDecide) {
    return { ok: false, failure: { kind: 'forbidden', message: gate.decideReason, entity: { kind: 'playbook', id } } }
  }
  const note = reason.trim()
  if (!note) {
    return { ok: false, failure: { kind: 'validation', message: 'A reason is required for both decisions.', entity: { kind: 'playbook', id } } }
  }
  const at = formatDemoInstant(clock.now())
  const reviewedVersion = rev?.version || p.version
  const action = decision === 'approve' ? 'Playbook approved' : 'Playbook returned to draft'
  authority.commit(ctx.corr, (d) => {
    const target = d.playbooks.find((x) => x.id === id)!
    if (rev) {
      if (decision === 'approve') {
        target.version = rev.version
        target.steps = rev.steps
        target.techniques = rev.techniques
        target.status = 'approved'
      }
      target.revision = undefined
    } else {
      target.status = decision === 'approve' ? 'approved' : 'draft'
    }
    if (decision === 'return' && target.status === 'review') target.status = 'draft'
    target.updated = at
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, ...auditRow(at, ctx, action, `${id} v${reviewedVersion}`, 'Success', note) })
    d.notices.unshift({
      id: noticeId(d, clock), group: 'update', category: 'approvals',
      text: decision === 'approve' ? `Playbook ${id} v${reviewedVersion} approved` : `Playbook ${id} v${reviewedVersion} returned to draft: ${note}`,
      projectId: '', at, read: false, to: { name: 'playbook', id },
    })
  })
  const after = authority.snapshot().playbooks.find((x) => x.id === id)!
  return { ok: true, data: { playbookId: id, decision, version: reviewedVersion, activeVersion: after.version, activated: decision === 'approve' } }
}

/** Builds the typed library service; `guard` is the factory's superseded-scope read guard.
 *  Reads observe scope cancellation; the review writes capture ctx at call time and commit once. */
export function createLibraryService(
  authority: DbAuthority,
  clock: Clock,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): LibraryService {
  return {
    list: (ctx, query) => guard(() => listLibrary(authority.snapshot(), ctx, query)),
    getPlaybook: (ctx, id) => guard(() => getPlaybook(authority.snapshot(), ctx, id)),
    getTechnique: (ctx, id) => guard(() => getTechnique(authority.snapshot(), ctx, id)),
    reviewQueue: (ctx) => guard(() => reviewQueue(authority.snapshot(), ctx)),
    proposeRevision: (ctx, id, input) => Promise.resolve(proposeRevision(authority, clock, ctx, id, input)),
    submitForReview: (ctx, id) => Promise.resolve(submitForReview(authority, clock, ctx, id)),
    decideRevision: (ctx, id, decision, reason) => Promise.resolve(decideRevision(authority, clock, ctx, id, decision, reason)),
  }
}
