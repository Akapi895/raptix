/**
 * The project detail's engagement read (migration Mốc 2). Keyed like the other project reads, so an invalidation of the
 * project reaches the detail page too.
 */
import { useQuery } from '@tanstack/react-query'
import { getEngagement } from './remote'
import { projectKeys, useProjectCacheActor } from './query'

export function useEngagementDetail(engagementId: string) {
  const cacheActor = useProjectCacheActor()
  return useQuery({ queryKey: projectKeys.detail(cacheActor, engagementId), queryFn: () => getEngagement(engagementId), enabled: !!engagementId })
}
