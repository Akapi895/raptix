/** Narrow C2 deadline, renewal and request-address reads over the owning service. */
import type { Session } from '../../domain/entities'
import type { ConsoleServices } from '../../domain/service-factory'
import type { ActorRef, RequestContext } from '../../domain/service'
import { projectAccessible } from '../../auth/policy'
import { projectView, scopedRows } from '../../domain/projection'
import { useServiceProjection } from '../../state/projection'
import { getGrantWatch, sessionPermOf, type C2GrantWatchRead, type C2Perm } from './service'

export function readGrantWatch(services: ConsoleServices, ctx: RequestContext): C2GrantWatchRead | undefined {
  return projectView(services, ctx, 'c2-grant-watch', (db) => {
    const res = getGrantWatch(db, ctx)
    return res.ok ? res.data : undefined
  })
}

export function readRenewalSessions(services: ConsoleServices, ctx: RequestContext): { sessions: Session[] } {
  return projectView(services, ctx, 'c2-renewal-sessions', (db) => ({ sessions: scopedRows(db, ctx, db.sessions) }))
}

export function readSessionProject(services: ConsoleServices, actor: ActorRef, id: string): string | undefined {
  const db = services.authority.snapshot()
  const session = db.sessions.find((s) => s.id === id)
  return session && projectAccessible(db.projects.find((p) => p.id === session.projectId), actor) ? session.projectId : undefined
}

export function readRequestProject(services: ConsoleServices, actor: ActorRef, id: string): string | undefined {
  const db = services.authority.snapshot()
  const request = db.sessionRequests.find((r) => r.id === id)
  return request && projectAccessible(db.projects.find((p) => p.id === request.projectId), actor) ? request.projectId : undefined
}

export function useRenewalSessions(): { sessions: Session[] } { return useServiceProjection(readRenewalSessions) }

/** The actor's derived C2 permission for one session, from recorded grants only. */
export function readSessionPerm(services: ConsoleServices, ctx: RequestContext, s: Session): C2Perm {
  return projectView(services, ctx, 'session-perm.' + s.id, (db) => sessionPermOf(db, ctx, s))
}

export function useSessionPerm(s: Session): C2Perm {
  return useServiceProjection((services, ctx) => readSessionPerm(services, ctx, s))
}
