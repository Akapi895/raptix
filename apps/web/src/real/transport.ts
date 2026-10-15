/**
 * Same-origin browser transport for real mode (integration ticket 03,
 * ADR-0068). The only module allowed to call `/api` — feature read models go
 * through typed adapters, never fetch directly.
 *
 * Responses are validated at the boundary with the shared web-contracts
 * guards; API error envelopes (`code` + `message`) surface their code and
 * server message. A network failure or timeout is an explicit
 * `unavailable` transport error — it is never converted into an empty
 * result or a mock fallback.
 */
import { isApiError, type ApiError } from '@raptix/web-contracts'

export type ApiErrorCode = ApiError['code']

/** Transport-level failure carrying the parsed API envelope (or a fallback). */
export class ApiTransportError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly details?: unknown

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiTransportError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** Per-request timeout in milliseconds (default 15 s). */
  timeoutMs?: number
  signal?: AbortSignal
}

const API_BASE = '/api'
const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Per-session CSRF token (ticket 07 multi-user deployments). The token comes
 * from `/api/auth/session` after sign-in; mutations attach it as a header so
 * the server-side origin/CSRF boundary accepts them. Local single-user
 * deployments never set it.
 */
let csrfToken: string | null = null

/** Stores the session CSRF token (or clears it with null). */
export function setCsrfToken(token: string | null): void {
  csrfToken = token
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    // An API that answers HTML (SPA fallback or proxy error page) is a
    // transport failure, never a parseable payload.
    throw new ApiTransportError(response.status, 'internal_error', 'The API returned a non-JSON response.')
  }
}

function unwrapEnvelope(body: unknown): ApiError | null {
  // Server envelope shape (apps/web/server/src/http/error-handler.ts):
  // `{ statusCode, error: { code, message, details? } }`. A flat
  // `{ code, message }` body is accepted as the contract's documented
  // alternative so a future server mapping change cannot silently break
  // error rendering.
  if (isRecordValue(body) && isApiError(body.error)) return body.error
  if (isApiError(body)) return body
  return null
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function failureFrom(response: Response, body: unknown): ApiTransportError {
  const envelope = unwrapEnvelope(body)
  if (envelope) {
    return new ApiTransportError(response.status, envelope.code, envelope.message, envelope.details)
  }
  const fallback: Record<number, [ApiErrorCode, string]> = {
    400: ['bad_request', 'The request was rejected by the server.'],
    401: ['unauthorized', 'The server rejected this session.'],
    403: ['forbidden', 'You are not allowed to perform this action.'],
    404: ['not_found', 'The requested record does not exist or is out of scope.'],
    409: ['conflict', 'The request conflicts with existing data.'],
    503: ['unavailable', 'The requested capability is unavailable on the server.'],
  }
  const [code, message] = fallback[response.status] ?? ['internal_error', 'The server reported an unexpected error.']
  return new ApiTransportError(response.status, code, message)
}

/**
 * Performs one validated API call. `validate` narrows the parsed JSON body;
 * a shape violation is a transport error (malformed server response), not a
 * silently tolerated value.
 */
export async function apiFetch<T>(
  path: string,
  validate: (value: unknown) => value is T,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options
  const timeout = AbortSignal.timeout(timeoutMs)
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' && csrfToken !== null ? { 'x-csrf-token': csrfToken } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal: composed,
    })
    const parsed = await parseBody(response)
    if (!response.ok) {
      // W04: any 401 means the session is no longer trusted. Signal the shell
      // so it drops actor-scoped state and re-renders sign-in instead of
      // keeping a stale authenticated view on screen.
      if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('raptix:session-expired'))
      throw failureFrom(response, parsed)
    }
    if (!validate(parsed)) {
      throw new ApiTransportError(response.status, 'internal_error', 'The API returned a response with an unexpected shape.')
    }
    return parsed
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (error instanceof ApiTransportError) throw error
    // DOMException is not an Error subclass in every environment — read the
    // name defensively so a fetch timeout is never misreported.
    const name = (error as { name?: string } | null)?.name
    const reason = name === 'TimeoutError' ? 'timed out' : 'is unreachable'
    throw new ApiTransportError(0, 'unavailable', `The Raptix API ${reason}. Verify the server is running and reachable.`)
  }
}
