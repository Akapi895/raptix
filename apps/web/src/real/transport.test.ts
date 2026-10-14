/** Boundary tests for the same-origin real-mode transport (ticket 03). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiTransportError, apiFetch } from './transport'

type Payload = { ok: true }
const isPayload = (v: unknown): v is Payload =>
  typeof v === 'object' && v !== null && (v as Record<string, unknown>).ok === true

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('apiFetch', () => {
  it('returns the parsed body on a valid response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ok: true })))
    await expect(apiFetch('/x', isPayload)).resolves.toEqual({ ok: true })
  })

  it('sends same-origin JSON requests against the /api base', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    await apiFetch('/engagements', isPayload, { method: 'POST', body: { name: 'x' } })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/engagements')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ name: 'x' }))
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(init.credentials).toBe('same-origin')
  })

  it('unwraps the wrapped server error envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse(404, { statusCode: 404, error: { code: 'not_found', message: 'Engagement not found' } })))
    const error = await apiFetch('/x', isPayload).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiTransportError)
    expect((error as ApiTransportError).status).toBe(404)
    expect((error as ApiTransportError).code).toBe('not_found')
    expect((error as ApiTransportError).message).toBe('Engagement not found')
  })

  it('accepts the flat error envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(409, { code: 'conflict', message: 'Duplicate slug' })))
    await expect(apiFetch('/x', isPayload)).rejects.toMatchObject({ code: 'conflict', status: 409, message: 'Duplicate slug' })
  })

  it('falls back to a status-mapped failure without an envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(503, { unexpected: 'shape' })))
    await expect(apiFetch('/x', isPayload)).rejects.toMatchObject({ code: 'unavailable', status: 503 })
  })

  it('maps a non-JSON body (HTML error page) to internal_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })))
    await expect(apiFetch('/x', isPayload)).rejects.toMatchObject({ code: 'internal_error' })
  })

  it('rejects a validation-shape violation as internal_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ok: false })))
    await expect(apiFetch('/x', isPayload)).rejects.toMatchObject({ code: 'internal_error', status: 200 })
  })

  it('maps a network failure to an explicit unavailable error (never an empty result)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const error = await apiFetch('/x', isPayload).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiTransportError)
    expect((error as ApiTransportError).status).toBe(0)
    expect((error as ApiTransportError).code).toBe('unavailable')
    expect((error as ApiTransportError).message).toContain('unreachable')
  })

  it('distinguishes a timeout from an unreachable server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError') }))
    await expect(apiFetch('/x', isPayload)).rejects.toThrow(/timed out/)
  })

  it('rethrows caller aborts untouched', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('Aborted', 'AbortError') }))
    await expect(apiFetch('/x', isPayload, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
