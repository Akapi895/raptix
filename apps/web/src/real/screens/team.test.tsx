/**
 * Ticket 07: the real team panel reflects the server's membership view and
 * never fakes a hierarchy — local single-user deployments show the explicit
 * unsupported reason, multi-user deployments expose owner-only actions and
 * surface refusals instead of optimistic member rows.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

const fetchMembers = vi.fn()
const inviteMember = vi.fn()
const removeMember = vi.fn()
const updateMemberRole = vi.fn()

vi.mock('../api', () => ({
  fetchMembers: (...a: unknown[]) => fetchMembers(...a),
  inviteMember: (...a: unknown[]) => inviteMember(...a),
  removeMember: (...a: unknown[]) => removeMember(...a),
  updateMemberRole: (...a: unknown[]) => updateMemberRole(...a),
}))

const LOCAL_VIEW = {
  engagementId: 'eng-1',
  mode: 'local-single-user',
  members: [{ id: 'local', label: 'Local Operator', role: 'operator', source: 'local' }],
  inviteSupported: false,
  reason: 'Memberships require an authentication strategy (hosted multi-user auth with sessions, CSRF and origin policy, enforced on every scoped API) that this build does not have.',
  source: 'db',
}

const MULTI_VIEW = {
  engagementId: 'eng-1',
  mode: 'multi-user',
  members: [
    { id: 'u-owner', label: 'Owner', role: 'owner', source: 'local' },
    { id: 'u-viewer', label: 'Viewer Vera', role: 'viewer', source: 'membership' },
  ],
  inviteSupported: true,
  reason: null,
  source: 'db',
}

async function renderPanel(): Promise<void> {
  const { RealTeamPanel } = await import('./team')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<RealTeamPanel engagementId="eng-1" />, { wrapper })
}

beforeEach(() => {
  fetchMembers.mockReset()
  inviteMember.mockReset()
  removeMember.mockReset()
  updateMemberRole.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('RealTeamPanel (ticket 07)', () => {
  it('renders the truthful local single-user view without invite controls', async () => {
    fetchMembers.mockResolvedValue(LOCAL_VIEW)
    await renderPanel()
    expect(await screen.findByText('Local Operator')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Memberships require an authentication strategy')
    expect(screen.queryByRole('button', { name: /invite member/i })).not.toBeInTheDocument()
  })

  it('lists persisted memberships and submits owner-only invites with the typed role', async () => {
    fetchMembers.mockResolvedValue(MULTI_VIEW)
    inviteMember.mockResolvedValue({ ok: true, memberId: 'u-new' })
    await renderPanel()
    expect(await screen.findByText('Viewer Vera')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Username'), 'new.user')
    await userEvent.type(screen.getByLabelText('Initial password'), 'longenough1')
    await userEvent.click(screen.getByRole('button', { name: /invite member/i }))
    await waitFor(() => expect(inviteMember).toHaveBeenCalledWith('eng-1', expect.objectContaining({ username: 'new.user', role: 'viewer' })))
    expect(await screen.findByRole('status')).toHaveTextContent('Member invited')
  })

  it('surfaces a refusal instead of a fake member row when the server denies the invite', async () => {
    fetchMembers.mockResolvedValue(MULTI_VIEW)
    inviteMember.mockRejectedValue(new Error('This action requires the owner role; the persisted membership grants viewer.'))
    await renderPanel()
    await screen.findByText('Viewer Vera')
    await userEvent.type(screen.getByLabelText('Username'), 'new.user')
    await userEvent.type(screen.getByLabelText('Initial password'), 'longenough1')
    await userEvent.click(screen.getByRole('button', { name: /invite member/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('requires the owner role')
  })

  it('removes a membership through the owned API', async () => {
    fetchMembers.mockResolvedValue(MULTI_VIEW)
    removeMember.mockResolvedValue({ ok: true })
    await renderPanel()
    await screen.findByText('Viewer Vera')
    await userEvent.click(screen.getByRole('button', { name: /remove Viewer Vera/i }))
    await waitFor(() => expect(removeMember).toHaveBeenCalledWith('eng-1', 'u-viewer'))
  })
})
