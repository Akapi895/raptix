/**
 * Tradecraft library read model (ticket 52, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local handlers for the playbook library list, playbook detail and
 * technique detail. Pure reads — every tradecraft mutation stays with the
 * legacy actions until ticket 53 migrates review, and no screen mutates
 * tradecraft data through this service.
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
import { projectAccessible } from '../../auth/policy'
import { TECHNIQUES, type Db } from '../../data'
import type { DbAuthority } from '../../domain/database'
import type { DetectState, Playbook, PlaybookRevision, Severity, StepStatus } from '../../domain/entities'
import type { RequestContext, ServiceResult } from '../../domain/service'

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

/** Builds the typed library service; `guard` is the factory's superseded-scope read guard. */
export function createLibraryService(
  authority: DbAuthority,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): LibraryService {
  return {
    list: (ctx, query) => guard(() => listLibrary(authority.snapshot(), ctx, query)),
    getPlaybook: (ctx, id) => guard(() => getPlaybook(authority.snapshot(), ctx, id)),
    getTechnique: (ctx, id) => guard(() => getTechnique(authority.snapshot(), ctx, id)),
  }
}
