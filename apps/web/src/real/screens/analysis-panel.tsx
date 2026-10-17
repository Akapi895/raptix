/**
 * Real observed analysis panel (integration ticket 14). Technique coverage
 * and bounded attack paths derive ONLY from engagement-scoped observed graph
 * nodes/edges; missing records render as explicit missing-data states — no
 * inferred execution or detection is fabricated.
 */
import { useQuery } from '@tanstack/react-query'
import { Radar } from 'lucide-react'
import type { ReactElement } from 'react'
import { fetchAnalysis } from '../api'
import { ApiTransportError } from '../transport'
import { Button, Card, CardHeader, Empty, Skeleton } from '../../ui'

/**
 * The server's own error text is not shown: a 404 here means the graph route
 * is not registered on this deployment (no Neo4j), which is an honest
 * "not available", not a missing page. Other failures keep their server message.
 */
function describeAnalysisError(error: unknown): string {
  if (error instanceof ApiTransportError && error.code === 'not_found') {
    return 'Analysis is not available on this server: the knowledge graph is not configured here.'
  }
  if (error instanceof ApiTransportError && error.code === 'unavailable') {
    return 'The knowledge graph is unavailable right now. Analysis loads again once it is reachable.'
  }
  return error instanceof Error ? error.message : 'The observed read failed.'
}

export function RealAnalysisPanel({ engagementId }: { engagementId: string }): ReactElement {
  const analysis = useQuery({
    queryKey: ['real', 'analysis', engagementId],
    queryFn: () => fetchAnalysis(engagementId),
  })

  if (analysis.isPending) {
    return <Card><CardHeader title="Observed analysis" /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  }
  if (analysis.isError || !analysis.data) {
    return <Empty icon={Radar} title="Analysis data is unavailable" action={<Button onClick={() => void analysis.refetch()}>Retry</Button>}>
      {describeAnalysisError(analysis.error)}
    </Empty>
  }
  const view = analysis.data

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Observed technique coverage" sub={`Derived only from engagement-scoped graph nodes carrying technique ids (source: graph, ${view.quality.graph}${view.quality.truncated ? ', truncated' : ''})`} />
        <div className="p-4">
          {view.observed.length === 0 ? (
            <p className="text-sm text-muted">
              {view.quality.graph === 'empty'
                ? 'The knowledge graph holds no observed nodes for this engagement yet — no technique coverage is inferred.'
                : 'No observed node carries a technique id yet.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2">Technique</th>
                  <th className="pb-2">Observed on</th>
                  <th className="pb-2">Nodes</th>
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
              ? 'Corpus coverage is unavailable right now (the corpus side of the graph answered nothing) — shown as missing data, never as zero coverage.'
              : `${view.coverage.inCorpus ?? '?'} of ${view.coverage.observedTechniques} observed technique(s) exist in the ${view.coverage.corpusTechniques}-technique corpus.`}
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title={`Observed paths (${view.paths.length})`} sub="Bounded chains over observed edges, starting at technique-bearing nodes — no path is synthesized beyond recorded edges" />
        <div className="p-4">
          {view.paths.length === 0 ? (
            <p className="text-sm text-muted">No observed edge chain between technique-bearing nodes exists yet.</p>
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
