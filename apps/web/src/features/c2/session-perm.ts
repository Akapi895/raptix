/**
 * Session access permission rule (ticket 70 module split): the pure
 * C2-permission predicate lives in its own feature-local module so eager
 * consumers (navigation search) do not pull the C2 read service into the
 * initial load. The rule is unchanged: viewer personas and out-of-project
 * actors have no access; a recorded grant wins; project members read-only.
 */
import { projectAccessible } from '../../auth/policy'
import type { Db } from '../../data'
import type { Session } from '../../domain/entities'
import type { RequestContext } from '../../domain/service'

export type C2Perm = 'none' | 'read-only' | 'interactive'

/** Recorded per-user permission for one session (viewer ⇒ none; grant ⇒ grant perm; member ⇒ read-only). */
export function sessionPermOf(db: Db, ctx: RequestContext, s: Session): C2Perm {
  if (ctx.actor.role === 'viewer' || !projectAccessible(db.projects.find((p) => p.id === s.projectId), ctx.actor)) return 'none'
  const g = s.grants.find((x) => x.user === ctx.actor.id)
  return g ? g.perm : 'read-only'
}
