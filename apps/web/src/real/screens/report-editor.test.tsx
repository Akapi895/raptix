/**
 * W20: the export flow downloads the artifact recorded by the same delivery
 * request (no second independent read that could drift versions), and an
 * approved/delivered report starts a revision through the revision API
 * instead of in-place edits.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import type { ReportView } from '../api'

const updateReport = vi.fn()
const decideReportReview = vi.fn()
const deliverReport = vi.fn()
const exportReport = vi.fn()
const reviseReport = vi.fn()

vi.mock('../api', () => ({
  updateReport: (...a: unknown[]) => updateReport(...a),
  decideReportReview: (...a: unknown[]) => decideReportReview(...a),
  deliverReport: (...a: unknown[]) => deliverReport(...a),
  exportReport: (...a: unknown[]) => exportReport(...a),
  reviseReport: (...a: unknown[]) => reviseReport(...a),
}))

vi.mock('../../state/session', () => ({ useDirty: vi.fn() }))

function report(overrides: Partial<ReportView> = {}): ReportView {
  return {
    id: 'rep-1',
    engagementId: 'eng-1',
    title: 'Penetration report',
    version: 2,
    status: 'approved',
    body: { summary: 'Summary text', sections: [{ title: 'Findings', content: 'Nothing held.' }] },
    createdBy: 'author',
    reviewedBy: 'solomon',
    reviewedAt: '2026-10-15T01:00:00.000Z',
    reviewComment: 'ok',
    approvedVersion: 2,
    updatedAt: '2026-10-15T01:00:00.000Z',
    deliveries: [],
    ...overrides,
  }
}

async function renderEditor(report: ReportView): Promise<void> {
  const { RealReportEditor } = await import('./report-editor')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<RealReportEditor report={report} />, { wrapper })
}

beforeEach(() => {
  updateReport.mockReset()
  decideReportReview.mockReset()
  deliverReport.mockReset().mockImplementation(async (_engagement: string, _reportId: string, input: { requestId: string; kind: string; format: string }) => ({
    ...report(),
    deliveries: [{ id: 'd-1', kind: input.kind, format: 'markdown', status: 'completed', createdAt: '2026-10-15T02:00:00.000Z' }],
    artifact: { engagementId: 'eng-1', reportId: 'rep-1', version: 2, format: 'markdown', mediaType: 'text/markdown', content: '# Penetration report', digest: 'f'.repeat(64) },
  }))
  exportReport.mockReset()
  reviseReport.mockReset().mockResolvedValue(report({ id: 'rep-2', version: 1, status: 'draft', approvedVersion: null, reviewedBy: null, reviewedAt: null, reviewComment: null }))
})

afterEach(() => {
  cleanup()
})

describe('RealReportEditor (W20 single-read export and revision)', () => {
  it('downloads the artifact recorded by the export request without a second content read', async () => {
    const clickSpy = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:x')
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
    HTMLAnchorElement.prototype.click = clickSpy
    await renderEditor(report())
    await userEvent.click(await screen.findByRole('button', { name: /download report markdown/i }))
    await waitFor(() => expect(deliverReport).toHaveBeenCalledWith('eng-1', 'rep-1', expect.objectContaining({ kind: 'export', expectedVersion: 2 })))
    expect(createObjectURL).toHaveBeenCalled()
    expect(exportReport).not.toHaveBeenCalled()
  })

  it('starts a fresh revision for an approved report and hides in-place editing', async () => {
    await renderEditor(report())
    await userEvent.click(await screen.findByRole('button', { name: /start a revision/i }))
    await waitFor(() => expect(reviseReport).toHaveBeenCalledWith('eng-1', 'rep-1', expect.objectContaining({ expectedVersion: 2 })))
    expect(screen.queryByRole('button', { name: /save report/i })).not.toBeInTheDocument()
  })
})
