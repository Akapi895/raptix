/**
 * Asset inventory read model (ticket 50, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local handlers for the asset catalog list, asset detail and the
 * scope-classification view. Scope-checked reads over the one database
 * authority: a non-member's specific-project read is denied with
 * `not-found` (no existence leak); an asset in an accessible project
 * outside the active project context is refused with `forbidden` + the
 * owning project (the screen offers an explicit switch). Relationships stay
 * scoped to the asset's own project and sensitive evidence is masked
 * without `viewSensitive`. Pure projections — import/scope mutations and
 * tags/notes stay with the legacy actions until ticket 51.
 */
import { projectAccessible, can as policyCan } from '../../auth/policy'
import { TECHNIQUES, type Db } from '../../data'
import type { DbAuthority } from '../../domain/database'
import type { Asset } from '../../domain/entities'
import type { Clock, RequestContext, ServiceResult } from '../../domain/service'
import { changeAssetScopeTransaction, importAssetsTransaction, type AssetImportOutcome, type AssetImportRow, type AssetScopeWriteInput, type AssetScopeWriteOutcome } from './writes'

/** Filter state for the catalog list (all optional; empty = unfiltered). */
export interface AssetListQuery {
  q?: string
  type?: string
  /** One Asset scope state ('in' | 'out' | 'pending' | 'unclassified'). */
  scope?: string
  owner?: string
  os?: string
  /** 1-based page; out-of-range values clamp to the valid range. */
  page?: number
  pageSize?: number
}

/** One catalog row: the canonical asset plus the aggregate-view project label. */
export interface AssetListItem {
  asset: Asset
  /** Owning project id; present only in the aggregate all-projects view. */
  projectId?: string
}

/** Whole-scope counts for the KPI pills (never filtered by the active query). */
export type AssetKpis = Record<Asset['scope'], number>

/** The whole catalog read: page + scope KPIs + filter options. */
export interface AssetListRead {
  items: AssetListItem[]
  page: number
  pageSize: number
  total: number
  kpis: AssetKpis
  owners: string[]
}

/**
 * Sections of an asset read that the source cannot supply. Real mode names them
 * explicitly instead of rendering an empty list that reads as "none".
 */
export type AssetUnmodelled = 'operations' | 'findings' | 'evidence' | 'agents' | 'approvals' | 'techniques' | 'history' | 'governance'

/** Observed attack-chain graph (real mode only): server-redacted nodes and edges, listed verbatim. */
export interface AssetObservedGraph {
  nodes: { id: string; labels: string[]; properties: Record<string, unknown> }[]
  edges: { id: string; source: string; target: string; type: string; properties: Record<string, unknown> }[]
  truncated: boolean
}

export interface AssetService {
  /** The observed graph source; the simulated store has none, so the screen says so instead of inventing one. */
  observedGraph(ctx: RequestContext): Promise<ServiceResult<AssetObservedGraph>>
  list(ctx: RequestContext, query?: AssetListQuery): Promise<ServiceResult<AssetListRead>>
  get(ctx: RequestContext, id: string): Promise<ServiceResult<AssetDetailRead>>
  scope(ctx: RequestContext): Promise<ServiceResult<AssetScopeRead>>
  /** Atomic validated import for the active project; refusals commit nothing. */
  importRows(ctx: RequestContext, rows: readonly AssetImportRow[]): Promise<ServiceResult<AssetImportOutcome>>
  /** Role-gated classification change with the audited reason. */
  changeScope(ctx: RequestContext, assetId: string, scope: Asset['scope'], input?: AssetScopeWriteInput): Promise<ServiceResult<AssetScopeWriteOutcome>>
}

const PAGE_SIZE = 10
const MAX_PAGE_SIZE = 100
const OP_TERMINAL: readonly string[] = ['done', 'cancelled']

/** The actor's accessible project ids (the shared membership rule). */
function accessibleProjects(db: Db, ctx: RequestContext): Set<string> {
  return new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
}

/** The scoped asset base: aggregate folds in accessible projects; a specific scope reads only that project. */
function scopedAssets(db: Db, ctx: RequestContext, accessible: Set<string>): Asset[] {
  const aggregate = !ctx.projectId || ctx.projectId === 'all'
  return db.assets.filter((a) => (aggregate ? accessible.has(a.projectId) : a.projectId === ctx.projectId))
}

/** Denies a specific-project read the actor holds no membership for (no existence leak). */
function denyForeignProject(db: Db, ctx: RequestContext): ServiceResult<never> | undefined {
  if (!ctx.projectId || ctx.projectId === 'all') return undefined
  const project = db.projects.find((p) => p.id === ctx.projectId)
  if (project && projectAccessible(project, ctx.actor)) return undefined
  return { ok: false, failure: { kind: 'not-found', message: 'Assets for this project are not available for your account.' } }
}

/**
 * Pure list handler. KPIs and filter options derive from the whole scoped
 * base (pills stay live regardless of filters); `items` apply filters+page.
 */
export function listAssets(db: Db, ctx: RequestContext, query: AssetListQuery = {}): ServiceResult<AssetListRead> {
  const denied = denyForeignProject(db, ctx)
  if (denied) return denied
  const aggregate = !ctx.projectId || ctx.projectId === 'all'
  const accessible = accessibleProjects(db, ctx)
  const base = scopedAssets(db, ctx, accessible)
  const kpis: AssetKpis = {
    in: base.filter((a) => a.scope === 'in').length,
    out: base.filter((a) => a.scope === 'out').length,
    pending: base.filter((a) => a.scope === 'pending').length,
    unclassified: base.filter((a) => a.scope === 'unclassified').length,
  }
  const q = (query.q || '').toLowerCase()
  const rows = base
    .filter((a) => !q || (a.name + a.ident + a.id + a.ip).toLowerCase().includes(q))
    .filter((a) => !query.type || a.type === query.type)
    .filter((a) => !query.scope || a.scope === query.scope)
    .filter((a) => !query.owner || a.owner === query.owner)
    .filter((a) => !query.os || a.os === query.os)
  const pageSize = Math.min(Math.max(1, query.pageSize ?? PAGE_SIZE), MAX_PAGE_SIZE)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.min(Math.max(1, query.page ?? 1), pages)
  return {
    ok: true,
    data: {
      items: rows.slice((page - 1) * pageSize, page * pageSize).map((asset) => ({ asset, projectId: aggregate ? asset.projectId : undefined })),
      page, pageSize, total: rows.length, kpis,
      owners: [...new Set(base.map((a) => a.owner))],
    },
  }
}

export interface AssetProjectRef {
  id: string
  name: string
  status: string
  roeVersion: string
  roeStatus: string
  window: string
}

export interface AssetOpRef { id: string; name: string; status: string; updated: string }
export interface AssetFindingRef { id: string; title: string; severity: string; status: string; technique: string }
export interface AssetEvidenceRef { id: string; name: string; kind: string; sensitive: boolean; masked: boolean }
export interface AssetAgentRef { id: string; host: string; status: string; op?: string }
export interface AssetApprovalRef { id: string; type: string; by: string; reviewer: string; at: string; status: string }
/** Technique catalog reference observed on this asset's findings (resolves to the library route). */
export interface AssetTechniqueRef { id: string; name: string; tactic: string }
export type AssetHistoryTone = 'accent' | 'neutral'
export interface AssetHistoryItem { at: string; title: string; sub: string; tone: AssetHistoryTone }

/**
 * One detail read: asset + scoped relationships + role masking + history.
 * Agents/techniques are observations (agents of the referencing operations;
 * technique catalog refs resolve to the library routes), never guarantees.
 */
export interface AssetDetailRead {
  asset: Asset
  project: AssetProjectRef
  operations: AssetOpRef[]
  findings: AssetFindingRef[]
  evidence: AssetEvidenceRef[]
  agents: AssetAgentRef[]
  approvals: AssetApprovalRef[]
  techniques: AssetTechniqueRef[]
  /** Audit trail (project-scoped) + the last-updated observation, newest first. */
  history: AssetHistoryItem[]
  canViewSensitive: boolean
  unmodelled: AssetUnmodelled[]
}

/**
 * Pure detail handler. Outside the actor's access is `not-found` (no
 * existence leak); an accessible asset outside the active project context
 * is `forbidden` with the owning project on the entity ref. Relationships
 * never cross the asset's project.
 */
export function getAsset(db: Db, ctx: RequestContext, id: string): ServiceResult<AssetDetailRead> {
  const notFound = { ok: false as const, failure: { kind: 'not-found' as const, message: `Asset ${id} does not exist or is not available for your account.`, entity: { kind: 'asset' as const, id } } }
  const a = db.assets.find((x) => x.id === id)
  if (!a) return notFound
  const project = db.projects.find((p) => p.id === a.projectId)
  if (!project || !projectAccessible(project, ctx.actor)) return notFound
  const aggregate = !ctx.projectId || ctx.projectId === 'all'
  if (!aggregate && ctx.projectId !== a.projectId) {
    return {
      ok: false,
      failure: {
        kind: 'forbidden',
        message: `Asset ${id} belongs to ${a.projectId}. Switch to that project to view it.`,
        entity: { kind: 'asset', id, projectId: a.projectId },
      },
    }
  }
  const ops = db.operations.filter((o) => o.projectId === a.projectId && o.assets.includes(a.id))
  const fs = db.findings.filter((f) => f.projectId === a.projectId && f.asset === a.name)
  const ev = db.evidence.filter((e) => fs.some((f) => f.evidence.includes(e.id)) || (!!e.opId && ops.some((o) => o.id === e.opId) && e.source.includes('/')))
  const agents = db.agents.filter((g) => ops.some((o) => o.agents.includes(g.id)))
  const apprs = db.approvals.filter((x) => x.projectId === a.projectId && ((x.diff || '').includes(a.name) || (x.diff || '').includes(a.id) || (x.type === 'Scope change' && a.scope === 'pending')))
  const canViewSensitive = policyCan(ctx.actor, 'viewSensitive', project)
  const mask = (e: (typeof ev)[number]) => e.sensitive && !canViewSensitive
  const techniques = [...new Set(fs.map((f) => f.technique).filter(Boolean))].map((tid) => {
    const t = TECHNIQUES.find((x) => x.id === tid)
    return { id: tid, name: t?.name ?? tid, tactic: t?.tactic ?? '—' }
  })
  const history: AssetHistoryItem[] = [
    ...db.audit
      .filter((x) => x.projectId === a.projectId && (x.obj.includes(a.id) || x.obj.split(', ').includes(a.name)))
      .map((x) => ({ at: x.at, title: `${x.action} — ${x.actor}`, sub: x.reason ? `Reason: ${x.reason}` : x.result, tone: 'accent' as const })),
    { at: a.updated, title: `Last updated (source: ${a.source})`, sub: `Current scope: ${a.scope}`, tone: 'neutral' as const },
  ]
  return {
    ok: true,
    data: {
      asset: a,
      project: { id: project.id, name: project.name, status: project.status, roeVersion: project.roeVersion, roeStatus: project.roeStatus, window: project.window },
      operations: ops.map((o) => ({ id: o.id, name: o.name, status: o.status, updated: o.updated })),
      findings: fs.map((f) => ({ id: f.id, title: f.title, severity: f.severity, status: f.status, technique: f.technique })),
      evidence: ev.map((e) => ({ id: e.id, name: mask(e) ? 'Redacted (sensitive)' : e.name, kind: mask(e) ? '••••' : e.kind, sensitive: e.sensitive, masked: mask(e) })),
      agents: agents.map((g) => ({ id: g.id, host: g.host, status: g.status, op: g.op || undefined })),
      approvals: apprs.map((x) => ({ id: x.id, type: x.type, by: x.by, reviewer: x.reviewer, at: x.at, status: x.status })),
      techniques, history, canViewSensitive, unmodelled: [],
    },
  }
}

/** One scope-view row: the asset plus the non-terminal operations that reference it. */
export interface AssetScopeRow {
  asset: Asset
  /** Operations whose scope would be impacted by a change to this asset. */
  impactedOps: string[]
}

/** Per-project scope context: ROE state + what a scope change would invalidate. */
export interface AssetScopeProject {
  id: string
  name: string
  status: string
  roeVersion: string
  roeStatus: string
  window: string
  /** Approved plans a scope change marks for re-validation / ready ops returned to draft. */
  plansToRevalidate: { id: string; ver: string }[]
  readyOps: string[]
  /** Running operations that keep the current approved policy. */
  runningOps: string[]
  /** Open scope-change approval for the project, when one awaits review. */
  pendingScopeApproval?: { id: string; by: string; at: string }
}

/** The whole scope-classification read: scoped rows + per-project contexts. */
export interface AssetScopeRead {
  unmodelled: AssetUnmodelled[]
  rows: AssetScopeRow[]
  /** Contexts for the scope's projects: the specific project always, accessible asset projects in aggregate. */
  projects: AssetScopeProject[]
  accessibleCount: number
}

/** Pure scope-classification read backing the scope map & review. */
export function getAssetScope(db: Db, ctx: RequestContext): ServiceResult<AssetScopeRead> {
  const denied = denyForeignProject(db, ctx)
  if (denied) return denied
  const aggregate = !ctx.projectId || ctx.projectId === 'all'
  const accessible = accessibleProjects(db, ctx)
  const rows: AssetScopeRow[] = scopedAssets(db, ctx, accessible).map((asset) => ({
    asset,
    impactedOps: db.operations.filter((o) => o.projectId === asset.projectId && o.assets.includes(asset.id) && !OP_TERMINAL.includes(o.status)).map((o) => o.id),
  }))
  const specific = aggregate ? undefined : db.projects.find((p) => p.id === ctx.projectId)
  const projectIds = new Set(rows.map((r) => r.asset.projectId))
  if (specific) projectIds.add(specific.id)
  const projects: AssetScopeProject[] = db.projects
    .filter((p) => projectIds.has(p.id) && accessible.has(p.id))
    .map((p) => {
      const apr = db.approvals.find((x) => x.projectId === p.id && x.status === 'pending' && x.type === 'Scope change')
      return {
        id: p.id, name: p.name, status: p.status, roeVersion: p.roeVersion, roeStatus: p.roeStatus, window: p.window,
        plansToRevalidate: db.plans.filter((pl) => pl.projectId === p.id && pl.status === 'approved').map((pl) => ({ id: pl.id, ver: pl.ver || `v${pl.version}` })),
        readyOps: db.operations.filter((o) => o.projectId === p.id && o.status === 'ready').map((o) => o.id),
        runningOps: db.operations.filter((o) => o.projectId === p.id && ['running', 'paused'].includes(o.status)).map((o) => o.id),
        pendingScopeApproval: apr ? { id: apr.id, by: apr.by, at: apr.at } : undefined,
      }
    })
  return { ok: true, data: { rows, projects, accessibleCount: accessible.size, unmodelled: [] } }
}

/** Builds the typed asset service; `guard` is the factory's superseded-scope read guard. */
export function createAssetService(
  authority: DbAuthority,
  clock: Clock,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): AssetService {
  return {
    list: (ctx, query) => guard(() => listAssets(authority.snapshot(), ctx, query)),
    get: (ctx, id) => guard(() => getAsset(authority.snapshot(), ctx, id)),
    scope: (ctx) => guard(() => getAssetScope(authority.snapshot(), ctx)),
    observedGraph: (ctx) => Promise.resolve({ ok: false, failure: { kind: 'unavailable', message: `The simulated store has no observed graph for ${ctx.projectId}.` } }),
    importRows: (ctx, rows) => Promise.resolve(importAssetsTransaction(authority, clock, ctx, ctx.projectId, rows)),
    changeScope: (ctx, assetId, scope, input) => Promise.resolve(changeAssetScopeTransaction(authority, clock, ctx, assetId, scope, input)),
  }
}
