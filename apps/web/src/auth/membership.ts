/**
 * Service-backed project membership view (ticket 06, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * A typed read through the factory's `forScope`: it lists the projects the
 * actor can access in a scope, through the same scope-checked handlers every
 * migrated feature uses. The permission policy (`policy.ts`) is the decision
 * rule this view is checked against; the legacy store keeps its synchronous
 * projection of the same rule until its screens migrate. The Query binding
 * keys by auth scope, so a persona/project switch reads a different cache
 * entry and the ScopeCancelBridge cancels superseded reads.
 */
import { useQuery } from '@tanstack/react-query'
import type { Project } from '../domain/entities'
import type { ConsoleServices } from '../domain/console-services';
import type { ActorRef, ListResult, PageRequest, RequestContext } from '../domain/service'
import { consoleKeys, useQueryScope } from '../state/keys'
import { useServices } from '../state/services'
import { actorRef } from '../domain/actor'

/** Lists the actor's accessible projects in a scope via the typed service read. */
export function listProjectMemberships(
  services: ConsoleServices,
  actor: ActorRef,
  projectId = '',
  page?: PageRequest,
): Promise<ListResult<Project>> {
  const ctx: RequestContext = { actor, projectId, corr: 'memberships' }
  return services.forScope(actor, projectId).list(ctx, page)
}

/** Resolves the membership view to the set of accessible project ids. */
export async function accessibleProjectIds(services: ConsoleServices, actor: ActorRef, projectId = ''): Promise<Set<string>> {
  const res = await listProjectMemberships(services, actor, projectId)
  if (!res.ok) throw new Error(res.failure.message)
  return new Set(res.data.items.map((p) => p.id))
}

/** Query-backed membership view for migrated consumers; keyed by the auth scope. */
export function useProjectMemberships() {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: consoleKeys.view('project-memberships', scope),
    queryFn: () => listProjectMemberships(services, actorRef(scope.actor, scope.role), scope.project),
    enabled: !!services,
  })
}
