/**
 * Capability wire contract for `GET /api/capabilities`.
 *
 * Flags describe what the system supports/has available; they never replace
 * server authorization. Reason strings come from the server (e.g.
 * "runtime_unavailable", "not_verified", "service_missing") and are not
 * enumerated here so the server can add reasons without a contract bump.
 */
import { isNonEmptyString, isRecord } from './guards.js'

export interface Capability {
  supported: boolean
  available: boolean
  /** Required to explain `available: false`; must be non-empty when present. */
  reason?: string
}

export function isCapability(value: unknown): value is Capability {
  if (!isRecord(value)) return false
  if (typeof value.supported !== 'boolean' || typeof value.available !== 'boolean') return false
  if (value.available && !value.supported) return false
  if (value.reason !== undefined && !isNonEmptyString(value.reason)) return false
  return true
}

export interface CapabilitiesDocument {
  version: number
  /** Deployment mode, e.g. "local-single-user". */
  mode: string
  /** Stable, non-secret installation identity; absent on older servers. */
  deploymentId?: string
  /**
   * Who may decide a workflow item. `required` keeps the four-eyes rule (the author never decides their own item);
   * `single-operator` lets the same person decide it (ADR-0100). Absent on older servers, which mean `required`.
   */
  independentReview?: 'required' | 'single-operator'
  capabilities: Record<string, Capability>
}

export function isCapabilitiesDocument(value: unknown): value is CapabilitiesDocument {
  if (!isRecord(value)) return false
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1) {
    return false
  }
  if (!isNonEmptyString(value.mode)) return false
  if (value.deploymentId !== undefined && (typeof value.deploymentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.deploymentId))) return false
  if (value.independentReview !== undefined && value.independentReview !== 'required' && value.independentReview !== 'single-operator') return false
  if (!isRecord(value.capabilities)) return false
  return Object.values(value.capabilities).every(isCapability)
}
