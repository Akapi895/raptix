import { useEffect, useMemo, useState } from 'react'
import type { AssetMapAssetRef, AssetMapCompleteness, AssetMapDetail, AssetMapNeighborhood, AssetMapOverview } from '@raptix/web-contracts'
import { useProjectStore } from '../../state/stores'
import {
  fetchAssetMapDetail,
  fetchAssetMapMembers,
  fetchAssetMapNeighborhood,
  fetchAssetMapOverview,
} from '../../real/asset-map-api'
import { AssetMapCanvas } from './AssetMapCanvas'
import { toCanvasElements } from './graph-model'

/** Maps a failure to a sentence the operator can act on; never an empty map. */
function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown error'
  return `The asset map could not be loaded (${message}). Nothing is shown as complete.`
}

function Completeness({ label, state }: { label: string; state: AssetMapCompleteness }) {
  const total = state.total === null ? '(total unknown)' : `of ${state.total}`
  return (
    <p className="text-xs text-slate-600" data-testid="completeness">
      {label}: {state.loaded} {total}
      {state.hasMore ? ' · more available' : ''}
      {state.truncated ? ' · cut by byte budget' : ''}
      {state.source.graph !== 'ok' && state.source.graph !== 'not_queried' ? ` · graph ${state.source.graph}` : ''}
    </p>
  )
}

function AssetList({ title, items, selected, onSelect }: { title: string; items: AssetMapAssetRef[]; selected: string | null; onSelect: (assetId: string) => void }) {
  return (
    <section aria-label={title} className="space-y-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="space-y-1">
        {items.map(item => (
          <li key={item.assetId}>
            <button
              type="button"
              aria-pressed={selected === item.assetId}
              onClick={() => onSelect(item.assetId)}
              className={`w-full truncate rounded px-2 py-1 text-left text-sm ${selected === item.assetId ? 'bg-slate-800 text-white' : 'hover:bg-slate-100'}`}
            >
              {item.canonicalKey}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Inspector({ detail, onLoadMore }: { detail: AssetMapDetail; onLoadMore: () => void }) {
  const body = detail.detail
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="font-semibold">{detail.asset.canonicalKey}</p>
        <p className="text-xs text-slate-600">
          {detail.asset.kind} · namespace {detail.asset.namespace} · {detail.provenance.graphNodes} observed node(s)
        </p>
      </div>
      <section aria-label="Sources" className="space-y-1">
        <h4 className="font-semibold">Sources</h4>
        <ul className="text-xs">
          {detail.provenance.sources.map(source => (
            <li key={source.source}>
              {source.source}: {source.count}
            </li>
          ))}
        </ul>
        <h4 className="pt-2 font-semibold">Evidence</h4>
        <ul className="text-xs" data-testid="evidence">
          {detail.provenance.evidence.map((ref, index) => (
            <li key={`${ref.source}-${index}`}>
              {ref.source} · episode {ref.sourceEpisodeId ?? 'unknown'}
              {ref.observedAt ? ` · ${ref.observedAt}` : ''}
            </li>
          ))}
        </ul>
      </section>
      {body.kind === 'services' ? (
        <section aria-label="Services" className="space-y-1">
          <h4 className="font-semibold">Services</h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left">
                <th>Port</th>
                <th>Service</th>
                <th>Product</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {body.items.map(item => (
                <tr key={item.id}>
                  <td>
                    {item.port}/{item.protocol}
                  </td>
                  <td>{item.service ?? '—'}</td>
                  <td>{[item.product, item.version].filter(Boolean).join(' ') || '—'}</td>
                  <td>{item.source ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {body.kind === 'endpoints' ? (
        <section aria-label="Sitemap" className="space-y-1">
          <h4 className="font-semibold">Sitemap</h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left">
                <th>Method</th>
                <th>URL (redacted)</th>
                <th>Status</th>
                <th>Parameters</th>
              </tr>
            </thead>
            <tbody>
              {body.items.map(item => (
                <tr key={item.id}>
                  <td>{item.method}</td>
                  <td className="break-all">{item.url}</td>
                  <td>{item.statusCode ?? '—'}</td>
                  <td>{item.parameters.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {body.kind === 'unsupported' ? <p className="text-xs text-slate-600">{body.reason}</p> : null}
      {detail.nextCursor ? (
        <button type="button" onClick={onLoadMore} className="rounded border px-2 py-1 text-xs">
          Load more
        </button>
      ) : null}
      <Completeness label="Rows" state={detail.completeness} />
    </div>
  )
}

/**
 * Asset Map (flagged): hosts and web origins on the left, their relationship graph in the middle,
 * and the inspector with sources, evidence, services and sitemap on the right. Every list is paged
 * and every count says what it covers.
 */
export function AssetMapPage() {
  const engagementId = useProjectStore(state => state.pid)
  const [overview, setOverview] = useState<AssetMapOverview | null>(null)
  const [hosts, setHosts] = useState<AssetMapAssetRef[]>([])
  const [origins, setOrigins] = useState<AssetMapAssetRef[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [neighborhood, setNeighborhood] = useState<AssetMapNeighborhood | null>(null)
  const [detail, setDetail] = useState<AssetMapDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const elements = useMemo(() => (neighborhood ? toCanvasElements(neighborhood) : { nodes: [], edges: [] }), [neighborhood])

  useEffect(() => {
    if (!engagementId || engagementId === 'all') return
    let live = true
    setError(null)
    Promise.all([fetchAssetMapOverview(engagementId), fetchAssetMapMembers(engagementId, 'host'), fetchAssetMapMembers(engagementId, 'web_origin')])
      .then(([view, hostPage, originPage]) => {
        if (!live) return
        setOverview(view)
        setHosts(hostPage.items)
        setOrigins(originPage.items)
      })
      .catch(reason => live && setError(describeFailure(reason)))
    return () => {
      live = false
    }
  }, [engagementId])

  useEffect(() => {
    if (!engagementId || !selected) return
    let live = true
    setError(null)
    Promise.all([fetchAssetMapNeighborhood(engagementId, selected), fetchAssetMapDetail(engagementId, selected)])
      .then(([graph, inspector]) => {
        if (!live) return
        setNeighborhood(graph)
        setDetail(inspector)
      })
      .catch(reason => live && setError(describeFailure(reason)))
    return () => {
      live = false
    }
  }, [engagementId, selected])

  const loadMoreDetail = (): void => {
    if (!detail || !engagementId || !selected || !detail.nextCursor) return
    fetchAssetMapDetail(engagementId, selected, detail.nextCursor)
      .then(next => setDetail(current => (current ? { ...next, detail: appendItems(current.detail, next.detail) } : next)))
      .catch(reason => setError(describeFailure(reason)))
  }

  const loadMoreRelations = (): void => {
    if (!neighborhood || !engagementId || !selected || !neighborhood.nextCursor) return
    fetchAssetMapNeighborhood(engagementId, selected, neighborhood.nextCursor)
      .then(next => setNeighborhood(current => (current ? mergeNeighborhood(current, next) : next)))
      .catch(reason => setError(describeFailure(reason)))
  }

  if (!engagementId || engagementId === 'all') {
    return <p className="p-4 text-sm">Open the Asset Map from a project (?engagement=…) to see its assets.</p>
  }

  return (
    <div className="grid grid-cols-[220px_1fr_340px] gap-4 p-4" data-testid="asset-map">
      <aside className="space-y-4">
        <h2 className="text-base font-semibold">Asset Map</h2>
        {overview ? <Completeness label="Catalogued" state={overview.completeness} /> : null}
        <AssetList title="Hosts" items={hosts} selected={selected} onSelect={setSelected} />
        <AssetList title="Web origins" items={origins} selected={selected} onSelect={setSelected} />
      </aside>
      <main className="space-y-2">
        {error ? (
          <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-2 text-sm">
            {error}
          </p>
        ) : null}
        <AssetMapCanvas elements={elements} onSelectAsset={setSelected} />
        {neighborhood ? <Completeness label="Relations" state={neighborhood.completeness} /> : null}
        {neighborhood?.nextCursor ? (
          <button type="button" onClick={loadMoreRelations} className="rounded border px-2 py-1 text-xs">
            Load more relations
          </button>
        ) : null}
      </main>
      <aside>{detail ? <Inspector detail={detail} onLoadMore={loadMoreDetail} /> : <p className="text-sm text-slate-600">Select a host or origin to inspect it.</p>}</aside>
    </div>
  )
}

/** Adds the next page of relations; centres and nodes already on screen are not repeated. */
function mergeNeighborhood(current: AssetMapNeighborhood, next: AssetMapNeighborhood): AssetMapNeighborhood {
  const seenEdges = new Set(current.edges.map(edge => edge.id))
  const seenNodes = new Set([...current.centers, ...current.nodes].map(node => node.id))
  return {
    ...next,
    centers: current.centers,
    nodes: [...current.nodes, ...next.nodes.filter(node => !seenNodes.has(node.id))],
    edges: [...current.edges, ...next.edges.filter(edge => !seenEdges.has(edge.id))],
  }
}

/** Adds the next page of rows to the rows already on screen. */
function appendItems(current: AssetMapDetail['detail'], next: AssetMapDetail['detail']): AssetMapDetail['detail'] {
  if (current.kind === 'services' && next.kind === 'services') return { kind: 'services', items: [...current.items, ...next.items] }
  if (current.kind === 'endpoints' && next.kind === 'endpoints') return { kind: 'endpoints', items: [...current.items, ...next.items] }
  return next
}
