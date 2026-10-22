import type { ComponentType } from 'react'
import { AiOperator } from '../features/aichat/views/operator-page'
import { AiPlan, AiPlanCompare, AiPlanReview } from '../features/plans/views/plan-pages'
import { routes as fanout } from '../features/branches/index'
import { AiHistory, AiTrace } from '../features/trace/views/ai-trace-pages'

export const routes: Record<string, ComponentType> = {
  'ai-operator': AiOperator,
  'ai-plan': AiPlan,
  'ai-plan-review': AiPlanReview,
  'ai-plan-compare': AiPlanCompare,
  'ai-trace': AiTrace,
  'ai-history': AiHistory,
  ...fanout,
}
