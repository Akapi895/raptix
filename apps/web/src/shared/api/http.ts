/**
 * Minimal JSON HTTP client for the new API boundary (W03).
 *
 * - Joins the configured API base URL with a path; path segments with dynamic
 *   data must be pre-encoded via {@link encodePathSegment}.
 * - Combines the caller's AbortSignal (route cancel) with a per-operation
 *   timeout, so callers can distinguish the two failure kinds.
 * - Checks `response.ok` BEFORE parsing success payloads; non-OK responses
 *   become {@link ApiStatusError} with the server status preserved.
 * - Retries are structural: only GET may retry (bounded, transport failures
 *   only); mutations are never retried regardless of caller options.
 */
import {
  ApiCanceledError,
  ApiClientError,
  ApiInvalidResponseError,
  ApiNetworkError,
  ApiTimeoutError,
  parseApiStatusError,
} from './errors'

export const DEFAULT_TIMEOUT_MS = 10_000
export const MUTATION_TIMEOUT_MS = 15_000
const MAX_READ_RETRIES = 1

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value)
}

export function joinApiPath(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** Caller-owned cancellation (route switching); NOT the timeout signal. */
  signal?: AbortSignal
  timeoutMs?: number
  /** Bounded GET-only retries on transport failures; ignored for mutations. */
  retries?: number
}

function isAbortLike(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** Classifies a late abort/timeout during body reads (route cancel vs deadline). */
function classifyAbort(scope: { signal?: AbortSignal; timedOut: boolean }, timeoutMs: number, error: unknown): void {
  if (scope.signal?.aborted) throw new ApiCanceledError()
  if (scope.timedOut) throw new ApiTimeoutError(timeoutMs)
  if (isAbortLike(error)) throw new ApiCanceledError()
}

async function fetchOnce<T>(url: string, options: RequestOptions, timeoutMs: number): Promise<T> {
  const { signal, method = 'GET', body } = options
  if (signal?.aborted) throw new ApiCanceledError()
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort)
  try {
    const jsonBody = body === undefined ? undefined : JSON.stringify(body)
    const init: RequestInit = { method, body: jsonBody, signal: controller.signal }
    if (jsonBody !== undefined) init.headers = { 'Content-Type': 'application/json' }
    const response = await fetch(url, init)
    if (!response.ok) {
      // Error bodies are best-effort, except abort/timeout still classify as such.
      const raw = await response.text().catch(error => {
        if (signal?.aborted || timedOut || isAbortLike(error)) throw error
        return ''
      })
      let parsed: unknown = null
      if (raw.length > 0) { try { parsed = JSON.parse(raw) } catch { parsed = null } }
      throw parseApiStatusError(response.status, parsed)
    }
    try {
      return await response.json() as T
    } catch (error) {
      classifyAbort({ signal, timedOut }, timeoutMs, error)
      throw new ApiInvalidResponseError('Response body was not valid JSON', error)
    }
  } catch (error) {
    if (error instanceof ApiClientError) throw error
    classifyAbort({ signal, timedOut }, timeoutMs, error)
    throw new ApiNetworkError(error)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

export async function requestJson<T>(baseUrl: string, path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retries = method === 'GET' ? Math.min(Math.max(options.retries ?? 0, 0), MAX_READ_RETRIES) : 0
  const url = joinApiPath(baseUrl, path)
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchOnce<T>(url, { ...options, method }, timeoutMs)
    } catch (error) {
      const transient = error instanceof ApiNetworkError || error instanceof ApiTimeoutError
      if (attempt >= retries || !transient || options.signal?.aborted) throw error
    }
  }
}
