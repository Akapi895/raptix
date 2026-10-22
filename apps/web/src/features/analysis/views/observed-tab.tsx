/**
 * Observed analysis tab (plan P09, Analysis slice), shared by the mock and the
 * real project detail. Technique coverage and bounded paths derive only from
 * the source's observed records: a missing record is an explicit missing-data
 * state, and no execution or detection is inferred.
 */
import type { ReactElement } from 'react'
import { Radar } from 'lucide-react'
import { Card, CardHeader, Empty, Skeleton, Button } from '../../../ui/index'
import { useObservedAnalysis } from '../query'

export function ObservedAnalysisTab({ engagementId }: { engagementId: string }): ReactElement {
  const analysis = useObservedAnalysis(engagementId)
  if (analysis.isPending) return <Card><CardHeader title="Observed analysis" /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  if (analysis.isError || !analysis.data) {
    return <Empty icon={Radar} title="Analysis data is unavailable" action={<Button onClick={() => void analysis.refetch()}>Retry</Button>}>
      {analysis.error instanceof Error ? analysis.error.message : 'The observed read failed.'}
    </Empty>
  }
  const view = analysis.data

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Observed technique coverage" sub={`Derived only from engagement-scoped observed records (source: ${view.quality.graph}${view.quality.truncated ? ', truncated' : ''})`} />
        <div className="p-4">
          {view.observed.length === 0 ? (
            <p className="text-sm text-muted">
              {view.quality.graph === 'empty' ? 'No observed record holds a technique for this engagement yet — no technique coverage is inferred.' : 'No observed record carries a technique id yet.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2">Technique</th>
                  <th className="pb-2">Observed on</th>
                  <th className="pb-2">Records</th>
                </tr>
              </thead>
              <tbody>
                {view.observed.map((o) => (
                  <tr key={o.techniqueId} className="border-t border-line">
                    <td className="py-2 pr-3 font-mono text-xs">{o.techniqueId}</td>
                    <td className="py-2 pr-3 text-xs">{o.label ?? '—'}</td>
                    <td className="py-2 text-xs text-muted">{o.nodeIds.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-neutral">
            {view.coverage.corpusTechniques === null
              ? 'Corpus coverage is unavailable right now — shown as missing data, never as zero coverage.'
              : `${view.coverage.inCorpus ?? '?'} of ${view.coverage.observedTechniques} observed technique(s) exist in the ${view.coverage.corpusTechniques}-technique corpus.`}
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title={`Observed paths (${view.paths.length})`} sub="Bounded chains over observed records, starting at technique-bearing steps — no path is synthesized beyond recorded steps" />
        <div className="p-4">
          {view.paths.length === 0 ? (
            <p className="text-sm text-muted">No observed chain between technique-bearing steps exists yet.</p>
          ) : (
            <ol className="space-y-3">
              {view.paths.map((p) => (
                <li key={p.id} className="rounded-lg border border-line p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {p.steps.map((step, i) => (
                      <span key={`${p.id}-${step.nodeId}-${i}`} className="flex items-center gap-1.5">
                        {i > 0 && <span className="text-muted">→</span>}
                        <span className="font-mono">{step.techniqueId ?? '·'}</span>
                        <span className="text-muted">{step.label ?? step.nodeId}</span>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>
    </div>
  )
}
