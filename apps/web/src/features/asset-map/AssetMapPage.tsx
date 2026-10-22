import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type {
  AssetMapAssetRef,
  AssetMapCompleteness,
  AssetMapDetail,
  AssetMapKind,
  AssetMapMembersPage,
  AssetMapNeighborhood,
  AssetMapOverlay,
  AssetMapOverview,
} from '@raptix/web-contracts'
import { useProjectStore } from '../../state/stores'
import { useSession } from '../../platform/session'
import { ApiTransportError } from '../../platform/transport'
import { assetMapReads } from './query'
import { AssetMapCanvas, type CanvasFocus, type CanvasRestore } from './AssetMapCanvas'
import { toCanvasElements, VISIBLE_EDGE_BUDGET, VISIBLE_NODE_BUDGET } from './canvas-model'
import { rendererFor, rendererLabel } from './domain-renderers'
import { loadSavedView, saveSelection, type SavedCamera } from './saved-view'

/** Kinds the operator can switch off on the canvas. Centres are never switched off. */
const SWITCHABLE_KINDS = [
  { kind: 'service', label: 'Services' },
  { kind: 'origin', label: 'Origins' },
] as const

/** One catalog list as the page holds it: the rows loaded so far, where the next page starts, and what is known about the total. */
interface ListState {
  items: AssetMapAssetRef[]
  nextCursor: string | null
  completeness: AssetMapCompleteness | null
}

const EMPTY_LIST: ListState = { items: [], nextCursor: null, completeness: null }

function listFrom(page: AssetMapMembersPage): ListState {
  return { items: page.items, nextCursor: page.nextCursor, completeness: page.completeness }
}

/** Adds the next page to a list; a row already on screen is not repeated. */
function appendToList(current: ListState, page: AssetMapMembersPage): ListState {
  const seen = new Set(current.items.map(item => item.assetId))
  return { items: [...current.items, ...page.items.filter(item => !seen.has(item.assetId))], nextCursor: page.nextCursor, completeness: page.completeness }
}

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

function AssetList({
  title,
  list,
  selected,
  onSelect,
  onLoadMore,
}: {
  title: string
  list: ListState
  selected: string | null
  onSelect: (assetId: string) => void
  onLoadMore: () => void
}) {
  return (
    <section aria-label={title} className="space-y-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="space-y-1">
        {list.items.map(item => (
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
      {list.completeness ? <Completeness label={title} state={list.completeness} /> : null}
      {list.nextCursor ? (
        <button type="button" onClick={onLoadMore} className="rounded border px-2 py-1 text-xs">
          Load more {title.toLowerCase()}
        </button>
      ) : null}
    </section>
  )
}

function Inspector({
  engagementId,
  detail,
  filter,
  onFilter,
  onLoadMore,
  overlay,
  overlayError,
}: {
  engagementId: string
  detail: AssetMapDetail
  filter: string
  onFilter: (value: string) => void
  onLoadMore: () => void
  overlay: AssetMapOverlay | null
  overlayError: string | null
}) {
  const body = detail.detail
  const [draft, setDraft] = useState(filter)
  const [synced, setSynced] = useState(filter)
  // Adjusted during render: a passive effect would run after the first input and overwrite the typed draft.
  if (filter !== synced) {
    setSynced(filter)
    setDraft(filter)
  }
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
              {ref.artifactRef ? <span data-testid="evidence-artifact"> · artifact {ref.artifactRef}</span> : null}
              {ref.capture ? (
                <span data-testid="evidence-capture">
                  {' · '}capture {ref.capture.id} ({ref.capture.classification}, digest {ref.capture.digest.slice(0, 12)}…)
                  {ref.capture.classification === 'unclassified' ? (
                    ' · classify to open'
                  ) : (
                    <>
                      {' · '}
                      <a href={`/api/engagements/${encodeURIComponent(engagementId)}/artifacts/captures/${encodeURIComponent(ref.capture.id)}/content`}>open</a>
                    </>
                  )}
                </span>
              ) : ref.artifactRef ? (
                <span data-testid="evidence-uncaptured"> · not imported as a capture</span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Work and findings" className="space-y-1">
        <h4 className="font-semibold">Work and findings</h4>
        {overlayError ? (
          <p role="alert" className="text-xs">
            {overlayError}
          </p>
        ) : null}
        {overlay ? (
          <>
            <p className="text-xs" data-testid="linked-findings">
              Linked findings: {overlay.linked.total}
              {overlay.linked.total > 0 ? ` (${Object.entries(overlay.linked.byStatus).map(([status, count]) => `${status} ${count}`).join(', ')})` : ''}
            </p>
            <ul className="text-xs">
              {overlay.linked.items.map(item => (
                <li key={item.id}>
                  {item.severity} · {item.title} · {item.status}
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-600" data-testid="unlinked-findings">
              Unlinked findings in this engagement: {overlay.unlinkedFindings} (attribution unknown: no owning record names an asset)
            </p>
          </>
        ) : null}
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
 * and the inspector with sources, evidence, services, sitemap and findings on the right. Every list is
 * paged and says what it covers. Each read belongs to the project it started in: a response that
 * arrives after the operator switched project, or after the asset moved on, is dropped.
 */
/**
 * One project and one signed-in user at a time. The page is keyed by both, so each scope starts from its own
 * state, camera and in-flight reads. Nothing from a previous project can then reach the saved view of the next one.
 */
export function AssetMapPage() {
  const engagementId = useProjectStore(state => state.pid)
  const actorId = useSession().session?.actor?.id ?? null
  return <AssetMapScope key={`${actorId ?? ''}\u0000${engagementId ?? ''}`} engagementId={engagementId} actorId={actorId} />
}

function AssetMapScope({ engagementId, actorId }: { engagementId: string | null; actorId: string | null }) {
  const [overview, setOverview] = useState<AssetMapOverview | null>(null)
  const [hostList, setHostList] = useState<ListState>(EMPTY_LIST)
  const [originList, setOriginList] = useState<ListState>(EMPTY_LIST)
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
  const [overlay, setOverlay] = useState<AssetMapOverlay | null>(null)
  const [overlayError, setOverlayError] = useState<string | null>(null)
  const [restore, setRestore] = useState<CanvasRestore | null>(null)
  /** The camera last reported by the canvas for this project; saved with the selection. */
  const camera = useRef<SavedCamera | null>(null)
  const restoreCount = useRef(0)
  /** Bumped whenever the project or the signed-in user changes; every read compares against it before it applies. */
  const generation = useRef(0)
  /** Within one project, the newest selection read wins. */
  const request = useRef(0)
  const searchRequest = useRef(0)
  const focusCount = useRef(0)
  /** Revision of the catalog the lists were last loaded from; a refresh reports when it moved. */
  const seenRevision = useRef<string | null>(null)
  const elements = useMemo(
    () => (neighborhood ? toCanvasElements(neighborhood, { hidden: hiddenKinds }) : { nodes: [], edges: [], hiddenNodes: 0, hiddenEdges: 0, filteredNodes: 0 }),
    [neighborhood, hiddenKinds],
  )

  useEffect(() => {
    if (!engagementId || engagementId === 'all') return
    const gen = ++generation.current
    setError(null)
    setNotice(null)
    setSelected(null)
    setNeighborhood(null)
    setDetail(null)
    setResults(null)
    setQuery('')
    setFilter('')
    setFocus(null)
    setOverlay(null)
    setOverlayError(null)
    setOverview(null)
    setHostList(EMPTY_LIST)
    setOriginList(EMPTY_LIST)
    seenRevision.current = null
    Promise.all([assetMapReads.overview(engagementId), assetMapReads.members(engagementId, 'host'), assetMapReads.members(engagementId, 'web_origin')])
      .then(([view, hostPage, originPage]) => {
        if (gen !== generation.current) return
        seenRevision.current = view.completeness.revision
        setOverview(view)
        setHostList(listFrom(hostPage))
        setOriginList(listFrom(originPage))
        // The saved asset may sit past the first page of each list (it was reached by search), so it is
        // restored as it is. The server answers not-found if the asset has left the catalog.
        const saved = loadSavedView(actorId, engagementId)
        if (saved) {
          setSelected(saved.assetId)
          if (saved.camera) {
            camera.current = saved.camera
            setRestore({ camera: saved.camera, token: ++restoreCount.current })
          }
        }
      })
      .catch(reason => {
        if (gen === generation.current) setError(describeFailure(reason))
      })
  }, [engagementId, actorId])

  /** Loads the relations and the inspector of one asset. A response for an asset, filter or project already left is dropped. */
  const loadSelection = (asset: string, sitemapFilter: string): void => {
    if (!engagementId || engagementId === 'all') return
    const gen = generation.current
    const token = ++request.current
    const current = (): boolean => gen === generation.current && token === request.current
    setError(null)
    Promise.all([assetMapReads.neighborhood(engagementId, asset), assetMapReads.detail(engagementId, asset, null, sitemapFilter)])
      .then(([graph, inspector]) => {
        if (!current()) return
        setNeighborhood(graph)
        setDetail(inspector)
      })
      .catch(reason => {
        if (current()) setError(describeFailure(reason))
      })
    // Findings load on their own: a failure here is shown in the inspector and does not hide the map.
    assetMapReads.overlay(engagementId, asset)
      .then(view => {
        if (!current()) return
        setOverlay(view)
        setOverlayError(null)
      })
      .catch(reason => {
        if (current()) setOverlayError(`Findings for this asset could not be loaded (${reason instanceof Error ? reason.message : 'unknown error'}).`)
      })
  }

  useEffect(() => {
    if (!engagementId || engagementId === 'all' || !selected) return
    setFilter('')
    setNeighborhood(null)
    setDetail(null)
    setOverlay(null)
    setOverlayError(null)
    saveSelection(actorId, engagementId, selected, camera.current)
    loadSelection(selected, '')
    // loadSelection reads the current engagement; it is re-run only when the selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId, selected])

  /** Re-reads the lists and the open asset. The canvas keeps the positions of nodes it already drew. */
  const refresh = (): void => {
    if (!engagementId || engagementId === 'all') return
    const gen = generation.current
    Promise.all([assetMapReads.overview(engagementId), assetMapReads.members(engagementId, 'host'), assetMapReads.members(engagementId, 'web_origin')])
      .then(([view, hostPage, originPage]) => {
        if (gen !== generation.current) return
        const moved = seenRevision.current !== null && seenRevision.current !== view.completeness.revision
        seenRevision.current = view.completeness.revision
        setOverview(view)
        setHostList(listFrom(hostPage))
        setOriginList(listFrom(originPage))
        setNotice(moved ? 'The graph changed since the last load; the lists were refreshed.' : 'The map is up to date.')
      })
      .catch(reason => {
        if (gen === generation.current) setError(describeFailure(reason))
      })
    if (selected) loadSelection(selected, filter)
  }

  /** Next page of the host or origin list. A cursor from before a catalog change starts the list again. */
  const loadMoreList = (kind: AssetMapKind): void => {
    const list = kind === 'host' ? hostList : originList
    if (!engagementId || engagementId === 'all' || list.nextCursor === null) return
    const gen = generation.current
    const cursor = list.nextCursor
    const apply = (update: (state: ListState) => ListState): void => (kind === 'host' ? setHostList(update) : setOriginList(update))
    assetMapReads.members(engagementId, kind, cursor)
      .then(page => {
        if (gen === generation.current) apply(state => appendToList(state, page))
      })
      .catch(reason => {
        if (gen !== generation.current) return
        if (!isRevisionChanged(reason)) return setError(describeFailure(reason))
        assetMapReads.members(engagementId, kind)
          .then(first => {
            if (gen === generation.current) apply(() => listFrom(first))
          })
          .catch(again => {
            if (gen === generation.current) setError(describeFailure(again))
          })
      })
  }

  const applyFilter = (value: string): void => {
    if (!selected) return
    setFilter(value)
    loadSelection(selected, value)
  }

  const runSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const text = query.trim()
    if (!engagementId || engagementId === 'all') return
    if (text === '') {
      setResults(null)
      return
    }
    const gen = generation.current
    const token = ++searchRequest.current
    assetMapReads.search(engagementId, text)
      .then(found => {
        if (gen === generation.current && token === searchRequest.current) setResults(found.items)
      })
      .catch(reason => {
        if (gen === generation.current && token === searchRequest.current) setError(describeFailure(reason))
      })
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
    const gen = generation.current
    const token = request.current
    const asset = selected
    assetMapReads.neighborhood(engagementId, asset, neighborhood.nextCursor)
      .then(next => {
        if (gen !== generation.current || token !== request.current) return
        setNeighborhood(current => (current ? mergeNeighborhood(current, next) : next))
      })
      .catch(reason => {
        if (gen !== generation.current || token !== request.current) return
        if (!isRevisionChanged(reason)) return setError(describeFailure(reason))
        // The graph changed under the cursor: start the relations again from the first page.
        const restart = ++request.current
        assetMapReads.neighborhood(engagementId, asset)
          .then(first => {
            if (gen === generation.current && restart === request.current) setNeighborhood(first)
          })
          .catch(again => {
            if (gen === generation.current && restart === request.current) setError(describeFailure(again))
          })
      })
  }

  const loadMoreDetail = (): void => {
    if (!detail || !engagementId || !selected || !detail.nextCursor) return
    const gen = generation.current
    const token = request.current
    const asset = selected
    const sitemapFilter = filter
    assetMapReads.detail(engagementId, asset, detail.nextCursor, sitemapFilter)
      .then(next => {
        if (gen !== generation.current || token !== request.current) return
        setDetail(current => (current ? { ...next, detail: appendItems(current.detail, next.detail) } : next))
      })
      .catch(reason => {
        if (gen !== generation.current || token !== request.current) return
        if (!isRevisionChanged(reason)) return setError(describeFailure(reason))
        const restart = ++request.current
        assetMapReads.detail(engagementId, asset, null, sitemapFilter)
          .then(first => {
            if (gen === generation.current && restart === request.current) setDetail(first)
          })
          .catch(again => {
            if (gen === generation.current && restart === request.current) setError(describeFailure(again))
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
        <AssetList title="Hosts" list={hostList} selected={selected} onSelect={setSelected} onLoadMore={() => loadMoreList('host')} />
        <AssetList title="Web origins" list={originList} selected={selected} onSelect={setSelected} onLoadMore={() => loadMoreList('web_origin')} />
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
        <AssetMapCanvas
          elements={elements}
          onSelectAsset={setSelected}
          focus={focus}
          restore={restore}
          onCameraChange={next => {
            camera.current = next
            if (engagementId && selected) saveSelection(actorId, engagementId, selected, next)
          }}
        />
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
          <Inspector engagementId={engagementId} detail={detail} filter={filter} onFilter={applyFilter} onLoadMore={loadMoreDetail} overlay={overlay} overlayError={overlayError} />
        ) : (
          <p className="text-sm text-slate-600">Select a host or origin to inspect it.</p>
        )}
      </aside>
    </div>
  )
}
