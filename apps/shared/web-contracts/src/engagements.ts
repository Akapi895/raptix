/**
 * Engagement/project wire contracts.
 *
 * `Engagement` is the LEGACY captured contract (W00 HTTP fixture / DB row
 * shape, camelCase). Keep legacy parsing distinct and marked legacy: the
 * server maps it to the public `ProjectViewModel`, which never exposes
 * `workspacePath`/`userId`. Approval HITL wire: legacy snake_case payloads
 * (`request_id`, epoch-seconds `created_at`) stay legacy-raw and are
 * intentionally not re-described here.
 */
import { isIsoUtcTimestamp, isNonEmptyString, isRecord } from './guards.js'

export const ENGAGEMENT_STATUSES = ['draft', 'planning', 'running', 'completed', 'failed'] as const
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number]
export function isEngagementStatus(value: unknown): value is EngagementStatus {
  return typeof value === 'string' && (ENGAGEMENT_STATUSES as readonly string[]).includes(value)
}

export const ENGAGEMENT_TARGET_TYPES = ['web_url', 'ip_range'] as const
export type EngagementTargetType = (typeof ENGAGEMENT_TARGET_TYPES)[number]
export function isEngagementTargetType(value: unknown): value is EngagementTargetType {
  return typeof value === 'string' && (ENGAGEMENT_TARGET_TYPES as readonly string[]).includes(value)
}

/** Legacy captured engagement row (W00 fixtures 004/006/007). Not the public project DTO. */
export interface Engagement {
  id: string
  name: string
  targetType: EngagementTargetType
  targetValue: string
  authorizationConfirmed: boolean
  status: EngagementStatus
  userId: string
  /** Thread assigned by the runtime; null until a run starts. */
  threadId: string | null
  workspacePath: string
  createdAt: string
  updatedAt: string
}

export function isEngagement(value: unknown): value is Engagement {
  if (!isRecord(value)) return false
  return (
    isNonEmptyString(value.id) && isNonEmptyString(value.name) &&
    isEngagementTargetType(value.targetType) && isNonEmptyString(value.targetValue) &&
    typeof value.authorizationConfirmed === 'boolean' && isEngagementStatus(value.status) &&
    isNonEmptyString(value.userId) && (value.threadId === null || isNonEmptyString(value.threadId)) &&
    isNonEmptyString(value.workspacePath) &&
    isIsoUtcTimestamp(value.createdAt) && isIsoUtcTimestamp(value.updatedAt)
  )
}

export interface CreateEngagementRequest {
  name: string
  targetType: EngagementTargetType
  targetValue: string
  /** Legacy API rejects creation without explicit authorization (400). */
  authorizationConfirmed: true
}

export function isCreateEngagementRequest(value: unknown): value is CreateEngagementRequest {
  return (
    isRecord(value) && isNonEmptyString(value.name) && isEngagementTargetType(value.targetType) &&
    isNonEmptyString(value.targetValue) && value.authorizationConfirmed === true
  )
}

/**
 * Public project view model (guide section 5.2): a NEW public DTO, not the
 * legacy captured DB row. Counts are `null` when no projection source exists;
 * `0` only when the projection/API confirms confirmed emptiness. The public
 * shape never carries `workspacePath` or `userId` — the validator rejects
 * those keys and absolute-path-shaped slugs.
 */
export const METADATA_STATES = ['verified', 'needs_review'] as const
export type MetadataState = (typeof METADATA_STATES)[number]
export function isMetadataState(value: unknown): value is MetadataState {
  return typeof value === 'string' && (METADATA_STATES as readonly string[]).includes(value)
}

export const PROJECT_SOURCES = ['api', 'mock'] as const
export type ProjectSource = (typeof PROJECT_SOURCES)[number]
export function isProjectSource(value: unknown): value is ProjectSource {
  return typeof value === 'string' && (PROJECT_SOURCES as readonly string[]).includes(value)
}

export interface ProjectViewModel {
  id: string
  workspaceSlug: string
  /** Falls back to slug until a displayName source exists. */
  displayName: string
  targetType: EngagementTargetType
  targetValue: string
  authorizationConfirmed: boolean
  metadataState: MetadataState
  /** Engagement lifecycle; never a runtime pause/cancel state. */
  lifecycleStatus: EngagementStatus
  findingCount: number | null
  assetCount: number | null
  activeAgentCount: number | null
  createdAt: string
  updatedAt: string
  /** Optional provenance of the projection itself. */
  source?: ProjectSource
}

/** Slug, not a path: no separators, so no absolute workspace path can leak through. */
export function isWorkspaceSlug(value: unknown): value is string {
  return isNonEmptyString(value) && !value.includes('/') && !value.includes('\\')
}

const PROJECT_VIEW_KEYS = [
  'id', 'workspaceSlug', 'displayName', 'targetType', 'targetValue', 'authorizationConfirmed',
  'metadataState', 'lifecycleStatus', 'findingCount', 'assetCount', 'activeAgentCount',
  'createdAt', 'updatedAt', 'source',
] as const

function isPublicCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export function isProjectViewModel(value: unknown): value is ProjectViewModel {
  if (!isRecord(value)) return false
  for (const key of Object.keys(value)) {
    if (!(PROJECT_VIEW_KEYS as readonly string[]).includes(key)) return false
  }
  return (
    isNonEmptyString(value.id) && isWorkspaceSlug(value.workspaceSlug) &&
    isNonEmptyString(value.displayName) && isEngagementTargetType(value.targetType) &&
    isNonEmptyString(value.targetValue) && typeof value.authorizationConfirmed === 'boolean' &&
    isMetadataState(value.metadataState) && isEngagementStatus(value.lifecycleStatus) &&
    (value.findingCount === null || isPublicCount(value.findingCount)) &&
    (value.assetCount === null || isPublicCount(value.assetCount)) &&
    (value.activeAgentCount === null || isPublicCount(value.activeAgentCount)) &&
    isIsoUtcTimestamp(value.createdAt) && isIsoUtcTimestamp(value.updatedAt) &&
    (value.source === undefined || isProjectSource(value.source))
  )
}

export const APPROVAL_ACTIONS = ['allow', 'deny'] as const
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number]
export function isApprovalAction(value: unknown): value is ApprovalAction {
  return typeof value === 'string' && (APPROVAL_ACTIONS as readonly string[]).includes(value)
}

export interface ApprovalDecisionRequest {
  /** Approval request identifier; a string ID, never an array index. */
  requestId: string
  action: ApprovalAction
}

export function isApprovalDecisionRequest(value: unknown): value is ApprovalDecisionRequest {
  return isRecord(value) && isNonEmptyString(value.requestId) && isApprovalAction(value.action)
}
