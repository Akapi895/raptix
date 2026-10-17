/**
 * Observed analysis port (plan P09, Analysis slice). It serves what the
 * engagement's own records show: the techniques observed on executed steps,
 * the bounded chains over observed edges, and the corpus coverage when the
 * corpus can answer. The real backend reads the knowledge graph; the mock
 * console derives the same shape from its executed steps. A missing corpus
 * count is null, shown as missing data, never as zero coverage.
 */
import type { RequestContext, ServiceResult } from '../../domain/service'

export interface ObservedTechnique {
  techniqueId: string
  label: string | null
  nodeIds: string[]
}

export interface ObservedPathStep {
  nodeId: string
  techniqueId: string | null
  label: string | null
}

export interface ObservedPath {
  id: string
  steps: ObservedPathStep[]
}

export interface ObservedAnalysisRead {
  observed: ObservedTechnique[]
  coverage: { observedTechniques: number; corpusTechniques: number | null; inCorpus: number | null }
  paths: ObservedPath[]
  quality: { graph: 'available' | 'empty'; truncated: boolean }
}

export interface ObservedAnalysisService {
  read(ctx: RequestContext): Promise<ServiceResult<ObservedAnalysisRead>>
}

/** Every call resolves to an explicit unavailable outcome when the backend does not serve the analysis graph. */
export function unavailableObservedAnalysisService(): ObservedAnalysisService {
  const failure = { kind: 'unavailable' as const, message: 'Analysis is not available on this server: the knowledge graph is not configured here.' }
  return { read: () => Promise.resolve({ ok: false, failure }) }
}
