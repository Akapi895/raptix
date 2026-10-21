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
import { apiFetch, ApiTransportError } from '../platform/transport'

const PREPARATION_TIMEOUT_MS = 660_000 // Allow the controller's ten-minute startup window and its final observation.
const PREPARATION_POLL_MS = 2_000

export function isEnvironmentPreparingError(error: unknown): error is ApiTransportError {
  if (!(error instanceof ApiTransportError) || error.status !== 409 || error.code !== 'conflict') return false
  return typeof error.details === 'object' && error.details !== null && 'field' in error.details && error.details.field === 'environment'
}

function preparationPhase(state: EnvironmentStateView): 'ready' | 'starting' | 'failed' {
  if (!state.slot.ownedByThisProject || state.environment.archived) return 'failed'
  if (state.slot.phase === 'ready' && state.environment.observedState === 'ready') return 'ready'
  return state.slot.phase === 'starting' && state.environment.observedState === 'starting' ? 'starting' : 'failed'
}

const PREPARATION_FAILURE_TEXT: Readonly<Record<string, string>> = {
  legacy_not_quiescent: 'Another project still has unfinished work. Reconcile it before starting this project.',
  not_ready: 'The project environment did not become ready. Inspect its state before retrying.',
  controller_unreachable: 'The environment controller could not be reached. Ask an administrator to check it.',
  observe_failed: 'The project environment state could not be observed. Inspect it before retrying.',
}

function preparationFailure(reason: string | null): string {
  return reason === null ? 'The project environment did not become ready. Inspect its state before retrying.' : PREPARATION_FAILURE_TEXT[reason] ?? `The project environment did not become ready (${reason}). Inspect its state before retrying.`
}

export function fetchEnvironment(engagementId: string): Promise<EnvironmentStateView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/environment`, (v): v is EnvironmentStateView => isEnvironmentStateView(v) && v.engagementId === engagementId)
}

export function submitEnvironmentCommand(engagementId: string, input: EnvironmentCommandRequest): Promise<EnvironmentCommandResult> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/environment/commands`, isEnvironmentCommandResult, { method: 'POST', body: input })
}

/** Only a pre-dispatch environment refusal may be retried, using the caller's original request identity. */
export async function withPreparedEnvironment<T>(engagementId: string, create: () => Promise<T>, stillCurrent: () => boolean, preparing: () => void): Promise<T> {
  const assertCurrent = (): void => {
    if (!stillCurrent()) throw new ApiTransportError(409, 'conflict', 'Conversation selection changed before the thread was created.')
  }
  assertCurrent()
  try { return await create() }
  catch (error) {
    if (!isEnvironmentPreparingError(error)) throw error
  }
  preparing()
  const deadline = Date.now() + PREPARATION_TIMEOUT_MS
  while (Date.now() < deadline) {
    assertCurrent()
    const state = await fetchEnvironment(engagementId)
    assertCurrent()
    const phase = preparationPhase(state)
    if (phase === 'ready') return create()
    if (phase === 'failed') throw new ApiTransportError(409, 'conflict', preparationFailure(state.environment.lastError))
    await new Promise(resolve => setTimeout(resolve, PREPARATION_POLL_MS))
  }
  throw new ApiTransportError(409, 'conflict', 'Environment preparation timed out. Inspect its state before retrying.')
}
