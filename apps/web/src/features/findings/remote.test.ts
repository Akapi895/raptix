import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    fetchCuratedFindings: vi.fn(),
    fetchFindings: vi.fn(),
    fetchRetainedCaptures: vi.fn(),
    createCuratedFinding: vi.fn(),
    importCuratedFinding: vi.fn(),
    attachEvidence: vi.fn(),
    classifyCapture: vi.fn(),
    uploadCapture: vi.fn(),
    downloadCapture: vi.fn(),
    updateCuratedFinding: vi.fn(),
    transitionCuratedFinding: vi.fn(),
    addCuratedFindingComment: vi.fn(),
    recordCuratedFindingRetest: vi.fn(),
    fetchFindingSuggestionDispositions: vi.fn(),
    getEngagement: vi.fn(),
  }
})
vi.mock('../projects/remote', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../projects/remote')>()
  return {
    ...actual,
    fetchCuratedFindings: vi.fn(),
    fetchFindings: vi.fn(),
    fetchRetainedCaptures: vi.fn(),
    createCuratedFinding: vi.fn(),
    importCuratedFinding: vi.fn(),
    attachEvidence: vi.fn(),
    classifyCapture: vi.fn(),
    uploadCapture: vi.fn(),
    downloadCapture: vi.fn(),
    updateCuratedFinding: vi.fn(),
    transitionCuratedFinding: vi.fn(),
    addCuratedFindingComment: vi.fn(),
    recordCuratedFindingRetest: vi.fn(),
    fetchFindingSuggestionDispositions: vi.fn(),
    getEngagement: vi.fn(),
  }
})

const api_findings = await import('./api');
const api_projects = await import('../projects/remote');
const { createRealFindingService } = await import('./remote')
const { createRealFeatureServices } = await import('../../state/real-services')
const { ApiTransportError } = await import('../../platform/transport')

const ctx = { actor: { id: 'u', role: 'operator' as const }, projectId: 'RT-1', corr: 'test' }

function curated(overrides: Partial<import('@raptix/web-contracts').CuratedFindingView> = {}): import('@raptix/web-contracts').CuratedFindingView {
  return {
    id: 'CF-1', engagementId: 'RT-1', title: 'Admin panel exposed', severity: 'high', status: 'draft',
    body: { detail: 'Panel reachable without auth.' }, expectedVersion: 3, sourceType: 'authored', producerRef: null,
    createdBy: 'alice', updatedBy: null, createdAt: '2026-10-13T09:00:00.000Z', updatedAt: '2026-10-13T10:00:00.000Z', producerDigest: null, lastReviewDecision: null, comments: [], history: [], retests: [],
    references: { assetId: null, bindingId: null, threadId: null, runId: null, techniqueId: null }, activityCursors: { comments: null, history: null, retests: null },
    evidence: [],
    ...overrides,
  }
}

function view(findings: import('@raptix/web-contracts').CuratedFindingView[]) {
  return { engagementId: 'RT-1', findings, transitions: {}, source: 'db' as const }
}

beforeEach(() => {
  vi.mocked(api_findings.fetchCuratedFindings).mockReset()
  vi.mocked(api_findings.fetchFindings).mockReset()
  vi.mocked(api_findings.fetchFindings).mockResolvedValue({ engagementId: 'RT-1', findings: [], truncated: false, source: 'workspace' })
  vi.mocked(api_findings.fetchRetainedCaptures).mockReset()
  vi.mocked(api_findings.fetchRetainedCaptures).mockResolvedValue({ engagementId: 'RT-1', captures: [], source: 'db' })
  vi.mocked(api_findings.createCuratedFinding).mockReset()
    vi.mocked(api_findings.importCuratedFinding).mockReset()
    vi.mocked(api_findings.attachEvidence).mockReset()
  vi.mocked(api_findings.classifyCapture).mockReset()
  vi.mocked(api_findings.uploadCapture).mockReset()
  vi.mocked(api_findings.downloadCapture).mockReset()
  vi.mocked(api_findings.updateCuratedFinding).mockReset()
  vi.mocked(api_findings.transitionCuratedFinding).mockReset()
  vi.mocked(api_findings.addCuratedFindingComment).mockReset()
  vi.mocked(api_findings.recordCuratedFindingRetest).mockReset()
  vi.mocked(api_findings.fetchFindingSuggestionDispositions).mockReset()
  vi.mocked(api_findings.fetchFindingSuggestionDispositions).mockResolvedValue({ engagementId: 'RT-1', dispositions: [] })
  vi.mocked(api_projects.getEngagement).mockReset()
})

describe('real findings list', () => {
  it('maps curated findings and producer claims without counting producer defaults as verified', async () => {
    vi.mocked(api_findings.fetchCuratedFindings).mockResolvedValue(view([
      curated({ id: 'CF-1', status: 'draft' }),
      curated({ id: 'CF-2', status: 'review', severity: 'critical' }),
      curated({ id: 'CF-3', status: 'resolved', severity: 'informational' }),
    ]))
    vi.mocked(api_findings.fetchFindings).mockResolvedValue({
      engagementId: 'RT-1',
      findings: [{
        engagementId: 'RT-1', id: 'FIND-001', title: 'Producer claim', severity: 'medium',
        description: 'Observed by runtime.', evidence: 'See retained output.', attackVector: 'Unknown',
        affectedAssets: ['10.129.227.140'], quality: { defaultSeverity: true, placeholderDescription: false, placeholderEvidence: false, unreadable: false },
        rawSource: '# FIND-001', sizeBytes: 12, source: 'workspace',
      }],
      truncated: false, source: 'workspace',
    })
    const res = await createRealFindingService().list(ctx, {})
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.total).toBe(4)
    expect(res.data.counts).toMatchObject({ all: 4, drafts: 1, review: 1, remediation: 1, confirmed: 0, ai: 1 })
    expect(res.data.awaitingReview).toBe(1)
    expect(res.data.resolved).toBe(1)
    expect(res.data.severity.info).toBe(1)
    expect(res.data.severity.critical).toBe(1)
    const producer = res.data.items.find((item) => item.finding.id === 'FIND-001')?.finding
    expect(producer).toMatchObject({ status: 'ai_suggested', severity: 'medium', asset: '10.129.227.140' })
    expect(res.data.severity.medium).toBe(0)
  })

  it('filters by category and paginates with clamped page numbers', async () => {
    vi.mocked(api_findings.fetchCuratedFindings).mockResolvedValue(view(
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
    expect(api_findings.fetchCuratedFindings).not.toHaveBeenCalled()
  })

  it('surfaces transport failures as typed service failures', async () => {
    vi.mocked(api_findings.fetchCuratedFindings).mockRejectedValue(new ApiTransportError(403, 'forbidden', 'Not a member.'))
    const res = await createRealFindingService().list(ctx, {})
    expect(res).toEqual({ ok: false, failure: { kind: 'forbidden', message: 'Not a member.' } })
  })
})

describe('real finding writes', () => {
  it('updates with the server expectedVersion read at write time', async () => {
    vi.mocked(api_findings.fetchCuratedFindings).mockResolvedValue(view([curated({ expectedVersion: 7 })]))
    vi.mocked(api_findings.updateCuratedFinding).mockResolvedValue(curated({ title: 'Renamed', expectedVersion: 8 }))
    const res = await createRealFindingService().save(ctx, 'CF-1', {
      title: 'Renamed', severity: 'high', asset: '', op: '', technique: '', desc: 'Panel reachable.', impact: '', rec: '', evidence: [], owner: 'alice',
    })
    expect(api_findings.updateCuratedFinding).toHaveBeenCalledWith('RT-1', 'CF-1', { title: 'Renamed', severity: 'high', detail: 'Panel reachable.', impact: '', recommendation: '', severityRationale: undefined, scopeNote: undefined, references: undefined, expectedVersion: 7 })
    expect(res.ok && res.data.title).toBe('Renamed')
  })

  it('reports a stale write as a conflict instead of overwriting', async () => {
    vi.mocked(api_findings.fetchCuratedFindings).mockResolvedValue(view([curated({ expectedVersion: 7 })]))
    vi.mocked(api_findings.updateCuratedFinding).mockRejectedValue(new ApiTransportError(409, 'conflict', 'Stale version.'))
    const res = await createRealFindingService().save(ctx, 'CF-1', {
      title: 'x', severity: 'low', asset: '', op: '', technique: '', desc: '', impact: '', rec: '', evidence: [], owner: 'alice',
    })
    expect(res).toEqual({ ok: false, failure: { kind: 'conflict', message: 'Stale version.' } })
  })

  it('writes at the version it last observed, so a concurrent edit is refused as a conflict', async () => {
    const service = createRealFindingService()
    vi.mocked(api_findings.fetchCuratedFindings).mockResolvedValue(view([curated({ expectedVersion: 3 })]))
    await service.list(ctx, {})
    vi.mocked(api_findings.updateCuratedFinding).mockRejectedValue(new ApiTransportError(409, 'conflict', 'Stale version.'))
    const res = await service.save(ctx, 'CF-1', {
      title: 'Edited elsewhere', severity: 'high', asset: '', op: '', technique: '', desc: 'Panel reachable.', impact: '', rec: '', evidence: [], owner: 'alice',
    })
    expect(api_findings.updateCuratedFinding).toHaveBeenCalledWith('RT-1', 'CF-1', expect.objectContaining({ expectedVersion: 3 }))
    expect(res).toEqual({ ok: false, failure: { kind: 'conflict', message: 'Stale version.' } })
  })

  it('refuses fields the curated workflow would silently drop', async () => {
    const res = await createRealFindingService().save(ctx, null, {
      title: 'x', severity: 'low', asset: 'web-01', op: '', technique: '', desc: '', impact: '', rec: '', evidence: [], owner: 'alice',
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.kind).toBe('validation')
    expect(res.failure.message).toContain('managed asset identity')
    expect(api_findings.createCuratedFinding).not.toHaveBeenCalled()
  })

  it('persists returned as its own transition with the reviewer reason and current version', async () => {
    vi.mocked(api_findings.fetchCuratedFindings).mockResolvedValue(view([curated({ status: 'review', expectedVersion: 4 })]))
    vi.mocked(api_findings.transitionCuratedFinding).mockResolvedValue(curated({ status: 'returned', expectedVersion: 5 }))
    const res = await createRealFindingService().transition(ctx, 'CF-1', 'returned', 'Add impact evidence.')
    expect(api_findings.transitionCuratedFinding).toHaveBeenCalledWith('RT-1', 'CF-1', 'returned', 4, 'Add impact evidence.')
    expect(res.ok && res.data.status).toBe('returned')
  })

  it('keeps the form-rendered version even when a later inventory read observes a new version', async () => {
    const service = createRealFindingService()
    vi.mocked(api_findings.fetchCuratedFindings).mockResolvedValue(view([curated({ expectedVersion: 9, evidence: [] })]))
    await service.list(ctx, {})
    vi.mocked(api_findings.updateCuratedFinding).mockRejectedValue(new ApiTransportError(409, 'conflict', 'Stale form.'))
    const res = await service.save(ctx, 'CF-1', {
      title: 'Edited old form', severity: 'high', asset: '', desc: 'Edited.', impact: '', rec: '', evidence: [], owner: 'alice', expectedVersion: 3,
    })
    expect(api_findings.updateCuratedFinding).toHaveBeenCalledWith('RT-1', 'CF-1', expect.objectContaining({ expectedVersion: 3 }))
    expect(res).toMatchObject({ ok: false, failure: { kind: 'conflict' } })
  })

  it('allows narrative edits to retain already-linked evidence without silently changing links', async () => {
    const evidence: import('@raptix/web-contracts').CuratedFindingView['evidence'] = [{ id: 'EV-1', engagementId: 'RT-1', captureId: null, kind: 'artifact', artifactPath: 'captures/a.png', digest: null, producer: 'recon', createdAt: '2026-10-13T09:00:00.000Z' }]
    vi.mocked(api_findings.fetchCuratedFindings).mockResolvedValue(view([curated({ evidence })]))
    vi.mocked(api_findings.updateCuratedFinding).mockResolvedValue(curated({ evidence, expectedVersion: 4, body: { detail: 'Edited narrative.', impact: 'Impact recorded.' } }))
    const res = await createRealFindingService().save(ctx, 'CF-1', {
      title: 'Existing evidence', severity: 'high', asset: '', desc: 'Edited narrative.', impact: 'Impact recorded.', rec: '', evidence: ['EV-1'], owner: 'alice', expectedVersion: 3,
    })
    expect(res.ok && res.data.impact).toBe('Impact recorded.')
    expect(res.ok && res.data.evidence).toEqual(['EV-1'])
  })

  it('adds a comment using the caller-pinned version and request identity', async () => {
    vi.mocked(api_findings.fetchCuratedFindings).mockResolvedValue(view([curated({ expectedVersion: 7 })]))
    vi.mocked(api_findings.addCuratedFindingComment).mockResolvedValue(curated({ expectedVersion: 8, comments: [{ id: 'comment-1', actorId: 'operator', createdAt: '2026-10-17T10:00:00.000Z', text: 'Added impact evidence.', findingVersion: 8 }] }))
    const service = createRealFindingService()
    await service.list(ctx, {})
    const res = await service.addComment(ctx, 'CF-1', 'Added impact evidence.', 7, 'request-1')
    expect(api_findings.addCuratedFindingComment).toHaveBeenCalledWith('RT-1', 'CF-1', { text: 'Added impact evidence.', expectedVersion: 7, requestId: 'request-1' })
    expect(res.ok && res.data.comments).toEqual([{ id: 'comment-1', version: 8, by: 'operator', at: expect.any(String), text: 'Added impact evidence.' }])
  })

  it('records retest outcomes against the last observed version and maps persistence fields', async () => {
    vi.mocked(api_findings.fetchCuratedFindings).mockResolvedValue(view([curated({ status: 'retest', expectedVersion: 5 })]))
    vi.mocked(api_findings.recordCuratedFindingRetest).mockResolvedValue(curated({ status: 'remediation', expectedVersion: 6, retests: [{ id: 'retest-1', actorId: 'operator', createdAt: '2026-10-17T10:00:00.000Z', result: 'Persists', note: 'Still reproducible.', findingVersion: 6, evidenceRefs: [] }] }))
    const service = createRealFindingService()
    await service.list(ctx, {})
    const res = await service.recordRetest(ctx, 'CF-1', { result: 'Persists', note: 'Still reproducible.', requestId: 'request-2' })
    expect(api_findings.recordCuratedFindingRetest).toHaveBeenCalledWith('RT-1', 'CF-1', { result: 'Persists', note: 'Still reproducible.', requestId: 'request-2', expectedVersion: 5 })
    expect(res.ok && res.data.status).toBe('remediation')
    expect(res.ok && res.data.retests).toMatchObject([{ result: 'Persists', note: 'Still reproducible.' }])
  })

  it('imports a workspace producer finding as a curated draft with its workspace path', async () => {
    vi.mocked(api_findings.fetchFindings).mockResolvedValue({
      engagementId: 'RT-1',
      findings: [{
        engagementId: 'RT-1', id: 'FIND-001', title: 'Producer claim', severity: 'medium',
        description: 'Observed by runtime.', evidence: 'See retained output.', attackVector: 'Unknown',
        affectedAssets: ['10.129.227.140'], quality: { defaultSeverity: true, placeholderDescription: false, placeholderEvidence: false, unreadable: false },
        rawSource: '# FIND-001', sizeBytes: 12, source: 'workspace',
      }],
      truncated: false, source: 'workspace',
    })
    vi.mocked(api_findings.importCuratedFinding).mockResolvedValue(curated({ id: 'CF-imported', sourceType: 'imported', producerRef: 'findings/FIND-001.md' }))
    const res = await createRealFindingService().importSuggestion(ctx, 'FIND-001')
    expect(api_findings.importCuratedFinding).toHaveBeenCalledWith('RT-1', {
      title: 'Producer claim', severity: 'medium', detail: 'Observed by runtime.', producerRef: 'findings/FIND-001.md',
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data).toMatchObject({ id: 'CF-imported', status: 'draft' })
  })

  it('refuses an import ID that is not present in the selected engagement producer read', async () => {
    const res = await createRealFindingService().importSuggestion(ctx, 'FIND-FOREIGN')
    expect(res).toEqual({ ok: false, failure: { kind: 'not-found', message: 'Producer finding FIND-FOREIGN is not available in this engagement.' } })
    expect(api_findings.importCuratedFinding).not.toHaveBeenCalled()
  })
})

describe('real evidence reads', () => {
  it('lists the evidence linked into curated findings, filtered by kind and text', async () => {
    vi.mocked(api_findings.fetchCuratedFindings).mockResolvedValue(view([
      curated({ id: 'CF-1', evidence: [{ id: 'EV-1', engagementId: 'RT-1', captureId: null, kind: 'artifact', artifactPath: 'captures/admin.png', digest: null, producer: 'recon', createdAt: '2026-10-13T09:00:00.000Z' }] }),
      curated({ id: 'CF-2', evidence: [{ id: 'EV-2', engagementId: 'RT-1', captureId: null, kind: 'digest', artifactPath: null, digest: 'abcdef0123456789', producer: null, createdAt: '2026-10-13T09:30:00.000Z' }] }),
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

  it('lists unclassified retained captures as metadata without claiming readable original bytes', async () => {
    vi.mocked(api_findings.fetchCuratedFindings).mockResolvedValue(view([]))
    vi.mocked(api_findings.fetchRetainedCaptures).mockResolvedValue({ engagementId: 'RT-1', source: 'db', captures: [{
      id: 'cap-1', engagementId: 'RT-1', filename: null, mediaType: 'application/octet-stream', sizeBytes: 4,
      digest: 'a'.repeat(64), producer: 'web-user:operator', classification: 'unclassified', classificationVersion: 1,
      uploadedBy: 'operator', classifiedBy: null, classificationReason: null, classifiedAt: null,
      createdAt: '2026-10-13T10:00:00.000Z', canReadOriginal: false, canClassify: false,
    }] })
    const res = await createRealFindingService().listEvidence(ctx, {})
    expect(res.ok && res.data.items).toMatchObject([{ ref: 'cap-1', captureId: 'cap-1', masked: true, classification: 'unclassified', canViewOriginal: false }])
  })

  it('exposes a retained unlinked capture to the classification queue with no original-read claim', async () => {
    vi.mocked(api_findings.fetchCuratedFindings).mockResolvedValue(view([]))
    vi.mocked(api_findings.fetchRetainedCaptures).mockResolvedValue({ engagementId: 'RT-1', source: 'db', captures: [{
      id: 'cap-unclassified', engagementId: 'RT-1', filename: null, mediaType: 'text/plain', sizeBytes: 4,
      digest: 'a'.repeat(64), producer: 'web-user:operator', classification: 'unclassified', classificationVersion: 1,
      uploadedBy: 'operator', classifiedBy: null, classificationReason: null, classifiedAt: null,
      createdAt: '2026-10-13T10:00:00.000Z', canReadOriginal: false, canClassify: true,
    }] })
    const res = await createRealFindingService().listEvidence(ctx, {})
    expect(res.ok && res.data.items).toMatchObject([{ ref: 'cap-unclassified', captureId: 'cap-unclassified', classification: 'unclassified', canClassify: true, canViewOriginal: false }])
  })

  it('uploads bytes as an unclassified retained capture without auto-linking it', async () => {
    vi.mocked(api_findings.uploadCapture).mockResolvedValue({
      id: 'cap-2', engagementId: 'RT-1', filename: null, mediaType: 'text/plain', sizeBytes: 2,
      digest: 'b'.repeat(64), producer: 'web-user:operator', classification: 'unclassified', classificationVersion: 1,
      uploadedBy: 'operator', classifiedBy: null, classificationReason: null, classifiedAt: null,
      createdAt: '2026-10-13T10:00:00.000Z', canReadOriginal: false, canClassify: false,
    })
    const res = await createRealFindingService().uploadEvidence(ctx, {
      findingId: 'CF-1', name: 'note.txt', kind: 'Text', source: 'Manual', sensitive: false, requestId: 'req-1', bytes: new Uint8Array([0x41, 0x42]), mediaType: 'text/plain',
    })
    expect(api_findings.uploadCapture).toHaveBeenCalledWith('RT-1', { requestId: 'req-1', filename: 'note.txt', mediaType: 'text/plain', base64: 'QUI=' })
    expect(api_findings.attachEvidence).not.toHaveBeenCalled()
    expect(res.ok && res.data).toMatchObject({ id: 'cap-2', classification: 'unclassified', captureId: 'cap-2', sensitive: false, canViewOriginal: false })
  })

  it('classifies an observed capture with its read version and returns the new server version', async () => {
    vi.mocked(api_findings.classifyCapture).mockResolvedValue({
      id: 'cap-2', engagementId: 'RT-1', filename: 'note.txt', mediaType: 'text/plain', sizeBytes: 2,
      digest: 'b'.repeat(64), producer: 'web-user:operator', classification: 'standard', classificationVersion: 2,
      uploadedBy: 'operator', classifiedBy: 'reviewer', classificationReason: 'Reviewed lab evidence.',
      classifiedAt: '2026-10-13T11:00:00.000Z', createdAt: '2026-10-13T10:00:00.000Z', canReadOriginal: true, canClassify: true,
    })
    const res = await createRealFindingService().classifyCapture(ctx, 'cap-2', 'standard', 1, 'Reviewed lab evidence.')
    expect(api_findings.classifyCapture).toHaveBeenCalledWith('RT-1', 'cap-2', { classification: 'standard', expectedVersion: 1, reason: 'Reviewed lab evidence.' })
    expect(res.ok && res.data).toMatchObject({ captureId: 'cap-2', classification: 'standard', classificationVersion: 2, canViewOriginal: true })
  })

  it('attaches only classified captures with the finding version last read', async () => {
    vi.mocked(api_findings.fetchRetainedCaptures).mockResolvedValue({ engagementId: 'RT-1', source: 'db', captures: [{
      id: 'cap-1', engagementId: 'RT-1', filename: 'capture.png', mediaType: 'image/png', sizeBytes: 2,
      digest: 'c'.repeat(64), producer: 'web-user:operator', classification: 'standard', classificationVersion: 2,
      uploadedBy: 'operator', classifiedBy: 'reviewer', classificationReason: 'Standard test capture.',
      classifiedAt: '2026-10-13T10:30:00.000Z', createdAt: '2026-10-13T10:00:00.000Z', canReadOriginal: true, canClassify: true,
    }] })
    vi.mocked(api_findings.fetchCuratedFindings)
      .mockResolvedValueOnce(view([curated({ expectedVersion: 3 })]))
      .mockResolvedValue(view([curated({ expectedVersion: 4, evidence: [{ id: 'link-1', engagementId: 'RT-1', captureId: 'cap-1', kind: 'artifact', artifactPath: 'findings/capture-cap-1.png', digest: 'c'.repeat(64), producer: 'web-user:operator', createdAt: '2026-10-13T11:00:00.000Z' }] })]))
    vi.mocked(api_findings.attachEvidence).mockResolvedValue({ id: 'link-1', engagementId: 'RT-1', captureId: 'cap-1', kind: 'artifact', artifactPath: 'findings/capture-cap-1.png', digest: 'c'.repeat(64), producer: 'web-user:operator', createdAt: '2026-10-13T11:00:00.000Z' })
    const res = await createRealFindingService().attachEvidence(ctx, 'CF-1', 'cap-1')
    expect(api_findings.attachEvidence).toHaveBeenCalledWith('RT-1', 'CF-1', { kind: 'artifact', captureId: 'cap-1', expectedVersion: 3 })
    expect(res.ok && res.data.evidence).toContain('link-1')
  })

  it('rejects original bytes whose SHA-256 does not match the retained descriptor', async () => {
    const descriptor = { id: 'cap-3', engagementId: 'RT-1', filename: 'note.txt', mediaType: 'text/plain', sizeBytes: 2, digest: 'a'.repeat(64), producer: null, classification: 'standard' as const, classificationVersion: 2, uploadedBy: 'owner', classifiedBy: 'reviewer', classificationReason: 'approved', classifiedAt: '2026-10-13T10:00:00.000Z', createdAt: '2026-10-13T09:00:00.000Z', canReadOriginal: true, canClassify: true }
    vi.mocked(api_findings.fetchCuratedFindings).mockResolvedValue(view([]))
    vi.mocked(api_findings.fetchRetainedCaptures).mockResolvedValue({ engagementId: 'RT-1', captures: [descriptor], source: 'db' })
    vi.mocked(api_findings.downloadCapture).mockResolvedValue({ bytes: new Uint8Array([0x41, 0x42]), mediaType: 'application/octet-stream', filename: 'note.txt', digest: 'a'.repeat(64) })
    const result = await createRealFindingService().downloadEvidence(ctx, 'cap-3')
    expect(result).toEqual({ ok: false, failure: { kind: 'conflict', message: 'Downloaded bytes do not match the retained capture digest.' } })
  })

  it('reports a missing evidence reference as not-found and an unverified integrity baseline', async () => {
    vi.mocked(api_findings.fetchCuratedFindings).mockResolvedValue(view([curated({ id: 'CF-1' })]))
    vi.mocked(api_projects.getEngagement).mockResolvedValue({ id: 'RT-1', displayName: 'Lab' } as never)
    const missing = await createRealFindingService().getEvidence(ctx, 'EV-404')
    expect(missing).toEqual({ ok: false, failure: { kind: 'not-found', message: 'ID EV-404 does not exist or is not available for your account.' } })
    vi.mocked(api_findings.fetchCuratedFindings).mockResolvedValue(view([curated({ id: 'CF-1', evidence: [{ id: 'EV-1', engagementId: 'RT-1', captureId: null, kind: 'artifact', artifactPath: 'a.png', digest: null, producer: null, createdAt: '2026-10-13T09:00:00.000Z' }] })]))
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
