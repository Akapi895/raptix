import { isApprovalsView, type ApprovalsView } from '@raptix/web-contracts';
import { apiFetch } from '../../platform/transport';

/** Response of the workspace-backed HITL decision endpoint. */
export interface ApprovalDecisionView {
  ok: true
  requestId: string
  action: 'allow' | 'deny'
  decidedAtSeconds: number
}

export function fetchApprovals(engagementId: string): Promise<ApprovalsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/approvals`, (v): v is ApprovalsView => isApprovalsView(v) && v.engagementId === engagementId && v.approvals.every(a => a.engagementId === engagementId))
}

export function decideApproval(
  engagementId: string,
  input: { requestId: string; action: 'allow' | 'deny'; operatorNote?: string },
): Promise<ApprovalDecisionView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/approvals`, isApprovalDecision, {
    method: 'POST',
    body: input,
  })
}

export function isApprovalDecision(v: unknown): v is ApprovalDecisionView {
  return typeof v === 'object' && v !== null && (v as Record<string, unknown>).ok === true &&
    typeof (v as Record<string, unknown>).requestId === 'string' &&
    ((v as Record<string, unknown>).action === 'allow' || (v as Record<string, unknown>).action === 'deny') &&
    typeof (v as Record<string, unknown>).decidedAtSeconds === 'number'
}
