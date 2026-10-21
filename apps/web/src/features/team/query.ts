/**
 * Membership query binding (plan P09, Team slice). Reads go through
 * TeamService and are keyed by the auth scope; each membership write refreshes
 * the team read and the project's access-dependent reads.
 */
import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { actorRef } from '../../demo/persona'
import { useFeatureServices as useServices } from '../../state/feature-services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { RequestContext, ServiceFailure } from '../../domain/service'
import type { TeamInviteInput, TeamMember, TeamRead } from './service'

export class TeamError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'TeamError'
  }
}

const ctxOf = (scope: QueryScope, corr: string): RequestContext => ({ actor: actorRef(scope.actor, scope.role), projectId: scope.project, corr })

export function useTeamRead() {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: consoleKeys.view('team', scope, 'read'),
    queryFn: async (): Promise<TeamRead> => {
      const res = await services.team(actorRef(scope.actor, scope.role), scope.project).read(ctxOf(scope, 'team-read'))
      if (!res.ok) throw new TeamError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Writes resolve to the committed member or throw a TeamError with the handler's reason; a committed change refreshes the team read. */
export function useTeamWrites() {
  const services = useServices()
  const scope = useQueryScope()
  const client = useQueryClient()
  return useMemo(() => {
    const svc = () => services.team(actorRef(scope.actor, scope.role), scope.project)
    const refresh = async (): Promise<void> => {
      await client.invalidateQueries({ queryKey: ['team'] })
    }
    return {
      invite: async (input: TeamInviteInput): Promise<TeamMember> => {
        const res = await svc().invite(ctxOf(scope, 'team-invite'), input)
        if (!res.ok) throw new TeamError(res.failure)
        await refresh()
        return res.data
      },
      changeRole: async (memberId: string, role: string): Promise<TeamMember> => {
        const res = await svc().changeRole(ctxOf(scope, 'team-role'), memberId, role)
        if (!res.ok) throw new TeamError(res.failure)
        await refresh()
        return res.data
      },
      remove: async (memberId: string): Promise<void> => {
        const res = await svc().remove(ctxOf(scope, 'team-remove'), memberId)
        if (!res.ok) throw new TeamError(res.failure)
        await refresh()
      },
    }
  }, [services, scope, client])
}
