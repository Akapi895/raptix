/**
 * The scope panel names the requester and the decider by their member label,
 * never by the raw user id. The decision comment stays next to the decider.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

const fetchScopeRevisions = vi.fn()
const fetchAssetInventory = vi.fn()
const fetchEffectiveScope = vi.fn()
const fetchMembers = vi.fn()

vi.mock('../api', () => ({
  decideScopeRevision: vi.fn(),
  fetchAssetInventory: (...a: unknown[]) => fetchAssetInventory(...a),
  fetchEffectiveScope: (...a: unknown[]) => fetchEffectiveScope(...a),
  fetchScopeRevisions: (...a: unknown[]) => fetchScopeRevisions(...a),
  fetchMembers: (...a: unknown[]) => fetchMembers(...a),
  submitScopeRevision: vi.fn(),
}))

vi.mock('../session', () => ({
  useSession: () => ({ session: { actor: { id: 'u-reviewer' } } }),
}))

const REVISIONS = {
  engagementId: 'eng-1',
  revisions: [
    {
      id: 'rev-1',
      engagementId: 'eng-1',
      version: 1,
      status: 'approved',
      diff: { added: ['10.0.0.5'], removed: [], rationale: 'add host' },
      roe: { windows: [], emergencyContacts: [], restrictions: [] },
      requestedBy: 'u-owner',
      decidedBy: 'u-reviewer',
      decidedAt: '2026-10-15T02:00:00.000Z',
      decisionComment: 'looks right',
      createdAt: '2026-10-15T01:00:00.000Z',
    },
  ],
  latestApprovedVersion: 1,
  submitSupported: true,
  source: 'db',
}

const MEMBERS = {
  engagementId: 'eng-1',
  mode: 'multi-user',
  members: [
    { id: 'u-owner', label: 'Owner Lee', role: 'owner', source: 'membership' },
    { id: 'u-reviewer', label: 'Reviewer Kim', role: 'reviewer', source: 'membership' },
  ],
  inviteSupported: true,
  reason: null,
  source: 'db',
}

async function renderPanel(): Promise<void> {
  const { RealScopePanel } = await import('./scope-panel')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<RealScopePanel engagementId="eng-1" />, { wrapper })
}

beforeEach(() => {
  fetchScopeRevisions.mockReset()
  fetchAssetInventory.mockReset()
  fetchEffectiveScope.mockReset()
  fetchMembers.mockReset()
  fetchAssetInventory.mockResolvedValue({ engagementId: 'eng-1', assets: [], latestApprovedVersion: null, source: 'db' })
  fetchEffectiveScope.mockResolvedValue({ engagementId: 'eng-1', version: 1, rootTarget: null, inScope: [], roe: { windows: [], emergencyContacts: [], restrictions: [] }, source: 'db' })
})

afterEach(() => {
  cleanup()
})

describe('RealScopePanel actor attribution', () => {
  it('shows the requester and the decider by member label, with the decision comment', async () => {
    fetchScopeRevisions.mockResolvedValue(REVISIONS)
    fetchMembers.mockResolvedValue(MEMBERS)
    await renderPanel()
    expect(await screen.findByText('Owner Lee')).toBeInTheDocument()
    expect(screen.getByText('Reviewer Kim: looks right')).toBeInTheDocument()
    expect(screen.queryByText('u-owner')).not.toBeInTheDocument()
    expect(screen.queryByText('u-reviewer')).not.toBeInTheDocument()
  })
})
