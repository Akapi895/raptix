/**
 * The inbox's mock decisions: each legacy decide entry as a typed bridge over the plans, approvals and C2 transactions, with the
 * request context the store always used. Mock mode only; the inbox reaches the authority through this hook.
 */
import { useServices } from '../../state/services'
import { readActor } from '../../auth/identity'
import { useAuthStore } from '../../state/stores'
import { decideApprovalTransaction } from '../approvals/service'
import { decidePlanTransaction } from '../plans/service'
import { readPlanProject } from '../plans/bridge'
import { decideSessionRequestTransaction } from '../c2/grants'
import { readSessionRequestMeta } from '../c2/projection'

export function useTaskActions() {
  const services = useServices()
  const actorCtx = (projectId: string) => ({ actor: readActor(services, useAuthStore.getState().meName), projectId, corr: 'legacy' })
  return {
    decidePlan: (planId: string, decision: 'approved' | 'rejected' | 'returned', note: string) => {
      const projectId = readPlanProject(services.authority, planId)
      if (!projectId) return { ok: false as const, error: `Plan ${planId} does not exist.` }
      const res = decidePlanTransaction(services.authority, services.clock, actorCtx(projectId), planId, decision, note)
      return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
    },
    decideApproval: (id: string, decision: 'approved' | 'returned', note: string) => {
      const res = decideApprovalTransaction(services.authority, services.clock, actorCtx(''), id, decision, note)
      return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
    },
    decideSessionRequest: (id: string, decision: 'approved' | 'rejected' | 'changes', note: string, minutes?: number) => {
      const r = readSessionRequestMeta(services, id)
      if (!r) return { ok: false as const, error: `Access request ${id} does not exist.` }
      const res = decideSessionRequestTransaction(services.authority, services.clock, actorCtx(r.projectId), { requestId: id, decision, note, minutes })
      return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
    },
  }
}
