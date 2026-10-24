/** Public surface of the approvals feature: the approval reads and the decision write the conversation's tool HITL uses. */
export { decideApproval, fetchApprovals } from './remote'
export type { ApprovalDecisionView } from './remote'
