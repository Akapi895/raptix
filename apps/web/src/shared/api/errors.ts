/**
 * API error taxonomy for the new-server HTTP boundary (W03).
 *
 * Wire envelope from `web-raptix-server`: `{ statusCode, error: { code, message } }`.
 * The HTTP status is preserved verbatim on {@link ApiStatusError} so callers can
 * branch 400 (field validation) / 404 / 409 correctly. Transport failures are
 * distinguished from route cancellation: only a caller-owned AbortSignal yields
 * {@link ApiCanceledError}; a per-operation deadline yields {@link ApiTimeoutError}.
 */

/** Canonical code set re-exported from @raptix/web-contracts (server-aligned superset). */
import { API_ERROR_CODES, type ApiErrorCode } from '@raptix/web-contracts'
export { API_ERROR_CODES, type ApiErrorCode } from '@raptix/web-contracts'

export function isKnownApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value)
}

export type ApiErrorKind = 'status' | 'timeout' | 'canceled' | 'network' | 'invalid_response'

export class ApiClientError extends Error {
  readonly kind: ApiErrorKind

  constructor(kind: ApiErrorKind, message: string) {
    super(message)
    this.name = new.target.name
    this.kind = kind
  }
}

/** Non-OK response. `statusCode` is the preserved HTTP status, never re-derived. */
export class ApiStatusError extends ApiClientError {
  readonly statusCode: number
  /** Envelope code from the server; 'unknown' when the body was not a valid envelope. */
  readonly code: string
  readonly field?: string

  constructor(statusCode: number, code: string, message: string, field?: string) {
    super('status', message)
    this.statusCode = statusCode
    this.code = code
    this.field = field
  }

  get isValidationError(): boolean { return this.statusCode === 400 }
  get isNotFound(): boolean { return this.statusCode === 404 }
  get isConflict(): boolean { return this.statusCode === 409 }
}

/** Request exceeded its per-operation deadline; not a route cancel. */
export class ApiTimeoutError extends ApiClientError {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super('timeout', `Request timed out after ${timeoutMs}ms`)
    this.timeoutMs = timeoutMs
  }
}

/** The caller's AbortSignal fired (route switch/unmount). Never retried. */
export class ApiCanceledError extends ApiClientError {
  constructor(message = 'Request canceled') {
    super('canceled', message)
  }
}

/** fetch itself failed (server unreachable/refused); distinct from HTTP errors. */
export class ApiNetworkError extends ApiClientError {
  readonly underlying?: unknown

  constructor(underlying?: unknown) {
    super('network', 'Network request failed')
    this.underlying = underlying
  }
}

/** 2xx response whose body was not usable (bad JSON or failed DTO validation). */
export class ApiInvalidResponseError extends ApiClientError {
  readonly underlying?: unknown

  constructor(message: string, underlying?: unknown) {
    super('invalid_response', message)
    this.underlying = underlying
  }
}

export interface ApiErrorEnvelope {
  statusCode: number
  error: { code: string; message: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parses a non-OK body into an {@link ApiStatusError}. The HTTP status is always
 * preserved; malformed or legacy-shaped bodies (`{ error: "..." }`) degrade to a
 * generic message with code 'unknown' instead of crashing or being trusted.
 */
export function parseApiStatusError(statusCode: number, body: unknown): ApiStatusError {
  if (
    isRecord(body) && typeof body.statusCode === 'number' && isRecord(body.error) &&
    typeof body.error.code === 'string' && body.error.code.length > 0 &&
    typeof body.error.message === 'string' && body.error.message.length > 0
  ) {
    const details = body.error.details
    const field = isRecord(details) && typeof details.field === 'string' ? details.field : undefined
    return new ApiStatusError(statusCode, body.error.code, body.error.message, field)
  }
  return new ApiStatusError(statusCode, 'unknown', `Request failed with status ${statusCode}`)
}
