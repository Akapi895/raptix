import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../features/team/remote', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../features/team/remote')>()
  return {
    ...actual,
    fetchMembers: vi.fn(),
    inviteMember: vi.fn(),
    updateMemberRole: vi.fn(),
    removeMember: vi.fn(),
  }
})

const api_team = await import('../../features/team/remote');
const { createRealTeamService } = await import('./team')

const ctx = { actor: { id: 'u-owner', role: 'manager' as const }, projectId: 'eng-1', corr: 'test' }

beforeEach(() => {
  vi.mocked(api_team.fetchMembers).mockReset()
  vi.mocked(api_team.inviteMember).mockReset()
  vi.mocked(api_team.updateMemberRole).mockReset()
  vi.mocked(api_team.removeMember).mockReset()
})

describe('real membership service', () => {
  it('reads the persisted members and offers manage controls only to the owner', async () => {
    vi.mocked(api_team.fetchMembers).mockResolvedValue({ engagementId: 'eng-1', mode: 'multi-user', members: [{ id: 'u-owner', label: 'Owner Lee', role: 'owner', source: 'local' }, { id: 'u-v', label: 'Viewer Vera', role: 'viewer', source: 'membership' }], canManage: true, inviteSupported: true, reason: null, source: 'db' } as unknown as Awaited<ReturnType<typeof api_team.fetchMembers>>)
    const result = await createRealTeamService().read(ctx)
    expect(result).toMatchObject({ ok: true, data: { canManage: true, invite: { supported: true, needsPassword: true } } })
    if (result.ok) expect(result.data.members.map((m) => m.owner)).toEqual([true, false])
  })

  it('names the reason in a single-user deployment instead of offering invites', async () => {
    vi.mocked(api_team.fetchMembers).mockResolvedValue({ engagementId: 'eng-1', mode: 'local-single-user', members: [], canManage: false, inviteSupported: false, reason: 'Memberships need an authentication strategy.', source: 'db' } as unknown as Awaited<ReturnType<typeof api_team.fetchMembers>>)
    const result = await createRealTeamService().read(ctx)
    expect(result).toMatchObject({ ok: true, data: { canManage: false, manageReason: 'Memberships need an authentication strategy.', invite: { supported: false } } })
  })

  it('offers no manage controls to a member the server does not name as owner', async () => {
    vi.mocked(api_team.fetchMembers).mockResolvedValue({ engagementId: 'eng-1', mode: 'multi-user', members: [{ id: 'u-owner', label: 'Owner Lee', role: 'owner', source: 'local' }, { id: 'u-v', label: 'Viewer Vera', role: 'viewer', source: 'membership' }], canManage: false, inviteSupported: true, reason: null, source: 'db' } as unknown as Awaited<ReturnType<typeof api_team.fetchMembers>>)
    const result = await createRealTeamService().read({ ...ctx, actor: { id: 'u-v', role: 'manager' as const } })
    expect(result).toMatchObject({ ok: true, data: { canManage: false, manageReason: 'Only the engagement owner can manage members.' } })
  })

  it('sends the invite with the password and returns the new member', async () => {
    vi.mocked(api_team.inviteMember).mockResolvedValue({ ok: true, memberId: 'u-new' })
    const result = await createRealTeamService().invite(ctx, { username: 'new.user', displayName: 'New User', role: 'viewer', password: 'longenough1' })
    expect(api_team.inviteMember).toHaveBeenCalledWith('eng-1', { username: 'new.user', displayName: 'New User', password: 'longenough1', role: 'viewer' })
    expect(result).toMatchObject({ ok: true, data: { id: 'u-new', role: 'viewer' } })
  })
})
