/**
 * Notice center query binding (plan P09, Notices slice). Reads go through the notice
 * center port for the current persona and project. Writes resolve to their
 * ServiceResult, so the header renders a refused write in the server's words and a
 * committed write refreshes the notice keys in both modes.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { actorRef } from '../../demo/persona'
import { useFeatureServices as useServices } from '../../state/feature-services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { RequestContext } from '../../domain/service'
import type { NoticeCenterService } from './center'

const ctxOf = (scope: QueryScope, corr: string): RequestContext => ({ actor: actorRef(scope.actor, scope.role), projectId: scope.project, corr })

function useCenter(): { services: ReturnType<typeof useServices>; scope: QueryScope; center: () => NoticeCenterService } {
  const services = useServices()
  const scope = useQueryScope()
  return { services, scope, center: () => services.noticeCenter(actorRef(scope.actor, scope.role), scope.project) }
}

/** The persona's notices: the list, the unread count and whether this account may dismiss. */
export function useNoticeCenterRead() {
  const { services, scope, center } = useCenter()
  return useQuery({
    queryKey: consoleKeys.view('notice', scope, 'center'),
    queryFn: async () => {
      const res = await center().list(ctxOf(scope, 'notice-list'))
      if (!res.ok) throw new Error(res.failure.message)
      return res.data
    },
    enabled: !!services,
  })
}

/** Read, dismiss and mark-all writes; each resolves to its ServiceResult and refreshes the notice keys. */
export function useNoticeCenterWrites() {
  const { scope, center } = useCenter()
  const client = useQueryClient()
  const refresh = () => client.invalidateQueries({ queryKey: ['notice'] })
  return {
    setRead: useMutation({
      mutationFn: (v: { id: string; read: boolean }) => center().setRead(ctxOf(scope, 'notice-read'), v.id, v.read),
      onSettled: refresh,
    }),
    dismiss: useMutation({
      mutationFn: (id: string) => center().dismiss(ctxOf(scope, 'notice-dismiss'), id),
      onSettled: refresh,
    }),
    markAllRead: useMutation({
      mutationFn: () => center().markAllRead(ctxOf(scope, 'notice-read-all')),
      onSettled: refresh,
    }),
  }
}
