import type { Operation } from '../../domain/entities'
import type { AgentInstance, AgentWorkspace, InstanceStatus } from './model'

/** Templates are copied into an actor-owned authority record on its first write. */
export function executionSeeds(operations: Operation[]): AgentWorkspace[] {
  return operations.map((operation): AgentWorkspace => {
    const id = operation.id
    const at = operation.updated
    const rootStatus: InstanceStatus = operation.status === 'done' ? 'completed' : ['cancelled', 'estop'].includes(operation.status) ? 'cancelled' : operation.status === 'running' ? 'running' : operation.status === 'paused' ? 'paused' : operation.status === 'error' ? 'failed' : 'queued'
    const root: AgentInstance = {
      id: `${id}/raptix`, name: 'Raptix', role: 'Orchestrator', parent: null,
      objective: operation.name, target: operation.assets.join(', '), status: rootStatus,
      activity: rootStatus === 'running' ? 'Coordinating the engagement' : `Recorded operation state: ${operation.status}`, updated: at,
      deps: [], inputs: [operation.planId ?? 'No plan reference'], outputs: [], path: 'direct', controls: [],
    }
    const rows: { name: string; role: string; objective: string; target: string; status: InstanceStatus; activity: string; path: AgentInstance['path'] }[] = id !== 'OP-014' ? [] : [
      { name: 'Recon #1', role: 'Recon', objective: 'Inventory services on win-dc-01', target: 'win-dc-01', status: 'running', activity: 'Service enumeration · service-mapper', path: 'direct' },
      { name: 'Recon #2', role: 'Recon', objective: 'Review the web surface of web-01', target: 'web-01', status: 'waiting', activity: 'Waiting for your assessment-window clarification', path: 'direct' },
      { name: 'Analyst #1', role: 'Analyst', objective: 'Summarize the observed account privileges', target: 'FD-011', status: 'completed', activity: 'Summary recorded · EV-014-01', path: 'forward' },
      { name: 'Exploit #1', role: 'Exploit', objective: 'Review controlled validation prerequisites', target: 'FD-011', status: 'blocked', activity: 'Blocked by Recon #2 and an unobserved dependency', path: 'forward' },
      { name: 'Analyst #2', role: 'Analyst', objective: 'Clarify the expected evidence format', target: 'web-01', status: 'waiting', activity: 'Waiting for your evidence-format answer', path: 'direct' },
      { name: 'Recon #3', role: 'Recon', objective: 'Review API metadata', target: 'api-01', status: 'queued', activity: 'Queued behind Recon #1', path: 'direct' },
      { name: 'Analyst #3', role: 'Analyst', objective: 'Parse a synthetic capture', target: 'EV-014-01', status: 'failed', activity: 'Capture parser returned an error', path: 'observe' },
      { name: 'Recon #4', role: 'Recon', objective: 'Review an excluded target', target: 'Out-of-scope target', status: 'cancelled', activity: 'Task cancelled; no execution claim', path: 'observe' },
      { name: 'Unattributed observation', role: 'Unknown', objective: 'Source lacks an instance parent', target: 'Unknown', status: 'unknown', activity: 'Observation stale; outcome not known', path: 'observe' },
    ]
    const instances = [root, ...rows.map((row, index): AgentInstance => ({
      ...row, id: `${id}/instance-${index + 1}`, parent: row.status === 'unknown' ? null : root.id,
      deps: index === 3 ? [`${id}/instance-2`, `${id}/missing-input`] : index === 5 ? [`${id}/instance-1`] : [],
      inputs: [operation.planId ?? 'No plan reference', 'ROE-014-v2'], outputs: index === 2 ? ['EV-014-01'] : [],
      controls: row.path === 'observe' ? [] : ['pause', 'resume', 'cancel', 'retry', 'reassign'], updated: at, stale: row.status === 'unknown',
    }))]
    const questions = id === 'OP-014' ? [
      { id: `${id}/question-window`, instanceId: `${id}/instance-2`, text: 'Which approved testing window should I use for web-01?' },
      { id: `${id}/question-evidence`, instanceId: `${id}/instance-5`, text: 'Should the summary reference the capture or a redacted excerpt?' },
    ] : []
    return {
      id: `template/${id}`, projectId: operation.projectId, executionId: id, owner: '', instances, questions, requests: [], drafts: {},
      messages: instances.map((instance, index) => ({ id: `${id}/seed-${index}`, instanceId: instance.id, sender: instance.id, recipient: 'operator', path: instance.path, text: `Demo activity: ${instance.activity}. Objective: ${instance.objective}.`, at, delivery: 'delivered' })),
    }
  })
}
