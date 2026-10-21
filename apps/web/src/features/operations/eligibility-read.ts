/** Project eligibility summaries for synchronous badges and CSV enrichment. */
import type { ConsoleServices } from '../../domain/console-services';
import type { RequestContext } from '../../domain/service'
import { projectView } from '../../domain/projection'
import { projectAccessible } from '../../domain/policy'
import { useServiceProjection } from '../../state/projection'
import { eligibility } from './preflight'

export interface EligibilitySummary {
  eligibility: ReturnType<typeof eligibility>
  operationCount: number
}

export function readEligibilitySummaries(services: ConsoleServices, ctx: RequestContext): Record<string, EligibilitySummary> {
  return projectView(services, ctx, 'eligibility-summaries', (db) => Object.fromEntries(
    db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => [p.id, {
      eligibility: eligibility(db, p.id), operationCount: db.operations.filter((o) => o.projectId === p.id).length,
    }]),
  ))
}

export function useEligibilitySummaries(): Record<string, EligibilitySummary> {
  return useServiceProjection(readEligibilitySummaries)
}

export function useEligibility(projectId: string): ReturnType<typeof eligibility> {
  const summaries = useEligibilitySummaries()
  return summaries[projectId]?.eligibility ?? { kind: 'locked', label: 'No project selected', tone: 'neutral', reasons: [] }
}
