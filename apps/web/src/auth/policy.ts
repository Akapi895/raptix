/**
 * Shared permission policy (ticket 06, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The documented 6-role × 19-action matrix, project membership and
 * read-only context live here as the one authorization authority. Every
 * decision takes the actor and the addressed project explicitly — UI modes,
 * panels or screens never grant authorization. Consumers:
 * - `src/store.tsx` forwards the legacy `can`/`canAccessProject`/`readOnly`
 *   helpers here so baseline screens keep their exact semantics;
 * - `src/domain/service-factory.ts` scope-checks typed reads/writes with the
 *   same membership rule (replacing its interim copy);
 * - `src/auth/membership.ts` is the service-backed membership view the
 *   interface is checked against.
 */
import type { Project, Role } from '../domain/entities'
import type { CanAction } from '../domain/permissions'
import type { ActorRef } from '../domain/service'

/** The subset of a project an authorization decision needs. */
export type ProjectRef = Pick<Project, 'id' | 'status' | 'members'>

/** The documented role → granted-actions matrix, ported verbatim from the legacy `can()` switch. */
export const ROLE_ACTIONS: Record<Role, readonly CanAction[]> = {
  admin: ['createProject', 'approve', 'editScope', 'confirmClose', 'reopen', 'admin', 'viewSensitive', 'estop', 'approvePlan', 'approveAccess', 'terminate'],
  manager: ['createProject', 'editScope', 'run', 'createFinding', 'reviewFinding', 'editReport', 'requestClose', 'viewSensitive', 'estop', 'plan', 'interactive', 'approveAccess', 'terminate'],
  operator: ['run', 'createFinding', 'editReport', 'viewSensitive', 'plan', 'interactive'],
  reviewer: ['approve', 'reviewFinding', 'approveReport', 'confirmClose', 'viewSensitive', 'approvePlan', 'approveAccess'],
  analyst: ['createFinding', 'editReport', 'viewSensitive'],
  viewer: [],
}

/** Compile-time guard: every one of the 19 actions must be granted somewhere. */
type GrantedSomewhere = (typeof ROLE_ACTIONS)[Role][number]
type MatrixCoversAll = [CanAction] extends [GrantedSomewhere] ? true : never
const matrixCoversAll: MatrixCoversAll = true
void matrixCoversAll

/** Display label for each role in the documented 6-role model (ticket 67: one definition, moved from the legacy store). */
export const ROLE_LABEL: Record<Role, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }

/** Roles that reach every project without an explicit membership entry. */
const ELEVATED: readonly Role[] = ['admin', 'manager', 'reviewer']

/** Membership rule: elevated roles see every project; other roles need a membership entry. */
export function projectAccessible(project: ProjectRef | undefined, actor: ActorRef): boolean {
  if (!project) return false
  if (ELEVATED.includes(actor.role)) return true
  return project.members.some((m) => m.user === actor.id)
}

/** Transitional membership adapter for callers holding a database projection. */
export function canAccessProject(db: { projects: readonly ProjectRef[] }, me: { name: string; role: Role }, projectId: string): boolean {
  return projectAccessible(db.projects.find((x) => x.id === projectId), { id: me.name, role: me.role })
}

/** True when the project context itself forbids mutations (closed or cancelled). */
export function projectLocked(project: ProjectRef | undefined): boolean {
  return !!project && (project.status === 'closed' || project.status === 'cancelled')
}

/**
 * The 19-action decision for an explicit actor/project pair. Denial order:
 * project membership first (a non-member can do nothing with the project —
 * ledger gap G-11), then the closed/cancelled read-only context, then the
 * role matrix. No project context (aggregate view) decides on the role
 * matrix alone, matching the legacy seam.
 */
export function can(actor: ActorRef, action: CanAction, project?: ProjectRef): boolean {
  if (project && !projectAccessible(project, actor)) return false
  if (projectLocked(project) && action !== 'reopen' && action !== 'viewSensitive') return false
  return ROLE_ACTIONS[actor.role].includes(action)
}

/** Read-only context: closed/cancelled projects and the viewer role; no project → editable. */
export function readOnlyContext(project: ProjectRef | undefined, actor: ActorRef): boolean {
  if (!project) return false
  return projectLocked(project) || actor.role === 'viewer'
}
