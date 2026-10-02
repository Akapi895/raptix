import type { RunSnapshot } from '../agent-runs/model'

export interface ProjectRunSummary {
  needsAttention: boolean
  pendingApprovalAgents: string[]
}

// Needs-attention is derived from the shared demo run store: agents that are
// blocked and still waiting on a HITL decision. No project-id hardcoding.
export function getProjectRunSummary(snapshot: RunSnapshot): ProjectRunSummary {
  const pendingApprovalAgents = snapshot.agents
    .filter(agent => agent.status === 'blocked' && !snapshot.approvals[agent.id])
    .map(agent => agent.name)
  return {
    needsAttention: pendingApprovalAgents.length > 0,
    pendingApprovalAgents,
  }
}
