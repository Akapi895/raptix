/** Curated findings of an engagement, read for the operation results (P12). */
import { useQuery } from '@tanstack/react-query'
import { fetchCuratedFindings } from '../../real/api'
import { consoleKeys, useQueryScope } from '../../state/keys'

export function useCuratedFindings(engagementId: string) {
  const scope = useQueryScope()
  return useQuery({
    queryKey: consoleKeys.view('runtime-results', scope, engagementId, 'curated-findings'),
    queryFn: () => fetchCuratedFindings(engagementId),
    enabled: engagementId !== '' && engagementId !== 'all',
  })
}
