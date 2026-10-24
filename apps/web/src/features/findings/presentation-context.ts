/** Resolves Findings provenance and trusted request identity at the composition seam. */
import { useContext } from 'react'
import { SessionContext } from '../../platform/session'
import { useMe } from '../../state/console'
import { useIndependentReviewRequired } from '../../state/real-context'

export function useFindingIdentity() {
  const session = useContext(SessionContext)
  const me = useMe()
  const independentReviewRequired = useIndependentReviewRequired()
  return {
    actorId: session?.session?.actor?.id ?? me.email,
    trustedActorId: session?.session?.actor?.id ?? null,
    independentReviewRequired,
    deploymentId: session?.deploymentId ?? window.location.origin,
    uploadActorId: session?.session?.actor?.id ?? 'local',
    uploadDeploymentId: session?.deploymentId ?? 'local',
  }
}
