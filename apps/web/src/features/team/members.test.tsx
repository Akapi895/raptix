/**
 * The shared membership view: a single-user deployment says why it cannot
 * invite; an owner can invite with a username and password, change a role and
 * remove a member through a confirmation; a refused write surfaces its reason.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { useSessionStore } from '../../state/session'

const useTeamRead = vi.fn()
const invite = vi.fn()
const changeRole = vi.fn()
const remove = vi.fn()

vi.mock('./query', () => ({
  useTeamRead: () => useTeamRead(),
  useTeamWrites: () => ({ invite: (...a: unknown[]) => invite(...a), changeRole: (...a: unknown[]) => changeRole(...a), remove: (...a: unknown[]) => remove(...a) }),
}))

const LOCAL = {
  members: [{ id: 'local', label: 'Local Operator', role: 'operator', owner: false }],
  assignableRoles: ['operator', 'reviewer', 'viewer'],
  canManage: false,
  manageReason: 'Memberships require an authentication strategy that this build does not have.',
  invite: { supported: false, reason: 'Memberships require an authentication strategy that this build does not have.', needsPassword: true, candidates: [] },
}

const OWNER_VIEW = {
  members: [
    { id: 'u-owner', label: 'Owner', role: 'owner', owner: true },
    { id: 'u-viewer', label: 'Viewer Vera', role: 'viewer', owner: false },
  ],
  assignableRoles: ['operator', 'reviewer', 'viewer'],
  canManage: true,
  manageReason: null,
  invite: { supported: true, reason: null, needsPassword: true, candidates: [] },
}

async function renderMembers(): Promise<void> {
  const { TeamMembers } = await import('./members')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<TeamMembers engagementId="eng-1" />, { wrapper })
}

beforeEach(() => {
  useTeamRead.mockReset()
  invite.mockReset()
  changeRole.mockReset()
  remove.mockReset()
})

afterEach(() => {
  cleanup()
  useSessionStore.setState({ confirmState: null })
})

describe('TeamMembers (single-user deployment)', () => {
  it('says why it cannot invite and offers no invite controls', async () => {
    useTeamRead.mockReturnValue({ isPending: false, isError: false, data: LOCAL, refetch: vi.fn(), error: null })
    await renderMembers()
    expect(await screen.findByText('Local Operator')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Memberships require an authentication strategy')
    expect(screen.queryByRole('button', { name: /invite member/i })).not.toBeInTheDocument()
  })

  it('keeps the reason on the disabled controls of a member who cannot manage, so the control explains itself', async () => {
    const viewer = { ...OWNER_VIEW, canManage: false, manageReason: 'Only the engagement owner can manage members.' }
    useTeamRead.mockReturnValue({ isPending: false, isError: false, data: viewer, refetch: vi.fn(), error: null })
    await renderMembers()
    const remove = await screen.findByRole('button', { name: 'Remove Viewer Vera' })
    expect(remove).toBeDisabled()
    expect(remove).toHaveAttribute('title', 'Only the engagement owner can manage members.')
    expect(screen.getByRole('button', { name: 'Invite member' })).toHaveAttribute('title', 'Only the engagement owner can manage members.')
  })
})

describe('TeamMembers (owner)', () => {
  it('invites with the typed username, password and the least-privileged role', async () => {
    useTeamRead.mockReturnValue({ isPending: false, isError: false, data: OWNER_VIEW, refetch: vi.fn(), error: null })
    invite.mockResolvedValue({ id: 'u-new', label: 'new.user', role: 'viewer', owner: false })
    await renderMembers()
    expect(await screen.findByText('Viewer Vera')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Username'), 'new.user')
    await userEvent.type(screen.getByLabelText('Initial password'), 'longenough1')
    await userEvent.click(screen.getByRole('button', { name: /invite member/i }))
    await waitFor(() => expect(invite).toHaveBeenCalledWith(expect.objectContaining({ username: 'new.user', role: 'viewer', password: 'longenough1' })))
    expect(await screen.findByRole('status')).toHaveTextContent('Member invited')
  })

  it('surfaces a refused invite as the reason instead of a member row', async () => {
    useTeamRead.mockReturnValue({ isPending: false, isError: false, data: OWNER_VIEW, refetch: vi.fn(), error: null })
    invite.mockRejectedValue(new Error('This action requires the owner role; the persisted membership grants viewer.'))
    await renderMembers()
    await screen.findByText('Viewer Vera')
    await userEvent.type(screen.getByLabelText('Username'), 'new.user')
    await userEvent.type(screen.getByLabelText('Initial password'), 'longenough1')
    await userEvent.click(screen.getByRole('button', { name: /invite member/i }))
    expect(await screen.findByText('This action requires the owner role; the persisted membership grants viewer.')).toBeInTheDocument()
  })

  it('removes a member only after the confirmation', async () => {
    useTeamRead.mockReturnValue({ isPending: false, isError: false, data: OWNER_VIEW, refetch: vi.fn(), error: null })
    remove.mockResolvedValue(null)
    await renderMembers()
    await screen.findByText('Viewer Vera')
    fireEvent.click(screen.getByRole('button', { name: /remove viewer vera/i }))
    expect(remove).not.toHaveBeenCalled()
    const confirm = useSessionStore.getState().confirmState
    expect(confirm?.confirmLabel).toBe('Remove member')
    await confirm!.onConfirm('')
    await waitFor(() => expect(remove).toHaveBeenCalledWith('u-viewer'))
  })

  it('changes a role through the role select', async () => {
    useTeamRead.mockReturnValue({ isPending: false, isError: false, data: OWNER_VIEW, refetch: vi.fn(), error: null })
    changeRole.mockResolvedValue({ id: 'u-viewer', label: 'Viewer Vera', role: 'reviewer', owner: false })
    await renderMembers()
    await screen.findByText('Viewer Vera')
    await userEvent.selectOptions(screen.getByLabelText('Role of Viewer Vera'), 'reviewer')
    await waitFor(() => expect(changeRole).toHaveBeenCalledWith('u-viewer', 'reviewer'))
    expect(screen.getByText('Viewer Vera')).toBeInTheDocument()
  })
})
