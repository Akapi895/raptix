import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRealOverviewService } from './remote'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function stubEndpoints(routes: Record<string, () => Response>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const key = Object.keys(routes).find((k) => url.endsWith(k))
    return key ? routes[key]() : new Response('unexpected', { status: 404 })
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('real overview adapter', () => {
  it('maps the findings rollup as the source records it, verified counts only', async () => {
    stubEndpoints({
      '/api/overview/findings': () => json({ total: 3, bySeverity: { high: 2, low: 1 }, byStatus: { confirmed: 3 }, unresolvedBySeverity: { high: 2, low: 1 }, latestCreatedAt: '2026-10-14T09:05:00.000Z', engagementsWithFindings: 1, engagements: 2, truncated: false, source: 'db' }),
    })
    const res = await createRealOverviewService().findings()
    expect(res).toEqual({ ok: true, data: { total: 3, engagements: 2, engagementsWithFindings: 1, bySeverity: { high: 2, low: 1 }, byStatus: { confirmed: 3 }, unresolvedBySeverity: { high: 2, low: 1 }, latestCreatedAt: '2026-10-14 09:05Z', truncated: false } })
  })

  it('formats the C2 command instants and keeps the recorded counts', async () => {
    stubEndpoints({
      '/api/overview/c2': () => json({
        commandsByStatus: { succeeded: 1 },
        recentCommands: [{ id: 'cmd-1', engagementId: 'eng-1', sessionId: 'sess-1', status: 'succeeded', createdAt: '2026-10-14T09:05:00.000Z' }],
        pendingGrants: 0,
        source: 'db',
      }),
    })
    const res = await createRealOverviewService().c2()
    expect(res).toMatchObject({ ok: true, data: { pendingGrants: 0, commandsByStatus: { succeeded: 1 }, recentCommands: [{ id: 'cmd-1', createdAt: '2026-10-14 09:05Z' }] } })
  })

  it('reports one failing section as unavailable and leaves the others readable', async () => {
    stubEndpoints({
      '/api/overview/findings': () => json({ error: 'down' }, 503),
      '/api/overview/c2': () => json({ commandsByStatus: {}, recentCommands: [], pendingGrants: 2, source: 'db' }),
    })
    const service = createRealOverviewService()
    const findings = await service.findings()
    const c2 = await service.c2()
    expect(findings.ok).toBe(false)
    expect(c2.ok).toBe(true)
  })
})
