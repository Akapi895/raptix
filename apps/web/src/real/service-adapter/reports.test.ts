import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchReports: vi.fn(),
    createReport: vi.fn(),
    updateReport: vi.fn(),
    submitReportForReview: vi.fn(),
    decideReportReview: vi.fn(),
    deliverReport: vi.fn(),
  }
})

const api = await import('../api')
const { createRealReportService } = await import('./reports')
const { ApiTransportError } = await import('../transport')

const ctx = { actor: { id: 'user-author', role: 'operator' as const }, projectId: 'eng-1', corr: 'test' }
const reviewerCtx = { actor: { id: 'user-reviewer', role: 'reviewer' as const }, projectId: 'eng-1', corr: 'test' }

function view(overrides: Partial<import('../api').ReportView> = {}): import('../api').ReportView {
  return {
    id: 'rep-1', engagementId: 'eng-1', title: 'External assessment', version: 2, status: 'draft',
    body: { summary: 'Scope summary.', sections: [{ title: 'Results', content: 'Two issues.' }, { title: 'Appendix', content: '' }] },
    createdBy: 'user-author', reviewedBy: null, reviewedAt: null, reviewComment: null, approvedVersion: null,
    updatedAt: '2026-10-14T09:00:00.000Z', deliveries: [],
    ...overrides,
  }
}

function listOf(...reports: import('../api').ReportView[]) {
  return { engagementId: 'eng-1', reports, exportFormats: ['json', 'markdown'], source: 'db' as const }
}

beforeEach(() => {
  vi.mocked(api.fetchReports).mockReset()
  vi.mocked(api.createReport).mockReset()
  vi.mocked(api.updateReport).mockReset()
  vi.mocked(api.submitReportForReview).mockReset()
  vi.mocked(api.decideReportReview).mockReset()
  vi.mocked(api.deliverReport).mockReset()
})

describe('real report reads', () => {
  it('maps the real lifecycle onto the console statuses and counts the KPIs', async () => {
    vi.mocked(api.fetchReports).mockResolvedValue(listOf(
      view({ id: 'a', status: 'draft' }),
      view({ id: 'b', status: 'in_review' }),
      view({ id: 'c', status: 'changes_requested' }),
      view({ id: 'd', status: 'approved', approvedVersion: 2 }),
      view({ id: 'e', status: 'delivered', approvedVersion: 2 }),
    ))
    const res = await createRealReportService().list(ctx, {})
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.items.map((i) => [i.report.id, i.report.status])).toEqual([
      ['a', 'draft'], ['b', 'review'], ['c', 'returned'], ['d', 'approved'], ['e', 'delivered'],
    ])
    expect(res.data.counts).toEqual({ open: 2, review: 1, approved: 1, delivered: 1 })
  })

  it('presents the summary as the fixed first section and the body sections after it', async () => {
    vi.mocked(api.fetchReports).mockResolvedValue(listOf(view()))
    const res = await createRealReportService().editor(ctx, 'rep-1')
    expect(res.ok && res.data.report.sections.map((s) => [s.id, s.title])).toEqual([
      ['summary', 'Summary'], ['s0', 'Results'], ['s1', 'Appendix'],
    ])
  })

  it('withholds editing for a report in review and explains why', async () => {
    vi.mocked(api.fetchReports).mockResolvedValue(listOf(view({ status: 'in_review' })))
    const res = await createRealReportService().editor(ctx, 'rep-1')
    expect(res.ok && res.data.canEdit).toBe(false)
    expect(res.ok && res.data.editReason).toMatch(/draft or a returned report/)
  })

  it('reports a missing report as not-found', async () => {
    vi.mocked(api.fetchReports).mockResolvedValue(listOf())
    const res = await createRealReportService().editor(ctx, 'rep-404')
    expect(res).toEqual({ ok: false, failure: { kind: 'not-found', message: 'Report rep-404 does not exist or is not available for your account.' } })
  })

  it('refuses the aggregate scope instead of fanning out per engagement', async () => {
    const res = await createRealReportService().list({ ...ctx, projectId: '' }, {})
    expect(res.ok).toBe(false)
    expect(api.fetchReports).not.toHaveBeenCalled()
  })
})

describe('real report writes', () => {
  it('saves one section at the version it read and keeps the summary and the other sections', async () => {
    vi.mocked(api.fetchReports).mockResolvedValue(listOf(view({ version: 4 })))
    vi.mocked(api.updateReport).mockResolvedValue(view({ version: 5 }))
    const res = await createRealReportService().saveSection(ctx, 'rep-1', 's0', 'Three issues.')
    expect(api.updateReport).toHaveBeenCalledWith('eng-1', 'rep-1', {
      expectedVersion: 4, title: 'External assessment', summary: 'Scope summary.',
      sections: [{ title: 'Results', content: 'Three issues.' }, { title: 'Appendix', content: '' }],
    })
    expect(res.ok && res.data.version).toBe('v5')
  })

  it('surfaces a concurrent edit as a conflict instead of overwriting', async () => {
    vi.mocked(api.fetchReports).mockResolvedValue(listOf(view({ version: 4 })))
    vi.mocked(api.updateReport).mockRejectedValue(new ApiTransportError(409, 'conflict', 'Concurrent edit.'))
    const res = await createRealReportService().saveSection(ctx, 'rep-1', 's0', 'x')
    expect(res).toEqual({ ok: false, failure: { kind: 'conflict', message: 'Concurrent edit.' } })
  })

  it('keeps the summary fixed: it cannot be removed and must stay first when reordering', async () => {
    const service = createRealReportService()
    const removed = await service.removeSection(ctx, 'rep-1', 'summary')
    expect(removed.ok).toBe(false)
    vi.mocked(api.fetchReports).mockResolvedValue(listOf(view()))
    const reordered = await service.reorderSections(ctx, 'rep-1', ['s0', 'summary', 's1'])
    expect(reordered.ok).toBe(false)
    expect(api.updateReport).not.toHaveBeenCalled()
  })

  it('removes a body section and writes the remaining sections at the read version', async () => {
    vi.mocked(api.fetchReports).mockResolvedValue(listOf(view({ version: 3 })))
    vi.mocked(api.updateReport).mockResolvedValue(view({ version: 4 }))
    await createRealReportService().removeSection(ctx, 'rep-1', 's1')
    expect(api.updateReport).toHaveBeenCalledWith('eng-1', 'rep-1', expect.objectContaining({
      expectedVersion: 3, sections: [{ title: 'Results', content: 'Two issues.' }],
    }))
  })

  it('refuses to submit when the caller holds unsaved section content', async () => {
    vi.mocked(api.fetchReports).mockResolvedValue(listOf(view()))
    const res = await createRealReportService().submit(ctx, 'rep-1', { bodies: { summary: 'Edited but not saved.' } })
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.failure.kind).toBe('validation')
    expect(api.submitReportForReview).not.toHaveBeenCalled()
  })

  it('requires a comment to approve or return and sends the version it read', async () => {
    const service = createRealReportService()
    const empty = await service.decide(reviewerCtx, 'rep-1', 'approve', '  ')
    expect(empty.ok).toBe(false)
    vi.mocked(api.fetchReports).mockResolvedValue(listOf(view({ status: 'in_review', version: 2 })))
    vi.mocked(api.decideReportReview).mockResolvedValue(view({ status: 'approved', approvedVersion: 2, version: 2 }))
    const res = await service.decide(reviewerCtx, 'rep-1', 'approve', 'Looks right.')
    expect(api.decideReportReview).toHaveBeenCalledWith('eng-1', 'rep-1', { decision: 'approved', comment: 'Looks right.', expectedVersion: 2 })
    expect(res.ok && res.data.status).toBe('approved')
  })

  it('records a manual delivery of the approved version only, with recipient and receipt', async () => {
    const service = createRealReportService()
    const unconfirmed = await service.deliver(ctx, 'rep-1', { recipient: 'Client', channel: 'email', notes: 'sent', confirm: false })
    expect(unconfirmed.ok).toBe(false)
    vi.mocked(api.fetchReports).mockResolvedValue(listOf(view({ status: 'approved', approvedVersion: 2 })))
    vi.mocked(api.deliverReport).mockResolvedValue({ ...view({ status: 'delivered', approvedVersion: 2 }), artifact: { reportId: 'rep-1', version: 2, format: 'markdown', mediaType: 'text/markdown', content: '', digest: '' } } as never)
    const res = await service.deliver(ctx, 'rep-1', { recipient: 'Client', channel: 'email', notes: 'sent by mail', confirm: true })
    expect(api.deliverReport).toHaveBeenCalledWith('eng-1', 'rep-1', expect.objectContaining({ kind: 'delivery', expectedVersion: 2, recipient: 'Client', receipt: 'sent by mail' }))
    expect(res.ok && res.data.status).toBe('delivered')
  })
})

describe('real report gates for capabilities the backend does not model', () => {
  it('refuses to link findings and to export PDF or DOCX with the registered reason', async () => {
    const service = createRealReportService()
    const linked = await service.setFindings(ctx, 'rep-1', ['F-1'])
    expect(linked.ok === false && linked.failure.kind).toBe('unavailable')
    expect(linked.ok === false && linked.failure.message).toMatch(/does not link findings/)
    const exported = await service.exportVersion(ctx, 'rep-1', 'PDF')
    expect(exported.ok === false && exported.failure.message).toMatch(/PDF and DOCX export/)
  })

  it('records a delivery only for the operator role and above, never for a reviewer', async () => {
    vi.mocked(api.fetchReports).mockResolvedValue(listOf(view({ status: 'approved', approvedVersion: 2 })))
    const reviewerView = await createRealReportService().review(reviewerCtx, 'rep-1')
    expect(reviewerView.ok && reviewerView.data.gates.deliver.allowed).toBe(false)
    expect(reviewerView.ok && reviewerView.data.gates.deliver.reason).toMatch(/operator role/)
    const operatorView = await createRealReportService().review(ctx, 'rep-1')
    expect(operatorView.ok && operatorView.data.gates.deliver.allowed).toBe(true)
  })

  it('gives the reviewer decision only to a reviewer who did not write the report', async () => {
    vi.mocked(api.fetchReports).mockResolvedValue(listOf(view({ status: 'in_review' })))
    const own = await createRealReportService().review({ ...reviewerCtx, actor: { id: 'user-author', role: 'reviewer' } }, 'rep-1')
    expect(own.ok && own.data.gates.decide.allowed).toBe(false)
    const other = await createRealReportService().review(reviewerCtx, 'rep-1')
    expect(other.ok && other.data.gates.decide.allowed).toBe(true)
  })
})

describe('real report composition', () => {
  it('serves the report adapter only when the reports capability is supported', async () => {
    const { createRealFeatureServices } = await import('./index')
    const unsupported = createRealFeatureServices({ version: 1, mode: 'multi-user', capabilities: {} } as never)
    const res = await unsupported.reports(ctx.actor, 'eng-1').list(ctx, {})
    expect(res.ok === false && res.failure.message).toBe('Reports is not integrated with the real backend yet.')
  })
})
