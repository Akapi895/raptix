/**
 * The engagement audit shows who acted by their member name, falls back to the
 * recorded id for an actor outside the engagement, and keeps "not recorded" for
 * entries with no actor (vault lifecycle rows).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

const useAuditRead = vi.fn()
const fetchMembers = vi.fn()

vi.mock('../team/api', () => ({
  fetchMembers: (...a: unknown[]) => fetchMembers(...a),
}))

vi.mock('./query', () => ({
  useAuditRead: (...a: unknown[]) => useAuditRead(...a),
}))

const ENTRIES = [
  { id: 'a1', createdAt: '2026-10-15T01:00:00.000Z', action: 'scope.revision_submitted', actorId: 'u-owner', engagementId: 'eng-1', targetType: 'scope_revision', targetId: 'rev-2', reason: 'add host', source: 'web' },
  { id: 'a2', createdAt: '2026-10-15T02:00:00.000Z', action: 'scope.revision_approved', actorId: 'u-departed', engagementId: 'eng-1', targetType: 'scope_revision', targetId: 'rev-2', reason: null, source: 'web' },
  { id: 'a3', createdAt: '2026-10-15T03:00:00.000Z', action: 'vault.revealed', actorId: null, engagementId: 'eng-1', targetType: 'vault_secret', targetId: 'sec-1', reason: null, source: 'vault' },
]

const MEMBERS = {
  engagementId: 'eng-1',
  mode: 'multi-user',
  members: [{ id: 'u-owner', label: 'Owner Lee', role: 'owner', source: 'membership' }],
  canManage: true,
  inviteSupported: true,
  reason: null,
  source: 'db',
}

async function renderPanel(): Promise<void> {
  const { AuditPanel } = await import('./panel')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<AuditPanel engagementId="eng-1" />, { wrapper })
}

beforeEach(() => {
  useAuditRead.mockReset()
  fetchMembers.mockReset()
  fetchMembers.mockResolvedValue(MEMBERS)
})

afterEach(() => {
  cleanup()
})

describe('AuditPanel attribution', () => {
  it('names a known actor, keeps the recorded id for a departed actor, and marks vault rows not recorded', async () => {
    useAuditRead.mockReturnValue({ isPending: false, isError: false, data: { entries: ENTRIES, total: 3, truncated: false }, refetch: vi.fn(), error: null })
    await renderPanel()
    expect(await screen.findByText('Owner Lee')).toBeInTheDocument()
    expect(screen.getByText('u-departed')).toBeInTheDocument()
    expect(screen.getByText('not recorded', { exact: false })).toBeInTheDocument()
  })

  it('says when the newest entries are a truncated page', async () => {
    useAuditRead.mockReturnValue({ isPending: false, isError: false, data: { entries: ENTRIES, total: 40, truncated: true }, refetch: vi.fn(), error: null })
    await renderPanel()
    expect(await screen.findByText(/Showing the newest 3 of 40 matching entries/)).toBeInTheDocument()
  })

  it('passes the action and search filters to the read', async () => {
    useAuditRead.mockReturnValue({ isPending: false, isError: false, data: { entries: [], total: 0, truncated: false }, refetch: vi.fn(), error: null })
    await renderPanel()
    expect(useAuditRead).toHaveBeenLastCalledWith({ action: undefined, q: undefined })
  })
})
