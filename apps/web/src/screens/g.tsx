import type { ComponentType } from 'react'
import { AiOperator } from './g-chat'
import { AiPlan, AiPlanCompare, AiPlanReview } from './g-plan'
import { routes as fanout } from './g-fanout'
import { AiHistory, AiTrace } from './g-trace'

export const routes: Record<string, ComponentType> = {
  'ai-operator': AiOperator,
  'ai-plan': AiPlan,
  'ai-plan-review': AiPlanReview,
  'ai-plan-compare': AiPlanCompare,
  'ai-trace': AiTrace,
  'ai-history': AiHistory,
  ...fanout,
}
