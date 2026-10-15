/**
 * W18: the library review surface shows the real base/proposed diff per
 * proposal (fetched by id), requires the reviewer to have viewed it before a
 * decision, surfaces canonical drift from the detail read, and hands the
 * approved export JSON to the git publication workflow — never mutates the
 * corpus.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import type { LibraryProposalView } from '../api'

const fetchLibraryProposals = vi.fn()
const fetchLibraryProposal = vi.fn()
const submitLibraryProposal = vi.fn()
const amendLibraryProposal = vi.fn()
const proposeLibraryProposal = vi.fn()
const decideLibraryProposal = vi.fn()
const exportLibraryProposal = vi.fn()

vi.mock('../api', () => ({
  fetchLibraryProposals: (...a: unknown[]) => fetchLibraryProposals(...a),
  fetchLibraryProposal: (...a: unknown[]) => fetchLibraryProposal(...a),
  submitLibraryProposal: (...a: unknown[]) => submitLibraryProposal(...a),
  amendLibraryProposal: (...a: unknown[]) => amendLibraryProposal(...a),
  proposeLibraryProposal: (...a: unknown[]) => proposeLibraryProposal(...a),
  decideLibraryProposal: (...a: unknown[]) => decideLibraryProposal(...a),
  exportLibraryProposal: (...a: unknown[]) => exportLibraryProposal(...a),
}))

function proposal(overrides: Partial<LibraryProposalView> = {}): LibraryProposalView {
  return {
    id: 'p-1',
    engagementId: 'eng-1',
    skillName: 'dcsync',
    skillPath: '/skills/standard/ad/dcsync/SKILL.md',
    baseRevision: 'rev-abc123def456',
    status: 'proposed',
    version: 3,
    proposedBody: 'Proposed body content.\n',
    baseBody: 'Base body content.\n',
    rationale: 'Tighten the OPSEC paragraph.',
    createdBy: 'author',
    createdAt: '2026-10-15T01:00:00.000Z',
    updatedAt: '2026-10-15T02:00:00.000Z',
    reviews: [],
    canonicalCurrent: undefined,
    ...overrides,
  }
}

const EXPORT = {
  kind: 'library-body-replacement-proposal' as const,
  proposal: { id: 'p-1', engagementId: 'eng-1', skillName: 'dcsync', skillPath: '/skills/standard/ad/dcsync/SKILL.md', baseRevision: 'rev-abc123def456', status: 'approved', version: 3, createdBy: 'author' },
  base: { body: 'Base body content.\n', revision: 'rev-abc123def456' },
  proposed: { body: 'Proposed body content.\n' },
  diff: { before: 'Base body content.\n', after: 'Proposed body content.\n' },
  reviews: [{ id: 'r-1', proposalVersion: 3, decision: 'approved' as const, comment: 'sound', reviewerId: 'solomon', createdAt: '2026-10-15T03:00:00.000Z' }],
  publicationContract: ['Preserve the SKILL.md frontmatter; this export replaces the body only.'],
}

async function renderPanel(): Promise<void> {
  const { RealLibraryReviewPanel } = await import('./library-review-panel')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<RealLibraryReviewPanel engagementId="eng-1" />, { wrapper })
}

beforeEach(() => {
  fetchLibraryProposals.mockReset().mockResolvedValue({ engagementId: 'eng-1', proposals: [proposal()], source: 'db' })
  fetchLibraryProposal.mockReset().mockResolvedValue(proposal({ canonicalCurrent: true }))
  submitLibraryProposal.mockReset()
  amendLibraryProposal.mockReset()
  proposeLibraryProposal.mockReset()
  decideLibraryProposal.mockReset().mockResolvedValue(proposal({ status: 'approved' }))
  exportLibraryProposal.mockReset().mockResolvedValue(EXPORT)
})

afterEach(() => {
  cleanup()
})

describe('RealLibraryReviewPanel (W18 review/diff/export)', () => {
  it('fetches the proposal detail and renders the base/proposed diff before a decision is possible', async () => {
    await renderPanel()
    const approve = await screen.findByRole('button', { name: /approve/i })
    expect(approve).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /review diff/i }))
    await waitFor(() => expect(fetchLibraryProposal).toHaveBeenCalledWith('eng-1', 'p-1'))
    expect(await screen.findByText(/base body content/i)).toBeInTheDocument()
    expect(screen.getByText(/proposed body content/i)).toBeInTheDocument()
    expect(screen.getByText(/tighten the opsec paragraph/i)).toBeInTheDocument()
    const approveAfter = screen.getByRole('button', { name: /approve/i })
    expect(approveAfter).toBeEnabled()
    await userEvent.click(approveAfter)
    await waitFor(() => expect(decideLibraryProposal).toHaveBeenCalledWith('eng-1', 'p-1', expect.objectContaining({ decision: 'approved', expectedVersion: 3 })))
  })

  it('surfaces canonical drift from the detail read', async () => {
    fetchLibraryProposal.mockResolvedValue(proposal({ canonicalCurrent: false }))
    await renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /review diff/i }))
    expect(await screen.findByText(/canonical corpus changed/i)).toBeInTheDocument()
  })

  it('downloads the approved export as JSON carrying base, proposed, diff and review metadata', async () => {
    fetchLibraryProposals.mockResolvedValue({ engagementId: 'eng-1', proposals: [proposal({ status: 'approved', reviews: [{ id: 'r-1', proposalVersion: 3, decision: 'approved', comment: 'sound', reviewerId: 'solomon', createdAt: '2026-10-15T03:00:00.000Z' }] })] })
    const clickSpy = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:x')
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
    HTMLAnchorElement.prototype.click = clickSpy
    await renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /export/i }))
    await waitFor(() => expect(exportLibraryProposal).toHaveBeenCalledWith('eng-1', 'p-1'))
    await userEvent.click(await screen.findByRole('button', { name: /download json/i }))
    await waitFor(() => expect(clickSpy).toHaveBeenCalled())
    expect(createObjectURL).toHaveBeenCalled()
  })
})
