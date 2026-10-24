import type { RequestContext, ServiceResult } from '../../domain/service'

export interface TeamMember {
  id: string
  label: string
  /** `owner` for the engagement owner; otherwise the role this source assigns. */
  role: string
  owner: boolean
}

export interface TeamInvite {
  supported: boolean
  /** The explicit reason invites are unavailable, shown in place of the control. */
  reason: string | null
  /** Real invites create an account and need a password; the mock adds an existing user. */
  needsPassword: boolean
  /** Users the mock can add; empty when the source takes a free-text username. */
  candidates: string[]
}

export interface TeamRead {
  members: TeamMember[]
  assignableRoles: string[]
  canManage: boolean
  manageReason: string | null
  invite: TeamInvite
}

export interface TeamInviteInput { username: string; displayName: string; role: string; password: string }

export interface TeamService {
  read(ctx: RequestContext): Promise<ServiceResult<TeamRead>>
  invite(ctx: RequestContext, input: TeamInviteInput): Promise<ServiceResult<TeamMember>>
  changeRole(ctx: RequestContext, memberId: string, role: string): Promise<ServiceResult<TeamMember>>
  remove(ctx: RequestContext, memberId: string): Promise<ServiceResult<null>>
}
