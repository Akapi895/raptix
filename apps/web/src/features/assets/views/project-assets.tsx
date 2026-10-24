/**
 * The project's Assets tab (real mode). Two attributes stay apart: the scope classification (in, pending, out or
 * unclassified, which decides whether an asset can be a target) and the inventory status (active, stopped or unknown).
 * The inventory does not record a status yet, so the status is shown as not recorded and never inferred from scope or
 * observation. Discovery and the map are entry points to the screens that own them; nothing here starts a run.
 */
import { useState, type ReactElement } from 'react'
import { AssetPreviewModal } from '../preview-modal'
import { go } from '../../../router/navigate'
import { utcMinuteOr } from '../../../platform/format'
import { Button, Card, CardHeader, cx, DescList, Empty, Input, Segmented, Skeleton, Status } from '../../../ui/index'
import { useAssetList } from '../query'
import type { AssetListRead } from '../service'

type AssetSub = 'overview' | 'inventory' | 'discovery' | 'map'
type ScopeFilter = '' | 'in' | 'pending' | 'out' | 'unclassified'

const SUB_OPTIONS: { id: AssetSub; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'map', label: 'Map' },
]

const SCOPE_OPTIONS: { id: ScopeFilter; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'in', label: 'In scope' },
  { id: 'pending', label: 'Pending' },
  { id: 'out', label: 'Out of scope' },
  { id: 'unclassified', label: 'Unclassified' },
]

const PAGE_SIZE = 50

const OBSERVATION_TEXT: Record<AssetListRead['observation'], string> = {
  ok: 'The observed graph was read in full.',
  truncated: 'The observed graph read was capped, so the observed counts may be partial.',
  unavailable: 'The observed graph could not be read.',
}

function sourceText(source: string): string {
  return source === 'observed' ? 'Seen in a run' : 'Managed'
}

function Tile({ label, value }: { label: string; value: number | string }): ReactElement {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-subtle px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-mono text-lg tabular-nums">{value}</div>
    </div>
  )
}

function OverviewPanel({ read, onOpen }: { read: AssetListRead; onOpen: (sub: AssetSub) => void }): ReactElement {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile label="Total assets" value={read.total} />
        <Tile label="In scope" value={read.kpis.in} />
        <Tile label="Pending review" value={read.kpis.pending} />
        <Tile label="Out of scope" value={read.kpis.out} />
        <Tile label="Unclassified" value={read.kpis.unclassified} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Scope classification" sub="Whether an asset may be a target. Only approved in-scope assets can be selected." />
          <div className="p-4">
            <DescList
              items={[
                { k: 'In scope', v: 'Approved by a reviewer and selectable as a target' },
                { k: 'Pending review', v: 'Added by a scope revision that no reviewer has approved yet' },
                { k: 'Out of scope', v: 'Excluded; never a target' },
                { k: 'Unclassified', v: 'Not yet classified' },
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Inventory status" sub="Whether an asset is active, stopped or unknown." />
          <p className="p-4 text-sm text-muted">The inventory does not record an asset&apos;s status yet. It is shown as not recorded, and it is never inferred from the scope or from what was observed.</p>
        </Card>
        <Card>
          <CardHeader title="Where assets come from" sub="Managed assets were added by an operator; seen-in-a-run assets were observed during an execution." />
          <div className="p-4">
            <DescList
              items={[
                { k: 'Managed', v: String(read.sources.managed ?? 0) },
                { k: 'Seen in a run', v: String(read.sources.observed ?? 0) },
                { k: 'Observed graph', v: OBSERVATION_TEXT[read.observation] },
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Asset types" />
          {Object.keys(read.types).length === 0 ? (
            <p className="p-4 text-sm text-muted">No assets recorded yet.</p>
          ) : (
            <div className="p-4">
              <DescList items={Object.entries(read.types).map(([type, count]) => ({ k: type, v: String(count) }))} />
            </div>
          )}
        </Card>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onOpen('inventory')}>Open inventory</Button>
        <Button variant="secondary" onClick={() => onOpen('discovery')}>Open discovery</Button>
      </div>
    </div>
  )
}

interface InventoryFilters {
  scope: ScopeFilter
  q: string
  page: number
}

function InventoryPanel({ read, filters, onFilters, onPreview, busy }: {
  read: AssetListRead
  filters: InventoryFilters
  onFilters: (next: InventoryFilters) => void
  onPreview: (id: string) => void
  /** True while a new filter or page is read; the rows on screen are the previous read until it lands. */
  busy: boolean
}): ReactElement {
  const filtered = filters.q !== '' || filters.scope !== ''
  const first = (read.page - 1) * read.pageSize + 1
  const last = Math.min(read.page * read.pageSize, read.total)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<ScopeFilter> value={filters.scope} onChange={(scope) => onFilters({ ...filters, scope, page: 1 })} options={SCOPE_OPTIONS} />
        <Input
          aria-label="Search assets"
          placeholder="Search by name or identifier"
          value={filters.q}
          onChange={(e) => onFilters({ ...filters, q: e.target.value, page: 1 })}
          className="max-w-xs"
        />
        {busy && <span role="status" className="text-xs text-muted">Updating…</span>}
      </div>
      <Card>
        {read.items.length === 0 ? (
          <Empty title={filtered ? 'No assets match these filters' : 'No assets in this engagement yet'}>
            {filtered ? 'Clear the search or the scope filter to see the inventory.' : 'Add or import assets from the Discovery tab.'}
          </Empty>
        ) : (
          <div className={cx('overflow-x-auto transition-opacity', busy && 'opacity-60')}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="p-3 font-medium">Name</th>
                  <th className="p-3 font-medium">Identifier</th>
                  <th className="p-3 font-medium">Type</th>
                  <th className="p-3 font-medium">Scope</th>
                  <th className="p-3 font-medium">Source</th>
                  <th className="p-3 font-medium">Inventory status</th>
                  <th className="p-3 font-medium">Observed</th>
                  <th className="p-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {read.items.map(({ asset }) => (
                  <tr key={asset.id} className="border-b border-line last:border-0">
                    <td className="p-3">
                      <button type="button" className="font-medium text-link hover:underline" onClick={() => onPreview(asset.id)}>{asset.name}</button>
                    </td>
                    <td className="p-3 font-mono text-xs">{asset.ident}</td>
                    <td className="p-3 text-xs">{asset.type}</td>
                    <td className="p-3"><Status kind="scope" value={asset.scope} /></td>
                    <td className="p-3 text-xs text-muted">{sourceText(asset.source)}</td>
                    <td className="p-3 text-xs text-muted">Not recorded</td>
                    <td className="p-3 text-xs text-muted">{asset.observation ? `${asset.observation.services.length} services · ${asset.observation.findingCount} findings` : '—'}</td>
                    <td className="whitespace-nowrap p-3 text-xs text-muted">{utcMinuteOr(asset.updated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {read.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>Showing {first}–{last} of {read.total}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={read.page <= 1} onClick={() => onFilters({ ...filters, page: read.page - 1 })}>Previous</Button>
            <Button size="sm" variant="secondary" disabled={last >= read.total} onClick={() => onFilters({ ...filters, page: read.page + 1 })}>Next</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function DiscoveryPanel({ read }: { read: AssetListRead }): ReactElement {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Add assets" sub="Add an asset by hand or import a list. Each row names its scope, and an asset outside approved scope cannot be selected as a target." actions={<Button size="sm" onClick={() => go('asset-new')}>Open add and import</Button>} />
      </Card>
      <Card>
        <CardHeader title="Observed discovery" sub="Assets seen during an execution are recorded in the observed graph, apart from the assets you added." />
        <div className="p-4">
          <DescList
            items={[
              { k: 'Seen in a run', v: String(read.sources.observed ?? 0) },
              { k: 'Observed graph', v: OBSERVATION_TEXT[read.observation] },
            ]}
          />
        </div>
      </Card>
    </div>
  )
}

function MapPanel({ engagementId, mapEnabled }: { engagementId: string; mapEnabled: boolean }): ReactElement {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Scope map" sub="The scope map and its review of pending changes." actions={<Button size="sm" variant="secondary" onClick={() => go('asset-scope')}>Open scope map</Button>} />
      </Card>
      {mapEnabled ? (
        <Card>
          <CardHeader title="Asset map" sub="The assets of this engagement and the relationships between them." actions={<Button size="sm" variant="secondary" onClick={() => go('project', { id: engagementId, tab: 'asset-map' })}>Open asset map</Button>} />
        </Card>
      ) : (
        <p className="text-sm text-muted">The asset map is not enabled in this deployment.</p>
      )}
    </div>
  )
}

export function ProjectAssets({ engagementId, mapEnabled }: { engagementId: string; mapEnabled: boolean }): ReactElement {
  const [sub, setSub] = useState<AssetSub>('overview')
  const [filters, setFilters] = useState<InventoryFilters>({ scope: '', q: '', page: 1 })
  const [preview, setPreview] = useState<string | null>(null)
  const list = useAssetList({ q: filters.q || undefined, scope: filters.scope || undefined, page: filters.page, pageSize: PAGE_SIZE })

  return (
    <div className="space-y-4">
      <Segmented<AssetSub> value={sub} onChange={setSub} options={SUB_OPTIONS} />
      {sub === 'map' ? (
        <MapPanel engagementId={engagementId} mapEnabled={mapEnabled} />
      ) : list.isPending ? (
        <Skeleton className="h-40" />
      ) : list.isError || !list.data ? (
        <Empty title="Assets could not be loaded">
          {list.error instanceof Error ? list.error.message : 'The inventory could not be read.'}
        </Empty>
      ) : (
        <>
          {sub === 'overview' && <OverviewPanel read={list.data} onOpen={setSub} />}
          {sub === 'inventory' && <InventoryPanel read={list.data} filters={filters} onFilters={setFilters} onPreview={setPreview} busy={list.isPlaceholderData} />}
          {sub === 'discovery' && <DiscoveryPanel read={list.data} />}
        </>
      )}
      {preview !== null && <AssetPreviewModal key={preview} id={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}
