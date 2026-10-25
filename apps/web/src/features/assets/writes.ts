import type { ActorRef, RequestContext, ServiceResult } from '../../domain/service'
import type { Asset } from '../../domain/entities'
import { type ApprovalRef, type ScopeAssetInput } from '../approvals/service'
import type { AssetService } from './service';
/** The asset types the real inventory stores (the server refuses any other type). */
export const ASSET_TYPES = ['Host', 'IP', 'URL', 'Subnet']
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
/** One import row. The real inventory stores the type and identifier only; added assets stay pending until approval. */
export type AssetImportRow = Pick<ScopeAssetInput, 'name' | 'ident' | 'type' | 'source'>
/** One row the import refuses, with the exact reasons (reported, never hidden). */
export interface AssetRowIssue { index: number; name: string; duplicate: boolean; reasons: string[] }
/** Import checks against the identifiers the project already holds in its asset list. */
export function validateImportRows(existingIdents: readonly string[], rows: readonly AssetImportRow[]): AssetRowIssue[] {
  const existing = new Set(existingIdents.map((ident) => ident.trim().toLowerCase()))
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
export interface AssetImportOutcome {
  /** Number of rows committed (all rows — refusals commit zero). */
  added: number
}
export interface AssetScopeWriteInput {
  /** Audited reason (required by the screens' confirm dialogs for gated changes). */
  reason?: string
  /** Audit action label (defaults to 'Changed asset scope status'). */
  action?: string
  /** Approval-request note for a pending proposal (defaults to the reason). */
  note?: string
}
/** A scope change request for the reviewer; the project comes from the write context. */
export interface AssetScopeApprovalInput {
  /** The justification the reviewer reads. */
  note: string
  /** What the request changes, carried as the approval's diff. */
  diff: string
}
export interface AssetScopeWriteOutcome {
  assetId: string
  projectId: string
  scope: Asset['scope']
  /** Approval id when the proposal opened a scope-change review in this commit. */
  reviewRequested?: string
}
export interface AssetWriteHandlers {
  /** Atomic validated import for the active project (aggregate scope refuses). */
  importRows(rows: readonly AssetImportRow[]): Promise<ServiceResult<AssetImportOutcome>>
  /** Role-gated scope change with the audited reason. */
  changeScope(assetId: string, scope: Asset['scope'], input?: AssetScopeWriteInput): Promise<ServiceResult<AssetScopeWriteOutcome>>
  /** Raises a scope change request for the reviewer; refused where the port has no approval path. */
  requestScopeApproval(input: AssetScopeApprovalInput): Promise<ServiceResult<ApprovalRef>>
}
/**
 * Builds the asset write handlers for one actor/scope over the feature port, so the
 * same screen writes through the feature port. Contexts are
 * built at call time, so a persona/project switch never retargets a mutation.
 */
export function createAssetWriteHandlers(port: AssetService, actor: ActorRef, scopeProject: string): AssetWriteHandlers {
  let seq = 0
  const ctx = (): RequestContext => ({ actor, projectId: scopeProject === 'all' ? '' : scopeProject, corr: `asset-w-${++seq}` })
  return {
    importRows: (rows) => port.importRows(ctx(), rows),
    changeScope: (assetId, scope, input) => port.changeScope(ctx(), assetId, scope, input),
    requestScopeApproval: (input) => port.requestScopeApproval(ctx(), input),
  }
}
