/**
 * The project portfolio (plan §5.2, reference R12): one presentation for both modes, reading the projects port. Stat tiles
 * count the projects the actor can access, and the filters narrow them by search, status, target type, metadata verification
 * and update time. A filter the connected source cannot answer is not offered, and a column the source does not record shows
 * as unavailable instead of a demo or zero value. The palette and stat, filter and chip treatments are the findings page's.
 */
import { useMemo, useState, type ReactElement } from 'react'
import { FolderPlus, RefreshCw, ServerCrash, X } from 'lucide-react'
import { useProjectRows } from '../list-query'
import type { ProjectRow } from '../service'
import { go } from '../../../router/navigate'
import { useProjectStore } from '../../../state/stores'
import { Button, Empty, Input, Mono, PageHeader, Select, Skeleton, Status, Table, cx, type Col } from '../../../ui/index'

/** Lifecycle states that count as active: the same set the overview uses for its active-projects figure. */
const ACTIVE_STATUSES = new Set(['active', 'approved', 'planning', 'running'])
const DAY_MS = 24 * 60 * 60 * 1000
const UPDATED_RANGES: { id: UpdatedRange; label: string }[] = [
  { id: 'any', label: 'Any time' },
  { id: '7', label: 'Last 7 days' },
  { id: '30', label: 'Last 30 days' },
  { id: 'older', label: 'Older than 30 days' },
]
type UpdatedRange = 'any' | '7' | '30' | 'older'
type MetadataFilter = 'any' | 'verified' | 'review'
type SortOrder = 'updated' | 'name'

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message : 'The projects request failed.'
  return (
    <div className="mx-auto max-w-xl pt-10 text-center" role="alert">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-panel text-bad"><ServerCrash size={22} aria-hidden /></div>
      <h2 className="text-base font-semibold">Could not load projects</h2>
      <p className="mt-2 break-words text-sm text-muted">{message}</p>
      <Button variant="primary" className="mt-4" icon={RefreshCw} onClick={onRetry}>Try again</Button>
    </div>
  )
}

/** A value the source does not record reads as "Not recorded", with its reason in the tooltip. */
function Unrecorded({ value, reason }: { value: string | null; reason: string }) {
  return value === null ? <span className="text-neutral" title={reason}>Not recorded</span> : <>{value}</>
}

/** The update instant falls inside the chosen range, measured from the browser clock (a filter, not a displayed instant). */
function inUpdatedRange(iso: string | null, range: UpdatedRange, now: number): boolean {
  if (range === 'any') return true
  if (iso === null) return false
  const age = now - new Date(iso).getTime()
  if (range === '7') return age <= 7 * DAY_MS
  if (range === '30') return age <= 30 * DAY_MS
  return age > 30 * DAY_MS
}

/** Edge and figure colour per tone, the same tokens the findings stat cards use. The total card has no tone. */
const TONE: Record<'ok' | 'warn' | 'neutral', { edge: string; figure: string }> = {
  ok: { edge: 'border-l-ok', figure: 'text-ok' },
  warn: { edge: 'border-l-warn', figure: 'text-warn' },
  neutral: { edge: 'border-l-neutral', figure: 'text-neutral' },
}

/** A stat card in the findings page's shape: centred label, large figure, and the note on what it counts. */
function StatTile({ label, value, note, tone }: { label: string; value: number | string; note: string; tone?: keyof typeof TONE }): ReactElement {
  const style = tone ? TONE[tone] : undefined
  /* A text value (for example "Not recorded") is not a count, so it never takes the zero or tone styling. */
  const figure = typeof value === 'number'
    ? cx('text-[2rem]', value === 0 ? 'text-muted opacity-50' : style?.figure ?? 'text-fg')
    : 'text-base text-muted'
  return (
    <div className={cx('rounded-lg border border-line bg-panel p-4 text-center shadow-sm', style && cx('border-l-4', style.edge))}>
      <div className="text-sm text-muted">{label}</div>
      <div className={cx('mt-2 font-bold leading-none tabular-nums', figure)}>{value}</div>
      <div className="mt-1.5 text-[13px] font-medium tracking-wide text-muted">{note}</div>
    </div>
  )
}

/** A status chip: the status, its count, and whether it is the active filter. */
function StatusChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
        active ? 'border-primary/40 bg-primary/5 text-primary' : 'border-line bg-panel text-muted hover:bg-hover hover:text-fg',
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{count}</span>
    </button>
  )
}

export function ProjectPortfolio(): ReactElement {
  const list = useProjectRows()
  const setPid = useProjectStore((s) => s.setPid)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [targetType, setTargetType] = useState('')
  const [metadata, setMetadata] = useState<MetadataFilter>('any')
  const [updated, setUpdated] = useState<UpdatedRange>('any')
  const [sort, setSort] = useState<SortOrder>('updated')

  const items = useMemo(() => list.data ?? [], [list.data])
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of items) counts.set(p.status, (counts.get(p.status) ?? 0) + 1)
    return Array.from(counts.entries())
  }, [items])
  const targetTypes = useMemo(() => Array.from(new Set(items.map((p) => p.targetType).filter((t): t is string => t !== null))), [items])
  const hasMetadata = items.some((p) => p.metadataVerified !== null)
  const hasUpdatedInstants = items.some((p) => p.updatedAtIso !== null)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const now = Date.now()
    const matched = items.filter((p) => (!status || p.status === status)
      && (!targetType || p.targetType === targetType)
      && (metadata === 'any' || (metadata === 'verified' ? p.metadataVerified === true : p.metadataVerified === false))
      && inUpdatedRange(p.updatedAtIso, updated, now)
      && (!needle || `${p.id} ${p.name} ${p.workspaceSlug ?? ''} ${p.target ?? ''}`.toLowerCase().includes(needle)))
    return sort === 'name' ? [...matched].sort((a, b) => a.name.localeCompare(b.name)) : matched
  }, [items, q, status, targetType, metadata, updated, sort])

  const filtersActive = q !== '' || status !== '' || targetType !== '' || metadata !== 'any' || updated !== 'any'
  const clearFilters = () => { setQ(''); setStatus(''); setTargetType(''); setMetadata('any'); setUpdated('any') }

  const open = (p: ProjectRow) => {
    setPid(p.id)
    go('project', { id: p.id })
  }

  const cols: Col<ProjectRow>[] = [
    { key: 'project', header: 'Project', render: (p) => (
      <div className="min-w-0">
        <div className="truncate font-medium">{p.name}</div>
        <div className="truncate text-xs">
          <Mono className="text-accent">{p.id}</Mono>
          {p.workspaceSlug && <span className="text-muted"> · workspace {p.workspaceSlug}</span>}
        </div>
      </div>
    ) },
    { key: 'target', header: 'Target', render: (p) => (
      <div className="min-w-0 text-xs">
        <div className="truncate font-mono"><Unrecorded value={p.target} reason="The source does not record a target for this project" /></div>
        {p.targetType && <div className="text-muted">{p.targetType}</div>}
      </div>
    ) },
    { key: 'metadata', header: 'Metadata', render: (p) => (p.metadataVerified === null
      ? <span className="text-neutral" title="The source does not verify metadata">Not recorded</span>
      : <Status kind="check" value={p.metadataVerified ? 'pass' : 'review'} size="sm" label={p.metadataVerified ? 'Verified' : 'Needs review'} />) },
    { key: 'updated', header: 'Updated', className: 'max-md:hidden', render: (p) => <span className="whitespace-nowrap text-xs text-muted">{p.updatedAt}</span> },
  ]

  const activeCount = items.filter((p) => ACTIVE_STATUSES.has(p.status.toLowerCase())).length
  const draftCount = items.filter((p) => p.status.toLowerCase() === 'draft').length
  const reviewCount = items.filter((p) => p.metadataVerified === false).length

  return (
    <>
      <PageHeader
        title="Projects"
        sub="Projects your account can access. A value the connected source does not record shows as Not recorded, with the reason on hover."
        actions={<Button variant="primary" icon={FolderPlus} onClick={() => go('project-new')}>New Project</Button>}
      />
      {list.isPending ? (
        <div className="space-y-3" aria-busy="true" role="status">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : list.isError ? (
        <LoadError error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Projects" value={items.length} note="Accessible to your account" />
            <StatTile label="Active" value={activeCount} note="Active, approved, planning or running" tone="ok" />
            <StatTile label="Draft" value={draftCount} note="Not yet planned" tone="neutral" />
            <StatTile label="Metadata to review" value={hasMetadata ? reviewCount : 'Not recorded'} note="Policy check needs review" tone="warn" />
          </div>

          <section aria-label="Project filters" className={cx('rounded-xl border bg-panel p-2 shadow-sm', filtersActive ? 'border-primary/40' : 'border-line')}>
            <div className="flex flex-wrap items-center gap-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by id, name, workspace or target…" aria-label="Search projects" className="min-w-[240px] flex-1" />
              <Select aria-label="Sort projects" value={sort} onChange={(e) => setSort(e.target.value as SortOrder)} className="!w-auto">
                <option value="updated">Sort: recently updated</option>
                <option value="name">Sort: name A–Z</option>
              </Select>
              {targetTypes.length > 0 && (
                <Select aria-label="Filter by target type" value={targetType} onChange={(e) => setTargetType(e.target.value)} className="!w-auto">
                  <option value="">All target types</option>
                  {targetTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              )}
              {hasMetadata && (
                <Select aria-label="Filter by metadata" value={metadata} onChange={(e) => setMetadata(e.target.value as MetadataFilter)} className="!w-auto">
                  <option value="any">Any metadata</option>
                  <option value="verified">Verified</option>
                  <option value="review">Needs review</option>
                </Select>
              )}
              {hasUpdatedInstants && (
                <Select aria-label="Filter by update time" value={updated} onChange={(e) => setUpdated(e.target.value as UpdatedRange)} className="!w-auto">
                  {UPDATED_RANGES.map((range) => <option key={range.id} value={range.id}>{range.label}</option>)}
                </Select>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
                <StatusChip label="All" count={items.length} active={status === ''} onClick={() => setStatus('')} />
                {statusCounts.map(([value, count]) => (
                  <StatusChip key={value} label={value} count={count} active={status === value} onClick={() => setStatus(value)} />
                ))}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {filtersActive && <Button size="sm" variant="ghost" icon={X} onClick={clearFilters}>Clear filters</Button>}
                <span className="text-xs text-muted" aria-live="polite">Showing {rows.length} of {items.length}</span>
              </div>
            </div>
          </section>

          {rows.length === 0 ? (
            <Empty
              icon={FolderPlus}
              title={items.length === 0 ? 'No projects yet' : 'No projects match the filters'}
              action={<Button variant="primary" icon={FolderPlus} onClick={() => go('project-new')}>New Project</Button>}
            >
              {items.length === 0
                ? 'Create the first project to start planning.'
                : 'An empty result means no records match — this is not an error.'}
            </Empty>
          ) : (
            <Table cols={cols} rows={rows} rowKey={(p) => p.id} onRow={open} />
          )}
        </div>
      )}
    </>
  )
}
