/**
 * Organization settings Query binding (ticket 56, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. Keys
 * start with the `org` entity kind and embed the auth scope at position 1:
 * any committed org change (this service's writes) invalidates the `['org']`
 * prefix, and the bridge's project-view invalidation also reaches these views
 * when a legacy action changes a project the members view derives from (a
 * wizard-created membership appears in the users table without a reload).
 * A persona/project switch cancels the superseded scope's reads.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useServices, useStore } from '../../store'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { OrgInvite, OrgProfile, Role } from '../../domain/entities'
import type {
  OrgInviteInput, OrgMemberStatusAction, OrgMemberView, OrgProfilePatch,
  OrgProfileRead, OrgMembersRead,
} from './service'

/** Feature-local key namespaces: ['org', scope, 'profile' | 'members']. */
export const orgKeys = {
  profile: (scope: QueryScope) => consoleKeys.view('org', scope, 'profile'),
  members: (scope: QueryScope) => consoleKeys.view('org', scope, 'members'),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class OrgReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'OrgReadError'
  }
}

/**
 * The actor for org reads/writes comes from the store's persona projection,
 * which applies committed role overrides — a member whose role was changed in
 * settings is authorized under the new role immediately (no fork between the
 * legacy seam and this typed one). Query keys stay scoped by persona/project.
 */
function useOrgActor() {
  const { me } = useStore()
  return useMemo(() => ({ id: me.name, role: me.role }), [me.name, me.role])
}

/** Query-backed organization profile for the current auth/project scope. */
export function useOrgProfile() {
  const services = useServices()
  const scope = useQueryScope()
  const actor = useOrgActor()
  return useQuery({
    queryKey: orgKeys.profile(scope),
    queryFn: async (): Promise<OrgProfileRead> => {
      const res = await services
        .settings(actor, scope.project)
        .getProfile({ actor, projectId: scope.project, corr: 'org-profile' })
      if (!res.ok) throw new OrgReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Query-backed organization members (roles, statuses, invites, project ids). */
export function useOrgMembers() {
  const services = useServices()
  const scope = useQueryScope()
  const actor = useOrgActor()
  return useQuery({
    queryKey: orgKeys.members(scope),
    queryFn: async (): Promise<OrgMembersRead> => {
      const res = await services
        .settings(actor, scope.project)
        .getMembers({ actor, projectId: scope.project, corr: 'org-members' })
      if (!res.ok) throw new OrgReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/**
 * Write-side binding (ticket 56): typed organization mutations for the
 * current scope. Each call captures actor/project at call time — a persona
 * or project switch never retargets an in-flight write — and every commit
 * publishes one ChangeSet the bridge turns into refetches for both the
 * Query views and the legacy store. Callers resolve the explicit
 * ServiceResult: a refused write never commits, and the message is safe to
 * render.
 */
export function useOrgWrites() {
  const services = useServices()
  const scope = useQueryScope()
  const actor = useOrgActor()
  return useMemo(() => {
    const ctx = (corr: string): RequestContext => ({ actor, projectId: scope.project, corr })
    const svc = () => services.settings(actor, scope.project)
    return {
      updateProfile: (patch: OrgProfilePatch): Promise<ServiceResult<OrgProfile>> =>
        svc().updateProfile(ctx('org-profile-save'), patch),
      setMemberRole: (name: string, role: Role, reason: string): Promise<ServiceResult<OrgMemberView>> =>
        svc().setMemberRole(ctx('org-member-role'), name, role, reason),
      setMemberStatus: (name: string, action: OrgMemberStatusAction, reason: string): Promise<ServiceResult<OrgMemberView>> =>
        svc().setMemberStatus(ctx('org-member-status'), name, action, reason),
      inviteMember: (input: OrgInviteInput): Promise<ServiceResult<OrgInvite>> =>
        svc().inviteMember(ctx('org-invite'), input),
    }
  }, [services, scope.project, actor])
}
