/**
 * The engagement audit shows who acted by their member name, falls back to the
 * recorded id for an actor outside the engagement, and keeps "not recorded" for
 * entries with no actor (vault lifecycle rows).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

const fetchEngagementAudit = vi.fn()
const fetchMembers = vi.fn()

vi.mock('../api', () => ({
  fetchEngagementAudit: (...a: unknown[]) => fetchEngagementAudit(...a),
  fetchMembers: (...a: unknown[]) => fetchMembers(...a),
}))

const AUDIT = {
  engagementId: 'eng-1',
  entries: [
    { id: 'a1', createdAt: '2026-10-15T01:00:00.000Z', action: 'scope.revision_submitted', actorId: 'u-owner', engagementId: 'eng-1', targetType: 'scope_revision', reason: 'add host', source: 'web' },
    { id: 'a2', createdAt: '2026-10-15T02:00:00.000Z', action: 'scope.revision_approved', actorId: 'u-departed', engagementId: 'eng-1', targetType: 'scope_revision', reason: null, source: 'web' },
    { id: 'a3', createdAt: '2026-10-15T03:00:00.000Z', action: 'vault.revealed', actorId: null, engagementId: 'eng-1', targetType: 'vault_secret', reason: null, source: 'vault' },
  ],
  total: 3,
  truncated: false,
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
  const { RealAuditPanel } = await import('./audit-panel')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<RealAuditPanel engagementId="eng-1" />, { wrapper })
}

beforeEach(() => {
  fetchEngagementAudit.mockReset()
  fetchMembers.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('RealAuditPanel actor attribution', () => {
  it('shows a member by name, an unknown actor by its recorded id, and no actor as "not recorded"', async () => {
    fetchEngagementAudit.mockResolvedValue(AUDIT)
    fetchMembers.mockResolvedValue(MEMBERS)
    await renderPanel()
    expect(await screen.findByText('Owner Lee')).toBeInTheDocument()
    expect(screen.getByText('u-departed')).toBeInTheDocument()
    expect(screen.getByText('not recorded')).toBeInTheDocument()
    expect(screen.queryByText('u-owner')).not.toBeInTheDocument()
  })
})
