import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Bug, Sparkles, Plus, RotateCcw } from 'lucide-react'
import { sevLabel, SEVS, type FindingListItem, type FindingSort } from './service'
import { type Finding } from '../../domain/entities'
import { FindingReadError, useFindingList } from './query'
import { useAiActions } from './ai-actions'
import { useCreateReason } from './create-reason'
import {
  Banner, Button, cx, Empty, Kpi, Locked, Mono, PageHeader, Pager, SearchBox, Select, Sev, Skeleton, Status, Tabs,
} from '../../ui/index'
import { go, useRoute } from '../../router/navigate'
import { useActiveProject } from '../../state/console'
import { useProjectStore } from '../../state/stores'

/** Status tabs; the scoped counts come from the findings read model (ticket 31). */
const TABS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'review', label: 'In Review' },
  { id: 'ai', label: 'AI Suggestions' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'remediation', label: 'Remediation' },
]

/** Severity colours follow the shared status tones: critical and high share the danger hue, differing in strength. */
const SEV_FILL: Record<string, string> = { critical: 'bg-bad', high: 'bg-bad/70', medium: 'bg-warn', low: 'bg-cyan', info: 'bg-neutral' }
const SEV_EDGE: Record<string, string> = { critical: 'border-l-bad', high: 'border-l-bad/70', medium: 'border-l-warn', low: 'border-l-cyan', info: 'border-l-neutral' }

/* ───────────── FI-01: list ───────────── */

/**
 * Curated findings by severity: a stacked bar and one button per severity. The buttons filter the list, and AI suggestions
 * are not in these counts (the read model excludes them until a human verifies them).
 */
function SeverityDistribution({ counts, selected, onPick }: { counts: Record<string, number>; selected: string; onPick: (s: string) => void }) {
  const total = SEVS.reduce((n, s) => n + (counts[s] ?? 0), 0)
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)
  return (
    <section aria-labelledby="severity-distribution-title" className="rounded-xl border border-line bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="severity-distribution-title" className="text-sm font-semibold">Severity distribution</h3>
        <span className="text-xs text-muted">{total} curated {total === 1 ? 'finding' : 'findings'} · AI suggestions not included</span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
        {SEVS.map((s) => (counts[s] ?? 0) > 0 && <span key={s} className={SEV_FILL[s]} style={{ width: `${pct(counts[s] ?? 0)}%` }} />)}
      </div>
      <div role="group" aria-label="Filter by severity" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {SEVS.map((s) => {
          const on = selected === s
          return (
            <button key={s} type="button" aria-pressed={on} onClick={() => onPick(s)}
              className={cx('flex min-w-0 flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition hover:bg-hover', on ? 'border-accent bg-accent-soft' : 'border-line')}>
              <span className="flex max-w-full items-center gap-1.5 text-xs text-muted"><span className={cx('size-2 shrink-0 rounded-full', SEV_FILL[s])} aria-hidden /><span className="truncate">{sevLabel[s]}</span></span>{' '}
              <span className="flex items-baseline gap-1.5 tabular-nums"><span className="text-lg font-semibold">{counts[s] ?? 0}</span>{' '}<span className="text-xs text-muted">{pct(counts[s] ?? 0)}%</span></span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  )
}

/**
 * One finding as a card: severity edge, identifiers and status in the header, the title and the description, then the
 * record's own scope fields. The whole card opens the finding; the AI actions stop propagation.
 */
function FindingCard({ item, showProject, action }: { item: FindingListItem; showProject: boolean; action?: ReactNode }) {
  const f = item.finding
  const producerNeedsReview = !!f.producer && Object.values(f.producer.quality ?? {}).some(Boolean)
  return (
    <article onClick={() => go('finding', { id: f.id })}
      className={cx('cursor-pointer rounded-xl border border-l-4 border-line bg-panel p-4 transition hover:bg-hover', SEV_EDGE[f.severity])}>
      <div className="flex flex-wrap items-center gap-2">
        <Mono className="text-accent">{f.id}</Mono>
        <Sev v={f.severity} />
        <Status kind="finding" value={f.status} size="sm" />
        {f.suggestionDisposition?.dismissed && <span className="text-xs text-muted">dismissed</span>}
        {f.technique && <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted">{f.technique}</span>}
        <span className="ml-auto whitespace-nowrap text-xs text-muted">Updated {f.updated}</span>
      </div>
      <h3 className="mt-2 text-[15px] font-semibold leading-snug">
        <button type="button" className="rounded text-left hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">{f.title}</button>
      </h3>
      {f.desc && <p className="mt-1 line-clamp-2 text-sm text-muted">{f.desc}</p>}
      <dl className={cx('mt-3 grid gap-x-6 gap-y-3 text-sm', showProject ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4')}>
        {showProject && (
          <Meta label="Project">
            <Mono>{f.projectId}</Mono>
            {item.projectClient && <div className="truncate text-xs text-muted">{item.projectClient}</div>}
          </Meta>
        )}
        <Meta label="Asset"><Mono>{f.asset}</Mono></Meta>
        <Meta label="Operation"><Mono>{f.op}</Mono></Meta>
        <Meta label="Owner">{f.owner}</Meta>
        <Meta label="Recorded"><span className="text-muted">{f.date}</span></Meta>
      </dl>
      {producerNeedsReview && <p className="mt-3 text-xs text-warn">Producer source needs review</p>}
      {action && <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>{action}</div>}
    </article>
  )
}

/**
 * Findings list (ticket 31): search/severity/status filters, pagination and
 * the severity/tab counts run on the typed findings service through Query —
 * scope-keyed cache entries, ChangeSet invalidation (a legacy status change
 * updates these views without a reload) and cancel-on-switch come from the
 * shared bridges. AI suggestions are presented as proposals: they are
 * excluded from the severity KPIs until a human verifies them, and
 * dismissal is persisted per actor in real mode. Creation and
 * the detail form still use the bridged legacy routes (owner: ticket 32).
 */
export function FindingList() {
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const project = useActiveProject()
  const ai = useAiActions()
  const [q, setQ] = useState('')
  const [sev, setSev] = useState('')
  const [tab, setTab] = useState(route.tab && TABS.some((t) => t.id === route.tab) ? route.tab : 'all')
  const [prj, setPrj] = useState('')
  const [owner, setOwner] = useState('')
  const [asset, setAsset] = useState('')
  const [opf, setOpf] = useState('')
  const [showDis, setShowDis] = useState(false)
  const [sort, setSort] = useState('updated')
  const [page, setPage] = useState(1)
  const reason = useCreateReason()
  const list = useFindingList({
    q: q || undefined, severity: sev || undefined, status: tab !== 'all' ? tab : undefined,
    project: prj || undefined, owner: owner || undefined, asset: asset || undefined, op: opf || undefined,
    sort: sort !== 'updated' ? (sort as FindingSort) : undefined,
    showDismissed: showDis,
    page: page > 1 ? page : undefined,
  })
  useEffect(() => { setPage(1) }, [q, sev, tab, prj, owner, asset, opf, sort, showDis])
  const data = list.data
  const rows = data?.items ?? []
  const filtered = !!(q || sev || prj || owner || asset || opf || tab !== 'all')
  const reset = () => { setQ(''); setSev(''); setTab('all'); setPrj(''); setOwner(''); setAsset(''); setOpf(''); setSort('updated') }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  const aiActions = (f: Finding) => {
    const w = ai.why(f)
    const dismissWhy = ai.dismissWhy(f)
    return f.suggestionDisposition?.dismissed ? <Button size="sm" variant="ghost" onClick={() => { void ai.restore(f) }}>Restore</Button> : (
      <>
        <Button size="sm" variant="primary" disabled={!!w} title={w || 'Verify the suggestion and create a finding in review'} onClick={() => ai.verify(f)}>Verify & create finding</Button>
        <Button size="sm" disabled={!!dismissWhy} title={dismissWhy || 'Dismiss with a reason'} onClick={() => ai.dismiss(f)}>Dismiss</Button>
      </>
    )
  }

  return (
    <div>
      {data?.truncated && <Banner tone="warn" title="List truncated">The producer projection is incomplete; finding sources may have been skipped.</Banner>}
      <PageHeader
        title="Findings"
        sub={pid === 'all' ? 'All findings across the projects you can access (read-only aggregate). Creating one requires a specific project.' : `Findings for ${project?.id} — ${project?.name}. KPIs count verified findings only.`}
        actions={pid !== 'all' && <Button variant="primary" icon={Plus} disabled={!!reason} title={reason || 'Create a new finding'} onClick={() => go('finding-new')}>Create Finding</Button>}
      />
      {pid !== 'all' && reason && <div className="-mt-3 mb-4 flex justify-end"><Locked reason={reason} /></div>}
      <div className="mb-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <SeverityDistribution counts={data?.severity ?? {}} selected={sev} onPick={(s) => setSev(sev === s ? '' : s)} />
        <div className="grid grid-cols-3 gap-3">
          <Kpi label="Awaiting Review" value={data?.awaitingReview ?? 0} tone="warn" onClick={() => setTab('review')} />
          <Kpi label="Resolved" value={data?.resolved ?? 0} tone="ok" onClick={() => setTab('remediation')} />
          <Kpi label="AI Suggestions" value={data?.counts.ai ?? 0} sub="Not counted until verified" tone="warn" onClick={() => setTab('ai')} />
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={TABS.map((t) => ({ id: t.id, label: t.label, count: data?.counts[t.id as keyof typeof data.counts] ?? 0 }))} />
      <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <SearchBox value={q} onChange={setQ} placeholder="Search by ID or title…" className="sm:col-span-2" />
        <Select aria-label="Severity" value={sev} onChange={(e) => setSev(e.target.value)}><option value="">All severities</option>{SEVS.map((s) => <option key={s} value={s}>{sevLabel[s]}</option>)}</Select>
        <Select aria-label="Operation" value={opf} onChange={(e) => setOpf(e.target.value)}><option value="">All operations</option>{(data?.ops ?? []).map((o) => <option key={o}>{o}</option>)}</Select>
        {pid === 'all' && <Select aria-label="Project" value={prj} onChange={(e) => setPrj(e.target.value)}><option value="">All projects</option>{(data?.projects ?? []).map((p) => <option key={p} value={p}>{p}</option>)}</Select>}
        <Select aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">All owners</option>{(data?.owners ?? []).map((o) => <option key={o}>{o}</option>)}</Select>
        <Select aria-label="Asset" value={asset} onChange={(e) => setAsset(e.target.value)}><option value="">All assets</option>{(data?.assets ?? []).map((o) => <option key={o}>{o}</option>)}</Select>
        <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}><option value="updated">Sort: recently updated</option><option value="created">Sort: newest recorded</option><option value="severity">Sort: severity</option><option value="id">Sort: ID</option></Select>
      </div>
      {filtered && <div className="mb-3 flex justify-end"><Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset}>Reset filters</Button></div>}
      {tab === 'ai' && (
        <div className="mb-3 space-y-2">
          <Banner tone="warn" icon={Sparkles} title="AI suggestions are not curated findings">They are excluded from confirmed counts, severity charts and reports until a human verifies them.</Banner>
          {(data?.dismissedCount ?? 0) > 0 && <label className="flex cursor-pointer items-center gap-2 text-xs text-muted"><input type="checkbox" className="accent-[var(--c-accent)]" checked={showDis} onChange={(e) => setShowDis(e.target.checked)} />Show dismissed suggestions ({data?.dismissedCount ?? 0})</label>}
        </div>
      )}
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
                  <FindingCard item={it} showProject={pid === 'all'} action={tab === 'ai' ? aiActions(it.finding) : undefined} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={tab === 'ai' ? Sparkles : Bug} title={tab === 'ai' ? 'No AI suggestions to review' : filtered ? 'No findings match the filters' : 'No findings yet'} action={filtered ? <Button onClick={reset}>Reset filters</Button> : <Button variant="primary" icon={Plus} disabled={!!reason} title={reason} onClick={() => go('finding-new')}>Create Finding</Button>}>
              {tab === 'ai' ? 'AI suggestions appear here when the AI Operator spots a possible gap in an operation.' : filtered ? 'Try removing some filters or the search term.' : 'No verified findings is a valid result. Findings are created from operation results, evidence or attack analysis — never invented to complete a report.'}
            </Empty>
          )}
          <Pager page={data?.page ?? 1} pages={pages} total={data?.total ?? 0} setPage={setPage} />
        </>
      )}
    </div>
  )
}
