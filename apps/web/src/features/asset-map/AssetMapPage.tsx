import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { AssetMapAssetRef, AssetMapCompleteness, AssetMapDetail, AssetMapNeighborhood, AssetMapOverview } from '@raptix/web-contracts'
import { useProjectStore } from '../../state/stores'
import { useSession } from '../../real/session'
import { ApiTransportError } from '../../real/transport'
import {
  fetchAssetMapDetail,
  fetchAssetMapMembers,
  fetchAssetMapNeighborhood,
  fetchAssetMapOverview,
  fetchAssetMapSearch,
} from '../../real/asset-map-api'
import { AssetMapCanvas, type CanvasFocus } from './AssetMapCanvas'
import { toCanvasElements, VISIBLE_EDGE_BUDGET, VISIBLE_NODE_BUDGET } from './canvas-model'
import { rendererFor, rendererLabel } from './domain-renderers'
import { loadSavedSelection, saveSelection } from './saved-view'

/** Kinds the operator can switch off on the canvas. Centres are never switched off. */
const SWITCHABLE_KINDS = [
  { kind: 'service', label: 'Services' },
  { kind: 'origin', label: 'Origins' },
] as const

/** Maps a failure to a sentence the operator can act on; never an empty map. */
function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown error'
  return `The asset map could not be loaded (${message}). Nothing is shown as complete.`
}

/** The graph or catalog moved on since a cursor was issued: paging must restart from the first page. */
function isRevisionChanged(error: unknown): boolean {
  return error instanceof ApiTransportError && error.status === 409
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

function Inspector({
  detail,
  filter,
  onFilter,
  onLoadMore,
}: {
  detail: AssetMapDetail
  filter: string
  onFilter: (value: string) => void
  onLoadMore: () => void
}) {
  const body = detail.detail
  const [draft, setDraft] = useState(filter)
  useEffect(() => setDraft(filter), [filter])
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="font-semibold">{detail.asset.canonicalKey}</p>
        <p className="text-xs text-slate-600">
          {detail.asset.kind} · namespace {detail.asset.namespace} · {detail.provenance.graphNodes} observed node(s)
        </p>
        <p className="text-xs text-slate-600" data-testid="renderer">
          {rendererLabel(rendererFor(detail.asset.kind))}
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
          <form
            className="flex gap-1"
            onSubmit={event => {
              event.preventDefault()
              onFilter(draft.trim())
            }}
          >
            <input
              aria-label="Filter sitemap"
              value={draft}
              onChange={event => setDraft(event.target.value)}
              placeholder="URL or path contains"
              className="min-w-0 flex-1 rounded border px-2 py-1 text-xs"
            />
            <button type="submit" className="rounded border px-2 py-1 text-xs">
              Filter
            </button>
          </form>
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
          {body.items.length === 0 ? <p className="text-xs text-slate-600">No endpoint matches{filter ? ` “${filter}”` : ''}.</p> : null}
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

/**
 * Asset Map (flagged): hosts and web origins on the left, their relationship graph in the middle,
 * and the inspector with sources, evidence, services and sitemap on the right. Every list is paged,
 * every count says what it covers, and a response for an asset the operator already left is dropped.
 */
export function AssetMapPage() {
  const engagementId = useProjectStore(state => state.pid)
  const actorId = useSession().session?.actor?.id ?? null
  const [overview, setOverview] = useState<AssetMapOverview | null>(null)
  const [hosts, setHosts] = useState<AssetMapAssetRef[]>([])
  const [origins, setOrigins] = useState<AssetMapAssetRef[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [neighborhood, setNeighborhood] = useState<AssetMapNeighborhood | null>(null)
  const [detail, setDetail] = useState<AssetMapDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [hiddenKinds, setHiddenKinds] = useState<ReadonlySet<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AssetMapAssetRef[] | null>(null)
  const [focus, setFocus] = useState<CanvasFocus | null>(null)
  /** Every in-flight read carries the token it started under; a result with an old token is dropped. */
  const request = useRef(0)
  const focusCount = useRef(0)
  /** Revision of the catalog the lists were last loaded from; a refresh reports when it moved. */
  const seenRevision = useRef<string | null>(null)
  const elements = useMemo(
    () => (neighborhood ? toCanvasElements(neighborhood, { hidden: hiddenKinds }) : { nodes: [], edges: [], hiddenNodes: 0, hiddenEdges: 0, filteredNodes: 0 }),
    [neighborhood, hiddenKinds],
  )

  useEffect(() => {
    if (!engagementId || engagementId === 'all') return
    let live = true
    setError(null)
    setNotice(null)
    setSelected(null)
    setNeighborhood(null)
    setDetail(null)
    setResults(null)
    seenRevision.current = null
    Promise.all([fetchAssetMapOverview(engagementId), fetchAssetMapMembers(engagementId, 'host'), fetchAssetMapMembers(engagementId, 'web_origin')])
      .then(([view, hostPage, originPage]) => {
        if (!live) return
        seenRevision.current = view.completeness.revision
        setOverview(view)
        setHosts(hostPage.items)
        setOrigins(originPage.items)
        const saved = loadSavedSelection(actorId, engagementId)
        if (saved && [...hostPage.items, ...originPage.items].some(item => item.assetId === saved)) setSelected(saved)
      })
      .catch(reason => live && setError(describeFailure(reason)))
    return () => {
      live = false
    }
  }, [engagementId, actorId])

  /** Loads the relations and the inspector of one asset. A response for an asset or filter already left is dropped. */
  const loadSelection = (asset: string, sitemapFilter: string): void => {
    if (!engagementId || engagementId === 'all') return
    const token = ++request.current
    setError(null)
    Promise.all([fetchAssetMapNeighborhood(engagementId, asset), fetchAssetMapDetail(engagementId, asset, null, sitemapFilter)])
      .then(([graph, inspector]) => {
        if (token !== request.current) return
        setNeighborhood(graph)
        setDetail(inspector)
      })
      .catch(reason => {
        if (token === request.current) setError(describeFailure(reason))
      })
  }

  useEffect(() => {
    if (!engagementId || engagementId === 'all' || !selected) return
    setFilter('')
    setNeighborhood(null)
    setDetail(null)
    saveSelection(actorId, engagementId, selected)
    loadSelection(selected, '')
    // loadSelection reads the current engagement; it is re-run only when the selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId, selected])

  /** Re-reads the lists and the open asset. The canvas keeps the positions of nodes it already drew. */
  const refresh = (): void => {
    if (!engagementId || engagementId === 'all') return
    Promise.all([fetchAssetMapOverview(engagementId), fetchAssetMapMembers(engagementId, 'host'), fetchAssetMapMembers(engagementId, 'web_origin')])
      .then(([view, hostPage, originPage]) => {
        const moved = seenRevision.current !== null && seenRevision.current !== view.completeness.revision
        seenRevision.current = view.completeness.revision
        setOverview(view)
        setHosts(hostPage.items)
        setOrigins(originPage.items)
        setNotice(moved ? 'The graph changed since the last load; the lists were refreshed.' : 'The map is up to date.')
      })
      .catch(reason => setError(describeFailure(reason)))
    if (selected) loadSelection(selected, filter)
  }

  const applyFilter = (value: string): void => {
    if (!selected) return
    setFilter(value)
    loadSelection(selected, value)
  }

  const runSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const text = query.trim()
    if (!engagementId || engagementId === 'all' || text === '') return setResults(null)
    fetchAssetMapSearch(engagementId, text)
      .then(found => setResults(found.items))
      .catch(reason => setError(describeFailure(reason)))
  }

  /** Opens an asset found by search, wherever it sits in the catalog, and asks the canvas to centre it. */
  const locate = (assetId: string): void => {
    setFocus({ assetId, token: ++focusCount.current })
    setSelected(assetId)
  }

  const toggleKind = (kind: string, shown: boolean): void => {
    setHiddenKinds(current => {
      const next = new Set(current)
      if (shown) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const loadMoreRelations = (): void => {
    if (!neighborhood || !engagementId || !selected || !neighborhood.nextCursor) return
    const token = request.current
    const asset = selected
    fetchAssetMapNeighborhood(engagementId, asset, neighborhood.nextCursor)
      .then(next => {
        if (token !== request.current) return
        setNeighborhood(current => (current ? mergeNeighborhood(current, next) : next))
      })
      .catch(reason => {
        if (token !== request.current) return
        if (!isRevisionChanged(reason)) return setError(describeFailure(reason))
        // The graph changed under the cursor: start the relations again from the first page.
        const restart = ++request.current
        fetchAssetMapNeighborhood(engagementId, asset)
          .then(first => {
            if (restart === request.current) setNeighborhood(first)
          })
          .catch(again => {
            if (restart === request.current) setError(describeFailure(again))
          })
      })
  }

  const loadMoreDetail = (): void => {
    if (!detail || !engagementId || !selected || !detail.nextCursor) return
    const token = request.current
    const asset = selected
    const sitemapFilter = filter
    fetchAssetMapDetail(engagementId, asset, detail.nextCursor, sitemapFilter)
      .then(next => {
        if (token !== request.current) return
        setDetail(current => (current ? { ...next, detail: appendItems(current.detail, next.detail) } : next))
      })
      .catch(reason => {
        if (token !== request.current) return
        if (!isRevisionChanged(reason)) return setError(describeFailure(reason))
        const restart = ++request.current
        fetchAssetMapDetail(engagementId, asset, null, sitemapFilter)
          .then(first => {
            if (restart === request.current) setDetail(first)
          })
          .catch(again => {
            if (restart === request.current) setError(describeFailure(again))
          })
      })
  }

  if (!engagementId || engagementId === 'all') {
    return <p className="p-4 text-sm">Open the Asset Map from a project (?engagement=…) to see its assets.</p>
  }

  return (
    <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[220px_minmax(0,1fr)_340px]" data-testid="asset-map">
      <aside className="space-y-4">
        <h2 className="text-base font-semibold">Asset Map</h2>
        <button type="button" onClick={refresh} className="rounded border px-2 py-1 text-xs">
          Refresh
        </button>
        {notice ? (
          <p role="status" className="text-xs text-slate-600">
            {notice}
          </p>
        ) : null}
        {overview ? <Completeness label="Catalogued" state={overview.completeness} /> : null}
        <form onSubmit={runSearch} className="space-y-1">
          <label htmlFor="asset-map-search" className="text-xs font-semibold">
            Find an asset
          </label>
          <div className="flex gap-1">
            <input
              id="asset-map-search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="IP, name or origin"
              className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"
            />
            <button type="submit" className="rounded border px-2 py-1 text-xs">
              Find
            </button>
          </div>
        </form>
        {results ? (
          <section aria-label="Search results" className="space-y-1">
            <ul className="space-y-1">
              {results.map(item => (
                <li key={item.assetId}>
                  <button type="button" onClick={() => locate(item.assetId)} className="w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-slate-100">
                    {item.canonicalKey}
                  </button>
                </li>
              ))}
            </ul>
            {results.length === 0 ? <p className="text-xs text-slate-600">No asset matches.</p> : null}
          </section>
        ) : null}
        <AssetList title="Hosts" items={hosts} selected={selected} onSelect={setSelected} />
        <AssetList title="Web origins" items={origins} selected={selected} onSelect={setSelected} />
      </aside>
      <main className="space-y-2">
        {error ? (
          <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-2 text-sm">
            {error}
          </p>
        ) : null}
        <fieldset className="flex gap-3 text-xs">
          <legend className="sr-only">Kinds drawn on the canvas</legend>
          {SWITCHABLE_KINDS.map(({ kind, label }) => (
            <label key={kind} className="flex items-center gap-1">
              <input type="checkbox" checked={!hiddenKinds.has(kind)} onChange={event => toggleKind(kind, event.target.checked)} />
              {label}
            </label>
          ))}
        </fieldset>
        <AssetMapCanvas elements={elements} onSelectAsset={setSelected} focus={focus} />
        {elements.hiddenNodes > 0 || elements.hiddenEdges > 0 ? (
          <p className="text-xs text-slate-600" data-testid="visible-budget">
            Not drawn: {elements.hiddenNodes} node(s) and {elements.hiddenEdges} relation(s) beyond the visible budget ({VISIBLE_NODE_BUDGET} nodes, {VISIBLE_EDGE_BUDGET} relations).
          </p>
        ) : null}
        {elements.filteredNodes > 0 ? <p className="text-xs text-slate-600">Switched off: {elements.filteredNodes} node(s) of the kinds unticked above.</p> : null}
        {neighborhood ? <Completeness label="Relations" state={neighborhood.completeness} /> : null}
        {neighborhood?.nextCursor ? (
          <button type="button" onClick={loadMoreRelations} className="rounded border px-2 py-1 text-xs">
            Load more relations
          </button>
        ) : null}
      </main>
      <aside>
        {detail ? (
          <Inspector detail={detail} filter={filter} onFilter={applyFilter} onLoadMore={loadMoreDetail} />
        ) : (
          <p className="text-sm text-slate-600">Select a host or origin to inspect it.</p>
        )}
      </aside>
    </div>
  )
}
