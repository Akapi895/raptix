/**
 * The plan workbench's mock actions: each legacy plan entry as a typed bridge over the plans transactions, with the request context
 * the store always used. Mock mode only; the plan screens reach the authority through this hook.
 */
import { useServices } from '../../state/services'
import { readActor } from '../../auth/identity'
import { useAuthStore } from '../../state/stores'
import type { ConsoleServices } from '../../domain/console-services'
import type { Plan } from '../../domain/entities'
import { projectOfPlan } from './service'
import { readPlanChecksNow } from './projection'
import {
  decidePlanTransaction, discardPlanTransaction, editPlanDraftTransaction, requestPlanReviewTransaction,
  revisePlanTransaction, withdrawPlanReviewTransaction,
} from './service'

/** The legacy Res bridge shape (the store's private `Res`). */
export type Res = { ok: boolean; error?: string }

function actorCtxOf(services: ConsoleServices, projectId: string) {
  return { actor: readActor(services, useAuthStore.getState().meName), projectId, corr: 'legacy' }
}


export function usePlanActions() {
  const services = useServices()
  const planProjectOf = (planId: string) => projectOfPlan(services.authority.snapshot().plans, planId)
  return {
    now: () => services.clock.now(),
    checksNow: (plan: Plan) => readPlanChecksNow(services, plan),
    requestApproval: (planId: string): Res => {
      const projectId = planProjectOf(planId)
      if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
      const res = requestPlanReviewTransaction(services.authority, services.clock, actorCtxOf(services, projectId), planId)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    decide: (planId: string, decision: 'approved' | 'rejected' | 'returned', note: string): Res => {
      const projectId = planProjectOf(planId)
      if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
      const res = decidePlanTransaction(services.authority, services.clock, actorCtxOf(services, projectId), planId, decision, note)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    withdraw: (planId: string): Res => {
      const projectId = planProjectOf(planId)
      if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
      const res = withdrawPlanReviewTransaction(services.authority, services.clock, actorCtxOf(services, projectId), planId)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    revise: (planId: string, changes: string[], note?: string): string => {
      const projectId = planProjectOf(planId)
      if (!projectId) return ''
      const res = revisePlanTransaction(services.authority, services.clock, actorCtxOf(services, projectId), planId, changes, note)
      return res.ok ? res.data.planId : ''
    },
    editDraft: (planId: string, patch: { steps?: Plan['steps']; title?: string }): Res => {
      const projectId = planProjectOf(planId)
      if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
      const res = editPlanDraftTransaction(services.authority, services.clock, actorCtxOf(services, projectId), planId, patch)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    discard: (planId: string): Res => {
      const projectId = planProjectOf(planId)
      if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
      const res = discardPlanTransaction(services.authority, services.clock, actorCtxOf(services, projectId), planId)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    execute: async (planId: string): Promise<{ ok: boolean; opId?: string; error?: string }> => {
      const projectId = planProjectOf(planId)
      if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
      const ctx = actorCtxOf(services, projectId)
      const res = await services.plansBridge(ctx.actor, projectId).createOperation(ctx, planId)
      return res.ok ? { ok: true, opId: res.data.opId } : { ok: false, error: res.failure.message }
    },
  }
}

