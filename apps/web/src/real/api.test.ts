/** Adapter + mapping tests for the engagement API slice (ticket 03). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectViewModel } from '@raptix/web-contracts'
import { createEngagement, engagementToProject, getEngagement, listEngagements } from '../features/projects/remote';
import { ApiTransportError } from '../platform/transport'

export function dto(overrides: Partial<ProjectViewModel> = {}): ProjectViewModel {
  return {
    id: 'eng-8f3c92a1',
    workspaceSlug: 'q1-external-assessment',
    displayName: 'Q1 External Assessment',
    targetType: 'web_url',
    targetValue: 'https://target.example.test',
    authorizationConfirmed: true,
    brief: 'Assess the public surface.',
    handoffConfirmedAt: null,
    metadataState: 'verified',
    lifecycleStatus: 'planning',
    findingCount: null,
    assetCount: null,
    activeAgentCount: null,
    createdAt: '2026-10-14T08:00:00.000Z',
    updatedAt: '2026-10-14T09:30:00.000Z',
    ...overrides,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('engagement adapters', () => {
  it('lists engagements through GET /api/engagements and validates every entry', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([dto()]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(listEngagements()).resolves.toHaveLength(1)
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('/api/engagements')
  })

  it('rejects a list containing one invalid entry instead of tolerating it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([dto(), { id: 3 }]), { status: 200 })))
    const error = await listEngagements().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiTransportError)
    expect((error as ApiTransportError).code).toBe('internal_error')
  })

  it('fetches one engagement with an encoded id', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(dto({ id: 'eng 8f3c' })), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getEngagement('eng 8f3c')).resolves.toMatchObject({ id: 'eng 8f3c' })
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('/api/engagements/eng%208f3c')
  })

  it('creates an engagement with a POST of the contract fields', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(dto({ lifecycleStatus: 'draft' })), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const created = await createEngagement({
      name: 'q1-external-assessment',
      displayName: 'Q1 External Assessment',
      targetType: 'ip_range',
      targetValue: '10.20.0.0/24',
      authorizationConfirmed: true,
      brief: 'Internal segment.',
    })
    expect(created.lifecycleStatus).toBe('draft')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({ name: 'q1-external-assessment', targetType: 'ip_range', authorizationConfirmed: true })
  })
})

describe('engagementToProject', () => {
  it('maps the DTO onto the UI Project entity with the identity fields intact', () => {
    const project = engagementToProject(dto())
    expect(project.id).toBe('eng-8f3c92a1')
    expect(project.name).toBe('Q1 External Assessment')
    expect(project.type).toBe('web_url')
    expect(project.desc).toBe('Assess the public surface.')
    expect(project.updated).toBe('2026-10-14T09:30:00.000Z')
  })

  it('maps the lifecycle status raw — never relabelled into a demo status', () => {
    expect(engagementToProject(dto()).status).toBe('planning')
    expect(engagementToProject(dto({ lifecycleStatus: 'running' })).status).toBe('running')
    expect(engagementToProject(dto({ lifecycleStatus: 'failed' })).status).toBe('failed')
  })

  it('renders fields without an API source as explicit neutral values, never demo facts', () => {
    const project = engagementToProject(dto())
    expect(project.client).toBe('')
    expect(project.owner).toBe('')
    expect(project.roeStatus).toBe('none')
    expect(project.roeVersion).toBe('')
    expect(project.start).toBe('')
    expect(project.end).toBe('')
    expect(project.emergency).toBe('')
    expect(project.members).toEqual([])
    expect(project.methods).toEqual([])
  })
})
