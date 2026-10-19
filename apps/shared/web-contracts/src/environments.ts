import { isIsoUtcTimestamp, isNonEmptyString, isRecord } from './guards.js'

// ADR-0092: project environment lifecycle commands and the single active slot.

export const ENVIRONMENT_COMMAND_ACTIONS = ['activate', 'stop', 'archive', 'unarchive'] as const
export const DEPLOYMENT_SLOT_PHASES = ['idle', 'starting', 'ready', 'stopping', 'uncertain'] as const
export const ENVIRONMENT_COMMAND_STATUSES = ['accepted', 'replayed', 'busy', 'stale', 'refused'] as const

export type EnvironmentCommandAction = typeof ENVIRONMENT_COMMAND_ACTIONS[number]
export type DeploymentSlotPhase = typeof DEPLOYMENT_SLOT_PHASES[number]
export type EnvironmentCommandStatus = typeof ENVIRONMENT_COMMAND_STATUSES[number]

export interface EnvironmentCommandRequest {
  /** Client-generated idempotency key, unique per deployment. */
  requestId: string
  action: EnvironmentCommandAction
  /** Slot version the caller last observed; a stale value is refused. */
  expectedVersion: number
}

export interface EnvironmentCommandResult {
  status: EnvironmentCommandStatus
  phase: DeploymentSlotPhase
  version: number
  commandId: string | null
  /**
   * Set only when the active project is the caller's own project. A `busy`
   * result never carries it, so a caller cannot learn another project's id.
   */
  activeEngagementId?: string | null
  /** Bounded refusal code; never free text from another project. */
  reason?: string
}

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/

export function isEnvironmentCommandRequest(v: unknown): v is EnvironmentCommandRequest {
  return isRecord(v) && typeof v.requestId === 'string' && REQUEST_ID.test(v.requestId) &&
    (ENVIRONMENT_COMMAND_ACTIONS as readonly unknown[]).includes(v.action) &&
    Number.isSafeInteger(v.expectedVersion) && (v.expectedVersion as number) >= 0
}

export function isEnvironmentCommandResult(v: unknown): v is EnvironmentCommandResult {
  if (!isRecord(v) || !(ENVIRONMENT_COMMAND_STATUSES as readonly unknown[]).includes(v.status)) return false
  if (!(DEPLOYMENT_SLOT_PHASES as readonly unknown[]).includes(v.phase)) return false
  if (!Number.isSafeInteger(v.version) || (v.version as number) < 0) return false
  if (v.commandId !== null && !isNonEmptyString(v.commandId)) return false
  if (v.activeEngagementId !== undefined && v.activeEngagementId !== null && !isNonEmptyString(v.activeEngagementId)) return false
  if (v.reason !== undefined && typeof v.reason !== 'string') return false
  // A busy answer means the slot is held: it can never be idle, and it never names the active project.
  if (v.status === 'busy') return v.phase !== 'idle' && !('activeEngagementId' in v)
  return true
}

/** What a caller may see about one project's environment. The slot is shared, so other projects appear only as `held`. */
export interface EnvironmentStateView {
  engagementId: string
  environment: {
    observedState: string
    desiredState: string
    generation: number
    observedAt: string | null
    /** True after an archive. Archived data is kept; the project cannot start until it is unarchived. */
    archived: boolean
    /** Bounded code for the last failed or undrained attempt, cleared by the next ready. Never free text. */
    lastError: string | null
  }
  slot: {
    phase: DeploymentSlotPhase
    version: number
    /** True when some project holds the deployment slot, including this one. */
    held: boolean
    /** True only when this project holds the slot. */
    ownedByThisProject: boolean
    /** Set only when this project holds the slot; never another project's id. */
    activeEngagementId: string | null
  }
}

const OBSERVED_STATES = ['unprovisioned', 'starting', 'ready', 'stopping', 'stopped', 'uncertain'] as const

export function isEnvironmentStateView(v: unknown): v is EnvironmentStateView {
  if (!isRecord(v) || !isNonEmptyString(v.engagementId) || !isRecord(v.environment) || !isRecord(v.slot)) return false
  const env = v.environment
  const slot = v.slot
  if (!(OBSERVED_STATES as readonly unknown[]).includes(env.observedState) || !['stopped', 'ready'].includes(String(env.desiredState))) return false
  if (!Number.isSafeInteger(env.generation) || (env.generation as number) < 0 || (env.observedAt !== null && !isIsoUtcTimestamp(env.observedAt))) return false
  if (typeof env.archived !== 'boolean' || (env.lastError !== null && typeof env.lastError !== 'string')) return false
  if (!(DEPLOYMENT_SLOT_PHASES as readonly unknown[]).includes(slot.phase) || !Number.isSafeInteger(slot.version) || (slot.version as number) < 0) return false
  if (typeof slot.held !== 'boolean' || typeof slot.ownedByThisProject !== 'boolean') return false
  if (slot.ownedByThisProject && slot.activeEngagementId !== v.engagementId) return false
  if (!slot.ownedByThisProject && slot.activeEngagementId !== null) return false
  return slot.held === (slot.phase !== 'idle')
}
