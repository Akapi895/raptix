/**
 * The Scope & ROE tab names the requester and the decider by member label in
 * real mode, offers Approve only to an independent actor, and names the
 * operations and plans a real backend does not model instead of listing none.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { SessionContext, type SessionState } from '../../real/session'

const useScopeRead = vi.fn()
const fetchMembers = vi.fn()

vi.mock('../../real/mode', () => ({ DATA_MODE: 'real', isRealMode: () => true, resolveDataMode: () => 'real' }))

vi.mock('../../real/api', () => ({
  fetchMembers: (...a: unknown[]) => fetchMembers(...a),
}))

vi.mock('../../state/console', () => ({
  useMe: () => ({ name: 'Riley Brooks', email: 'riley@example.test', role: 'reviewer' }),
}))

vi.mock('./query', () => ({
  useScopeRead: () => useScopeRead(),
  useScopeWrites: () => ({ submit: vi.fn(), decide: vi.fn() }),
}))

vi.mock('../assets/query', () => ({
  useAssetList: () => ({ isPending: false, data: { items: [], kpis: { in: 0, out: 0, pending: 0, unclassified: 0 } } }),
}))

const EFFECTIVE = { version: 1, rootTarget: null, inScope: [], roe: { windows: [], emergencyContacts: ['blue@example.test'], restrictions: [] }, windowText: null }

const MEMBERS = {
  engagementId: 'eng-1',
  mode: 'multi-user',
  members: [
    { id: 'u-owner', label: 'Owner Lee', role: 'owner', source: 'membership' },
    { id: 'u-reviewer', label: 'Reviewer Kim', role: 'reviewer', source: 'membership' },
  ],
  canManage: true,
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

function readWith(revisions: unknown[], unmodelled: string[] = []) {
  return {
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    error: null,
    data: {
      revisions,
      latestApprovedVersion: 1,
      effective: EFFECTIVE,
      impact: null,
      unmodelled,
      supports: { roeFields: true },
    },
  }
}

async function renderTab(): Promise<void> {
  const { ScopeTab } = await import('./tab')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const session = { session: { actor: { id: 'u-reviewer' } }, pending: false, error: null, retry: () => undefined } as unknown as SessionState
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <SessionContext.Provider value={session}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SessionContext.Provider>
  )
  render(<ScopeTab engagementId="eng-1" />, { wrapper })
  fireEvent.click(await screen.findByRole('button', { name: 'ROE' }))
}

beforeEach(() => {
  useScopeRead.mockReset()
  fetchMembers.mockReset()
  fetchMembers.mockResolvedValue(MEMBERS)
})

afterEach(() => {
  cleanup()
})

describe('ScopeTab actor attribution', () => {
  it('shows the requester and the decider by member label, with the decision comment', async () => {
    useScopeRead.mockReturnValue(readWith([revision({})]))
    await renderTab()
    expect(await screen.findByText('Owner Lee')).toBeInTheDocument()
    expect(screen.getByText('Reviewer Kim: looks right')).toBeInTheDocument()
    expect(screen.queryByText('u-owner')).not.toBeInTheDocument()
    expect(screen.queryByText('u-reviewer')).not.toBeInTheDocument()
  })
})

describe('ScopeTab independent decisions', () => {
  it('offers Approve to a reviewer who did not request the pending revision', async () => {
    useScopeRead.mockReturnValue(readWith([revision({ status: 'pending', decidedBy: null, decisionComment: null })]))
    await renderTab()
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('does not offer Approve on a revision the actor requested', async () => {
    useScopeRead.mockReturnValue(readWith([revision({ status: 'pending', requestedBy: 'u-reviewer', decidedBy: null, decisionComment: null })]))
    await renderTab()
    expect(await screen.findByText('Awaiting an independent reviewer')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })
})

describe('ScopeTab unmodelled sections', () => {
  it('names the operations and plans this backend does not model', async () => {
    useScopeRead.mockReturnValue(readWith([revision({})], ['operations', 'plans', 'documents']))
    await renderTab()
    expect(await screen.findByText(/Operations and plans affected by a scope change are not modelled/)).toBeInTheDocument()
  })
})
