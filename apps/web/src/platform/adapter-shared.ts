import type { ServiceFailure, ServiceResult } from '../domain/service'
import { ApiTransportError } from './transport'

/** Maps a transport failure onto the console's typed failure kinds (ADR-0067). */
export function failureFrom(error: unknown): ServiceFailure {
  if (error instanceof ApiTransportError) {
    const kind = error.status === 403 ? 'forbidden'
      : error.status === 404 ? 'not-found'
      : error.status === 409 ? 'conflict'
      : error.status === 400 || error.status === 422 ? 'validation'
      : 'unavailable'
    return { kind, message: error.message }
  }
  return { kind: 'unavailable', message: error instanceof Error ? error.message : 'The request failed.' }
}

/**
 * Runs a service call so that a transport error becomes an explicit failure result.
 * A caller that switched away (unmount, engagement change) aborts its request; that
 * cancellation is not a failure to show, so it propagates for the query layer to drop.
 */
export async function guarded<T>(run: () => Promise<ServiceResult<T>>): Promise<ServiceResult<T>> {
  try {
    return await run()
  } catch (error) {
    if (isAbortError(error)) throw error
    return { ok: false, failure: failureFrom(error) }
  }
}

export function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError'
}

export function instant(iso: string): number {
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? 0 : parsed
}

/** Short, locale-stable display of an ISO instant; empty when the source has none. */
export function displayTime(iso: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return ''
  return new Date(parsed).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
