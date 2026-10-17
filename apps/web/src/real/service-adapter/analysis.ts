import type { RequestContext, ServiceResult } from '../../domain/service'
import type { ObservedAnalysisRead, ObservedAnalysisService } from '../../features/analysis/observed'
import { fetchAnalysis } from '../api'
import { ApiTransportError } from '../transport'
import { guarded } from './shared'

/**
 * A 404 here means the graph route is not registered on this deployment (no
 * knowledge graph), which is an honest "not available", not a missing page.
 */
function graphMessage(error: unknown): string {
  if (error instanceof ApiTransportError && error.code === 'not_found') return 'Analysis is not available on this server: the knowledge graph is not configured here.'
  if (error instanceof ApiTransportError && error.code === 'unavailable') return 'The knowledge graph is unavailable right now. Analysis loads again once it is reachable.'
  return error instanceof Error ? error.message : 'The observed read failed.'
}

export function createRealObservedAnalysisService(): ObservedAnalysisService {
  return {
    read: (ctx: RequestContext) => guarded(async (): Promise<ServiceResult<ObservedAnalysisRead>> => {
      if (!ctx.projectId || ctx.projectId === 'all') return { ok: false, failure: { kind: 'validation', message: 'Select an engagement before reading its analysis.' } }
      try {
        const view = await fetchAnalysis(ctx.projectId)
        return {
          ok: true,
          data: {
            observed: view.observed.map((o) => ({ techniqueId: o.techniqueId, label: o.label, nodeIds: o.nodeIds })),
            coverage: view.coverage,
            paths: view.paths.map((p) => ({ id: p.id, steps: p.steps })),
            quality: view.quality,
          },
        }
      } catch (error) {
        return { ok: false, failure: { kind: 'unavailable', message: graphMessage(error) } }
      }
    }),
  }
}
