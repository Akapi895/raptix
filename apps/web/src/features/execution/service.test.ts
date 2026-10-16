import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConsoleServices, type ConsoleServices } from '../../domain/service-factory'
import type { RequestContext } from '../../domain/service'
import { observeInstanceRequest, readWorkspaces, saveInstanceDraft, submitInstanceRequest } from './service'
import { persistExecution, restoreExecution } from './recovery'

const ctx: RequestContext = { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: 'RT-2026-014', corr: 'instance-test' }
let services: ConsoleServices
const current = () => readWorkspaces(services, ctx).find((workspace) => workspace.executionId === 'OP-014')!
beforeEach(() => { localStorage.clear(); services = createConsoleServices() })
afterEach(() => services.dispose())

describe('execution instance addressing', () => {
  it('shows a newly created operation without starting it or copying agents from another execution', () => {
    services.authority.commit('new-operation', (db) => {
      db.operations.push({ ...structuredClone(db.operations.find((operation) => operation.id === 'OP-014')!), id: 'OP-NEW', status: 'draft', name: 'New preparation draft', planId: undefined })
    })
    const workspace = readWorkspaces(services, ctx).find((row) => row.executionId === 'OP-NEW')
    expect(workspace?.instances).toHaveLength(1)
    expect(workspace?.instances[0]).toMatchObject({ role: 'Orchestrator', status: 'queued' })
    expect(workspace?.requests).toEqual([])
    expect(services.authority.snapshot().operations.find((operation) => operation.id === 'OP-NEW')!.status).toBe('draft')
  })

  it('keeps same-role transcripts and actor drafts isolated and publishes through the authority', () => {
    const events: string[] = []
    services.subscribe((change) => events.push(...change.entities.map((entity) => entity.kind)))
    saveInstanceDraft(services, ctx, 'OP-014', 'OP-014/instance-1', 'For the first Recon')
    saveInstanceDraft(services, ctx, 'OP-014', 'OP-014/instance-2', 'For the second Recon')
    submitInstanceRequest(services, ctx, 'OP-014', 'OP-014/instance-2', 'message', 'Only Recon #2', 'delivered')
    expect(current().drafts['OP-014/instance-1']).toBe('For the first Recon')
    expect(current().messages.filter((message) => message.text === 'Only Recon #2')).toMatchObject([{ instanceId: 'OP-014/instance-2', recipient: 'OP-014/instance-2', path: 'direct' }])
    expect(readWorkspaces(services, { ...ctx, actor: { id: 'Taylor Chen', role: 'operator' } }).find((workspace) => workspace.executionId === 'OP-014')!.drafts).toEqual({})
    expect(events).toContain('agent-workspace')
  })

  it('answers only the matching pending question and leaves the other question pending', () => {
    const question = current().questions[0]
    expect(() => submitInstanceRequest(services, ctx, 'OP-014', 'OP-014/instance-1', 'answer', 'Approved window', 'delivered', question.id)).toThrow(/belongs to another/)
    submitInstanceRequest(services, ctx, 'OP-014', question.instanceId, 'answer', 'Approved window', 'delivered', question.id)
    expect(current().questions[0].answer).toBe('Approved window')
    expect(current().questions[1].answer).toBeUndefined()
    expect(() => submitInstanceRequest(services, ctx, 'OP-014', question.instanceId, 'answer', 'Again', 'delivered', question.id)).toThrow(/already answered/)
  })

  it('records forwarding through Raptix rather than claiming a direct channel', () => {
    submitInstanceRequest(services, ctx, 'OP-014', 'OP-014/instance-3', 'message', 'Explain the summary', 'delivered')
    const message = current().messages.find((row) => row.text === 'Explain the summary')!
    expect(message.path).toBe('forward')
    expect(current().messages.find((row) => row.id === `${message.id}/receipt`)).toMatchObject({ sender: 'OP-014/raptix', instanceId: 'OP-014/instance-3' })
  })

  it('reconciles an uncertain message identity without sending it twice', () => {
    const id = submitInstanceRequest(services, ctx, 'OP-014', 'OP-014/instance-1', 'message', 'Capture more context', 'uncertain')
    expect(() => submitInstanceRequest(services, ctx, 'OP-014', 'OP-014/instance-1', 'message', 'Duplicate', 'delivered')).toThrow(/Reconcile/)
    observeInstanceRequest(services, ctx, 'OP-014', id, 'delivered')
    observeInstanceRequest(services, ctx, 'OP-014', id, 'delivered')
    expect(current().messages.filter((message) => message.id === id || message.id === `${id}/receipt`)).toHaveLength(2)
  })
})

describe('observed controls and recovery', () => {
  it('waits for cancel ACK and preserves a completion that raced with the request', () => {
    const id = submitInstanceRequest(services, ctx, 'OP-014', 'OP-014/instance-1', 'cancel', 'Operator requested cancellation', 'delivered')
    expect(current().instances[1].status).toBe('running')
    services.authority.commit('completion-race', (db) => { db.agentWorkspaces.find((row) => row.owner === ctx.actor.id && row.executionId === 'OP-014')!.instances[1].status = 'completed' })
    observeInstanceRequest(services, ctx, 'OP-014', id, 'delivered')
    expect(current().instances[1].status).toBe('completed')
    expect(current().requests[0].reason).toContain('observed outcome preserved')
  })

  it('creates a new linked retry attempt without changing the completed attempt', () => {
    const id = submitInstanceRequest(services, ctx, 'OP-014', 'OP-014/instance-3', 'retry', 'Review the new evidence reference', 'delivered')
    observeInstanceRequest(services, ctx, 'OP-014', id, 'delivered')
    expect(current().instances.find((instance) => instance.id === 'OP-014/instance-3')!.status).toBe('completed')
    expect(current().instances.find((instance) => instance.previous === 'OP-014/instance-3')).toMatchObject({ status: 'queued', outputs: [] })
  })

  it('does not acknowledge resume after a project stop appeared while awaiting ACK', () => {
    const pause = submitInstanceRequest(services, ctx, 'OP-014', 'OP-014/instance-1', 'pause', 'Pause for review', 'delivered')
    observeInstanceRequest(services, ctx, 'OP-014', pause, 'delivered')
    const resume = submitInstanceRequest(services, ctx, 'OP-014', 'OP-014/instance-1', 'resume', 'Review complete', 'delivered')
    services.authority.commit('stop-race', (db) => { db.stopState = { scope: 'project', id: ctx.projectId, phase: 'stopping', reason: 'Incident', at: 'now', by: ctx.actor.id } })
    expect(() => observeInstanceRequest(services, ctx, 'OP-014', resume, 'delivered')).toThrow(/locked/)
    expect(current().instances[1].status).toBe('paused')
  })

  it('restores authority data and unconfirmed request without redispatch; other actors see no private draft', () => {
    saveInstanceDraft(services, ctx, 'OP-014', 'OP-014/instance-2', 'Private draft')
    const id = submitInstanceRequest(services, ctx, 'OP-014', 'OP-014/instance-1', 'message', 'Pending request', 'uncertain')
    persistExecution(services, ctx)
    services.authority.reset()
    restoreExecution(services, ctx)
    restoreExecution(services, ctx)
    expect(current().drafts['OP-014/instance-2']).toBe('Private draft')
    expect(current().requests.filter((request) => request.id === id)).toHaveLength(1)
    expect(current().requests[0].state).toBe('uncertain')
    expect(readWorkspaces(services, { ...ctx, actor: { id: 'Pat Kim', role: 'reviewer' } }).find((workspace) => workspace.executionId === 'OP-014')!.messages.some((message) => message.id === id)).toBe(false)
  })

  it('refuses foreign execution identities and viewer controls', () => {
    expect(() => saveInstanceDraft(services, { ...ctx, projectId: 'RT-2026-015' }, 'OP-014', 'OP-014/instance-1', 'Wrong scope')).toThrow(/not available/)
    expect(() => submitInstanceRequest(services, { ...ctx, actor: { id: 'Casey Nguyen (Client)', role: 'viewer' } }, 'OP-014', 'OP-014/instance-1', 'cancel', 'Cancel', 'delivered')).toThrow(/cannot control/)
  })
})
