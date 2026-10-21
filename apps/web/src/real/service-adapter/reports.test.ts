import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../features/reports/remote', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../features/reports/remote')>()
  return {
    ...actual,
    fetchReports: vi.fn(),
    createReport: vi.fn(),
    updateReport: vi.fn(),
    submitReportForReview: vi.fn(),
    decideReportReview: vi.fn(),
    deliverReport: vi.fn(),
    fetchMembers: vi.fn(),
    fetchCuratedFindings: vi.fn(),
    exportReport: vi.fn(),
    updateReportSetup: vi.fn(),
    setReportFindings: vi.fn(),
    acknowledgeReportDelivery: vi.fn(),
    reviseReport: vi.fn(),
    createReportTemplate: vi.fn(),
    fetchAuthSession: vi.fn(),
  }
})
vi.mock('../../features/team/remote', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../features/team/remote')>()
  return {
    ...actual,
    fetchReports: vi.fn(),
    createReport: vi.fn(),
    updateReport: vi.fn(),
    submitReportForReview: vi.fn(),
    decideReportReview: vi.fn(),
    deliverReport: vi.fn(),
    fetchMembers: vi.fn(),
    fetchCuratedFindings: vi.fn(),
    exportReport: vi.fn(),
    updateReportSetup: vi.fn(),
    setReportFindings: vi.fn(),
    acknowledgeReportDelivery: vi.fn(),
    reviseReport: vi.fn(),
    createReportTemplate: vi.fn(),
    fetchAuthSession: vi.fn(),
  }
})
vi.mock('../../features/findings/remote', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../features/findings/remote')>()
  return {
    ...actual,
    fetchReports: vi.fn(),
    createReport: vi.fn(),
    updateReport: vi.fn(),
    submitReportForReview: vi.fn(),
    decideReportReview: vi.fn(),
    deliverReport: vi.fn(),
    fetchMembers: vi.fn(),
    fetchCuratedFindings: vi.fn(),
    exportReport: vi.fn(),
    updateReportSetup: vi.fn(),
    setReportFindings: vi.fn(),
    acknowledgeReportDelivery: vi.fn(),
    reviseReport: vi.fn(),
    createReportTemplate: vi.fn(),
    fetchAuthSession: vi.fn(),
  }
})
vi.mock('../../platform/auth-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platform/auth-api')>()
  return {
    ...actual,
    fetchReports: vi.fn(),
    createReport: vi.fn(),
    updateReport: vi.fn(),
    submitReportForReview: vi.fn(),
    decideReportReview: vi.fn(),
    deliverReport: vi.fn(),
    fetchMembers: vi.fn(),
    fetchCuratedFindings: vi.fn(),
    exportReport: vi.fn(),
    updateReportSetup: vi.fn(),
    setReportFindings: vi.fn(),
    acknowledgeReportDelivery: vi.fn(),
    reviseReport: vi.fn(),
    createReportTemplate: vi.fn(),
    fetchAuthSession: vi.fn(),
  }
})

const api_authApi = await import('../../platform/auth-api');
const api_team = await import('../../features/team/remote');
const api_findings = await import('../../features/findings/remote');
const api_reports = await import('../../features/reports/remote');
const { createRealReportService } = await import('./reports')
const { ApiTransportError } = await import('../../platform/transport')

const ctx = { actor: { id: 'user-author', role: 'operator' as const }, projectId: 'eng-1', corr: 'test' }
const reviewerCtx = { actor: { id: 'user-reviewer', role: 'reviewer' as const }, projectId: 'eng-1', corr: 'test' }

function view(overrides: Partial<import('../../features/reports/remote').ReportView> = {}): import('../../features/reports/remote').ReportView {
  return {
    id: 'rep-1', engagementId: 'eng-1', title: 'External assessment', version: 2, status: 'draft',
    body: { summary: 'Scope summary.', sections: [{ title: 'Results', content: 'Two issues.' }, { title: 'Appendix', content: '' }] },
    createdBy: 'user-author', reviewedBy: null, reviewedAt: null, reviewComment: null, approvedVersion: null,
    updatedAt: '2026-10-14T09:00:00.000Z', templateId: null, templateVersion: null, period: null, reviewerId: null, parentReportId: null, rootReportId: null, selectedFindings: [], readiness: { ready: false, checks: [] }, deliveries: [],
    ...overrides,
  }
}

function listOf(...reports: import('../../features/reports/remote').ReportView[]) {
  return { engagementId: 'eng-1', reports, templates: [], exportFormats: ['json', 'markdown'], source: 'db' as const }
}

beforeEach(() => {
  // No session by default: the tests below exercise the single-user identity; the session case sets its own account.
  vi.mocked(api_authApi.fetchAuthSession).mockReset()
  vi.mocked(api_authApi.fetchAuthSession).mockResolvedValue(null)
  vi.mocked(api_team.fetchMembers).mockResolvedValue({ engagementId: 'eng-1', mode: 'multi-user', canManage: false, inviteSupported: false, reason: null, source: 'db', members: [
    { id: 'user-author', label: 'Ada Author', role: 'operator', source: 'membership' },
    { id: 'user-reviewer', label: 'Rex Reviewer', role: 'reviewer', source: 'membership' },
  ] })
  vi.mocked(api_findings.fetchCuratedFindings).mockResolvedValue({ engagementId: 'eng-1', findings: [], transitions: {}, source: 'db' })
  vi.mocked(api_reports.fetchReports).mockReset()
  vi.mocked(api_reports.createReport).mockReset()
  vi.mocked(api_reports.updateReport).mockReset()
  vi.mocked(api_reports.submitReportForReview).mockReset()
  vi.mocked(api_reports.decideReportReview).mockReset()
  vi.mocked(api_reports.deliverReport).mockReset()
})

describe('real report reads', () => {
  it('maps the real lifecycle onto the console statuses and counts the KPIs', async () => {
    vi.mocked(api_reports.fetchReports).mockResolvedValue(listOf(
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
    vi.mocked(api_reports.fetchReports).mockResolvedValue(listOf(view()))
    const res = await createRealReportService().editor(ctx, 'rep-1')
    expect(res.ok && res.data.report.sections.map((s) => [s.id, s.title])).toEqual([
      ['summary', 'Summary'], ['s0', 'Results'], ['s1', 'Appendix'],
    ])
  })

  it('withholds editing for a report in review and explains why', async () => {
    vi.mocked(api_reports.fetchReports).mockResolvedValue(listOf(view({ status: 'in_review' })))
    const res = await createRealReportService().editor(ctx, 'rep-1')
    expect(res.ok && res.data.canEdit).toBe(false)
    expect(res.ok && res.data.editReason).toMatch(/draft or a returned report/)
  })

  it('reports a missing report as not-found', async () => {
    vi.mocked(api_reports.fetchReports).mockResolvedValue(listOf())
    const res = await createRealReportService().editor(ctx, 'rep-404')
    expect(res).toEqual({ ok: false, failure: { kind: 'not-found', message: 'Report rep-404 does not exist or is not available for your account.' } })
  })

  it('refuses the aggregate scope instead of fanning out per engagement', async () => {
    const res = await createRealReportService().list({ ...ctx, projectId: '' }, {})
    expect(res.ok).toBe(false)
    expect(api_reports.fetchReports).not.toHaveBeenCalled()
  })
})

describe('real report writes', () => {
  it('saves one section at the version it read and keeps the summary and the other sections', async () => {
    vi.mocked(api_reports.fetchReports).mockResolvedValue(listOf(view({ version: 4 })))
    vi.mocked(api_reports.updateReport).mockResolvedValue(view({ version: 5 }))
    const res = await createRealReportService().saveSection(ctx, 'rep-1', 's0', 'Three issues.')
    expect(api_reports.updateReport).toHaveBeenCalledWith('eng-1', 'rep-1', {
      expectedVersion: 4, title: 'External assessment', summary: 'Scope summary.',
      sections: [{ title: 'Results', content: 'Three issues.' }, { title: 'Appendix', content: '' }],
    })
    expect(res.ok && res.data.version).toBe('v5')
  })

  it('surfaces a concurrent edit as a conflict instead of overwriting', async () => {
    vi.mocked(api_reports.fetchReports).mockResolvedValue(listOf(view({ version: 4 })))
    vi.mocked(api_reports.updateReport).mockRejectedValue(new ApiTransportError(409, 'conflict', 'Concurrent edit.'))
    const res = await createRealReportService().saveSection(ctx, 'rep-1', 's0', 'x')
    expect(res).toEqual({ ok: false, failure: { kind: 'conflict', message: 'Concurrent edit.' } })
  })

  it('keeps the summary fixed: it cannot be removed and must stay first when reordering', async () => {
    const service = createRealReportService()
    const removed = await service.removeSection(ctx, 'rep-1', 'summary')
    expect(removed.ok).toBe(false)
    vi.mocked(api_reports.fetchReports).mockResolvedValue(listOf(view()))
    const reordered = await service.reorderSections(ctx, 'rep-1', ['s0', 'summary', 's1'])
    expect(reordered.ok).toBe(false)
    expect(api_reports.updateReport).not.toHaveBeenCalled()
  })

  it('removes a body section and writes the remaining sections at the read version', async () => {
    vi.mocked(api_reports.fetchReports).mockResolvedValue(listOf(view({ version: 3 })))
    vi.mocked(api_reports.updateReport).mockResolvedValue(view({ version: 4 }))
    await createRealReportService().removeSection(ctx, 'rep-1', 's1')
    expect(api_reports.updateReport).toHaveBeenCalledWith('eng-1', 'rep-1', expect.objectContaining({
      expectedVersion: 3, sections: [{ title: 'Results', content: 'Two issues.' }],
    }))
  })

  it('refuses to submit when the caller holds unsaved section content', async () => {
    vi.mocked(api_reports.fetchReports).mockResolvedValue(listOf(view()))
    const res = await createRealReportService().submit(ctx, 'rep-1', { bodies: { summary: 'Edited but not saved.' } })
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.failure.kind).toBe('validation')
    expect(api_reports.submitReportForReview).not.toHaveBeenCalled()
  })

  it('requires a comment to approve or return and sends the version it read', async () => {
    const service = createRealReportService()
    const empty = await service.decide(reviewerCtx, 'rep-1', 'approve', '  ')
    expect(empty.ok).toBe(false)
    vi.mocked(api_reports.fetchReports).mockResolvedValue(listOf(view({ status: 'in_review', version: 2 })))
    vi.mocked(api_reports.decideReportReview).mockResolvedValue(view({ status: 'approved', approvedVersion: 2, version: 2 }))
    const res = await service.decide(reviewerCtx, 'rep-1', 'approve', 'Looks right.')
    expect(api_reports.decideReportReview).toHaveBeenCalledWith('eng-1', 'rep-1', { decision: 'approved', comment: 'Looks right.', expectedVersion: 2 })
    expect(res.ok && res.data.status).toBe('approved')
  })

  it('records a manual delivery of the approved version only, with recipient and receipt', async () => {
    const service = createRealReportService()
    const unconfirmed = await service.deliver(ctx, 'rep-1', { recipient: 'Client', channel: 'email', notes: 'sent', confirm: false })
    expect(unconfirmed.ok).toBe(false)
    vi.mocked(api_reports.fetchReports).mockResolvedValue(listOf(view({ status: 'approved', approvedVersion: 2 })))
    vi.mocked(api_reports.deliverReport).mockResolvedValue({ ...view({ status: 'delivered', approvedVersion: 2 }), artifact: { reportId: 'rep-1', version: 2, format: 'markdown', mediaType: 'text/markdown', content: '', digest: '' } } as never)
    const res = await service.deliver(ctx, 'rep-1', { recipient: 'Client', channel: 'email', notes: 'sent by mail', confirm: true })
    expect(api_reports.deliverReport).toHaveBeenCalledWith('eng-1', 'rep-1', expect.objectContaining({ kind: 'delivery', expectedVersion: 2, recipient: 'Client', receipt: 'sent by mail' }))
    expect(res.ok && res.data.status).toBe('delivered')
  })
})

describe('real report gates for capabilities the backend does not model', () => {
  it('pins the selected findings at the version the editor read, and refuses a PDF export before approval', async () => {
    vi.mocked(api_reports.fetchReports).mockResolvedValue(listOf(view()))
    vi.mocked(api_reports.setReportFindings).mockResolvedValue(view({ selectedFindings: [] }))
    const service = createRealReportService()
    const linked = await service.setFindings(ctx, 'rep-1', ['F-1'], 2)
    expect(linked.ok).toBe(true)
    expect(api_reports.setReportFindings).toHaveBeenCalledWith('eng-1', 'rep-1', { expectedVersion: 2, findingIds: ['F-1'] })
    const exported = await service.exportVersion(ctx, 'rep-1', 'PDF')
    expect(exported.ok === false && exported.failure.message).toMatch(/only after the report is approved/)
    expect(api_reports.deliverReport).not.toHaveBeenCalled()
  })

  it('records an approved PDF export and returns the file the server produced', async () => {
    const approved = view({ status: 'approved', approvedVersion: 2, version: 2, readiness: { ready: true, checks: [] }, deliveries: [] })
    const recorded = { ...approved, deliveries: [{ id: 'dl-1', kind: 'export', format: 'pdf', status: 'recorded', createdAt: '2026-10-19T09:00:00.000Z', recordedReceipt: null, acknowledgement: null }] }
    vi.mocked(api_reports.fetchReports).mockResolvedValueOnce(listOf(approved)).mockResolvedValue(listOf(recorded as never))
    vi.mocked(api_reports.deliverReport).mockResolvedValue({ ...recorded, artifact: { reportId: 'rep-1', version: 2, format: 'pdf', mediaType: 'application/pdf', content: 'JVBERi0=', encoding: 'base64', digest: 'a'.repeat(64) } } as never)
    const res = await createRealReportService().exportVersion(ctx, 'rep-1', 'PDF')
    expect(api_reports.deliverReport).toHaveBeenCalledWith('eng-1', 'rep-1', expect.objectContaining({ kind: 'export', format: 'pdf' }))
    expect(res.ok && res.data.rec.id).toBe('dl-1')
    expect(res.ok && res.data.artifact).toEqual({ filename: 'report-rep-1-v2.pdf', mediaType: 'application/pdf', content: 'JVBERi0=', encoding: 'base64' })
  })

  it('records a delivery only for the operator role and above, never for a reviewer', async () => {
    vi.mocked(api_reports.fetchReports).mockResolvedValue(listOf(view({ status: 'approved', approvedVersion: 2, readiness: { ready: true, checks: [] } })))
    const reviewerView = await createRealReportService().review(reviewerCtx, 'rep-1')
    expect(reviewerView.ok && reviewerView.data.gates.deliver.allowed).toBe(false)
    expect(reviewerView.ok && reviewerView.data.gates.deliver.reason).toMatch(/operator role/)
    const operatorView = await createRealReportService().review(ctx, 'rep-1')
    expect(operatorView.ok && operatorView.data.gates.deliver.allowed).toBe(true)
  })

  it('names the reviewer by the signed-in account id, not by the console name', async () => {
    vi.mocked(api_reports.fetchReports).mockResolvedValue(listOf(view({ status: 'in_review', createdBy: 'acct-author', reviewerId: 'acct-reviewer', readiness: { ready: true, checks: [] } })))
    vi.mocked(api_authApi.fetchAuthSession).mockResolvedValue({ authenticated: true, mode: 'multi-user', csrfToken: 'token', actor: { id: 'acct-reviewer', username: 'reviewer', displayName: 'Reviewer' } })
    const named = await createRealReportService().review({ ...reviewerCtx, actor: { id: 'Golden Reviewer', role: 'reviewer' } }, 'rep-1')
    expect(named.ok && named.data.gates.decide.allowed).toBe(true)
    vi.mocked(api_authApi.fetchAuthSession).mockResolvedValue({ authenticated: true, mode: 'multi-user', csrfToken: 'token', actor: { id: 'acct-other', username: 'other', displayName: 'Other' } })
    const other = await createRealReportService().review({ ...reviewerCtx, actor: { id: 'Golden Reviewer', role: 'reviewer' } }, 'rep-1')
    expect(other.ok && other.data.gates.decide.allowed).toBe(false)
  })

  it('gives the reviewer decision only to a reviewer who did not write the report', async () => {
    vi.mocked(api_reports.fetchReports).mockResolvedValue(listOf(view({ status: 'in_review', readiness: { ready: true, checks: [] } })))
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

describe('real report composition and acknowledgement (P06-P08)', () => {
  const template = { id: 'tpl-1', engagementId: 'eng-1', name: 'Pentest', version: 2, sections: [{ title: 'Summary', required: true }], createdBy: 'user-author', createdAt: '2026-10-01T00:00:00.000Z' }

  it('creates a draft with its template, reviewer, period and pinned findings through the server contracts', async () => {
    vi.mocked(api_reports.fetchReports).mockResolvedValue({ ...listOf(), templates: [template] })
    vi.mocked(api_reports.createReport).mockResolvedValue(view({ id: 'rep-9', version: 1 }))
    vi.mocked(api_reports.updateReportSetup).mockResolvedValue(view({ id: 'rep-9', version: 2 }))
    vi.mocked(api_reports.setReportFindings).mockResolvedValue(view({ id: 'rep-9', version: 3 }))
    const created = await createRealReportService().createDraft(ctx, { title: 'Q4', template: 'Pentest', kind: 'Red Team', reviewer: 'Rex Reviewer', findings: ['F-1'], period: 'Oct 1, 2026/Oct 31, 2026' })
    expect(created.ok).toBe(true)
    expect(api_reports.updateReportSetup).toHaveBeenCalledWith('eng-1', 'rep-9', expect.objectContaining({ expectedVersion: 1, templateId: 'tpl-1', reviewerId: 'user-reviewer' }))
    expect(api_reports.setReportFindings).toHaveBeenCalledWith('eng-1', 'rep-9', { expectedVersion: 2, findingIds: ['F-1'] })
  })

  it('refuses a period that is not two dates, before any write', async () => {
    vi.mocked(api_reports.fetchReports).mockResolvedValue({ ...listOf(), templates: [template] })
    const res = await createRealReportService().createDraft(ctx, { title: 'Q4', template: 'Pentest', kind: 'Red Team', reviewer: '', findings: [], period: 'not a range' })
    expect(res.ok === false && res.failure.kind).toBe('validation')
    expect(api_reports.createReport).not.toHaveBeenCalled()
  })

  it('records the recipient acknowledgement with its request id and shows it on the export record', async () => {
    vi.mocked(api_reports.fetchReports).mockResolvedValue(listOf(view({ id: 'rep-1', status: 'delivered', approvedVersion: 2, deliveries: [{ id: 'd-1', kind: 'delivery', format: 'markdown', status: 'completed', createdAt: '2026-10-14T09:00:00.000Z', recordedReceipt: null, acknowledgement: { id: 'ack-1', actorId: 'user-viewer', receipt: 'signed', createdAt: '2026-10-15T09:00:00.000Z' } }] })))
    vi.mocked(api_reports.acknowledgeReportDelivery).mockResolvedValue(view({ id: 'rep-1', status: 'delivered' }))
    const res = await createRealReportService().acknowledge(ctx, 'rep-1', { deliveryId: 'd-1', receipt: 'signed', requestId: 'req-ack-1' })
    expect(api_reports.acknowledgeReportDelivery).toHaveBeenCalledWith('eng-1', 'rep-1', 'd-1', { requestId: 'req-ack-1', receipt: 'signed' })
    expect(res.ok && res.data.ackAt).toBeTruthy()
  })

  it('starts a revision only for an approved or delivered version and pins the version the editor read', async () => {
    vi.mocked(api_reports.fetchReports).mockResolvedValue(listOf(view({ id: 'rep-1', status: 'approved', approvedVersion: 2, version: 2 })))
    vi.mocked(api_reports.reviseReport).mockResolvedValue(view({ id: 'rep-2', version: 1, status: 'draft' }))
    const rev = await createRealReportService().revise(ctx, 'rep-1', 2)
    expect(api_reports.reviseReport).toHaveBeenCalledWith('eng-1', 'rep-1', { expectedVersion: 2 })
    expect(rev.ok && rev.data.id).toBe('rep-2')
    const stale = await createRealReportService().revise(ctx, 'rep-1', 1)
    expect(stale.ok === false && stale.failure.kind).toBe('conflict')
  })

  it('creates a template version only for an owner-role actor and sends its sections', async () => {
    vi.mocked(api_reports.createReportTemplate).mockResolvedValue(template)
    const owner = { ...ctx, actor: { id: 'user-owner', role: 'admin' as const } }
    const created = await createRealReportService().createTemplate(owner, { name: 'Pentest', sections: [{ title: 'Summary', required: true }] })
    expect(api_reports.createReportTemplate).toHaveBeenCalledWith('eng-1', { name: 'Pentest', sections: [{ title: 'Summary', required: true }] })
    expect(created.ok && created.data.name).toBe('Pentest')
    const refused = await createRealReportService().createTemplate(ctx, { name: 'Pentest', sections: [] })
    expect(refused.ok === false && refused.failure.kind).toBe('forbidden')
  })

  it('downloads the server export bytes for JSON and Markdown with their digest', async () => {
    vi.mocked(api_reports.exportReport).mockResolvedValue({ engagementId: 'eng-1', reportId: 'rep-1', version: 2, format: 'markdown', mediaType: 'text/markdown', content: '# Report', encoding: 'utf8', digest: 'd'.repeat(64) })
    const res = await createRealReportService().exportArtifact(ctx, 'rep-1', 'markdown')
    expect(res.ok && res.data.filename).toBe('report-rep-1-v2.md')
    expect(res.ok && res.data.content).toBe('# Report')
  })
})
