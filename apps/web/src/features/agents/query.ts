/**
 * Agent fleet Query binding (ticket 48, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. Keys
 * start with the `agent` entity kind and embed the auth scope at position 1,
 * so both bridge invalidation paths reach them: any committed agent change
 * (legacy action or service write — status, reservation, assignment)
 * invalidates the `[kind]` prefix — a legacy agent-state change updates
 * these views without a reload — and a persona/project switch cancels the
 * superseded scope's reads before a delayed response can restore old
 * visibility.
 * Mutations capture the actor/project scope at call time, so a switch never
 * retargets an in-flight write; the handler additionally binds every write
 * to the addressed agent/group's own project (ticket 49). A committed write
 * publishes the `agent`/`agent-group` ChangeSet identities, so fleet and
 * detail views refetch without a reload.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { actorRef, OWNER_PERSONAS, REVIEWER_PERSONAS } from '../../demo/persona'
import { useServices } from '../../state/services'
import { useMe } from '../../state/console'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { ServiceFailure, ServiceResult } from '../../domain/service'
import type { Agent, Group } from '../../domain/entities'
import type { AgentDetailRead, AgentListQuery, AgentListRead } from './service'
import { setAgentStatusTransaction, type AssignmentInput, type GroupInput } from './writes'
import { recordAudit, type AuditInput } from '../audit'
import { submitApprovalTransaction } from '../approvals'

/** Feature-local key namespaces: ['agent', scope, 'list', query] / ['agent', scope, id]. */
export const agentKeys = {
  list: (scope: QueryScope, query: AgentListQuery) => consoleKeys.view('agent', scope, 'list', query),
  detail: (scope: QueryScope, id: string) => consoleKeys.entity('agent', scope, id),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class AgentReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'AgentReadError'
  }
}

/** Query-backed agent fleet for the current auth/project scope. */
export function useAgentList(query: AgentListQuery) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: agentKeys.list(scope, query),
    queryFn: async (): Promise<AgentListRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .agents(actor, scope.project)
        .list({ actor, projectId: scope.project, corr: 'agents-list' }, query)
      if (!res.ok) throw new AgentReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Query-backed agent detail (observed health, capabilities, history). */
export function useAgentDetail(id?: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: agentKeys.detail(scope, id || ''),
    queryFn: async (): Promise<AgentDetailRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .agents(actor, scope.project)
        .get({ actor, projectId: scope.project, corr: 'agent-detail' }, id || '')
      if (!res.ok) throw new AgentReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!id,
  })
}

let corrSeq = 0
const corr = (act: string) => `agent-${act}-${++corrSeq}`

/** Immediate assignment through the typed handler; the ServiceResult (success or typed failure) is returned to onSuccess. */
export function useAssignAgent() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (v: { agentId: string; projectId: string; note?: string }): Promise<ServiceResult<Agent>> => {
      const actor = actorRef(scope.actor, scope.role)
      return services.agents(actor, scope.project).assign({ actor, projectId: scope.project, corr: corr('assign') }, v.agentId, { projectId: v.projectId, note: v.note } satisfies AssignmentInput)
    },
  })
}

/** Returns an assigned agent to the shared pool through the typed handler. */
export function useUnassignAgent() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (v: { agentId: string; reason: string }): Promise<ServiceResult<Agent>> => {
      const actor = actorRef(scope.actor, scope.role)
      return services.agents(actor, scope.project).unassign({ actor, projectId: scope.project, corr: corr('unassign') }, v.agentId, v.reason)
    },
  })
}

/** Group create/rename/membership through the typed handler. */
export function useSaveGroup() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (v: GroupInput): Promise<ServiceResult<Group>> => {
      const actor = actorRef(scope.actor, scope.role)
      return services.agents(actor, scope.project).saveGroup({ actor, projectId: scope.project, corr: corr('group-save') }, v)
    },
  })
}

/** Removes one agent from a group through the typed handler. */
export function useRemoveFromGroup() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (v: { groupId: string; agentId: string; reason?: string }): Promise<ServiceResult<Group>> => {
      const actor = actorRef(scope.actor, scope.role)
      return services.agents(actor, scope.project).removeFromGroup({ actor, projectId: scope.project, corr: corr('group-remove') }, v.groupId, v.agentId, v.reason)
    },
  })
}

/* ── Mock console adapter for the agents screens: the display clock, the demo runtime, and the legacy-correlated approval, reassignment, status and audit writes the mirrored screens always made. Mock mode only. ── */

export function useAgentsMockConsole() {
  const services = useServices()
  const me = useMe()
  const actor = { id: me.name, role: me.role }
  const ctx = (projectId: string) => ({ actor, projectId, corr: 'legacy' })
  return {
    display: services.display,
    demo: services.demo,
    submitApproval: (projectId: string, input: Parameters<typeof submitApprovalTransaction>[3]) =>
      submitApprovalTransaction(services.authority, services.clock, ctx(projectId), input),
    replaceOperationAgent: (projectId: string, opId: string, from: string, to: string, reason: string) =>
      services.operations(actor, projectId).replaceAgent(ctx(projectId), opId, from, to, reason),
    /** The simulated personas the screens offer as group owners and reviewers: demo identities, not users of this server. */
    people: {
      owners: OWNER_PERSONAS,
      reviewers: REVIEWER_PERSONAS,
    },
    setAgentStatus: (projectId: string, agentId: string, status: Parameters<typeof setAgentStatusTransaction>[3]) =>
      setAgentStatusTransaction(services.authority, ctx(projectId), agentId, status),
    audit: (projectId: string, input: AuditInput) => recordAudit(services, ctx(projectId), input),
  }
}
