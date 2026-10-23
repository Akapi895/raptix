/**
 * Asset inventory port (ticket 50, ADR-0067 — docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The read models, write operations and capabilities the asset screens use. The mock
 * implementation is `mock.ts`; the real adapter is `remote.ts`.
 */
import type { Asset } from '../../domain/entities'
import type { RequestContext, ServiceResult } from '../../domain/service'
import type { ApprovalRef } from '../approvals/service'
import type { AssetImportOutcome, AssetImportRow, AssetScopeApprovalInput, AssetScopeWriteInput, AssetScopeWriteOutcome } from './writes'

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
  /** Owning project's display name in the aggregate view; null where the source does not record one. */
  projectName?: string | null
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
  /** Whole-scope counts by asset type and by provenance (managed or observed); never filtered. */
  types: Record<string, number>
  sources: Record<string, number>
  /** OS values the source records; empty when none is recorded, so no OS filter or column is offered. */
  oses: string[]
  /** 'truncated' when the observed graph read was capped; 'unavailable' when it could not be read at all. */
  observation: 'ok' | 'truncated' | 'unavailable'
}

/** Counts the items by a key, in the order the items arrive. */
export function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const value = key(item)
    counts[value] = (counts[value] ?? 0) + 1
  }
  return counts
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

/** What the active mode supports, so the screens branch on this rather than on the data mode. */
export interface AssetCapabilities {
  /** Scope change requests are raised from the scope screen; real mode raises them from the Scope revisions panel. */
  readonly scopeApprovalRequests: boolean
  /** The observed attack-chain graph is read from the server; the simulated store has none. */
  readonly observedGraph: boolean
  /** The mock store fills fields the real inventory does not hold (environment, sample discovery); the screens show them only when true. */
  readonly simulated: boolean
}

/** The mock store's capabilities. A constant, so the lazily loaded mock service can answer them without waiting for its module. */
export const MOCK_ASSET_CAPABILITIES: AssetCapabilities = { scopeApprovalRequests: true, observedGraph: false, simulated: true }

export interface AssetService {
  readonly capabilities: AssetCapabilities
  /** The observed graph source; the simulated store has none, so the screen says so instead of inventing one. */
  observedGraph(ctx: RequestContext): Promise<ServiceResult<AssetObservedGraph>>
  list(ctx: RequestContext, query?: AssetListQuery): Promise<ServiceResult<AssetListRead>>
  get(ctx: RequestContext, id: string): Promise<ServiceResult<AssetDetailRead>>
  scope(ctx: RequestContext): Promise<ServiceResult<AssetScopeRead>>
  /** Atomic validated import for the active project; refusals commit nothing. */
  importRows(ctx: RequestContext, rows: readonly AssetImportRow[]): Promise<ServiceResult<AssetImportOutcome>>
  /** Role-gated classification change with the audited reason. */
  changeScope(ctx: RequestContext, assetId: string, scope: Asset['scope'], input?: AssetScopeWriteInput): Promise<ServiceResult<AssetScopeWriteOutcome>>
  /** Scope change request for the reviewer, raised for the project in the context. */
  requestScopeApproval(ctx: RequestContext, input: AssetScopeApprovalInput): Promise<ServiceResult<ApprovalRef>>
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
