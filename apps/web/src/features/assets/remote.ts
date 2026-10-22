import type { Asset } from '../../domain/entities'
import type { RequestContext, ServiceResult } from '../../domain/service'
import type { AssetDetailRead, AssetListQuery, AssetListRead, AssetScopeRead, AssetService, AssetUnmodelled } from './service';
import type { AssetImportOutcome, AssetImportRow, AssetScopeWriteOutcome } from './writes'
import { classifyAsset, fetchAssetInventory, importAssets, type AssetInventoryView } from './endpoints';
import { fetchEffectiveScope } from '../scope/remote';
import { fetchGraph } from '../analysis/remote';
import { getEngagement } from '../projects/remote';
import { displayTime, guarded } from '../../platform/adapter-shared'

type InventoryRow = AssetInventoryView['assets'][number]
type Kind = 'host' | 'web_url' | 'ip_range'

const PAGE_SIZE = 10
const MAX_PAGE_SIZE = 100

/** The real inventory stores what was imported; the console's asset types map onto those kinds. */
const KIND_OF_TYPE: Readonly<Record<string, Kind>> = { Host: 'host', URL: 'web_url', IP: 'ip_range', Subnet: 'ip_range' }
const TYPE_OF_KIND: Readonly<Record<string, Asset['type']>> = { host: 'Host', web_url: 'URL', ip_range: 'Subnet' }
const SCOPE_OF_CLASSIFICATION: Readonly<Record<InventoryRow['classification'], Asset['scope']>> = { in_scope: 'in', out_of_scope: 'out', pending: 'pending' }
const CLASSIFICATION_OF_SCOPE: Readonly<Partial<Record<Asset['scope'], InventoryRow['classification']>>> = { in: 'in_scope', out: 'out_of_scope', pending: 'pending' }

/** Sections of the asset read that the real backend does not model. Named, never rendered as an empty list. */
const UNMODELLED_DETAIL: AssetUnmodelled[] = ['operations', 'findings', 'evidence', 'agents', 'approvals', 'techniques', 'history']
const UNMODELLED_SCOPE: AssetUnmodelled[] = ['operations', 'approvals', 'governance']

function toAsset(row: InventoryRow, engagementId: string): Asset {
  return {
    id: row.id,
    name: row.identifier,
    ident: row.identifier,
    ip: row.kind === 'ip_range' ? row.identifier : '',
    type: TYPE_OF_KIND[row.kind] ?? row.kind,
    os: '',
    owner: '',
    projectId: engagementId,
    scope: SCOPE_OF_CLASSIFICATION[row.classification],
    // Managed rows were imported by an operator; observed rows were seen during a run. The screen keeps that provenance.
    source: row.observed ? 'observed' : 'managed',
    updated: displayTime(row.updatedAt),
  }
}

function notFound<T>(id: string): ServiceResult<T> {
  return { ok: false, failure: { kind: 'not-found', message: `Asset ${id} does not exist or is not available for your account.` } }
}

function validation<T>(message: string): ServiceResult<T> {
  return { ok: false, failure: { kind: 'validation', message } }
}

function matches(asset: Asset, query: AssetListQuery): boolean {
  const needle = query.q?.trim().toLowerCase() ?? ''
  return (!needle || asset.name.toLowerCase().includes(needle) || asset.ident.toLowerCase().includes(needle))
    && (!query.type || asset.type === query.type)
    && (!query.scope || asset.scope === query.scope)
    && (!query.owner || asset.owner === query.owner)
    && (!query.os || asset.os === query.os)
}

/**
 * Real AssetService over the engagement's asset inventory (ADR-0084). Managed
 * inventory rows keep their observed/managed provenance. Operations, findings,
 * evidence, agents, approvals, techniques and history are not part of the real
 * inventory, so each detail or scope read names them as unmodelled.
 */
export function createRealAssetService(): AssetService {
  const inventory = async (engagementId: string): Promise<Asset[]> => {
    const view = await fetchAssetInventory(engagementId)
    return view.assets.map((row) => toAsset(row, engagementId))
  }
  return {
    capabilities: { scopeApprovalRequests: false, observedGraph: true },
    list: (ctx: RequestContext, query: AssetListQuery = {}) => guarded(async (): Promise<ServiceResult<AssetListRead>> => {
      if (!ctx.projectId || ctx.projectId === 'all') return { ok: false, failure: { kind: 'unavailable', message: 'Select an engagement to read its assets.' } }
      const all = await inventory(ctx.projectId)
      const rows = all.filter((asset) => matches(asset, query))
      const pageSize = Math.min(Math.max(1, query.pageSize ?? PAGE_SIZE), MAX_PAGE_SIZE)
      const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
      const page = Math.min(Math.max(1, query.page ?? 1), pageCount)
      const kpis: AssetListRead['kpis'] = {
        in: all.filter((asset) => asset.scope === 'in').length,
        out: all.filter((asset) => asset.scope === 'out').length,
        pending: all.filter((asset) => asset.scope === 'pending').length,
        unclassified: all.filter((asset) => asset.scope === 'unclassified').length,
      }
      return {
        ok: true,
        data: {
          items: rows.slice((page - 1) * pageSize, page * pageSize).map((asset) => ({ asset })),
          page,
          pageSize,
          total: rows.length,
          kpis,
          owners: [],
        },
      }
    }),

    get: (ctx: RequestContext, id: string) => guarded(async (): Promise<ServiceResult<AssetDetailRead>> => {
      if (!ctx.projectId || ctx.projectId === 'all') return { ok: false, failure: { kind: 'unavailable', message: 'Select an engagement to read its assets.' } }
      const view = await fetchAssetInventory(ctx.projectId)
      const row = view.assets.find((candidate) => candidate.id === id)
      if (!row) return notFound<AssetDetailRead>(id)
      const project = await getEngagement(ctx.projectId)
      return {
        ok: true,
        data: {
          asset: toAsset(row, ctx.projectId),
          project: { id: project.id, name: project.displayName, status: project.lifecycleStatus, roeVersion: '', roeStatus: 'none', window: '' },
          operations: [],
          findings: [],
          evidence: [],
          agents: [],
          approvals: [],
          techniques: [],
          history: [],
          canViewSensitive: false,
          unmodelled: UNMODELLED_DETAIL,
        },
      }
    }),

    scope: (ctx: RequestContext) => guarded(async (): Promise<ServiceResult<AssetScopeRead>> => {
      if (!ctx.projectId || ctx.projectId === 'all') return { ok: false, failure: { kind: 'unavailable', message: 'Select an engagement to read its scope.' } }
      const [assets, effective, project] = await Promise.all([inventory(ctx.projectId), fetchEffectiveScope(ctx.projectId), getEngagement(ctx.projectId)])
      const window = effective.roe.windows[0]
      return {
        ok: true,
        data: {
          unmodelled: UNMODELLED_SCOPE,
          rows: assets.map((asset) => ({ asset, impactedOps: [] })),
          projects: [{
            id: project.id,
            name: project.displayName,
            status: project.lifecycleStatus,
            roeVersion: effective.version === null ? '' : `v${effective.version}`,
            roeStatus: effective.version === null ? 'none' : 'approved',
            window: window ? `${window.start} – ${window.end} (${window.tz})` : '',
            plansToRevalidate: [],
            readyOps: [],
            runningOps: [],
          }],
          accessibleCount: assets.length,
        },
      }
    }),

    observedGraph: (ctx: RequestContext) => guarded(async () => {
      if (!ctx.projectId || ctx.projectId === 'all') return { ok: false, failure: { kind: 'unavailable', message: 'Select an engagement to read its observed graph.' } }
      const view = await fetchGraph(ctx.projectId)
      return { ok: true, data: { nodes: view.nodes, edges: view.edges, truncated: view.truncated } }
    }),
    importRows: (ctx: RequestContext, rows: readonly AssetImportRow[]) => guarded(async (): Promise<ServiceResult<AssetImportOutcome>> => {
      if (!ctx.projectId || ctx.projectId === 'all') return validation('Select an engagement before importing assets.')
      if (rows.length === 0) return validation('Add at least one asset to import.')
      const byKind = new Map<Kind, string[]>()
      for (const [index, row] of rows.entries()) {
        const kind = KIND_OF_TYPE[row.type]
        if (kind === undefined) return validation(`Row ${index + 1}: the ${row.type} type is not stored by the real asset inventory.`)
        byKind.set(kind, [...(byKind.get(kind) ?? []), row.ident])
      }
      let added = 0
      for (const [kind, identifiers] of byKind) {
        const result = await importAssets(ctx.projectId, identifiers, kind)
        added += result.imported
      }
      return { ok: true, data: { added } }
    }),

    changeScope: (ctx: RequestContext, assetId: string, scope: Asset['scope']) => guarded(async (): Promise<ServiceResult<AssetScopeWriteOutcome>> => {
      if (!ctx.projectId || ctx.projectId === 'all') return validation('Select an engagement before changing an asset scope.')
      const classification = CLASSIFICATION_OF_SCOPE[scope]
      if (classification === undefined) return validation('An asset can only be set to in scope, out of scope or pending.')
      const view = await fetchAssetInventory(ctx.projectId)
      const row = view.assets.find((candidate) => candidate.id === assetId)
      if (!row) return notFound<AssetScopeWriteOutcome>(assetId)
      await classifyAsset(ctx.projectId, assetId, classification, row.version)
      return { ok: true, data: { assetId, projectId: ctx.projectId, scope } }
    }),
    requestScopeApproval: () => Promise.resolve({ ok: false, failure: { kind: 'unavailable', message: 'Scope change requests are raised from the Scope revisions panel in real mode.' } }),
  }
}
