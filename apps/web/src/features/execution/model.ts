export type InstanceStatus = 'queued' | 'running' | 'waiting' | 'blocked' | 'completed' | 'failed' | 'cancelled' | 'paused' | 'unknown'
export type DeliveryPath = 'direct' | 'forward' | 'observe'
export type Outcome = 'delivered' | 'queued' | 'failed' | 'uncertain'
export type InstanceAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'reassign'

export interface AgentInstance {
  id: string
  name: string
  role: string
  parent: string | null
  objective: string
  target: string
  status: InstanceStatus
  activity: string
  updated: string
  deps: string[]
  inputs: string[]
  outputs: string[]
  path: DeliveryPath
  controls: InstanceAction[]
  previous?: string
  stale?: boolean
}
export interface InstanceMessage {
  id: string
  instanceId: string
  sender: string
  recipient: string
  path: DeliveryPath
  text: string
  at: string
  delivery: Outcome
  questionId?: string
}
export interface InstanceQuestion {
  id: string
  instanceId: string
  text: string
  answer?: string
}
export interface InstanceRequest {
  id: string
  instanceId: string
  action: InstanceAction | 'message' | 'answer'
  messageId?: string
  questionId?: string
  state: 'pending' | 'uncertain' | 'acknowledged' | 'failed'
  outcome: Outcome
  reason: string
  at: string
}
export interface AgentWorkspace {
  id: string
  projectId: string
  executionId: string
  owner: string
  instances: AgentInstance[]
  messages: InstanceMessage[]
  questions: InstanceQuestion[]
  requests: InstanceRequest[]
  drafts: Record<string, string>
}
