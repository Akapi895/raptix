import { useQuery } from '@tanstack/react-query'
import { fetchMembers } from './api'

/**
 * Resolves an actor id to the label of an engagement member, so screens show
 * "Alice" rather than a raw user id. Shares the Team panel's cache entry. An id
 * that is not a member of the engagement resolves to itself: never a made-up name.
 */
export function useMemberLabels(engagementId: string): (actorId: string) => string {
  const members = useQuery({ queryKey: ['real', 'members', engagementId], queryFn: () => fetchMembers(engagementId) })
  const labels = new Map((members.data?.members ?? []).map((m) => [m.id, m.label]))
  return (actorId: string) => labels.get(actorId) ?? actorId
}
