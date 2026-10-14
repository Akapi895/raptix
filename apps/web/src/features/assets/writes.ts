/**
 * Asset write-side handlers (ticket 51, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The manual/bulk import and every asset scope change run through typed
 * transactions over the one database authority. The import validates every
 * row BEFORE anything commits — name, type vocabulary, identifier syntax and
 * duplicates (against the project's committed assets and within the batch) —
 * so an invalid batch is refused with per-row reasons and zero changes; a
 * valid batch is ONE atomic commit through ticket 21's
 * {@link reviseScopeTransaction}, the canonical governance transaction:
 * imported assets stay `pending` until an independent approval admits them,
 * and a governed scope is invalidated at SUBMISSION (ROE bump, plan expiry,
 * ready-operation reset) — never delayed to the approval. Scope changes are
 * role-gated (`editScope`, or `approve` for the review decision) with the
 * handler's reason surfaced verbatim and the caller's reason audited; a
 * pending proposal under a governed ROE opens the scope-change request in
 * the same commit and never auto-promotes.
 */
import { APR, type Db } from '../../data'
import { can, projectAccessible, readOnlyContext } from '../../auth/policy'
import { formatDemoInstant } from '../../domain/clock'
import type { DbAuthority } from '../../domain/database'
import type { ActorRef, Clock, RequestContext, ServiceResult } from '../../domain/service'
import type { Asset } from '../../domain/entities'
import type { ConsoleServices } from '../../domain/service-factory'
import { reviseScopeTransaction, type ScopeAssetInput } from '../approvals/service'

/** Audit display labels for the actor's role (kept local to avoid a store cycle). */
const ROLE_LABEL: Record<string, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }
/** The demo dataset's independent reviewer; seeded approvals and notices name her. */
const REVIEWER = 'Pat Kim'

const SCOPE_LABEL: Record<Asset['scope'], string> = { in: 'in scope', out: 'out of scope', pending: 'pending approval', unclassified: 'unclassified' }
const stampOf = (clock: Clock) => formatDemoInstant(clock.now())
const projectRef = (id: string) => ({ kind: 'project' as const, id, projectId: id })

/* ───────────── Row validation (one authority for the preview and the transaction) ───────────── */

/** The asset types the import accepts (the catalog's type vocabulary). */
export const ASSET_TYPES = ['Host', 'IP', 'URL', 'Application', 'Subnet']

const hostRe = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i
const ipRe = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
/** Returns true when every octet of the dotted quad is a valid 0–255 value. */
export const okIp = (s: string) => { const m = ipRe.exec(s); return !!m && m.slice(1).every((x) => +x <= 255) }

/** Returns an error string, or '' when the identifier is valid for the type. */
export function validateIdent(type: string, ident: string): string {
  const v = ident.trim()
  if (!v) return 'Enter an identifier (IP, hostname or URL).'
  if (type === 'IP') return okIp(v) ? '' : 'Invalid IP address (example: 192.0.2.15).'
  if (type === 'Subnet') { const [ip, bits] = v.split('/'); return (bits !== undefined && okIp(ip) && +bits >= 0 && +bits <= 32) || (bits === undefined && hostRe.test(v)) ? '' : 'Subnet must be CIDR (198.51.100.0/24) or a lab zone name.' }
  if (type === 'URL') return /^(https?:\/\/)?[a-z0-9.-]+(:\d+)?(\/\S*)?$/i.test(v) ? '' : 'Invalid URL (example: https://app.example.test).'
  return hostRe.test(v) || okIp(v) ? '' : 'Hostname may only contain letters, digits, dots and hyphens.'
}

/** One import row: ticket 21's scope-asset input (added assets stay pending until approval). */
export type AssetImportRow = ScopeAssetInput

/** One row the import refuses, with the exact reasons (reported, never hidden). */
export interface AssetRowIssue { index: number; name: string; duplicate: boolean; reasons: string[] }

/**
 * Validates every row against the project's committed assets AND the batch
 * itself. Pure, so the import preview and the transaction report the same
 * reasons from one authority; duplicate detection only fires on rows that
 * are otherwise valid (matching the preview's keep/duplicate columns). The
 * type vocabulary is open — the catalog hosts types beyond the standard
 * select options (Database, Web server, …) — so only an empty type is a
 * row error.
 */
export function validateAssetRows(db: Db, projectId: string, rows: readonly AssetImportRow[]): AssetRowIssue[] {
  const existing = new Set(db.assets.filter((a) => a.projectId === projectId).map((a) => a.ident.trim().toLowerCase()))
  const seen = new Set<string>()
  const issues: AssetRowIssue[] = []
  rows.forEach((r, index) => {
    const name = r.name.trim()
    const ident = r.ident.trim()
    const type = r.type.trim()
    const reasons: string[] = []
    if (!name) reasons.push('missing name')
    if (!type) reasons.push('missing type')
    else { const e = validateIdent(type, ident); if (e) reasons.push(e) }
    const key = ident.toLowerCase()
    const duplicate = !!key && !reasons.length && (existing.has(key) || seen.has(key))
    if (key) seen.add(key)
    if (duplicate) reasons.push(existing.has(key) ? 'identifier already exists in this project' : 'duplicate identifier within this import')
    if (reasons.length) issues.push({ index, name: name || `row ${index + 1}`, duplicate, reasons })
  })
  return issues
}

/* ───────────── Import (atomic; consumes 21's governance transaction) ───────────── */

export interface AssetImportOutcome {
  /** Number of rows committed (all rows — refusals commit zero). */
  added: number
  /** True when the governance transaction invalidated the approved scope at submission. */
  invalidated: boolean
  /** ROE version after the revision (bumped when invalidated). */
  roeVersion: string
  /** Approved plans expired by the submission (Re-validation Required). */
  plansExpired: string[]
  /** Ready operations reset to Draft with preflight cleared. */
  operationsReset: string[]
  /** True when an independent scope approval is now required before targeting. */
  needsApproval: boolean
}

/**
 * The atomic import: all-or-nothing. Every row is validated first — one
 * invalid/duplicate row refuses the WHOLE batch with per-row reasons and
 * leaves the dataset byte-identical — then the valid batch commits through
 * {@link reviseScopeTransaction} in one ChangeSet: assets land `pending`
 * (or `out`), and a governed scope invalidates at submission.
 */
export function importAssetsTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, projectId: string, rows: readonly AssetImportRow[]): ServiceResult<AssetImportOutcome> {
  const db = authority.snapshot()
  const project = db.projects.find((x) => x.id === projectId)
  if (!project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: 'This project does not exist or is not available for your account.', entity: projectRef(projectId) } }
  }
  if (readOnlyContext(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'forbidden', message: ctx.actor.role === 'viewer' ? 'The Viewer role has read-only access.' : `Project ${projectId} is closed or cancelled — scope is read-only.`, entity: projectRef(projectId) } }
  }
  if (!can(ctx.actor, 'editScope', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_LABEL[ctx.actor.role]}) cannot add assets. Only a Red Team Manager or Organization Admin can.`, entity: projectRef(projectId) } }
  }
  if (!rows.length) {
    return { ok: false, failure: { kind: 'validation', message: 'No rows were selected to import.', entity: projectRef(projectId) } }
  }
  const issues = validateAssetRows(db, projectId, rows)
  if (issues.length) {
    const listed = issues.slice(0, 3).map((i) => `${i.name}: ${i.reasons.join('; ')}`).join(' · ')
    return { ok: false, failure: { kind: 'validation', message: `${issues.length} of ${rows.length} rows cannot be imported (${listed}${issues.length > 3 ? ' · …' : ''}). Nothing was committed.`, entity: projectRef(projectId) } }
  }
  const revised = reviseScopeTransaction(authority, clock, ctx, projectId, {
    assets: [...rows],
    note: `Importing ${rows.length} ${rows.length === 1 ? 'asset' : 'assets'} (${rows[0].source}) as pending scope.`,
    diff: rows.map((a) => `${a.name} → ${a.scope === 'out' ? 'out of scope' : 'pending scope'}`).join(', '),
  })
  if (!revised.ok) return revised
  const o = revised.data
  return { ok: true, data: { added: rows.length, invalidated: o.invalidated, roeVersion: o.roeVersion, plansExpired: o.plansExpired, operationsReset: o.operationsReset, needsApproval: o.invalidated } }
}

/* ───────────── Scope change (role-gated with reasons; pending never auto-promotes) ───────────── */

export interface AssetScopeWriteInput {
  /** Audited reason (required by the screens' confirm dialogs for gated changes). */
  reason?: string
  /** Audit action label (defaults to 'Changed asset scope status'). */
  action?: string
  /** Approval-request note for a pending proposal (defaults to the reason). */
  note?: string
}

export interface AssetScopeWriteOutcome {
  assetId: string
  projectId: string
  scope: Asset['scope']
  /** Approval id when the proposal opened a scope-change review in this commit. */
  reviewRequested?: string
}

/**
 * One asset scope change: resolves the asset (a foreign asset is `not-found`,
 * no existence leak), refuses an accessible asset outside the active project
 * context, enforces the read-only context and the role gate, and commits the
 * flip + audit in one ChangeSet. A `pending` proposal under a governed ROE
 * opens the scope-change request in the SAME commit when none is open and
 * the ROE essentials hold; the asset stays pending until an independent
 * approval admits it.
 */
export function changeAssetScopeTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, assetId: string, scope: Asset['scope'], input: AssetScopeWriteInput = {}): ServiceResult<AssetScopeWriteOutcome> {
  const db = authority.snapshot()
  const asset = db.assets.find((x) => x.id === assetId)
  const project = asset && db.projects.find((x) => x.id === asset.projectId)
  if (!asset || !project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: `Asset ${assetId} does not exist or is not available for your account.`, entity: { kind: 'asset', id: assetId } } }
  }
  if (ctx.projectId && ctx.projectId !== 'all' && ctx.projectId !== asset.projectId) {
    return { ok: false, failure: { kind: 'forbidden', message: `Asset ${assetId} belongs to ${asset.projectId}. Switch to that project to change it.`, entity: { kind: 'asset', id: assetId, projectId: asset.projectId } } }
  }
  if (readOnlyContext(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'forbidden', message: ctx.actor.role === 'viewer' ? 'The Viewer role has read-only access.' : `Project ${project.id} is closed or cancelled — scope is read-only.`, entity: { kind: 'asset', id: assetId, projectId: asset.projectId } } }
  }
  if (!can(ctx.actor, 'editScope', project) && !can(ctx.actor, 'approve', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_LABEL[ctx.actor.role]}) cannot change asset scope. Only a Red Team Manager, Reviewer or Organization Admin can.`, entity: { kind: 'asset', id: assetId, projectId: asset.projectId } } }
  }
  if (asset.scope === scope) {
    return { ok: false, failure: { kind: 'conflict', message: `Asset ${asset.name} is already ${SCOPE_LABEL[scope]}.`, entity: { kind: 'asset', id: assetId, projectId: asset.projectId } } }
  }
  const governed = project.roeStatus === 'approved' && ['approved', 'active'].includes(project.status)
  const openRequest = scope === 'pending' && governed
    ? db.approvals.find((a) => a.projectId === project.id && a.type === APR.scope && a.status === 'pending')
    : undefined
  const canRequest = scope === 'pending' && governed && !openRequest && !!project.emergency.trim() && !!project.window.trim()
  const at = stampOf(clock)
  let reviewRequested: string | undefined
  authority.commit(ctx.corr, (d) => {
    const a = d.assets.find((x) => x.id === assetId)!
    a.scope = scope
    a.updated = at
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: input.action || 'Changed asset scope status', obj: assetId, projectId: project.id, result: 'Success', reason: input.reason || '' })
    if (canRequest) {
      const id = 'APR-' + ++d.counters.approval
      d.approvals.unshift({ id, projectId: project.id, type: APR.scope, by: ctx.actor.id, reviewer: REVIEWER, at, status: 'pending', note: input.note || input.reason || `Proposed ${asset.name} for scope`, diff: `${asset.name} → in scope` })
      d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + clock.now() % 10000, group: 'todo', text: `${project.id} is waiting for your approval (${APR.scope})`, projectId: project.id, at, read: false, to: { name: 'project', id: project.id }, category: 'approvals' })
      reviewRequested = id
    }
  })
  return { ok: true, data: { assetId, projectId: project.id, scope, reviewRequested } }
}

/* ───────────── Screen-facing handlers (portfolio-handlers pattern) ───────────── */

export interface AssetWriteHandlers {
  /** Atomic validated import for the active project (aggregate scope refuses). */
  importRows(rows: readonly AssetImportRow[]): Promise<ServiceResult<AssetImportOutcome>>
  /** Role-gated scope change with the audited reason. */
  changeScope(assetId: string, scope: Asset['scope'], input?: AssetScopeWriteInput): Promise<ServiceResult<AssetScopeWriteOutcome>>
}

/** Builds the asset write handlers for one actor/scope; contexts are built at call time, so a persona/project switch never retargets a mutation. */
export function createAssetWriteHandlers(svc: ConsoleServices, actor: ActorRef, scopeProject: string): AssetWriteHandlers {
  let seq = 0
  const ctx = (): RequestContext => ({ actor, projectId: scopeProject === 'all' ? '' : scopeProject, corr: `asset-w-${++seq}` })
  const pid = scopeProject === 'all' ? '' : scopeProject
  return {
    importRows: (rows) => Promise.resolve(importAssetsTransaction(svc.authority, svc.clock, ctx(), pid, rows)),
    changeScope: (assetId, scope, input) => Promise.resolve(changeAssetScopeTransaction(svc.authority, svc.clock, ctx(), assetId, scope, input)),
  }
}
