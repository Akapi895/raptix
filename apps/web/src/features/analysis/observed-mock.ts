/**
 * Mock adapter for the observed analysis port (plan P09, Analysis slice). The
 * mock records executed steps with their technique; this adapter reads them as
 * the observed techniques and the observed chain of the selected operation.
 * The corpus is the mock's technique list, so its coverage counts are real.
 */
import { TECHNIQUES } from '../../domain/catalog';
import type { DbAuthority } from '../../demo/authority'
import type { RequestContext, ServiceResult } from '../../domain/service'
import { pathOf } from './path'
import type { ObservedAnalysisRead, ObservedAnalysisService, ObservedPath, ObservedTechnique } from './observed'

export function createMockObservedAnalysisService(authority: DbAuthority, guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>): ObservedAnalysisService {
  return {
    read: (ctx: RequestContext) => guard((): ServiceResult<ObservedAnalysisRead> => {
      const graph = pathOf(authority.snapshot(), ctx)
      if (!graph.ok) return graph
      const selected = graph.data.selected
      const executed = selected ? selected.steps.filter((s) => s.executed) : []
      const byTechnique = new Map<string, ObservedTechnique>()
      for (const step of executed) {
        const techniqueId = step.step.technique
        if (!techniqueId) continue
        const entry = byTechnique.get(techniqueId) ?? { techniqueId, label: TECHNIQUES.find((t) => t.id === techniqueId)?.name ?? null, nodeIds: [] }
        entry.nodeIds.push(step.step.id)
        byTechnique.set(techniqueId, entry)
      }
      const observed = [...byTechnique.values()]
      const paths: ObservedPath[] = selected && executed.length > 0 ? [{
        id: selected.op.id,
        steps: executed.map((s) => ({ nodeId: s.step.id, techniqueId: s.step.technique || null, label: s.step.name })),
      }] : []
      return {
        ok: true,
        data: {
          observed,
          coverage: {
            observedTechniques: observed.length,
            corpusTechniques: TECHNIQUES.length,
            inCorpus: observed.filter((t) => TECHNIQUES.some((x) => x.id === t.techniqueId)).length,
          },
          paths,
          quality: { graph: observed.length > 0 ? 'available' : 'empty', truncated: false },
        },
      }
    }),
  }
}
