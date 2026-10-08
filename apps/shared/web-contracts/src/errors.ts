/**
 * Error wire contract shared by web-raptix-server responses and browser parsing.
 *
 * The new DTO is `code` + `message` (camelCase public interface). Captured legacy
 * bodies such as `{"error": "..."}` are legacy-raw and intentionally fail
 * {@link isApiError}; the server peer owns the mapping.
 */
import { isNonEmptyString, isRecord } from './guards.js'

/** Closed set; extend only in agreement with the server peer and update tests. */
export const API_ERROR_CODES = [
  'bad_request', 'unauthorized', 'forbidden', 'not_found',
  'conflict', 'too_many_requests', 'internal_error', 'internal', 'unavailable',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value)
}

export interface ApiError {
  code: ApiErrorCode
  message: string
  /** Opaque structured context; never put secrets or raw backend stack traces here. */
  details?: unknown
}

export function isApiError(value: unknown): value is ApiError {
  return isRecord(value) && isApiErrorCode(value.code) && isNonEmptyString(value.message)
}
