/**
 * Notice center Query binding (ticket 59, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. The list
 * view starts with the `notice` entity kind and embeds the auth scope at
 * position 1, so every committed notice change — this service's writes and
 * every legacy `A.notify`/submission that produces a notice — invalidates the
 * `['notice']` prefix through the ChangeSet bridge and the header badge and
 * popover refetch without a reload. Keys embed the full scope, so a persona
 * switch reads a different cache entry while the ScopeCancelBridge cancels
 * the superseded scope's reads before a late response can restore its
 * visibility.
 */
import { useMemo } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useServices } from '../../state/services'
import { useMe } from '../../state/console'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { ServiceFailure, ServiceResult } from '../../domain/service'
import type { NoticeListRead, NoticeView } from './service'

/** Feature-local key namespaces: ['notice', scope, 'list']. */
export const noticeKeys = {
  list: (scope: QueryScope) => consoleKeys.view('notice', scope, 'list'),
}

/** A service failure rethrown as the query error, so the popover renders the kind and message. */
export class NoticeReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'NoticeReadError'
  }
}

/**
 * Query-backed persona-scoped notification list for the header badge and
 * popover. The actor comes from the canonical persona projection, so a role
 * override committed in settings applies to the notice gate immediately.
 */
export function useNotices() {
  const services = useServices()
  const scope = useQueryScope()
  const me = useMe()
  return useQuery({
    queryKey: noticeKeys.list(scope),
    queryFn: async (): Promise<NoticeListRead> => {
      const actor = { id: me.name, role: me.role }
      const res = await services
        .notices(actor, scope.project)
        .list({ actor, projectId: scope.project, corr: 'notice-list' })
      if (!res.ok) throw new NoticeReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

let corrSeq = 0
const corr = (act: string) => `${act}-${++corrSeq}`

/**
 * Write-side binding (ticket 59): typed notice mutations for the current
 * scope. Each call captures the actor at call time — a persona switch never
 * retargets an in-flight write — and every commit publishes one ChangeSet the
 * bridge turns into refetches for the badge/popover and the legacy store.
 * Callers resolve the explicit ServiceResult: a refused write never commits,
 * and the failure message is safe to render.
 */
export function useNoticeWrites() {
  const services = useServices()
  const scope = useQueryScope()
  const me = useMe()
  return useMemo(() => {
    const actor = () => ({ id: me.name, role: me.role })
    const svc = () => services.notices(actor(), scope.project)
    const ctx = (c: string) => ({ actor: actor(), projectId: scope.project, corr: c })
    return {
      setRead: (id: string, read: boolean): Promise<ServiceResult<NoticeView>> =>
        svc().setRead(ctx(corr('notice-read')), id, read),
      dismiss: (id: string): Promise<ServiceResult<{ id: string }>> =>
        svc().dismiss(ctx(corr('notice-dismiss')), id),
      markAllRead: (): Promise<ServiceResult<{ unread: number }>> =>
        svc().markAllRead(ctx(corr('notice-read-all'))),
    }
  }, [services, scope.project, me.name, me.role])
}

/** Convenience mutation wrappers the popover consumes; results resolve as ServiceResult for the callers to render. */
export function useNoticeMutations() {
  const writes = useNoticeWrites()
  return {
    setRead: useMutation({ mutationFn: (v: { id: string; read: boolean }) => writes.setRead(v.id, v.read) }),
    dismiss: useMutation({ mutationFn: (id: string) => writes.dismiss(id) }),
    markAllRead: useMutation({ mutationFn: () => writes.markAllRead() }),
  }
}
