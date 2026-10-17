/**
 * The scope panel names the requester and the decider by their member label,
 * never by the raw user id, and only an independent actor sees Approve/Reject
 * on a pending revision.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

const fetchMembers = vi.fn()
const useScopeRead = vi.fn()

vi.mock('../../real/api', () => ({
  fetchMembers: (...a: unknown[]) => fetchMembers(...a),
}))

vi.mock('../../real/session', () => ({
  useSession: () => ({ session: { actor: { id: 'u-reviewer' } } }),
}))

vi.mock('./query', () => ({
  useScopeRead: () => useScopeRead(),
  useScopeWrites: () => ({ submit: vi.fn(), decide: vi.fn() }),
}))

const EFFECTIVE = { version: 1, rootTarget: null, inScope: [], roe: { windows: [], emergencyContacts: [], restrictions: [] } }

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

function revision(overrides: Partial<{ id: string; status: string; requestedBy: string; decidedBy: string | null; decisionComment: string | null }>) {
  return {
    id: 'rev-1',
    version: 1,
    status: 'approved',
    diff: { added: ['10.0.0.5'], removed: [], rationale: 'add host' },
    roe: { windows: [], emergencyContacts: [], restrictions: [] },
    requestedBy: 'u-owner',
    decidedBy: 'u-reviewer',
    decisionComment: 'looks right',
    ...overrides,
  }
}

function readWith(revisions: unknown[]) {
  return { isPending: false, isError: false, data: { revisions, latestApprovedVersion: 1, effective: EFFECTIVE }, refetch: vi.fn(), error: null }
}

async function renderPanel(): Promise<void> {
  const { ScopePanel } = await import('./panel')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<ScopePanel engagementId="eng-1" />, { wrapper })
}

beforeEach(() => {
  fetchMembers.mockReset()
  useScopeRead.mockReset()
  fetchMembers.mockResolvedValue(MEMBERS)
})

afterEach(() => {
  cleanup()
})

describe('ScopePanel actor attribution', () => {
  it('shows the requester and the decider by member label, with the decision comment', async () => {
    useScopeRead.mockReturnValue(readWith([revision({})]))
    await renderPanel()
    expect(await screen.findByText('Owner Lee')).toBeInTheDocument()
    expect(screen.getByText('Reviewer Kim: looks right')).toBeInTheDocument()
    expect(screen.queryByText('u-owner')).not.toBeInTheDocument()
    expect(screen.queryByText('u-reviewer')).not.toBeInTheDocument()
  })
})

describe('ScopePanel independent decisions', () => {
  it('offers Approve to a reviewer who did not request the pending revision', async () => {
    useScopeRead.mockReturnValue(readWith([revision({ status: 'pending', decidedBy: null, decisionComment: null })]))
    await renderPanel()
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('does not offer Approve on a revision the actor requested', async () => {
    useScopeRead.mockReturnValue(readWith([revision({ status: 'pending', requestedBy: 'u-reviewer', decidedBy: null, decisionComment: null })]))
    await renderPanel()
    expect(await screen.findByText('Awaiting an independent reviewer')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })
})
