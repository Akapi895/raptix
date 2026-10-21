/** Ticket-04 adapter tests: planning documents + scoped runtime requests. */
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const ACK = (over: Record<string, unknown> = {}) => ({
  engagementId: 'eng-1', requestId: 'req-abc12345', operation: 'create_thread', state: 'accepted',
  threadId: 'th-1', runId: null, createdAt: '2026-10-14T08:00:00.000Z', updatedAt: '2026-10-14T08:00:01.000Z', ...over,
})

describe('planning adapters', () => {
  it('fetches and validates the planning view', async () => {
    const { fetchPlanning } = await import('../features/planning/remote');
    const view = {
      version: 1, engagementId: 'eng-1',
      documents: {
        roe: { state: 'missing' }, conops: { state: 'missing' }, deconfliction: { state: 'missing' },
        opplan: { state: 'ready', content: { engagement_name: 'E', threat_profile: 'external' } },
      },
      bundle: { roe: 'missing', conops: 'missing', deconfliction: 'missing', opplan: 'ready', 'threat-profile': 'missing', contact: 'missing', 'data-handling': 'missing', abort: 'missing', cleanup: 'missing' },
      readiness: { state: 'blocked', reasons: ['roe: missing'], runtimeSignal: 'not_observed' },
    }
    const fetchMock = vi.fn(async () => jsonResponse(200, view))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchPlanning('eng-1')).resolves.toMatchObject({ version: 1 })
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('/api/engagements/eng-1/plan-docs')
  })

  it('rejects a planning view whose document states disagree with the bundle', async () => {
    const { fetchPlanning } = await import('../features/planning/remote');
    const { ApiTransportError } = await import('../platform/transport')
    const view = {
      version: 1, engagementId: 'eng-1',
      documents: {
        roe: { state: 'ready', content: { engagement_name: 'E', client: 'C', start_date: '2026-01-01', end_date: '2026-02-01', engagement_type: 'external', testing_window: '09-17' } },
        conops: { state: 'ready', content: { engagement_name: 'E', executive_summary: 'S' } },
        deconfliction: { state: 'ready', content: { engagement_name: 'E' } },
        opplan: { state: 'ready', content: { engagement_name: 'E', threat_profile: 'external' } },
      },
      bundle: { roe: 'ready', conops: 'ready', deconfliction: 'ready', opplan: 'ready', 'threat-profile': 'ready', contact: 'ready', 'data-handling': 'ready', abort: 'ready', cleanup: 'ready' },
      readiness: { state: 'ready', reasons: [], runtimeSignal: 'not_observed' },
    }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ...view, bundle: { ...view.bundle, roe: 'missing' } })))
    const error = await fetchPlanning('eng-1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiTransportError)
  })

  it('confirms the handoff with the one-way PATCH body', async () => {
    const { confirmHandoff } = await import('../features/projects/remote');
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: 'eng-1', workspaceSlug: 'w', displayName: 'D', targetType: 'web_url', targetValue: 't', authorizationConfirmed: true, brief: null, handoffConfirmedAt: '2026-10-14T09:00:00.000Z', metadataState: 'verified', lifecycleStatus: 'planning', findingCount: null, assetCount: null, activeAgentCount: null, createdAt: '2026-10-14T08:00:00.000Z', updatedAt: '2026-10-14T09:00:00.000Z' }))
    vi.stubGlobal('fetch', fetchMock)
    await confirmHandoff('eng-1')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ handoffConfirmed: true })
  })
})

describe('scoped runtime adapters', () => {
  it('creates a thread with the request id + kind and no other fields', async () => {
    const { createThread } = await import('../features/aichat/remote');
    const fetchMock = vi.fn(async () => jsonResponse(201, ACK()))
    vi.stubGlobal('fetch', fetchMock)
    await createThread('eng-1', { requestId: 'req-abc12345', kind: 'planning' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/engagements/eng-1/threads')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ requestId: 'req-abc12345', kind: 'planning' })
  })

  it('submits a run and resumes with question targeting', async () => {
    const api_aichat = await import('../features/aichat/remote');
    const runAck = ACK({ operation: 'create_run', state: 'accepted', threadId: 'th-1', runId: 'run-1' })
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => jsonResponse(202, { ...runAck, operation: String(url).endsWith('/resume') ? 'resume' : 'create_run', requestId: JSON.parse(String(init?.body)).requestId }))
    vi.stubGlobal('fetch', fetchMock)
    await api_aichat.submitRun('eng-1', 'th-1', { requestId: 'req-abc12345', message: 'Draft the RoE' })
    const [, runInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((runInit as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((runInit as RequestInit).body))).toEqual({ requestId: 'req-abc12345', message: 'Draft the RoE' })
    await api_aichat.resumeThread('eng-1', 'th-1', { requestId: 'req-def67890', value: 'Option A', questionId: 'q-1' })
    const [resumeUrl, resumeInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(resumeUrl).toBe('/api/engagements/eng-1/threads/th-1/resume')
    expect(JSON.parse(String((resumeInit as RequestInit).body))).toEqual({ requestId: 'req-def67890', value: 'Option A', questionId: 'q-1' })
  })

  it('reconciles through the stable request id with an empty body', async () => {
    const { reconcileRequest } = await import('../features/aichat/remote');
    const fetchMock = vi.fn(async () => jsonResponse(200, ACK()))
    vi.stubGlobal('fetch', fetchMock)
    await reconcileRequest('eng-1', 'req-abc12345')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/engagements/eng-1/requests/req-abc12345/reconcile')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({})
  })
})
