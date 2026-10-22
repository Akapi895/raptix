import type { ComponentType } from 'react'
import { AiOperator } from '../features/aichat/views/operator-page'
import { AiPlan, AiPlanCompare, AiPlanReview } from './g-plan'
import { routes as fanout } from '../features/branches'
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
