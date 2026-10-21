/** Resolves Findings provenance and trusted request identity at the composition seam. */
import { useContext } from 'react'
import { DATA_MODE } from '../../state/mode'
import { SessionContext } from '../../platform/session'
import { useMe } from '../../state/console'

export const persistentFindings = DATA_MODE === 'real'

export function useFindingIdentity() {
  const session = useContext(SessionContext)
  const me = useMe()
  return {
    actorId: session?.session?.actor?.id ?? me.email,
    trustedActorId: session?.session?.actor?.id ?? null,
    deploymentId: session?.deploymentId ?? window.location.origin,
    uploadActorId: session?.session?.actor?.id ?? 'local',
    uploadDeploymentId: session?.deploymentId ?? 'local',
  }
}
