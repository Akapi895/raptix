import type { RequestContext } from '../../domain/service'
import type { TeamMember, TeamRead, TeamService } from '../../features/team/service'
import { fetchMembers, inviteMember, removeMember, updateMemberRole, type InviteMemberInput } from '../api'
import { guarded } from './shared'

/** The engagement id is the console's project id in real mode. */
function engagementOf(ctx: RequestContext): string | null {
  return ctx.projectId && ctx.projectId !== 'all' ? ctx.projectId : null
}

const NO_ENGAGEMENT = { kind: 'validation' as const, message: 'Select an engagement before reading or changing its members.' }
const ASSIGNABLE = ['operator', 'reviewer', 'viewer']

export function createRealTeamService(): TeamService {
  return {
    read: (ctx) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      const view = await fetchMembers(engagementId)
      const members: TeamMember[] = view.members.map((m) => ({ id: m.id, label: m.label, role: m.role, owner: m.role === 'owner' }))
      // The server decides who may change members; the console only shows the controls it reports.
      const canManage = view.canManage
      const data: TeamRead = {
        members,
        assignableRoles: ASSIGNABLE,
        canManage,
        manageReason: canManage ? null : view.inviteSupported ? 'Only the engagement owner can manage members.' : view.reason,
        invite: { supported: view.inviteSupported, reason: view.reason, needsPassword: true, candidates: [] },
      }
      return { ok: true, data }
    }),
    invite: (ctx, input) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      const body: InviteMemberInput = { username: input.username, displayName: input.displayName, password: input.password, role: input.role as InviteMemberInput['role'] }
      const created = await inviteMember(engagementId, body)
      return { ok: true, data: { id: created.memberId, label: input.displayName || input.username, role: input.role, owner: false } }
    }),
    changeRole: (ctx, memberId, role) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      const updated = await updateMemberRole(engagementId, memberId, role as InviteMemberInput['role'])
      return { ok: true, data: { id: memberId, label: memberId, role: updated.role, owner: false } }
    }),
    remove: (ctx, memberId) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      await removeMember(engagementId, memberId)
      return { ok: true, data: null }
    }),
  }
}
