/**
 * The reports panel names the reviewer by their member label, never by the raw
 * user id, and keeps the review comment next to them.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

const fetchReports = vi.fn()
const fetchMembers = vi.fn()

vi.mock('../api', () => ({
  createReport: vi.fn(),
  fetchReports: (...a: unknown[]) => fetchReports(...a),
  fetchMembers: (...a: unknown[]) => fetchMembers(...a),
}))

const REPORTS = {
  engagementId: 'eng-1',
  reports: [
    {
      id: 'r1',
      engagementId: 'eng-1',
      title: 'Lab assessment',
      body: { summary: 'Initial findings' },
      version: 2,
      status: 'approved',
      approvedVersion: 2,
      reviewedBy: 'u-owner',
      reviewComment: 'ready to deliver',
      deliveries: [],
      source: 'db',
    },
  ],
  source: 'db',
}

const MEMBERS = {
  engagementId: 'eng-1',
  mode: 'multi-user',
  members: [{ id: 'u-owner', label: 'Owner Lee', role: 'owner', source: 'membership' }],
  inviteSupported: true,
  reason: null,
  source: 'db',
}

async function renderPanel(): Promise<void> {
  const { RealReportsPanel } = await import('./reports-panel')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<RealReportsPanel engagementId="eng-1" />, { wrapper })
}

beforeEach(() => {
  fetchReports.mockReset()
  fetchMembers.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('RealReportsPanel reviewer attribution', () => {
  it('shows the reviewer by member label with the review comment, never the raw user id', async () => {
    fetchReports.mockResolvedValue(REPORTS)
    fetchMembers.mockResolvedValue(MEMBERS)
    await renderPanel()
    expect(await screen.findByText('Owner Lee: ready to deliver')).toBeInTheDocument()
    expect(screen.queryByText(/u-owner/)).not.toBeInTheDocument()
  })
})
