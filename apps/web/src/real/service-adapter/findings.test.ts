import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchCuratedFindings: vi.fn(),
    createCuratedFinding: vi.fn(),
    updateCuratedFinding: vi.fn(),
    transitionCuratedFinding: vi.fn(),
    getEngagement: vi.fn(),
  }
})

const api = await import('../api')
const { createRealFindingService } = await import('./findings')
const { createRealFeatureServices } = await import('./index')
const { ApiTransportError } = await import('../transport')

const ctx = { actor: { id: 'u', role: 'operator' as const }, projectId: 'RT-1', corr: 'test' }

function curated(overrides: Partial<import('../api').CuratedFindingView> = {}): import('../api').CuratedFindingView {
  return {
    id: 'CF-1', engagementId: 'RT-1', title: 'Admin panel exposed', severity: 'high', status: 'draft',
    body: { detail: 'Panel reachable without auth.' }, expectedVersion: 3, sourceType: 'authored', producerRef: null,
    createdBy: 'alice', updatedBy: null, updatedAt: '2026-10-13T10:00:00.000Z',
    evidence: [{ id: 'EV-1', kind: 'artifact', artifactPath: 'captures/a.png', digest: null, producer: 'recon', createdAt: '2026-10-13T09:00:00.000Z' }],
    ...overrides,
  }
}

function view(findings: import('../api').CuratedFindingView[]) {
  return { engagementId: 'RT-1', findings, transitions: {}, source: 'db' as const }
}

beforeEach(() => {
  vi.mocked(api.fetchCuratedFindings).mockReset()
  vi.mocked(api.createCuratedFinding).mockReset()
  vi.mocked(api.updateCuratedFinding).mockReset()
  vi.mocked(api.transitionCuratedFinding).mockReset()
  vi.mocked(api.getEngagement).mockReset()
})

describe('real findings list', () => {
  it('maps curated findings and derives status counts and KPIs', async () => {
    vi.mocked(api.fetchCuratedFindings).mockResolvedValue(view([
      curated({ id: 'CF-1', status: 'draft' }),
      curated({ id: 'CF-2', status: 'review', severity: 'critical' }),
      curated({ id: 'CF-3', status: 'resolved', severity: 'informational' }),
    ]))
    const res = await createRealFindingService().list(ctx, {})
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.total).toBe(3)
    expect(res.data.counts).toMatchObject({ all: 3, drafts: 1, review: 1, remediation: 1, confirmed: 0, ai: 0 })
    expect(res.data.awaitingReview).toBe(1)
    expect(res.data.resolved).toBe(1)
    expect(res.data.severity.info).toBe(1)
    expect(res.data.severity.critical).toBe(1)
  })

  it('filters by category and paginates with clamped page numbers', async () => {
    vi.mocked(api.fetchCuratedFindings).mockResolvedValue(view(
      Array.from({ length: 12 }, (_, i) => curated({ id: `CF-${String(i).padStart(2, '0')}`, status: i < 11 ? 'draft' : 'review' })),
    ))
    const drafts = await createRealFindingService().list(ctx, { status: 'drafts', page: 99 })
    expect(drafts.ok).toBe(true)
    if (!drafts.ok) return
    expect(drafts.data.total).toBe(11)
    expect(drafts.data.page).toBe(2)
    expect(drafts.data.items).toHaveLength(1)
  })

  it('refuses the aggregate scope instead of fanning out per engagement', async () => {
    const res = await createRealFindingService().list({ ...ctx, projectId: '' }, {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.kind).toBe('unavailable')
    expect(api.fetchCuratedFindings).not.toHaveBeenCalled()
  })

  it('surfaces transport failures as typed service failures', async () => {
    vi.mocked(api.fetchCuratedFindings).mockRejectedValue(new ApiTransportError(403, 'forbidden', 'Not a member.'))
    const res = await createRealFindingService().list(ctx, {})
    expect(res).toEqual({ ok: false, failure: { kind: 'forbidden', message: 'Not a member.' } })
  })
})

describe('real finding writes', () => {
  it('updates with the server expectedVersion read at write time', async () => {
    vi.mocked(api.fetchCuratedFindings).mockResolvedValue(view([curated({ expectedVersion: 7 })]))
    vi.mocked(api.updateCuratedFinding).mockResolvedValue(curated({ title: 'Renamed', expectedVersion: 8 }))
    const res = await createRealFindingService().save(ctx, 'CF-1', {
      title: 'Renamed', severity: 'high', asset: '', op: '', technique: '', desc: 'Panel reachable.', impact: '', rec: '', evidence: [], owner: 'alice',
    })
    expect(api.updateCuratedFinding).toHaveBeenCalledWith('RT-1', 'CF-1', { title: 'Renamed', severity: 'high', detail: 'Panel reachable.', expectedVersion: 7 })
    expect(res.ok && res.data.title).toBe('Renamed')
  })

  it('reports a stale write as a conflict instead of overwriting', async () => {
    vi.mocked(api.fetchCuratedFindings).mockResolvedValue(view([curated({ expectedVersion: 7 })]))
    vi.mocked(api.updateCuratedFinding).mockRejectedValue(new ApiTransportError(409, 'conflict', 'Stale version.'))
    const res = await createRealFindingService().save(ctx, 'CF-1', {
      title: 'x', severity: 'low', asset: '', op: '', technique: '', desc: '', impact: '', rec: '', evidence: [], owner: 'alice',
    })
    expect(res).toEqual({ ok: false, failure: { kind: 'conflict', message: 'Stale version.' } })
  })

  it('writes at the version it last observed, so a concurrent edit is refused as a conflict', async () => {
    const service = createRealFindingService()
    vi.mocked(api.fetchCuratedFindings).mockResolvedValue(view([curated({ expectedVersion: 3 })]))
    await service.list(ctx, {})
    vi.mocked(api.updateCuratedFinding).mockRejectedValue(new ApiTransportError(409, 'conflict', 'Stale version.'))
    const res = await service.save(ctx, 'CF-1', {
      title: 'Edited elsewhere', severity: 'high', asset: '', op: '', technique: '', desc: 'Panel reachable.', impact: '', rec: '', evidence: [], owner: 'alice',
    })
    expect(api.updateCuratedFinding).toHaveBeenCalledWith('RT-1', 'CF-1', expect.objectContaining({ expectedVersion: 3 }))
    expect(res).toEqual({ ok: false, failure: { kind: 'conflict', message: 'Stale version.' } })
  })

  it('refuses fields the curated workflow would silently drop', async () => {
    const res = await createRealFindingService().save(ctx, null, {
      title: 'x', severity: 'low', asset: 'web-01', op: '', technique: '', desc: '', impact: '', rec: '', evidence: [], owner: 'alice',
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.kind).toBe('validation')
    expect(res.failure.message).toMatch(/not linked|Findings are not/)
    expect(api.createCuratedFinding).not.toHaveBeenCalled()
  })

  it('maps the returned transition to the review→draft transition with the current version', async () => {
    vi.mocked(api.fetchCuratedFindings).mockResolvedValue(view([curated({ status: 'review', expectedVersion: 4 })]))
    vi.mocked(api.transitionCuratedFinding).mockResolvedValue(curated({ status: 'draft', expectedVersion: 5 }))
    const res = await createRealFindingService().transition(ctx, 'CF-1', 'returned')
    expect(api.transitionCuratedFinding).toHaveBeenCalledWith('RT-1', 'CF-1', 'draft', 4)
    expect(res.ok && res.data.status).toBe('draft')
  })

  it('refuses transition notes the workflow does not store', async () => {
    const res = await createRealFindingService().transition(ctx, 'CF-1', 'confirmed', 'looks right')
    expect(res.ok).toBe(false)
    expect(api.transitionCuratedFinding).not.toHaveBeenCalled()
  })

  it('returns registered control-gap reasons for operations without a backend concept', async () => {
    const res = await createRealFindingService().importSuggestion(ctx, 'AI-1')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.kind).toBe('unavailable')
    expect(res.failure.message).toMatch(/AI suggestions/)
  })
})

describe('real evidence reads', () => {
  it('lists the evidence linked into curated findings, filtered by kind and text', async () => {
    vi.mocked(api.fetchCuratedFindings).mockResolvedValue(view([
      curated({ id: 'CF-1', evidence: [{ id: 'EV-1', kind: 'artifact', artifactPath: 'captures/admin.png', digest: null, producer: 'recon', createdAt: '2026-10-13T09:00:00.000Z' }] }),
      curated({ id: 'CF-2', evidence: [{ id: 'EV-2', kind: 'digest', artifactPath: null, digest: 'abcdef0123456789', producer: null, createdAt: '2026-10-13T09:30:00.000Z' }] }),
    ]))
    const all = await createRealFindingService().listEvidence(ctx, {})
    expect(all.ok && all.data.kinds).toEqual(['artifact', 'digest'])
    expect(all.ok && all.data.items.map((e) => [e.ref, e.name, e.findingId])).toEqual([
      ['EV-1', 'admin.png', 'CF-1'],
      ['EV-2', 'digest abcdef012345', 'CF-2'],
    ])
    const artifacts = await createRealFindingService().listEvidence(ctx, { kind: 'artifact' })
    expect(artifacts.ok && artifacts.data.items.map((e) => e.ref)).toEqual(['EV-1'])
  })

  it('reports a missing evidence reference as not-found and an unverified integrity baseline', async () => {
    vi.mocked(api.fetchCuratedFindings).mockResolvedValue(view([curated({ id: 'CF-1' })]))
    vi.mocked(api.getEngagement).mockResolvedValue({ id: 'RT-1', displayName: 'Lab' } as never)
    const missing = await createRealFindingService().getEvidence(ctx, 'EV-404')
    expect(missing).toEqual({ ok: false, failure: { kind: 'not-found', message: 'ID EV-404 does not exist or is not available for your account.' } })
    vi.mocked(api.fetchCuratedFindings).mockResolvedValue(view([curated({ id: 'CF-1', evidence: [{ id: 'EV-1', kind: 'artifact', artifactPath: 'a.png', digest: null, producer: null, createdAt: '2026-10-13T09:00:00.000Z' }] })]))
    const found = await createRealFindingService().getEvidence(ctx, 'EV-1')
    expect(found.ok && found.data.integrity).toEqual({ status: 'unverified' })
    expect(found.ok && found.data.findings.map((f) => f.id)).toEqual(['CF-1'])
  })
})

describe('real feature service composition', () => {
  it('serves the findings adapter only when the capability is supported', async () => {
    const supported = createRealFeatureServices({ version: 1, mode: 'multi-user', capabilities: { findings: { supported: true, available: true } } } as never)
    expect(typeof supported.findings(ctx.actor, 'RT-1').list).toBe('function')
    const unsupported = createRealFeatureServices({ version: 1, mode: 'multi-user', capabilities: {} } as never)
    const res = await unsupported.findings(ctx.actor, 'RT-1').list(ctx, {})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.failure.message).toBe('Findings is not integrated with the real backend yet.')
  })
})
