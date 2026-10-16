import { can, projectAccessible, readOnlyContext } from '../../auth/policy'
import type { ConsoleServices } from '../../domain/service-factory'
import type { RequestContext } from '../../domain/service'
import { projectView } from '../../domain/projection'
import { formatDemoInstant } from '../../domain/clock'
import type { AgentWorkspace, InstanceAction, InstanceRequest, Outcome } from './model'
import { executionSeeds } from './seed'

export class ExecutionWorkspaceError extends Error {
  constructor(message: string) { super(message); this.name = 'ExecutionWorkspaceError' }
}

function requireExecutionReady(services: ConsoleServices, ctx: RequestContext, executionId: string): void {
  const snapshot = services.authority.snapshot()
  const project = snapshot.projects.find((row) => row.id === ctx.projectId)
  const stop = snapshot.stopState
  const stopped = stop && (stop.scope === 'workspace' || (stop.scope === 'project' && stop.id === ctx.projectId) || (stop.scope === 'operation' && stop.id === executionId))
  if (project?.roeStatus !== 'approved' || !project.emergency || !snapshot.assets.some((asset) => asset.projectId === ctx.projectId && asset.scope === 'in') || stopped || snapshot.operations.find((operation) => operation.id === executionId)?.status === 'estop') throw new ExecutionWorkspaceError('Execution is locked by scope or stop conditions. Review Scope & ROE and the existing stop workflow.')
}

export function readWorkspaces(services: ConsoleServices, ctx: RequestContext): AgentWorkspace[] {
  return projectView(services, ctx, 'agent-workspaces', (db) => {
    const project = db.projects.find((p) => p.id === ctx.projectId)
    if (!projectAccessible(project, ctx.actor)) return []
    const rows = db.agentWorkspaces.filter((row) => row.projectId === ctx.projectId && (!row.owner || row.owner === ctx.actor.id))
    rows.push(...executionSeeds(db.operations.filter((operation) => operation.projectId === ctx.projectId && !rows.some((row) => row.executionId === operation.id))))
    return [...new Set(rows.map((row) => row.executionId))].map((id) => rows.find((row) => row.executionId === id && row.owner === ctx.actor.id) ?? rows.find((row) => row.executionId === id)!)
  })
}

function write(services: ConsoleServices, ctx: RequestContext, executionId: string, update: (workspace: AgentWorkspace) => void, audit?: string): void {
  const project = services.authority.snapshot().projects.find((p) => p.id === ctx.projectId)
  if (!projectAccessible(project, ctx.actor)) throw new ExecutionWorkspaceError('This project is unavailable for your account.')
  if (readOnlyContext(project, ctx.actor)) throw new ExecutionWorkspaceError('The project or your role is read-only.')
  const source = readWorkspaces(services, ctx).find((row) => row.executionId === executionId)
  if (!source) throw new ExecutionWorkspaceError('Execution is not available in this scope.')
  services.authority.commit(ctx.corr, (db) => {
    let workspace = db.agentWorkspaces.find((row) => row.owner === ctx.actor.id && row.projectId === ctx.projectId && row.executionId === executionId)
    if (!workspace) {
      workspace = { ...structuredClone(source), owner: ctx.actor.id, id: JSON.stringify([ctx.actor.id, ctx.projectId, executionId]) }
      db.agentWorkspaces.push(workspace)
    }
    update(workspace)
    if (audit) db.audit.unshift({ id: 'AU-' + ++db.counters.audit, corr: ctx.corr, at: formatDemoInstant(services.clock.now()), actor: ctx.actor.id, role: ctx.actor.role, action: `${audit} (simulated)`, obj: executionId, projectId: ctx.projectId, result: 'Recorded', reason: 'Mock instance workspace; no runtime dispatch' })
  })
}

export function saveInstanceDraft(services: ConsoleServices, ctx: RequestContext, executionId: string, instanceId: string, text: string, questionId?: string): void {
  write(services, ctx, executionId, (workspace) => {
    if (!workspace.instances.some((instance) => instance.id === instanceId)) throw new ExecutionWorkspaceError('Unknown recipient.')
    if (questionId && !workspace.questions.some((question) => question.id === questionId && question.instanceId === instanceId)) throw new ExecutionWorkspaceError('Unknown question recipient.')
    workspace.drafts[questionId ? `${instanceId}/${questionId}` : instanceId] = text
  })
}

export function submitInstanceRequest(services: ConsoleServices, ctx: RequestContext, executionId: string, instanceId: string, action: InstanceRequest['action'], text: string, outcome: Outcome, questionId?: string): string {
  const id = crypto.randomUUID()
  const at = formatDemoInstant(services.clock.now())
  const snapshot = services.authority.snapshot()
  const project = snapshot.projects.find((p) => p.id === ctx.projectId)
  const control = action !== 'message' && action !== 'answer'
  if (!text.trim()) throw new ExecutionWorkspaceError(control ? 'A reason is required.' : 'Enter a message or answer.')
  if (control && !can(ctx.actor, 'run', project) && !can(ctx.actor, 'estop', project)) throw new ExecutionWorkspaceError('Your role cannot control this instance.')
  if (['resume', 'retry', 'reassign'].includes(action)) requireExecutionReady(services, ctx, executionId)
  write(services, ctx, executionId, (workspace) => {
    const instance = workspace.instances.find((row) => row.id === instanceId)
    if (!instance) throw new ExecutionWorkspaceError('Unknown recipient.')
    if (workspace.requests.some((request) => request.instanceId === instanceId && ['pending', 'uncertain'].includes(request.state))) throw new ExecutionWorkspaceError('Reconcile the existing request before sending another to this instance.')
    if (control) {
      if (!instance.controls.includes(action as InstanceAction)) throw new ExecutionWorkspaceError('This instance does not support that control.')
      const allowed = action === 'pause' ? ['running'] : action === 'resume' ? ['paused'] : action === 'cancel' ? ['queued', 'running', 'waiting', 'blocked', 'paused'] : ['failed', 'cancelled', 'completed']
      if (!allowed.includes(instance.status)) throw new ExecutionWorkspaceError('The observed instance state no longer supports this action.')
    } else {
      if (instance.path === 'observe' || (instance.path === 'direct' && ['completed', 'failed', 'cancelled'].includes(instance.status))) throw new ExecutionWorkspaceError('This channel is read-only. No new agent is spawned by opening it.')
      if (action === 'answer' && !workspace.questions.some((question) => question.id === questionId && question.instanceId === instanceId && question.answer === undefined)) throw new ExecutionWorkspaceError('This question is already answered or belongs to another instance.')
      workspace.messages.push({ id, instanceId, sender: ctx.actor.id, recipient: instanceId, path: instance.path, text: text.trim(), at, delivery: 'queued', questionId })
      workspace.drafts[questionId ? `${instanceId}/${questionId}` : instanceId] = ''
    }
    workspace.requests.push({ id, instanceId, action, messageId: control ? undefined : id, questionId, state: 'pending', outcome, reason: text.trim(), at })
  }, `${action} requested for ${instanceId}`)
  if (!control && outcome !== 'queued') observeInstanceRequest(services, ctx, executionId, id, outcome)
  return id
}

/** Reconciles the same identity; never sends or repeats the original command. */
export function observeInstanceRequest(services: ConsoleServices, ctx: RequestContext, executionId: string, requestId: string, outcome: Exclude<Outcome, 'queued'>): void {
  write(services, ctx, executionId, (workspace) => {
    const request = workspace.requests.find((row) => row.id === requestId)
    if (!request) throw new ExecutionWorkspaceError('Request is not recorded in this scope.')
    if (request.state === 'acknowledged' || request.state === 'failed') return
    if (outcome === 'delivered' && ['resume', 'retry', 'reassign'].includes(request.action)) requireExecutionReady(services, ctx, executionId)
    const instance = workspace.instances.find((row) => row.id === request.instanceId)!
    if (request.action !== 'message' && request.action !== 'answer') {
      const project = services.authority.snapshot().projects.find((row) => row.id === ctx.projectId)
      if (!can(ctx.actor, 'run', project) && !can(ctx.actor, 'estop', project)) throw new ExecutionWorkspaceError('Your role cannot acknowledge an instance control.')
      if (outcome === 'delivered' && ['resume', 'retry', 'reassign'].includes(request.action) && instance.deps.some((id) => workspace.instances.find((dependency) => dependency.id === id)?.status !== 'completed')) throw new ExecutionWorkspaceError('An instance dependency is missing or incomplete.')
    }
    request.state = outcome === 'delivered' ? 'acknowledged' : outcome === 'uncertain' ? 'uncertain' : 'failed'
    const message = workspace.messages.find((row) => row.id === request.messageId)
    if (message) message.delivery = outcome
    if (outcome !== 'delivered') return
    const at = formatDemoInstant(services.clock.now())
    if (request.action === 'message' || request.action === 'answer') {
      if (request.action === 'answer') {
        const question = workspace.questions.find((row) => row.id === request.questionId && row.instanceId === instance.id)
        if (!question || question.answer !== undefined) throw new ExecutionWorkspaceError('The question is no longer pending.')
        question.answer = request.reason
        if (instance.status === 'waiting' && !workspace.questions.some((row) => row.instanceId === instance.id && row.answer === undefined)) instance.status = 'queued'
      }
      workspace.messages.push({ id: `${request.id}/receipt`, instanceId: instance.id, sender: instance.path === 'forward' ? workspace.instances.find((row) => row.parent === null && row.role === 'Orchestrator')!.id : instance.id, recipient: ctx.actor.id, path: instance.path, at, delivery: 'delivered', text: `Simulated receipt: ${instance.path === 'forward' ? `Raptix recorded instructions for ${instance.name}` : `${instance.name} received your input`}. No runtime task was dispatched.` })
    } else if (request.action === 'retry' || request.action === 'reassign') {
      const attempt = workspace.instances.filter((row) => row.role === instance.role).length + 1
      workspace.instances.push({ ...structuredClone(instance), id: `${instance.id}/attempt-${request.id}`, name: `${instance.role} #${attempt}`, previous: instance.id, status: 'queued', activity: `New ${request.action} attempt requested; previous attempt unchanged`, updated: at, outputs: [] })
    } else if (!['completed', 'failed', 'cancelled'].includes(instance.status)) {
      instance.status = request.action === 'cancel' ? 'cancelled' : request.action === 'pause' ? 'paused' : 'queued'
      instance.activity = `Simulated ${request.action} acknowledged; child and dependency states unchanged`
      instance.updated = at
    } else request.reason += ' · Task already terminal; observed outcome preserved.'
  }, `Observed ${outcome} acknowledgement`)
}
