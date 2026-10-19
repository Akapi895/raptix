/**
 * Project environment adapters (ADR-0092). A decided command, including busy, stale and refused, is a validated
 * answer. Only malformed, unauthorized, unknown or unavailable requests reach the error path.
 */

import {
  isEnvironmentCommandResult,
  isEnvironmentStateView,
  type EnvironmentCommandRequest,
  type EnvironmentCommandResult,
  type EnvironmentStateView,
} from '@raptix/web-contracts'
import { apiFetch } from './transport'

export function fetchEnvironment(engagementId: string): Promise<EnvironmentStateView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/environment`, (v): v is EnvironmentStateView => isEnvironmentStateView(v) && v.engagementId === engagementId)
}

export function submitEnvironmentCommand(engagementId: string, input: EnvironmentCommandRequest): Promise<EnvironmentCommandResult> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/environment/commands`, isEnvironmentCommandResult, { method: 'POST', body: input })
}
