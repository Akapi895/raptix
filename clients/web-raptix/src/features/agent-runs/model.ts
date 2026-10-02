export type AgentStatus = 'running' | 'idle' | 'done' | 'blocked'

export type RunControlState = 'running' | 'stopped'
export type MockRunScenario = 'default' | 'ready' | 'active' | 'hitl' | 'completed' | 'failed' | 'disconnected' | 'reconnecting'

export type HitlDecision = 'approved' | 'rejected'

export interface SubAgent {
  id: string
  name: string
  type: string
  status: AgentStatus
  task: string
  skills: string[]
  tools: string[]
  recentActions: { label: string; ts: string }[]
  children?: SubAgent[]
}

export interface ToolCall {
  name: string
  result: string
}

export interface RunMessage {
  id: string
  role: 'user' | 'agent'
  agentName?: string
  content: string
  timestamp: string
  toolCalls?: ToolCall[]
}

export interface RunThread {
  id: string
  title: string
  preview: string
  timestamp: string
  messages: RunMessage[]
}

export interface HitlAction {
  agentId: string
  decision: HitlDecision
}

export interface RunScenario {
  displayName: string
  runState: RunControlState
  greeting: string
  rootAgent: SubAgent
  subAgents: SubAgent[]
  threads: RunThread[]
}

export interface RunSnapshot {
  projectId: string
  runState: RunControlState
  threads: RunThread[]
  activeThreadId: string | null
  agents: SubAgent[]
  approvals: Record<string, HitlDecision>
  pendingThreadIds: string[]
  source: 'mock-demo'
  scenario: MockRunScenario
  connectionState: 'connected' | 'disconnected' | 'reconnecting'
  executionError?: string
}

export const MAX_THREADS_PER_PROJECT = 30
export const MAX_MESSAGES_PER_THREAD = 200
export const MAX_RECENT_ACTIONS = 6

export const STATUS_STYLES: Record<
  AgentStatus,
  { dot: string; badgeBg: string; badgeText: string; label: string }
> = {
  running: { dot: '#22C55E', badgeBg: 'rgba(34,197,94,0.15)',  badgeText: '#16A34A', label: 'Running' },
  idle:    { dot: '#F59E0B', badgeBg: 'rgba(245,158,11,0.15)', badgeText: '#D97706', label: 'Idle' },
  done:    { dot: '#94A3B8', badgeBg: '#F1F5F9',               badgeText: '#475569', label: 'Done' },
  blocked: { dot: '#DC2626', badgeBg: '#FEF2F2',               badgeText: '#DC2626', label: 'Blocked' },
}
