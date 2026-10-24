import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Bug, ChevronRight, RefreshCw, RotateCcw, X } from 'lucide-react'
import { sevLabel, SEVS, type FindingListItem, type FindingListRead, type FindingSort } from './service'
import { FindingReadError, useFindingList } from './query'
import { Banner, Button, cx, Empty, Mono, PageHeader, Pager, SearchBox, Select, Skeleton, Status } from '../../ui/index'
import { go } from '../../router/navigate'

/** Severity colours of the vulnerabilities tab: card edge, stat value, badge text and badge fill. */
const SEV_STYLE: Record<string, { edge: string; stat: string; text: string; soft: string; fill: string }> = {
  critical: { edge: 'border-l-[#dc3545]', stat: 'text-[#dc2626]', text: 'text-[#dc3545]', soft: 'bg-[rgba(220,53,69,0.1)]', fill: 'bg-[#f87171]' },
  high: { edge: 'border-l-[#fd7e14]', stat: 'text-[#ea580c]', text: 'text-[#fd7e14]', soft: 'bg-[rgba(253,126,20,0.1)]', fill: 'bg-[#fb923c]' },
  medium: { edge: 'border-l-[#ffc107]', stat: 'text-warn', text: 'text-warn-text', soft: 'bg-[rgba(255,193,7,0.12)]', fill: 'bg-[#facc15]' },
  low: { edge: 'border-l-[#20c997]', stat: 'text-[#0f766e]', text: 'text-[#0f766e]', soft: 'bg-[rgba(32,201,151,0.1)]', fill: 'bg-[#2dd4bf]' },
  info: { edge: 'border-l-[#6c757d]', stat: 'text-[#2563eb]', text: 'text-muted', soft: 'bg-[rgba(108,117,125,0.12)]', fill: 'bg-[#60a5fa]' },
}

const STATUS_OPTIONS: { id: string; label: string }[] = [
  { id: '', label: 'All statuses' },
  { id: 'drafts', label: 'Draft' },
  { id: 'review', label: 'In review' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'remediation', label: 'Remediation' },
  { id: 'ai', label: 'AI suggested' },
]

const SORT_OPTIONS: { id: string; label: string }[] = [
  { id: 'updated', label: 'Recently updated' },
  { id: 'created', label: 'Newest recorded' },
  { id: 'severity', label: 'Severity' },
  { id: 'id', label: 'ID' },
]

/** The finding record stores no category or confidence yet; the detail says so rather than showing a guessed value. */
function NotRecorded(): ReactNode {
  return <span className="text-muted" title="The finding record does not store this value yet">Not recorded</span>
}

function StatCard({ label, value, pct, severity, active, onClick, children }: {
  label: string; value: number; pct?: string; severity?: string; active: boolean; onClick: () => void; children?: ReactNode
}) {
  const style = severity ? SEV_STYLE[severity] : undefined
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={cx(
        'rounded-lg border border-line bg-panel p-4 text-center shadow-sm transition hover:shadow-md',
        style && cx('border-l-4', style.edge),
        active && 'ring-2 ring-primary/25',
      )}>
      <div className="text-sm text-muted">{label}</div>
      <div className={cx('mt-2 text-[2rem] font-bold leading-none tabular-nums', value === 0 ? 'text-muted opacity-50' : style?.stat ?? 'text-fg')}>{value}</div>
      {pct !== undefined && <div className="mt-1.5 text-[13px] font-medium tracking-wide text-muted">{pct}</div>}
      {children}
    </button>
  )
}

/** The total card's bar: one segment per severity, widths in proportion to the counts. */
function StackedBar({ counts, total }: { counts: Record<string, number>; total: number }) {
  return (
    <div className={cx('mt-3 flex h-[5px] gap-px overflow-hidden rounded-[3px] bg-line/60', total === 0 && 'opacity-35')} aria-hidden>
      {SEVS.map((s) => (counts[s] ?? 0) > 0 && <span key={s} className={SEV_STYLE[s].fill} style={{ flexGrow: counts[s], flexBasis: 0 }} />)}
    </div>
  )
}

function SeverityBadge({ severity }: { severity: string }) {
  const style = SEV_STYLE[severity]
  const label = sevLabel[severity as keyof typeof sevLabel] ?? severity
  return <span className={cx('inline-block rounded-xl px-3 py-1 text-xs font-semibold uppercase tracking-wide', style?.soft, style?.text)}>{label}</span>
}

/** Filters that rarely change sit behind a popover, as on the vulnerabilities tab. */
function MoreFilters({ children, active }: { children: ReactNode; active: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button size="sm" variant={active ? 'primary' : 'secondary'} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        More filters{active ? ` (${active})` : ''}
      </Button>
      {open && (
        <div role="dialog" aria-label="More filters" className="absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-xl border border-line bg-panel p-4 shadow-lg">
          {children}
          <div className="flex justify-end"><Button size="sm" onClick={() => setOpen(false)}>Done</Button></div>
        </div>
      )}
    </div>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  )
}

/**
 * One finding: the chevron expands its details in place, the title opens the finding in its own project. The severity
 * edge and badge follow the vulnerabilities tab.
 */
function FindingCard({ item, expanded, onToggle }: { item: FindingListItem; expanded: boolean; onToggle: () => void }) {
  const f = item.finding
  const style = SEV_STYLE[f.severity]
  const open = () => go('finding', { id: f.id, engagementId: f.projectId })
  return (
    <article className={cx('rounded-lg border border-l-4 border-line bg-panel p-5 shadow-sm transition hover:shadow-md', style?.edge)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} details of ${f.title}`} onClick={onToggle}
              className="shrink-0 rounded p-0.5 text-muted transition hover:text-accent">
              <ChevronRight size={16} aria-hidden className={cx('transition-transform', expanded && 'rotate-90')} />
            </button>
            <button type="button" onClick={open} className="min-w-0 break-words rounded text-left text-[17px] font-semibold hover:text-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
              {f.title}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
            <SeverityBadge severity={f.severity} />
            <Status kind="finding" value={f.status} size="sm" />
            <span className="rounded-full bg-subtle px-2.5 py-0.5 text-xs text-muted">Project: {item.projectName ?? f.projectId}</span>
            <Mono className="text-xs text-muted">{f.id}</Mono>
            <span className="whitespace-nowrap text-xs text-muted">Updated {f.updated}</span>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={open}>Open</Button>
      </div>
      {expanded && (
        <div className="mt-4 pl-6">
          <p className="text-sm leading-relaxed">{f.desc || <span className="text-muted">No description recorded.</span>}</p>
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
            <Detail label="Finding ID"><Mono>{f.id}</Mono></Detail>
            <Detail label="Project">{item.projectName ?? f.projectId}</Detail>
            <Detail label="Target">{item.target ? <Mono>{item.target}</Mono> : <NotRecorded />}</Detail>
            <Detail label="Category"><NotRecorded /></Detail>
            <Detail label="Confidence"><NotRecorded /></Detail>
            <Detail label="Technique">{f.technique ? <Mono>{f.technique}</Mono> : <span className="text-muted">None recorded</span>}</Detail>
            <Detail label="Recorded"><span className="text-muted">{f.date}</span></Detail>
          </dl>
        </div>
      )}
    </article>
  )
}

/**
 * Findings across every project the account can read: the vulnerabilities tab's layout (stat cards, filter panel, card
 * list) over the curated findings read. AI suggestions stay in their own project.
 */
export function AllFindings() {
  const [q, setQ] = useState('')
  const [sev, setSev] = useState('')
  const [status, setStatus] = useState('')
  const [prj, setPrj] = useState('')
  const [sort, setSort] = useState('updated')
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const list = useFindingList({
    q: q || undefined, severity: sev || undefined, status: status || undefined, project: prj || undefined,
    sort: sort !== 'updated' ? (sort as FindingSort) : undefined,
    page: page > 1 ? page : undefined,
  })
  useEffect(() => { setPage(1) }, [q, sev, status, prj, sort])
  const data: FindingListRead | undefined = list.data
  const rows = data?.items ?? []
  const summary = data?.summary
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const moreActive = [sev, sort !== 'updated' ? sort : ''].filter(Boolean).length
  const filtered = !!(q || sev || status || prj || sort !== 'updated')
  const reset = () => { setQ(''); setSev(''); setStatus(''); setPrj(''); setSort('updated') }
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const projectName = (id: string) => data?.projectLabels[id] ?? id
  const chips: { key: string; label: string; clear: () => void }[] = [
    ...(q ? [{ key: 'q', label: `Search: "${q}"`, clear: () => setQ('') }] : []),
    ...(prj ? [{ key: 'prj', label: `Project: ${projectName(prj)}`, clear: () => setPrj('') }] : []),
    ...(status ? [{ key: 'status', label: `Status: ${STATUS_OPTIONS.find((o) => o.id === status)?.label ?? status}`, clear: () => setStatus('') }] : []),
    ...(sev ? [{ key: 'sev', label: `Severity: ${sevLabel[sev as keyof typeof sevLabel]}`, clear: () => setSev('') }] : []),
    ...(sort !== 'updated' ? [{ key: 'sort', label: `Sort: ${SORT_OPTIONS.find((o) => o.id === sort)?.label ?? sort}`, clear: () => setSort('updated') }] : []),
  ]

  return (
    <div>
      {data?.truncated && <Banner tone="warn" title="List truncated">Only the newest findings are listed. Narrow the filters or open a project for the rest.</Banner>}
      <PageHeader
        title="Findings"
        sub="Findings across the projects you can access. AI suggestions are unverified, so the counts leave them out until a reviewer curates them."
        actions={<Button icon={RefreshCw} onClick={() => list.refetch()}>Refresh</Button>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total findings" value={summary?.total ?? 0} active={sev === ''} onClick={() => setSev('')}>
          {summary && <StackedBar counts={summary.severity} total={summary.total} />}
        </StatCard>
        {SEVS.map((s) => {
          const count = summary?.severity[s] ?? 0
          const total = summary?.total ?? 0
          return (
            <StatCard key={s} label={sevLabel[s]} value={count} severity={s} active={sev === s}
              pct={total ? `${Math.round((count / total) * 100)}%` : '—'} onClick={() => setSev(sev === s ? '' : s)} />
          )
        })}
      </div>
      <div className={cx('mb-3 rounded-xl border bg-panel p-2 shadow-sm', filtered ? 'border-primary/40' : 'border-line')}>
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={q} onChange={setQ} placeholder="Search title, ID or description…" className="min-w-[14rem] flex-1" />
          <Select aria-label="Project" value={prj} onChange={(e) => setPrj(e.target.value)} className="!w-auto min-w-[11rem]">
            <option value="">All projects</option>
            {Object.entries(data?.projectLabels ?? {}).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </Select>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto min-w-[10rem]">
            {STATUS_OPTIONS.map((o) => {
              const count = o.id ? data?.counts[o.id as keyof typeof data.counts] : data?.counts.all
              return <option key={o.id} value={o.id}>{count === undefined ? o.label : `${o.label} (${count})`}</option>
            })}
          </Select>
          <MoreFilters active={moreActive}>
            <label className="block space-y-1 text-sm">
              <span className="text-muted">Severity</span>
              <Select aria-label="Severity" value={sev} onChange={(e) => setSev(e.target.value)}>
                <option value="">All severities</option>
                {SEVS.map((s) => <option key={s} value={s}>{sevLabel[s]}</option>)}
              </Select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-muted">Sort</span>
              <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </Select>
            </label>
          </MoreFilters>
          {filtered && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset}>Reset all</Button>}
        </div>
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2" role="list" aria-label="Active filters">
            <span className="text-xs text-muted">Active filters</span>
            {chips.map((chip) => (
              <span key={chip.key} role="listitem" className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 py-0.5 pl-2.5 pr-1 text-xs">
                {chip.label}
                <button type="button" aria-label={`Remove filter ${chip.label}`} onClick={chip.clear} className="rounded-full p-0.5 text-muted hover:text-fg">
                  <X size={12} aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      {list.isPending ? (
        <div aria-busy="true" aria-label="Loading findings"><Skeleton className="h-72" /></div>
      ) : list.isError ? (
        <Empty icon={AlertTriangle} title="Could not load findings" action={<Button onClick={() => list.refetch()}>Retry</Button>}>
          {(list.error as FindingReadError).failure.message}
        </Empty>
      ) : (
        <>
          {rows.length ? (
            <ul aria-label="Findings" className="space-y-3">
              {rows.map((it) => (
                <li key={it.finding.id}>
                  <FindingCard item={it} expanded={expanded.has(it.finding.id)} onToggle={() => toggle(it.finding.id)} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={Bug} title={filtered ? 'No findings match the filters' : 'No findings yet'} action={filtered ? <Button onClick={reset}>Reset all</Button> : undefined}>
              {filtered ? 'Try removing some filters or the search term.' : 'No verified findings is a valid result. Findings are created from operation results, evidence or attack analysis — never invented to complete a report.'}
            </Empty>
          )}
          <Pager page={data?.page ?? 1} pages={pages} total={data?.total ?? 0} setPage={setPage} />
        </>
      )}
    </div>
  )
}
