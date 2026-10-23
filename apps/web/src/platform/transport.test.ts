/** Boundary tests for the same-origin real-mode transport (ticket 03). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiTransportError, UNEXPECTED_RESPONSE_MESSAGE, apiFetch, apiFetchBytes } from './transport'

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

  it('shows users the unreadable-response copy and keeps the technical cause out of the message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })))
    const error = await apiFetch('/x', isPayload).catch((e: unknown) => e) as ApiTransportError
    expect(error.message).toBe(UNEXPECTED_RESPONSE_MESSAGE)
    expect(error.message).not.toMatch(/JSON|API/)
    expect(error.reason).toBe('the response body is not JSON')
  })

  it('replaces a generic server fault with the same user copy and keeps the server text as the reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { statusCode: 500, error: { code: 'internal_error', message: 'Internal server error' } })))
    const error = await apiFetch('/x', isPayload).catch((e: unknown) => e) as ApiTransportError
    expect(error.message).toBe(UNEXPECTED_RESPONSE_MESSAGE)
    expect(error.reason).toBe('Internal server error')
  })

  it('keeps a server-authored client error message as written', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(409, { statusCode: 409, error: { code: 'conflict', message: 'Duplicate slug' } })))
    await expect(apiFetch('/x', isPayload)).rejects.toMatchObject({ message: 'Duplicate slug' })
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
    expect((error as ApiTransportError).message).toBe('Raptix could not be reached. Check your connection and try again.')
    expect((error as ApiTransportError).reason).toBe('the server did not answer')
  })

  it('distinguishes a timeout from an unreachable server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError') }))
    await expect(apiFetch('/x', isPayload)).rejects.toThrow(/did not respond in time/)
  })

  it('rethrows caller aborts untouched', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('Aborted', 'AbortError') }))
    await expect(apiFetch('/x', isPayload, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('discards a response that arrives after the caller switched away (late ACK after abort)', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      setTimeout(() => resolve(jsonResponse(200, { ok: true })), 40)
    })))
    const pending = apiFetch('/x', isPayload, { signal: controller.signal })
    setTimeout(() => controller.abort(), 5)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('apiFetchBytes', () => {
  it('preserves the original bytes and validates server digest/length metadata', async () => {
    const bytes = new Uint8Array([0, 255, 65, 66])
    const fetchMock = vi.fn(async () => new Response(bytes, { status: 200, headers: {
      'Content-Type': 'application/octet-stream', 'Content-Disposition': "attachment; filename*=UTF-8''capture%20one.bin",
      'X-Content-SHA256': 'a'.repeat(64), 'X-Content-Length': String(bytes.length),
    } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiFetchBytes('/captures/cap-1/content')).resolves.toMatchObject({ bytes, digest: 'a'.repeat(64), filename: 'capture one.bin', mediaType: 'application/octet-stream' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/captures/cap-1/content')
    expect(init.credentials).toBe('same-origin')
  })

  it('rejects a byte count that differs from the retained descriptor headers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2]), { status: 200, headers: { 'X-Content-SHA256': 'a'.repeat(64), 'X-Content-Length': '3' } })))
    await expect(apiFetchBytes('/captures/cap-1/content')).rejects.toMatchObject({ code: 'internal_error', message: 'The download was incomplete. Try again.', reason: 'the downloaded size does not match the declared length' })
  })

  it('keeps server refusal envelopes intact for binary requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(409, { statusCode: 409, error: { code: 'conflict', message: 'Classify the capture first.' } })))
    await expect(apiFetchBytes('/captures/cap-1/content')).rejects.toMatchObject({ status: 409, code: 'conflict', message: 'Classify the capture first.' })
  })
})
