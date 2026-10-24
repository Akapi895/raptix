import { useQuery } from '@tanstack/react-query'
import { useFeatureServices } from '../../state/feature-services'
import { consoleKeys, useQueryScope } from '../../state/keys'
import type { ObservedAnalysisRead } from './observed'

/** The observed analysis of one engagement: the techniques its observed records hold, and the source the read came from. */
export function useObservedAnalysis(engagementId: string) {
  const services = useFeatureServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: consoleKeys.view('analysis', scope, engagementId, 'observed'),
    queryFn: async (): Promise<ObservedAnalysisRead> => {
      const actor = { id: scope.actor, role: scope.role }
      const res = await services.observedAnalysis(actor, engagementId).read({ actor, projectId: engagementId, corr: 'analysis-observed' })
      if (!res.ok) throw new Error(res.failure.message)
      return res.data
    },
    enabled: !!services,
  })
}
