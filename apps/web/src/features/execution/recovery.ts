import { z } from 'zod'
import type { ConsoleServices } from '../../domain/console-services';
import type { RequestContext } from '../../domain/service'
import { projectAccessible } from '../../domain/policy'
import { ExecutionWorkspaceError } from './service'

const status = z.enum(['queued', 'running', 'waiting', 'blocked', 'completed', 'failed', 'cancelled', 'paused', 'unknown'])
const path = z.enum(['direct', 'forward', 'observe'])
const action = z.enum(['pause', 'resume', 'cancel', 'retry', 'reassign'])
const outcome = z.enum(['delivered', 'queued', 'failed', 'uncertain'])
const record = z.object({
  id: z.string(), owner: z.string(), projectId: z.string(), executionId: z.string(),
  instances: z.array(z.object({ id: z.string(), name: z.string(), role: z.string(), parent: z.string().nullable(), objective: z.string(), target: z.string(), status, activity: z.string(), updated: z.string(), deps: z.array(z.string()), inputs: z.array(z.string()), outputs: z.array(z.string()), path, controls: z.array(action), previous: z.string().optional(), stale: z.boolean().optional() })),
  messages: z.array(z.object({ id: z.string(), instanceId: z.string(), sender: z.string(), recipient: z.string(), path, text: z.string(), at: z.string(), delivery: outcome, questionId: z.string().optional() })),
  questions: z.array(z.object({ id: z.string(), instanceId: z.string(), text: z.string(), answer: z.string().optional() })),
  requests: z.array(z.object({ id: z.string(), instanceId: z.string(), action: z.enum(['message', 'answer', ...action.options]), messageId: z.string().optional(), questionId: z.string().optional(), state: z.enum(['pending', 'uncertain', 'acknowledged', 'failed']), outcome, reason: z.string(), at: z.string() })),
  drafts: z.record(z.string(), z.string()),
})
const envelope = z.object({ version: z.literal(1), records: z.array(record) })
const key = (ctx: RequestContext): string => `raptix.mock.execution.v1.${encodeURIComponent(ctx.actor.id)}.${ctx.projectId}`

export function persistExecution(services: ConsoleServices, ctx: RequestContext): void {
  const records = services.authority.snapshot().agentWorkspaces.filter((row) => row.owner === ctx.actor.id && row.projectId === ctx.projectId)
  try { localStorage.setItem(key(ctx), JSON.stringify({ version: 1, records })) }
  catch { throw new ExecutionWorkspaceError('Browser recovery storage is unavailable. Changes exist only in this demo session.') }
}

export function restoreExecution(services: ConsoleServices, ctx: RequestContext): void {
  const project = services.authority.snapshot().projects.find((row) => row.id === ctx.projectId)
  if (!projectAccessible(project, ctx.actor)) return
  let raw: string | null
  try { raw = localStorage.getItem(key(ctx)) }
  catch { throw new ExecutionWorkspaceError('Browser recovery storage cannot be read.') }
  if (!raw) return
  let parsed: z.infer<typeof envelope>
  try { parsed = envelope.parse(JSON.parse(raw)) }
  catch { throw new ExecutionWorkspaceError('Saved demo workspace is invalid. It was not restored or replayed.') }
  const existing = services.authority.snapshot().agentWorkspaces
  const records = parsed.records.filter((row) => row.owner === ctx.actor.id && row.projectId === ctx.projectId && services.authority.snapshot().operations.some((operation) => operation.id === row.executionId && operation.projectId === row.projectId))
  const fresh = records.filter((row) => !existing.some((current) => current.owner === ctx.actor.id && current.projectId === ctx.projectId && current.executionId === row.executionId))
  if (fresh.length) services.authority.commit('execution-recovery', (db) => { db.agentWorkspaces.push(...fresh) })
}
