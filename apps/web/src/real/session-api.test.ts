/** Session restoration must authorize refreshed mutations and fail closed on outage. */
import { afterEach, expect, it, vi } from 'vitest'
import { fetchAuthSession } from '../platform/auth-api';
import { requestC2Grant } from '../features/c2/api';
import { setCsrfToken } from '../platform/transport'

afterEach(() => { vi.unstubAllGlobals(); setCsrfToken(null) })

it('uses the restored session CSRF token on the next mutation', async () => {
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST'
    ? { id: 'grant-1', status: 'requested' }
    : { authenticated: true, mode: 'multi-user', actor: { id: 'user-1', username: 'alice', displayName: 'Alice' }, csrfToken: 'restored-token' })))
  vi.stubGlobal('fetch', fetchMock)
  await fetchAuthSession()
  await requestC2Grant('eng-1', { sessionId: 'sess-1', reason: 'authorized test', expiresAt: '2026-10-16T00:00:00Z' })
  expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ 'x-csrf-token': 'restored-token' })
})

it('does not treat a session endpoint outage as a local single-user deployment', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network unavailable')))
  await expect(fetchAuthSession()).rejects.toThrow(/unreachable/)
})
