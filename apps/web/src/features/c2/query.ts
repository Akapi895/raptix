/**
 * C2 Query binding (ticket 45, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespaces over the shared console key builders. Keys
 * embed the auth scope at position 1, so a persona/project switch reads a
 * different cache entry and the superseded scope's in-flight reads are
 * cancelled. The overview and session-list keys start with the `session`
 * entity kind and the request key with `session-request`, so the bridge's
 * kind invalidation covers every live state change: a legacy session
 * mutation (grant, revocation, emergency-stop outcome, operation
 * completion) refetches the mounted overview and lists without a reload,
 * and an access-request decision refetches the requests view through
 * the same publication. Request/grant mutations live in the feature-local
 * transactions (./grants, ticket 46) behind the legacy action bridge.
 */
import { useQuery } from '@tanstack/react-query'
import { readGrantWatch, readRequestProject, readSessionProject } from './projection'
import { decideSessionRequestTransaction, type GrantRequestInput, type GrantRevokeInput, type SessionCommandInput } from './grants'
import { useServiceProjection } from '../../state/projection'
import { actorRef } from '../../domain/actor'
import { useServices } from '../../state/services'
import { useMe } from '../../state/console'
import { recordAudit, type AuditInput } from '../audit'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { ServiceFailure } from '../../domain/service'
import type {
  C2AuditQuery, C2AuditListRead, C2ChannelDetailRead, C2OverviewRead, C2GrantWatchRead,
  C2RequestListRead, C2SessionDetailRead, C2SessionListRead, C2SessionQuery,
} from './service'

/** Feature-local key namespaces (entity-kind-first for bridge invalidation). */
export const c2Keys = {
  overview: (scope: QueryScope) => consoleKeys.view('session', scope, 'c2-overview'),
  sessions: (scope: QueryScope, query: C2SessionQuery) => consoleKeys.view('session', scope, 'c2-sessions', query),
  session: (scope: QueryScope, id: string) => consoleKeys.entity('session', scope, id),
  requests: (scope: QueryScope) => consoleKeys.view('session-request', scope, 'c2-requests'),
  audit: (scope: QueryScope, query: C2AuditQuery) => consoleKeys.view('audit', scope, 'c2', query),
  channel: (scope: QueryScope, id: string) => consoleKeys.entity('channel', scope, id),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class C2ReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'C2ReadError'
  }
}

const ctxOf = (scope: QueryScope, corr: string) => ({ actor: actorRef(scope.actor, scope.role), projectId: scope.project, corr })

/** Query-backed C2 overview for the current auth/project scope. */
export function useC2Overview() {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: c2Keys.overview(scope),
    queryFn: async (): Promise<C2OverviewRead> => {
      const res = await services.c2(actorRef(scope.actor, scope.role), scope.project).overview(ctxOf(scope, 'c2-overview'))
      if (!res.ok) throw new C2ReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Query-backed scoped session list (filters and page are part of the key). */
export function useC2Sessions(query: C2SessionQuery) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: c2Keys.sessions(scope, query),
    queryFn: async (): Promise<C2SessionListRead> => {
      const res = await services.c2(actorRef(scope.actor, scope.role), scope.project).sessions(ctxOf(scope, 'c2-sessions'), query)
      if (!res.ok) throw new C2ReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Query-backed scoped access-request list (pending first). */
export function useC2Requests() {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: c2Keys.requests(scope),
    queryFn: async (): Promise<C2RequestListRead> => {
      const res = await services.c2(actorRef(scope.actor, scope.role), scope.project).requests(ctxOf(scope, 'c2-requests'))
      if (!res.ok) throw new C2ReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Query-backed scoped audit view (view/search/page are part of the key). */
export function useC2Audit(query: C2AuditQuery) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: c2Keys.audit(scope, query),
    queryFn: async (): Promise<C2AuditListRead> => {
      const res = await services.c2(actorRef(scope.actor, scope.role), scope.project).audit(ctxOf(scope, 'c2-audit'), query)
      if (!res.ok) throw new C2ReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Query-backed channel detail. */
export function useC2Channel(id?: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: c2Keys.channel(scope, id || ''),
    queryFn: async (): Promise<C2ChannelDetailRead> => {
      const res = await services.c2(actorRef(scope.actor, scope.role), scope.project).channel(ctxOf(scope, 'c2-channel'), id || '')
      if (!res.ok) throw new C2ReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!id,
  })
}

/**
 * Query-backed session detail (ticket 47). The key is `['session', scope, id]`,
 * so every session ChangeSet — grant, command, deadline sweep, termination —
 * refetches the mounted detail and console without a reload, and a persona or
 * project switch reads a different cache entry.
 */
export function useC2Session(id?: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: c2Keys.session(scope, id || ''),
    queryFn: async (): Promise<C2SessionDetailRead> => {
      const res = await services.c2(actorRef(scope.actor, scope.role), scope.project).session(ctxOf(scope, 'c2-session'), id || '')
      if (!res.ok) throw new C2ReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!id,
  })
}

/** Expiry alerts observe typed snapshots synchronously, without a Query fetch gap. */
export function useC2GrantWatch(): C2GrantWatchRead | undefined {
  return useServiceProjection(readGrantWatch)
}

/* ── Mock console adapter for the C2 screens: the display clock, the demo controls, and the legacy-correlated session commands and
 * grant writes the mirrored console always made. Mock mode only; the seam is intermediate, not a merged mock/real surface. ── */

export function useC2MockConsole() {
  const services = useServices()
  const me = useMe()
  const actor = { id: me.name, role: me.role }
  const ctx = (projectId: string) => ({ actor, projectId, corr: 'legacy' })
  const c2 = (projectId: string) => services.c2(actor, projectId)
  return {
    display: services.display,
    demo: services.demo,
    projectOfSession: (sessionId: string) => readSessionProject(services, actor, sessionId),
    projectOfRequest: (requestId: string) => readRequestProject(services, actor, requestId),
    decideRequest: (projectId: string, input: Parameters<typeof decideSessionRequestTransaction>[3]) =>
      decideSessionRequestTransaction(services.authority, services.clock, ctx(projectId), input),
    requestAccess: (projectId: string, input: GrantRequestInput) => c2(projectId).requestAccess(ctx(projectId), input),
    revokeGrant: (projectId: string, input: GrantRevokeInput) => c2(projectId).revokeGrant(ctx(projectId), input),
    sendCommand: (projectId: string, input: SessionCommandInput) => c2(projectId).sendCommand(ctx(projectId), input),
    expireGrant: (projectId: string, sessionId: string, user: string) => c2(projectId).expireGrant(ctx(projectId), sessionId, user),
    audit: (projectId: string, input: AuditInput) => recordAudit(services, ctx(projectId), input),
  }
}
