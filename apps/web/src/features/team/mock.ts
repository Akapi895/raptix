/**
 * Mock adapter for the membership port (plan P09, Team slice). The mock keeps
 * the owner and the project's members with the mock role vocabulary; this
 * adapter reads them and writes through the atomic project-membership
 * transaction, so an edit publishes its audit row with the membership.
 */
import { can, ROLE_LABEL } from '../../domain/policy'
import { USERS, type Db } from '../../data'
import type { DbAuthority } from '../../domain/database'
import type { Project, Role } from '../../domain/entities'
import type { RequestContext, ServiceResult } from '../../domain/service'
import { stamp } from '../../domain/demo-clock'
import { setProjectMembers } from '../projects/team-service'
import type { TeamMember, TeamRead, TeamService } from './service'

/** The mock's project roles; an organization admin is not a project member role. */
const ASSIGNABLE: readonly Role[] = ['manager', 'operator', 'reviewer', 'analyst', 'viewer']

function findProject(db: Db, ctx: RequestContext): ServiceResult<Project> {
  const project = db.projects.find((p) => p.id === ctx.projectId)
  return project ? { ok: true, data: project } : { ok: false, failure: { kind: 'not-found', message: `Project ${ctx.projectId} was not found.` } }
}

function readTeam(db: Db, ctx: RequestContext): ServiceResult<TeamRead> {
  const found = findProject(db, ctx)
  if (!found.ok) return found
  const p = found.data
  const closed = p.status === 'closed' || p.status === 'cancelled'
  const canManage = !closed && can(ctx.actor, 'editScope', p)
  const members: TeamMember[] = [
    { id: p.owner, label: p.owner, role: 'owner', owner: true },
    ...p.members.map((m) => ({ id: m.user, label: m.user, role: m.role, owner: false })),
  ]
  const taken = new Set(members.map((m) => m.id))
  return {
    ok: true,
    data: {
      members,
      assignableRoles: [...ASSIGNABLE],
      canManage,
      manageReason: canManage ? null : closed ? 'Project is closed — read-only.' : 'Only a Red Team Manager or Organization Admin can manage members.',
      invite: {
        supported: true,
        reason: null,
        needsPassword: false,
        candidates: Array.from(new Set(USERS.map((u) => u.name))).filter((name) => !taken.has(name)),
      },
    },
  }
}

export function createMockTeamService(authority: DbAuthority, guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>): TeamService {
  const memberOf = (ctx: RequestContext, user: string): TeamMember | null => {
    const found = findProject(authority.snapshot(), ctx)
    if (!found.ok) return null
    const row = found.data.members.find((m) => m.user === user)
    return row ? { id: row.user, label: row.user, role: row.role, owner: false } : null
  }
  return {
    read: (ctx) => guard(() => readTeam(authority.snapshot(), ctx)),
    invite: async (ctx, input) => {
      const found = findProject(authority.snapshot(), ctx)
      if (!found.ok) return found
      if (!USERS.some((u) => u.name === input.username)) return { ok: false, failure: { kind: 'validation', message: `${input.username} is not a user of this console.` } }
      const members = [...found.data.members, { user: input.username, role: input.role as Role, since: stamp() }]
      const written = setProjectMembers(authority, ctx, members, `Added ${input.username} as ${ROLE_LABEL[input.role as Role]}`, input.username)
      if (!written.ok) return written
      return { ok: true, data: memberOf(ctx, input.username) ?? { id: input.username, label: input.username, role: input.role, owner: false } }
    },
    changeRole: async (ctx, memberId, role) => {
      const found = findProject(authority.snapshot(), ctx)
      if (!found.ok) return found
      const members = found.data.members.map((m) => (m.user === memberId ? { ...m, role: role as Role } : m))
      const written = setProjectMembers(authority, ctx, members, `Changed ${memberId}'s role to ${ROLE_LABEL[role as Role]}`, memberId)
      if (!written.ok) return written
      return { ok: true, data: memberOf(ctx, memberId) ?? { id: memberId, label: memberId, role, owner: false } }
    },
    remove: async (ctx, memberId) => {
      const found = findProject(authority.snapshot(), ctx)
      if (!found.ok) return found
      const written = setProjectMembers(authority, ctx, found.data.members.filter((m) => m.user !== memberId), `Removed ${memberId} from the project`, memberId)
      return written.ok ? { ok: true, data: null } : written
    },
  }
}
