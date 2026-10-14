/** Request-ledger semantics (ticket 04): stable ids, poll, reconcile, no re-dispatch. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RequestRecoveryView } from '@raptix/web-contracts'

const ACK = (over: Record<string, unknown> = {}): RequestRecoveryView => ({
  engagementId: 'eng-1', requestId: 'req-abc12345', operation: 'create_run', state: 'creating',
  threadId: 'th-1', runId: null, createdAt: '2026-10-14T08:00:00.000Z', updatedAt: '2026-10-14T08:00:01.000Z', ...over,
} as RequestRecoveryView)

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('newRequestId', () => {
  it('produces server-valid request ids', async () => {
    const { newRequestId } = await import('./request-ledger')
    for (let i = 0; i < 20; i++) {
      expect(newRequestId()).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/)
    }
  })
})

describe('awaitRequest', () => {
  it('accepts immediately without any follow-up request', async () => {
    const { awaitRequest } = await import('./request-ledger')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const outcome = await awaitRequest('eng-1', ACK({ state: 'accepted', runId: 'run-1' }) as RequestRecoveryView)
    expect(outcome).toEqual({ kind: 'accepted', requestId: 'req-abc12345', threadId: 'th-1', runId: 'run-1' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('polls the same request id until accepted â€” never re-dispatches', async () => {
    const { awaitRequest } = await import('./request-ledger')
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return jsonResponse(200, ACK({ state: 'accepted', runId: 'run-9' }))
      return jsonResponse(500, {})
    })
    vi.stubGlobal('fetch', fetchMock)
    const outcome = await awaitRequest('eng-1', ACK(), { pollMs: 1, maxPolls: 5 })
    expect(outcome).toMatchObject({ kind: 'accepted', runId: 'run-9' })
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.every((u) => u.includes('/api/engagements/eng-1/requests/req-abc12345'))).toBe(true)
    expect(urls.some((u) => u.includes('/threads'))).toBe(false)
  })

  it('reconciles an uncertain outcome through the server endpoint', async () => {
    const { awaitRequest } = await import('./request-ledger')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/reconcile')) return jsonResponse(200, ACK({ state: 'accepted', runId: 'run-7' }))
      if (init?.method === 'GET') return jsonResponse(200, ACK({ state: 'uncertain' }))
      return jsonResponse(500, {})
    }))
    const outcome = await awaitRequest('eng-1', ACK(), { pollMs: 1, maxPolls: 5 })
    expect(outcome).toMatchObject({ kind: 'accepted', runId: 'run-7' })
  })

  it('surfaces rejection and unconfirmed outcomes distinctly', async () => {
    const { awaitRequest } = await import('./request-ledger')
    vi.stubGlobal('fetch', vi.fn())
    const rejected = await awaitRequest('eng-1', ACK({ state: 'rejected' }))
    expect(rejected).toMatchObject({ kind: 'rejected' })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, ACK({ state: 'creating' }))))
    const unconfirmed = await awaitRequest('eng-1', ACK({ state: 'creating' }), { pollMs: 1, maxPolls: 2 })
    expect(unconfirmed.kind).toBe('unconfirmed')
    if (unconfirmed.kind === 'unconfirmed') expect(unconfirmed.message).toMatch(/Reconcile/)
  })
})
