/**
 * Real assets panel (integration ticket 06, read-only): graph-projected
 * discovered assets and the observed attack-chain graph. Only server-redacted
 * observed values render; an unavailable graph source renders an honest
 * unavailable state - no invented hosts, paths or detections.
 */
import { type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Network } from 'lucide-react'
import type { AssetSummaryView } from '@raptix/web-contracts'
import { fetchAssets, fetchGraph } from '../api'
import { go, useRoute } from '../../router/navigate'
import { useProjectStore } from '../../state/stores'
import { Banner, Card, CardHeader, DescList, Empty, Skeleton, cx } from '../../ui'

const TYPE_TONE: Record<AssetSummaryView['type'], string> = {
  Host: 'border-line text-muted', Web: 'border-cyan/30 text-cyan', API: 'border-accent/30 text-accent',
  Identity: 'border-warn/30 text-warn', Mobile: 'border-line text-neutral',
}

/** Route-mounted wrapper: resolves the engagement from the route or active project. */
export function RealAssets(): ReactElement {
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const engagementId = route.id || (pid !== 'all' ? pid : '')
  if (!engagementId) {
    return (
      <Empty icon={Network} title="No engagement selected" action={<button className="underline" onClick={() => go('projects')}>Go to Projects</button>}>
        Open an engagement to inspect its discovered assets and graph.
      </Empty>
    )
  }
  return <RealAssetsPanel engagementId={engagementId} />
}

export function RealAssetsPanel({ engagementId }: { engagementId: string }): ReactElement {
  const assets = useQuery({ queryKey: ['real', 'assets', engagementId], queryFn: () => fetchAssets(engagementId) })
  const graph = useQuery({ queryKey: ['real', 'graph', engagementId], queryFn: () => fetchGraph(engagementId), retry: false })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Discovered assets" sub="Graph projection of assets observed during runs. Related findings link to the findings inventory." />
        {assets.isPending ? <div className="space-y-2" aria-busy="true" role="status"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
          : assets.isError ? (
            <div role="alert" className="text-sm text-bad">
              {assets.error instanceof Error ? assets.error.message : 'Assets could not be loaded.'}
              <button className="ml-3 underline" onClick={() => void assets.refetch()}>Try again</button>
            </div>
          ) : assets.data.assets.length === 0 ? (
            <Empty icon={Network} title="No assets discovered">No run has produced graph assets for this engagement yet.</Empty>
          ) : (
            <div className="space-y-3">
              {assets.data.truncated && <Banner tone="warn" title="List truncated">The graph projection truncated this asset list.</Banner>}
              {assets.data.assets.map((a) => <AssetRow key={a.id} asset={a} />)}
            </div>
          )}
      </Card>

      <Card>
        <CardHeader title="Attack-chain graph" sub="Server-redacted nodes and edges. The UI lists observed relationships verbatim and never reconstructs missing attack paths." />
        {graph.isPending ? <div className="space-y-2" aria-busy="true" role="status"><Skeleton className="h-16" /></div>
          : graph.isError ? (
            <Banner tone="warn" title="Graph source unavailable">
              {graph.error instanceof Error ? graph.error.message : 'The graph projection is not available right now.'} No substitute graph is shown.
            </Banner>
          ) : (
            <GraphSummary graph={graph.data} />
          )}
      </Card>
    </div>
  )
}

function AssetRow({ asset }: { asset: AssetSummaryView }): ReactElement {
  return (
    <div className="rounded-xl border border-line bg-subtle p-3" data-testid={`asset-${asset.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx('inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium', TYPE_TONE[asset.type])}>{asset.type}</span>
        <span className="text-sm font-medium text-fg">{asset.label}</span>
        {asset.hostname && <span className="font-mono text-xs text-muted">{asset.hostname}</span>}
        {asset.ip && <span className="font-mono text-xs text-muted">{asset.ip}</span>}
        {asset.url && <span className="font-mono text-xs text-muted">{asset.url}</span>}
        {asset.os && <span className="text-xs text-neutral">{asset.os}</span>}
      </div>
      <DescList
        items={[
          { k: 'Ports', v: asset.ports.length === 0 ? 'None observed' : asset.ports.join(', ') },
          { k: 'Services', v: asset.services.length === 0 ? 'None observed' : asset.services.join(', ') },
          { k: 'Related findings', v: asset.relatedFindingIds.length === 0 ? 'None' : asset.relatedFindingIds.join(', ') },
        ]}
      />
    </div>
  )
}

function GraphSummary({ graph }: { graph: { nodes: { id: string; labels: string[]; properties: Record<string, unknown> }[]; edges: { id: string; source: string; target: string; type: string; properties: Record<string, unknown> }[]; truncated: boolean } }): ReactElement {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{graph.nodes.length} nodes, {graph.edges.length} edges observed{graph.truncated ? ' (truncated)' : ''}.</p>
      {graph.nodes.length === 0 ? <p className="text-sm text-muted">The graph is empty - no relationships have been observed yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-neutral">
                <th className="py-1 pr-3 font-medium">Node</th>
                <th className="py-1 pr-3 font-medium">Labels</th>
                <th className="py-1 font-medium">Properties (server-redacted)</th>
              </tr>
            </thead>
            <tbody>
              {graph.nodes.slice(0, 50).map((n) => (
                <tr key={n.id} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-mono text-fg">{n.id}</td>
                  <td className="py-1.5 pr-3 text-muted">{n.labels.join(':')}</td>
                  <td className="py-1.5 font-mono text-neutral">{JSON.stringify(n.properties).slice(0, 160)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {graph.edges.length > 0 && (
        <ul className="space-y-1">
          {graph.edges.slice(0, 50).map((e) => (
            <li key={e.id} className="font-mono text-xs text-muted">({e.source}) -[{e.type}]-&gt; ({e.target})</li>
          ))}
        </ul>
      )}
    </div>
  )
}
