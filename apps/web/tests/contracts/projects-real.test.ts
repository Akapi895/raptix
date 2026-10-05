import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectViewModel } from '@raptix/web-contracts'
import {
  ApiCanceledError,
  ApiClientError,
  ApiInvalidResponseError,
  ApiNetworkError,
  ApiStatusError,
  ApiTimeoutError,
  isKnownApiErrorCode,
  parseApiStatusError,
} from '../../src/shared/api/errors'
import { DEFAULT_TIMEOUT_MS, encodePathSegment, joinApiPath, requestJson } from '../../src/shared/api/http'
import { realProjectsApi } from '../../src/features/projects/api/projects-real'
import { createProjectReal, projectsStore } from '../../src/features/projects/hooks/use-real-projects'

interface RecordedCall {
  url: string
  init: RequestInit
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function projectDto(overrides: Partial<ProjectViewModel> = {}): ProjectViewModel {
  return {
    id: 'eng_001',
    workspaceSlug: 'authorized-assessment',
    displayName: 'Authorized Assessment',
    targetType: 'web_url',
    targetValue: 'http://authorized-local-target:3010',
    authorizationConfirmed: true,
    metadataState: 'verified',
    lifecycleStatus: 'draft',
    findingCount: null,
    assetCount: null,
    activeAgentCount: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T11:00:00.000Z',
    source: 'api',
    ...overrides,
  }
}

let calls: RecordedCall[] = []

function stubFetch(handler: (call: RecordedCall) => Response | Promise<Response>): void {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const call: RecordedCall = { url: String(url), init }
    calls.push(call)
    return handler(call)
  }))
}

function stubPendingFetch(): Array<(response: Response) => void> {
  calls = []
  const resolvers: Array<(response: Response) => void> = []
  vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    return new Promise<Response>(resolve => resolvers.push(resolve))
  }))
  return resolvers
}

async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  projectsStore.reset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('shared/api/http', () => {
  it('joins the api base url with paths and encodes dynamic segments', () => {
    expect(joinApiPath('/api', '/engagements')).toBe('/api/engagements')
    expect(joinApiPath('/api/', 'engagements')).toBe('/api/engagements')
    expect(joinApiPath('http://127.0.0.1:5280', '/api/engagements')).toBe('http://127.0.0.1:5280/api/engagements')
    expect(encodePathSegment('a b/c')).toBe('a%20b%2Fc')
  })

  it('returns parsed JSON for ok responses', async () => {
    stubFetch(() => jsonResponse(200, { ok: true }))
    await expect(requestJson('/api', '/api/health')).resolves.toEqual({ ok: true })
  })

  it('preserves the server status and envelope code/message on http errors', async () => {
    stubFetch(() => jsonResponse(409, {
      statusCode: 409,
      error: { code: 'conflict', message: 'An engagement named "x" already exists for this owner' },
    }))
    const error = await requestJson('/api', '/api/engagements').then(
      () => { throw new Error('expected rejection') },
      cause => cause,
    )
    expect(error).toBeInstanceOf(ApiStatusError)
    const statusError = error as ApiStatusError
    expect(statusError.statusCode).toBe(409)
    expect(statusError.code).toBe('conflict')
    expect(statusError.message).toBe('An engagement named "x" already exists for this owner')
    expect(statusError.isConflict).toBe(true)
  })

  it('degrades malformed error bodies while preserving the http status', async () => {
    stubFetch(() => new Response('<html>gateway timeout</html>', { status: 502 }))
    const error = await requestJson('/api', '/api/engagements').then(
      () => { throw new Error('expected rejection') },
      cause => cause,
    )
    expect(error).toBeInstanceOf(ApiStatusError)
    expect((error as ApiStatusError).statusCode).toBe(502)
    expect((error as ApiStatusError).code).toBe('unknown')
    expect(parseApiStatusError(400, { error: 'legacy shape' }).code).toBe('unknown')
    const fielded = parseApiStatusError(400, {
      statusCode: 400,
      error: { code: 'bad_request', message: 'bad name', details: { field: 'name' } },
    })
    expect(fielded.field).toBe('name')
    expect(parseApiStatusError(400, {
      statusCode: 400, error: { code: 'bad_request', message: 'no details' },
    }).field).toBeUndefined()
  })

  it('maps per-operation timeouts distinctly from route cancellation', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: RequestInfo | URL, init: RequestInit = {}) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))
    const timedOut = expect(requestJson('/api', '/api/engagements')).rejects.toBeInstanceOf(ApiTimeoutError)
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 1)
    await timedOut

    const external = new AbortController()
    const canceled = expect(
      requestJson('/api', '/api/engagements', { signal: external.signal }),
    ).rejects.toBeInstanceOf(ApiCanceledError)
    external.abort()
    await canceled
  })

  it('never retries mutations even when retries are requested', async () => {
    stubFetch(() => { throw new TypeError('network down') })
    await expect(
      requestJson('/api', '/api/engagements', { method: 'POST', body: {}, retries: 3 }),
    ).rejects.toBeInstanceOf(ApiNetworkError)
    expect(calls).toHaveLength(1)
  })

  it('retries GET reads at most once on transport failures', async () => {
    let attempt = 0
    stubFetch(() => {
      attempt += 1
      if (attempt === 1) throw new TypeError('network down')
      return jsonResponse(200, [])
    })
    await expect(requestJson('/api', '/api/engagements', { retries: 5 })).resolves.toEqual([])
    expect(calls).toHaveLength(2)
  })

  it('rejects 2xx bodies that are not valid JSON instead of casting', async () => {
    stubFetch(() => new Response('<html>not json</html>', { status: 200 }))
    await expect(requestJson('/api', '/api/engagements')).rejects.toBeInstanceOf(ApiInvalidResponseError)
  })

  it('keeps the deadline and cancellation scope across the response body read', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init: RequestInit = {}) => ({
      ok: true,
      status: 200,
      json: () => new Promise<never>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }),
    }) as unknown as Response))
    const timedOut = expect(requestJson('/api', '/api/engagements')).rejects.toBeInstanceOf(ApiTimeoutError)
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 1)
    await timedOut

    const external = new AbortController()
    const canceled = expect(
      requestJson('/api', '/api/engagements', { signal: external.signal }),
    ).rejects.toBeInstanceOf(ApiCanceledError)
    await vi.advanceTimersByTimeAsync(0)
    external.abort()
    await canceled
  })

  it('exposes the known server error code set without trusting unknown codes', () => {
    expect(isKnownApiErrorCode('too_many_requests')).toBe(true)
    expect(isKnownApiErrorCode('internal_error')).toBe(true)
    expect(isKnownApiErrorCode('something_else')).toBe(false)
  })
})

describe('features/projects/projects-real adapter', () => {
  it('validates every list entry against ProjectViewModel and rejects malformed data', async () => {
    stubFetch(() => jsonResponse(200, [projectDto(), { id: 'broken' }]))
    await expect(realProjectsApi.list()).rejects.toBeInstanceOf(ApiInvalidResponseError)
  })

  it('passes through nullable counts, metadataState and provenance untouched', async () => {
    const dto = projectDto({ metadataState: 'needs_review', findingCount: null, assetCount: 0, source: 'api' })
    stubFetch(() => jsonResponse(200, [dto]))
    const projects = await realProjectsApi.list()
    expect(projects).toEqual([dto])
    expect(projects[0].findingCount).toBeNull()
    expect(projects[0].metadataState).toBe('needs_review')
  })

  it('sends the exact create payload with literal authorizationConfirmed true', async () => {
    stubFetch(() => jsonResponse(201, projectDto({ id: 'eng_002', workspaceSlug: 'fresh-slug' })))
    const created = await realProjectsApi.create({
      name: 'fresh-slug',
      displayName: 'Fresh Slug',
      targetType: 'ip_range',
      targetValue: '10.0.0.0/24',
      authorizationConfirmed: true,
    })
    expect(created.id).toBe('eng_002')
    expect(calls[0].url).toBe('/api/engagements')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      name: 'fresh-slug',
      displayName: 'Fresh Slug',
      targetType: 'ip_range',
      targetValue: '10.0.0.0/24',
      authorizationConfirmed: true,
    })

    stubFetch(() => jsonResponse(201, projectDto()))
    await realProjectsApi.create({
      name: 'fresh-slug', targetType: 'web_url', targetValue: 'https://x.example',
      authorizationConfirmed: true,
    })
    expect(JSON.parse(String(calls[0].init.body))).not.toHaveProperty('displayName')
  })

  it('patches only the supported fields to the encoded engagement id', async () => {
    stubFetch(call => {
      expect(call.url).toBe('/api/engagements/eng%2F001')
      expect(call.init.method).toBe('PATCH')
      return jsonResponse(200, projectDto())
    })
    await realProjectsApi.updateSupportedFields('eng/001', { displayName: 'Renamed' })
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ displayName: 'Renamed' })
  })

  it('encodes dynamic id segments for get', async () => {
    stubFetch(call => {
      expect(call.url).toBe('/api/engagements/eng%20001')
      return jsonResponse(200, projectDto())
    })
    await expect(realProjectsApi.get('eng 001')).resolves.toMatchObject({ id: 'eng_001' })
  })
})

describe('use-real-projects store', () => {
  it('dedups concurrent list reads into one request and aborts on last release', async () => {
    const resolvers = stubPendingFetch()
    projectsStore.retainList()
    projectsStore.retainList()
    expect(calls).toHaveLength(1)

    const signal = calls[0].init.signal as AbortSignal
    projectsStore.releaseList()
    projectsStore.releaseList()
    expect(signal.aborted).toBe(true)

    // The aborted response is superseded: it must not publish state.
    resolvers[0]?.(jsonResponse(200, [projectDto()]))
    await flush()
    expect(projectsStore.readList().status).not.toBe('ready')
  })

  it('surfaces async read errors without fixture fallback, then reloads explicitly', async () => {
    stubFetch(() => jsonResponse(500, { statusCode: 500, error: { code: 'internal_error', message: 'boom' } }))
    projectsStore.retainList()
    await vi.waitFor(() => expect(projectsStore.readList().status).toBe('error'))
    const errored = projectsStore.readList()
    expect(errored.projects).toEqual([])
    expect(errored.error).toBeInstanceOf(ApiClientError)
    expect((errored.error as ApiClientError).kind).toBe('status')
    expect((errored.error as ApiStatusError).statusCode).toBe(500)

    stubFetch(() => jsonResponse(200, [projectDto()]))
    projectsStore.reloadList()
    await vi.waitFor(() => expect(projectsStore.readList().status).toBe('ready'))
  })

  it('create seeds the detail cache with the real server id and refreshes the list', async () => {
    stubFetch(call => {
      if (call.init.method === 'POST') return jsonResponse(201, projectDto({ id: 'eng_009' }))
      return jsonResponse(200, [projectDto({ id: 'eng_009' })])
    })
    const created = await createProjectReal({
      name: 'authorized-assessment',
      targetType: 'web_url',
      targetValue: 'http://authorized-local-target:3010',
      authorizationConfirmed: true,
    })
    expect(created.id).toBe('eng_009')
    const detail = projectsStore.readProject('eng_009')
    expect(detail.status).toBe('ready')
    expect(detail.project?.id).toBe('eng_009')
    await vi.waitFor(() => expect(projectsStore.readList().status).toBe('ready'))
    expect(calls.filter(call => call.init.method === 'POST')).toHaveLength(1)
    expect(calls.filter(call => call.init.method === 'GET')).toHaveLength(1)
  })

  it('mutations invalidate in-flight list reads so pre-mutation results never publish', async () => {
    const resolvers = stubPendingFetch()
    projectsStore.retainList()
    const createPromise = createProjectReal({
      name: 'authorized-assessment',
      targetType: 'web_url',
      targetValue: 'http://authorized-local-target:3010',
      authorizationConfirmed: true,
    })
    resolvers[1]?.(jsonResponse(201, projectDto({ id: 'eng_010' })))
    await flush()
    const staleSignal = calls[0].init.signal as AbortSignal
    expect(staleSignal.aborted).toBe(true)
    expect(calls.filter(call => call.init.method === 'GET')).toHaveLength(2)
    resolvers[2]?.(jsonResponse(200, [projectDto({ id: 'eng_010' })]))
    await flush()
    resolvers[0]?.(jsonResponse(200, []))
    await flush()
    const list = projectsStore.readList()
    expect(list.status).toBe('ready')
    expect(list.projects.map(project => project.id)).toEqual(['eng_010'])
    await createPromise
  })

  it('never lets superseded reads overwrite fresh scoped state', async () => {
    const resolvers: Array<(response: Response) => void> = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolvers.push(resolve) })))
    projectsStore.retainList()
    projectsStore.releaseList()
    projectsStore.retainList()
    resolvers[1]?.(jsonResponse(200, [projectDto({ id: 'eng_B' })]))
    await flush()
    expect(projectsStore.readList().projects.map(project => project.id)).toEqual(['eng_B'])
    resolvers[0]?.(jsonResponse(200, [projectDto({ id: 'eng_A' })]))
    await flush()
    expect(projectsStore.readList().projects.map(project => project.id)).toEqual(['eng_B'])
  })
})
