/** Subscribes to narrow typed feature service reads without a fetch gap. */
import { useCallback, useSyncExternalStore } from 'react'
import type { ConsoleServices } from '../domain/console-services';
import type { RequestContext } from '../domain/service'
import { useQueryScope } from './keys'
import { useServices } from './services'

export function useServiceProjection<T>(read: (services: ConsoleServices, ctx: RequestContext) => T, projectId?: string): T {
  const services = useServices()
  const scope = useQueryScope()
  const subscribe = useCallback((changed: () => void) => services.subscribe(changed), [services])
  return useSyncExternalStore(subscribe, () => read(services, {
    actor: { id: scope.actor, role: scope.role }, projectId: projectId ?? scope.project, corr: 'projection',
  }))
}
