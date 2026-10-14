/** Scoped fleet form and recovery relationships complement the paged agent Query reads. */
import type { Agent, Group, Operation, Plan, Approval } from '../../domain/entities'
import type { ConsoleServices } from '../../domain/service-factory'
import type { RequestContext } from '../../domain/service'
import { projectView, scopedRows } from '../../domain/projection'
import { useServiceProjection } from '../../state/projection'

export interface GroupOptions { agents: Agent[]; groups: Group[] }
export interface AssignmentOptions { agents: Agent[]; operations: Operation[]; approvals: Approval[] }
export interface AgentRecoveryRead { agents: Agent[]; operations: Operation[]; plans: Plan[] }

export function readGroupOptions(services: ConsoleServices, ctx: RequestContext): GroupOptions {
  return projectView(services, ctx, 'agent-group-options', (db) => ({ agents: scopedRows(db, ctx, db.agents, true), groups: scopedRows(db, ctx, db.groups) }))
}

export function readAssignmentOptions(services: ConsoleServices, ctx: RequestContext): AssignmentOptions {
  return projectView(services, ctx, 'agent-assignment-options', (db) => ({ agents: scopedRows(db, ctx, db.agents, true), operations: scopedRows(db, ctx, db.operations), approvals: scopedRows(db, ctx, db.approvals) }))
}

export function readAgentRecovery(services: ConsoleServices, ctx: RequestContext, agent: Agent): AgentRecoveryRead {
  return projectView(services, ctx, `agent-recovery:${agent.id}`, (db) => ({
    agents: scopedRows(db, { ...ctx, projectId: agent.projectId || 'all' }, db.agents, true),
    operations: scopedRows(db, ctx, db.operations).filter((o) => o.agents.includes(agent.id)),
    plans: scopedRows(db, ctx, db.plans).filter((p) => p.agents.includes(agent.id)),
  }))
}

export function useGroupOptions(projectId?: string): GroupOptions { return useServiceProjection(readGroupOptions, projectId) }
export function useAssignmentOptions(): AssignmentOptions { return useServiceProjection(readAssignmentOptions, 'all') }
export function useAgentRecovery(agent: Agent): AgentRecoveryRead { return useServiceProjection((services, ctx) => readAgentRecovery(services, ctx, agent), 'all') }
