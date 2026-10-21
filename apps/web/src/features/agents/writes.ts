/**
 * Agent allocation + group write handlers (ticket 49, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Assignment and group management run as typed transactions over the one
 * database authority. Every write captures actor and project at call time
 * and binds to the addressed agent/group, so a persona or project switch
 * never retargets it. Eligibility is enforced HERE — never in the screen:
 * an immediate assignment moves a connected, unreserved POOL agent into a
 * project that is active or approved, decided by an `editScope` role, and a
 * pending assignment request never silently allocates (requests use ticket
 * 21's approval transaction; the immediate path refuses while a request for
 * the same agent is in review). Unassignment returns an unreserved agent to
 * the shared pool. Groups confine membership to the group's project and the
 * pool. Out-of-scope targets are `not-found` without an existence leak,
 * cross-context writes are `forbidden` with the owning project only, and
 * destructive edges require the confirm dialog's reason — the audit row and
 * the project notice commit atomically with the change, refusals commit
 * nothing.
 */
import { can, projectAccessible, readOnlyContext } from '../../domain/policy'
import type { Db } from '../../demo/seed';
import { formatDemoInstant } from '../../domain/clock'
import type { DbAuthority } from '../../demo/authority'
import type { Agent, Group, Project } from '../../domain/entities'
import type { Clock, RequestContext, ServiceResult } from '../../domain/service'

/** Audit display labels for the actor's role (kept local to avoid a store cycle). */
const ROLE_LABEL: Record<string, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }

const ACTIVE: readonly Project['status'][] = ['active', 'approved']
const CONN = (a: Agent) => a.status === 'online' || a.status === 'idle'
const STATUS_LABEL: Record<Agent['status'], string> = { online: 'Connected', idle: 'Idle', lost: 'Disconnected', disabled: 'Disabled', unknown: 'Unknown', unhealthy: 'Unhealthy' }

const agentRef = (id: string, projectId?: string) => ({ kind: 'agent' as const, id, projectId })
const projectRef = (id: string) => ({ kind: 'project' as const, id, projectId: id })
const groupRef = (id: string, projectId: string) => ({ kind: 'agent-group' as const, id, projectId })
const stampOf = (clock: Clock) => formatDemoInstant(clock.now())
const pad2 = (n: number) => String(n).padStart(2, '0')

/** Cross-context guard: a specific-project request may only address that project. */
const crossContext = (ctx: RequestContext, projectId: string): boolean =>
  !!ctx.projectId && ctx.projectId !== 'all' && ctx.projectId !== projectId

/** The in-review assignment request for one agent, if any (pending never silently allocates). */
export const pendingAssignmentOf = (db: Db, agentId: string) =>
  db.approvals.find((ap) => ap.type.startsWith('Agent assignment') && ap.status === 'pending' && (ap.diff || '').includes(agentId))

/* ───────────── Assignment (immediate path; the request path is 21's approval transaction) ───────────── */

export interface AssignmentInput {
  projectId: string
  /** Free-text detail recorded as the audit reason (duration, intended operation, reviewer). */
  note?: string
}

/**
 * Immediate assignment of a shared-pool agent to a project. Refusal order:
 * unknown agent, or an assigned agent whose project the actor cannot access,
 * or an inaccessible target → `not-found` (no existence leak); a closed/
 * cancelled target or read-only role → `forbidden`; a role without
 * `editScope` → `forbidden` (anyone with access can submit a request
 * instead); a draft/pending target → `validation` (request-only project);
 * an already-assigned agent, a disconnected or reserved agent, or an agent
 * with a pending assignment request → `conflict`/`validation` with the
 * observed reason. Success commits the assignment, its audit row and the
 * project notice in one ChangeSet.
 */
export function assignAgentTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, agentId: string, input: AssignmentInput): ServiceResult<Agent> {
  const db = authority.snapshot()
  const a = db.agents.find((x) => x.id === agentId)
  if (!a || (a.projectId && !projectAccessible(db.projects.find((p) => p.id === a.projectId), ctx.actor))) {
    return { ok: false, failure: { kind: 'not-found', message: `Agent ${agentId} does not exist or is not available for your account.`, entity: agentRef(agentId) } }
  }
  const target = db.projects.find((p) => p.id === input.projectId)
  if (!target || !projectAccessible(target, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: `Project ${input.projectId} does not exist or is not available for your account.`, entity: projectRef(input.projectId) } }
  }
  if (crossContext(ctx, target.id)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Project ${target.id} is outside the active project context. Switch to ${target.id} to assign agents to it.`, entity: projectRef(target.id) } }
  }
  if (readOnlyContext(target, ctx.actor)) {
    return { ok: false, failure: { kind: 'forbidden', message: ctx.actor.role === 'viewer' ? 'The Viewer role has read-only access.' : `Project ${target.id} is closed or cancelled — agents cannot be assigned to it.`, entity: projectRef(target.id) } }
  }
  if (!can(ctx.actor, 'editScope', target)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_LABEL[ctx.actor.role]}) cannot assign immediately. Anyone with access can submit a request for review instead.`, entity: projectRef(target.id) } }
  }
  if (!ACTIVE.includes(target.status)) {
    return { ok: false, failure: { kind: 'validation', message: `Project ${target.id} is ${target.status}: immediate assignment is not permitted until the ROE is approved. Submit a request instead.`, entity: projectRef(target.id) } }
  }
  if (a.projectId) {
    return { ok: false, failure: { kind: 'conflict', message: `${agentId} is already assigned to ${a.projectId}. Only shared-pool agents can be assigned.`, entity: agentRef(agentId, a.projectId) } }
  }
  if (!CONN(a)) {
    return { ok: false, failure: { kind: 'validation', message: `${agentId} is ${STATUS_LABEL[a.status]} (last seen ${a.lastSeen}). A non-connected agent is never available or auto-assigned.`, entity: agentRef(agentId) } }
  }
  if (a.op) {
    return { ok: false, failure: { kind: 'conflict', message: `${agentId} is reserved by ${a.op} until the operation finishes or is stopped.`, entity: agentRef(agentId) } }
  }
  const pending = pendingAssignmentOf(db, agentId)
  if (pending) {
    return { ok: false, failure: { kind: 'conflict', message: `Request ${pending.id} for ${agentId} is already pending review — pending approval does not allocate.`, entity: agentRef(agentId) } }
  }
  const at = stampOf(clock)
  authority.commit(ctx.corr, (d) => {
    const ag = d.agents.find((x) => x.id === agentId)!
    ag.projectId = target.id
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Assigned agent to project', obj: agentId, projectId: target.id, result: 'Success', reason: input.note?.trim() || 'Assigned immediately.' })
    d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + clock.now() % 10000, group: 'update', text: `${agentId} was assigned to ${target.id}`, projectId: target.id, at, read: false, to: { name: 'project', id: target.id }, category: 'agents' })
  })
  return { ok: true, data: authority.snapshot().agents.find((x) => x.id === agentId)! }
}

/**
 * Returns an unreserved assigned agent to the shared pool (group membership
 * is untouched — groups are orthogonal to allocation). The agent's own
 * project is the binding: out-of-access → `not-found`, another specific-
 * project context → `forbidden` with the owning project, read-only context
 * or a role without `editScope` → `forbidden`, a reserved agent → `conflict`
 * until its operation ends. A non-empty reason is required and the audit row
 * plus the project notice commit with the change.
 */
export function unassignAgentTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, agentId: string, reason: string): ServiceResult<Agent> {
  const db = authority.snapshot()
  const a = db.agents.find((x) => x.id === agentId)
  if (!a) {
    return { ok: false, failure: { kind: 'not-found', message: `Agent ${agentId} does not exist or is not available for your account.`, entity: agentRef(agentId) } }
  }
  if (!a.projectId) {
    return { ok: false, failure: { kind: 'validation', message: `${agentId} is already in the shared pool.`, entity: agentRef(agentId) } }
  }
  const project = db.projects.find((p) => p.id === a.projectId)
  if (!project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: `Agent ${agentId} does not exist or is not available for your account.`, entity: agentRef(agentId) } }
  }
  if (crossContext(ctx, project.id)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Agent ${agentId} belongs to project ${project.id}. Switch to that project to release it.`, entity: agentRef(agentId, project.id) } }
  }
  if (readOnlyContext(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'forbidden', message: ctx.actor.role === 'viewer' ? 'The Viewer role has read-only access.' : `Project ${project.id} is closed or cancelled — allocation is read-only.`, entity: agentRef(agentId, project.id) } }
  }
  if (!can(ctx.actor, 'editScope', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_LABEL[ctx.actor.role]}) cannot change agent allocation. Only a Red Team Manager or Organization Admin can.`, entity: agentRef(agentId, project.id) } }
  }
  if (!reason.trim()) {
    return { ok: false, failure: { kind: 'validation', message: `A reason is required to return ${agentId} to the shared pool.`, entity: agentRef(agentId, project.id) } }
  }
  if (a.op) {
    return { ok: false, failure: { kind: 'conflict', message: `${agentId} is reserved by ${a.op}. The reservation must end before the agent can be released.`, entity: agentRef(agentId, project.id) } }
  }
  const at = stampOf(clock)
  authority.commit(ctx.corr, (d) => {
    const ag = d.agents.find((x) => x.id === agentId)!
    const from = ag.projectId
    ag.projectId = ''
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Released agent to shared pool', obj: agentId, projectId: from, result: 'Success', reason: reason.trim() })
    d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + clock.now() % 10000, group: 'update', text: `${agentId} was returned to the shared pool`, projectId: from, at, read: false, to: { name: 'project', id: from }, category: 'agents' })
  })
  return { ok: true, data: authority.snapshot().agents.find((x) => x.id === agentId)! }
}

/* ───────────── Agent status (the legacy raw mutation, ticket 67 wave 5) ───────────── */

/**
 * Sets an agent's status (the detail screen's disable/enable action). This
 * is the legacy `A.setAgentStatus` entry moved verbatim — mutate first, then
 * the 'Disabled agent'/'Enabled agent' audit row bound to the agent's own
 * project, two commits in the same order with the same demo stamp. No
 * eligibility gate lives here (the legacy entry had none): the screen owns
 * the role/read-only reasons, and the disable reason is audited separately
 * by the caller.
 */
export function setAgentStatusTransaction(authority: DbAuthority, ctx: RequestContext, agentId: string, s: Agent['status']): void {
  const projectId = authority.snapshot().agents.find((x) => x.id === agentId)?.projectId ?? ''
  authority.commit(ctx.corr, (d) => { d.agents.find((x) => x.id === agentId)!.status = s })
  authority.commit(ctx.corr, (d) => {
    d.audit.unshift({ corr: projectId === 'RT-2026-014' && /^(SS|AR)-/.test(agentId) ? 'COR-014-01' : undefined, id: 'AU-' + ++d.counters.audit, at: formatDemoInstant(authority.clock.now()), actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: s === 'disabled' ? 'Disabled agent' : 'Enabled agent', obj: agentId, projectId, result: 'Success', reason: '' })
  })
}

/* ───────────── Groups (create / rename / membership) ───────────── */

export interface GroupInput {
  id?: string
  name: string
  projectId: string
  desc: string
  agents: string[]
  owner: string
  policy: string
  /** Confirm-dialog reason; required when the edit removes agents an operation is using. */
  reason?: string
}

/**
 * Creates or updates a group — name (rename included), description, policy,
 * owner and membership in one commit. Membership rules are enforced here:
 * a member must exist, be free of another group, and be either a pool agent
 * (auto-assigned to the group's project, mirroring the legacy behavior) or
 * already assigned to the group's project — a cross-project agent is
 * refused with its owning project. Removing an agent an operation is
 * currently using requires the confirm reason; the removal changes the
 * group's usage policy only — it never stops the operation.
 */
export function saveGroupTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, input: GroupInput): ServiceResult<Group> {
  const db = authority.snapshot()
  const name = input.name.trim()
  if (!name) {
    return { ok: false, failure: { kind: 'validation', message: 'Enter a group name.', entity: groupRef(input.id || '', input.projectId) } }
  }
  const project = db.projects.find((p) => p.id === input.projectId)
  if (!project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: `Project ${input.projectId} does not exist or is not available for your account.`, entity: projectRef(input.projectId) } }
  }
  const group = input.id ? db.groups.find((g) => g.id === input.id) : undefined
  if (input.id && !group) {
    return { ok: false, failure: { kind: 'not-found', message: `Group ${input.id} does not exist or is not available for your account.`, entity: groupRef(input.id, input.projectId) } }
  }
  if (crossContext(ctx, project.id)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Project ${project.id} is outside the active project context. Switch to ${project.id} to edit its groups.`, entity: projectRef(project.id) } }
  }
  if (readOnlyContext(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'forbidden', message: ctx.actor.role === 'viewer' ? 'The Viewer role has read-only access.' : `Project ${project.id} is closed or cancelled — groups are read-only.`, entity: projectRef(project.id) } }
  }
  if (!can(ctx.actor, 'editScope', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_LABEL[ctx.actor.role]}) cannot edit groups. Only a Red Team Manager or Organization Admin can.`, entity: projectRef(project.id) } }
  }
  if (db.groups.some((g) => g.id !== input.id && g.projectId === project.id && g.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, failure: { kind: 'conflict', message: `A group named “${name}” already exists in ${project.id}.`, entity: groupRef(group?.id || '', project.id) } }
  }
  for (const aid of input.agents) {
    const ag = db.agents.find((x) => x.id === aid)
    if (!ag) {
      return { ok: false, failure: { kind: 'validation', message: `Agent ${aid} does not exist.`, entity: agentRef(aid) } }
    }
    if (ag.group && ag.group !== group?.name) {
      return { ok: false, failure: { kind: 'conflict', message: `${aid} already belongs to group ${ag.group}. Remove it there first.`, entity: agentRef(aid, ag.projectId || undefined) } }
    }
    if (ag.projectId && ag.projectId !== project.id) {
      return { ok: false, failure: { kind: 'validation', message: `${aid} belongs to project ${ag.projectId}. Group membership is limited to the group's project and the shared pool.`, entity: agentRef(aid, ag.projectId) } }
    }
  }
  const removed = (group?.agents ?? []).filter((aid) => !input.agents.includes(aid))
  const removedInUse = removed.map((aid) => db.agents.find((x) => x.id === aid)).filter((x): x is Agent => !!x?.op)
  if (removedInUse.length && !input.reason?.trim()) {
    return { ok: false, failure: { kind: 'validation', message: `A reason is required to remove agents that are in use (${removedInUse.map((x) => x.id).join(', ')}). Confirm the impact first.`, entity: groupRef(group!.id, project.id) } }
  }
  const at = stampOf(clock)
  const groupId = group?.id || 'GR-' + pad2(db.groups.length + 1)
  authority.commit(ctx.corr, (d) => {
    const gr = d.groups.find((g) => g.id === groupId)
    if (gr) Object.assign(gr, { name, projectId: project.id, desc: input.desc, agents: [...input.agents], owner: input.owner, policy: input.policy, updated: at })
    else d.groups.push({ id: groupId, name, projectId: project.id, desc: input.desc, agents: [...input.agents], owner: input.owner, policy: input.policy, updated: at })
    d.agents.forEach((ag) => {
      if (input.agents.includes(ag.id)) { ag.group = name; if (!ag.projectId) ag.projectId = project.id }
      else if (removed.includes(ag.id)) ag.group = ''
    })
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: group ? 'Updated agent group' : 'Created agent group', obj: groupId, projectId: project.id, result: 'Success', reason: input.reason?.trim() || '' })
    if (removedInUse.length) {
      d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: 'Removed in-use agent from group', obj: removedInUse.map((x) => x.id).join(', '), projectId: project.id, result: 'Success', reason: input.reason!.trim() })
    }
  })
  return { ok: true, data: authority.snapshot().groups.find((g) => g.id === groupId)! }
}

/**
 * Removes one agent from a group. The group's project is the binding
 * (out-of-access → `not-found`, another specific-project context →
 * `forbidden`); only a real member can be removed and an agent an operation
 * is currently using requires the confirm reason.
 */
export function removeFromGroupTransaction(authority: DbAuthority, clock: Clock, ctx: RequestContext, groupId: string, agentId: string, reason = ''): ServiceResult<Group> {
  const db = authority.snapshot()
  const g = db.groups.find((x) => x.id === groupId)
  const project = g ? db.projects.find((p) => p.id === g.projectId) : undefined
  if (!g || !project || !projectAccessible(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'not-found', message: `Group ${groupId} does not exist or is not available for your account.`, entity: groupRef(groupId, g?.projectId || '') } }
  }
  if (crossContext(ctx, project.id)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Group ${g.name} belongs to project ${project.id}. Switch to that project to edit it.`, entity: groupRef(groupId, project.id) } }
  }
  if (readOnlyContext(project, ctx.actor)) {
    return { ok: false, failure: { kind: 'forbidden', message: ctx.actor.role === 'viewer' ? 'The Viewer role has read-only access.' : `Project ${project.id} is closed or cancelled — groups are read-only.`, entity: groupRef(groupId, project.id) } }
  }
  if (!can(ctx.actor, 'editScope', project)) {
    return { ok: false, failure: { kind: 'forbidden', message: `Your role (${ROLE_LABEL[ctx.actor.role]}) cannot edit groups. Only a Red Team Manager or Organization Admin can.`, entity: groupRef(groupId, project.id) } }
  }
  if (!g.agents.includes(agentId)) {
    return { ok: false, failure: { kind: 'validation', message: `${agentId} is not a member of ${g.name}.`, entity: groupRef(groupId, project.id) } }
  }
  const inUse = db.agents.find((x) => x.id === agentId)?.op
  if (inUse && !reason.trim()) {
    return { ok: false, failure: { kind: 'validation', message: `A reason is required to remove ${agentId} — operation ${inUse} is using it. Confirm the impact first.`, entity: groupRef(groupId, project.id) } }
  }
  const at = stampOf(clock)
  authority.commit(ctx.corr, (d) => {
    const gr = d.groups.find((x) => x.id === groupId)!
    gr.agents = gr.agents.filter((x) => x !== agentId)
    const ag = d.agents.find((x) => x.id === agentId)
    if (ag) ag.group = ''
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: inUse ? 'Removed in-use agent from group' : 'Removed agent from group', obj: agentId, projectId: project.id, result: 'Success', reason: reason.trim() })
  })
  return { ok: true, data: authority.snapshot().groups.find((x) => x.id === groupId)! }
}
