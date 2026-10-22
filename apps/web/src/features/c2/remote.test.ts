/**
 * The C2 provider adapter maps the provider's registry, grants and command ledger
 * onto the port: check-ins become instants, the grant bounds come from the server,
 * and a provider that is unreachable or refuses a dispatch is reported as that
 * refusal, never as an empty or substitute view.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    fetchC2Sessions: vi.fn(),
    fetchC2Grants: vi.fn(),
    fetchC2Commands: vi.fn(),
    dispatchC2Command: vi.fn(),
  }
})

const api_c2 = await import('./api');
const { ApiTransportError } = await import('../../platform/transport')
const { createRealC2ProviderService } = await import('./remote')

const ctx = { actor: { id: 'u-owner', role: 'manager' as const }, projectId: 'eng-1', corr: 'test' }

beforeEach(() => {
  vi.mocked(api_c2.fetchC2Sessions).mockReset()
  vi.mocked(api_c2.fetchC2Grants).mockReset()
  vi.mocked(api_c2.fetchC2Commands).mockReset()
  vi.mocked(api_c2.dispatchC2Command).mockReset()
})

describe('real C2 provider service', () => {
  it('maps the registry and states the check-in as an instant', async () => {
    vi.mocked(api_c2.fetchC2Sessions).mockResolvedValue({
      engagementId: 'eng-1', source: 'sliver',
      sessions: [{ id: 'sess-1', name: 's', hostname: 'host-9', username: 'svc', os: 'linux', arch: 'amd64', transport: 'mtls', remoteAddress: '10.0.0.9:443', activeC2: 'mtls', version: '1', pid: 1, listenerPort: 8888, lastCheckin: 1_700_000_000, isDead: false }],
      listeners: [{ engagementId: 'eng-1', protocol: 'mtls', port: 8888, jobId: 7, active: true }],
      profiles: [{ name: 'lab', created: 1, userAgent: 'ua', headerCount: 0, cookieCount: 0, parameterCount: 0, pathSegmentCount: 0 }],
    } as never)
    const result = await createRealC2ProviderService().surface(ctx)
    expect(result).toMatchObject({
      ok: true,
      data: {
        sessions: [{ id: 'sess-1', lastCheckin: '2023-11-14T22:13:20.000Z', isDead: false }],
        listeners: [{ jobId: 7, protocol: 'mtls', active: true }],
        profiles: [{ name: 'lab', userAgent: 'ua' }],
      },
    })
  })

  it('takes the grant bounds from the server rather than a value of its own', async () => {
    vi.mocked(api_c2.fetchC2Grants).mockResolvedValue({ engagementId: 'eng-1', grants: [], minGrantHours: 2, maxGrantHours: 8, source: 'db' } as never)
    const result = await createRealC2ProviderService().grants(ctx)
    expect(result).toEqual({ ok: true, data: { grants: [], bounds: { minHours: 2, maxHours: 8 } } })
  })

  it('reports a provider that is unreachable as unavailable, with the server’s message and no substitute view', async () => {
    vi.mocked(api_c2.fetchC2Sessions).mockRejectedValue(new ApiTransportError(503, 'unavailable', 'The C2 provider is not configured for this deployment.'))
    const result = await createRealC2ProviderService().surface(ctx)
    expect(result).toEqual({ ok: false, failure: { kind: 'unavailable', message: 'The C2 provider is not configured for this deployment.' } })
  })

  it('passes a refused dispatch through as its refusal, never as a sent command', async () => {
    vi.mocked(api_c2.dispatchC2Command).mockRejectedValue(new ApiTransportError(409, 'conflict', 'No live approved grant covers this session.'))
    const result = await createRealC2ProviderService().dispatch(ctx, { sessionId: 'sess-1', requestId: 'req-1', path: '/usr/bin/id', args: [] })
    expect(result).toEqual({ ok: false, failure: { kind: 'conflict', message: 'No live approved grant covers this session.' } })
  })

  it('answers a missing engagement as a validation failure, never as an empty registry', async () => {
    const result = await createRealC2ProviderService().surface({ ...ctx, projectId: 'all' })
    expect(result).toMatchObject({ ok: false, failure: { kind: 'validation' } })
    expect(api_c2.fetchC2Sessions).not.toHaveBeenCalled()
  })
})
