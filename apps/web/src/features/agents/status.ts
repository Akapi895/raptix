import type { RuntimeInstanceView } from '@raptix/web-contracts'

export type AgentTone = 'running' | 'done' | 'failed' | 'stopped'

/** The runtime's own outcome words mapped to the four states the operator reads: Running, Completed, Failed, Stopped. */
export function agentStatus(instance: RuntimeInstanceView): { label: string; tone: AgentTone } {
  if (instance.outcome === 'running') return { label: 'Running', tone: 'running' }
  if (instance.outcome === 'cancel_requested') return { label: 'Stopping', tone: 'running' }
  if (instance.outcome === 'success' || instance.outcome === 'finished') return { label: 'Completed', tone: 'done' }
  if (instance.outcome === 'failed' || instance.outcome === 'error' || instance.outcome === 'timeout') return { label: 'Failed', tone: 'failed' }
  return { label: 'Stopped', tone: 'stopped' }
}

/** True while the runtime reports the instance as running (or stopping): the panel's active count. */
export function isLiveInstance(instance: RuntimeInstanceView): boolean {
  return agentStatus(instance).tone === 'running'
}
