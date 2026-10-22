import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Bug, Sparkles, Plus, RotateCcw } from 'lucide-react'
import { sevLabel, SEVS } from './service'
import { type Finding } from '../../domain/entities'
import { FindingReadError, useFindingList } from './query'
import type { FindingSort } from './service'
import { useAiActions } from './ai-actions'
import { useCreateReason } from './create-reason'
import {
  Banner, Button, Empty, Field, FilterBar, Kpi, Locked, Mono, PageHeader, Pager, SearchBox, Select, Sev, Skeleton, Status, Table, Tabs,
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

/* ───────────── FI-01: list ───────────── */

function MoreFilters({ children, active }: { children: ReactNode; active: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button size="sm" variant={active ? 'primary' : 'secondary'} aria-expanded={open} onClick={() => setOpen(!open)}>More filters{active ? ` (${active})` : ''}</Button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-xl border border-line bg-panel p-4 shadow-lg">
          {children}
          <div className="flex justify-end"><Button size="sm" onClick={() => setOpen(false)}>Done</Button></div>
        </div>
      )}
    </div>
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
  const listTabs = TABS
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
  const moreActive = [prj, owner, asset, sort !== 'updated' ? sort : ''].filter(Boolean).length
  const filtered = !!(q || sev || prj || owner || asset || opf || tab !== 'all')
  const reset = () => { setQ(''); setSev(''); setTab('all'); setPrj(''); setOwner(''); setAsset(''); setOpf(''); setSort('updated') }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div>
      {data?.truncated && <Banner tone="warn" title="List truncated">The producer projection is incomplete; finding sources may have been skipped.</Banner>}
      <PageHeader
        title="Findings"
        sub={pid === 'all' ? 'All findings across the projects you can access (read-only aggregate). Creating one requires a specific project.' : `Findings for ${project?.id} — ${project?.name}. KPIs count verified findings only.`}
        actions={pid !== 'all' && <Button variant="primary" icon={Plus} disabled={!!reason} title={reason || 'Create a new finding'} onClick={() => go('finding-new')}>Create Finding</Button>}
      />
      {pid !== 'all' && reason && <div className="-mt-3 mb-4 flex justify-end"><Locked reason={reason} /></div>}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {SEVS.map((s) => <Kpi key={s} label={sevLabel[s]} value={data?.severity[s] ?? 0} tone={s === 'critical' || s === 'high' ? 'bad' : s === 'medium' ? 'warn' : s === 'low' ? 'cyan' : 'neutral'} onClick={() => setSev(sev === s ? '' : s)} />)}
        <Kpi label="Awaiting Review" value={data?.awaitingReview ?? 0} tone="warn" onClick={() => setTab('review')} />
        <Kpi label="Resolved" value={data?.resolved ?? 0} tone="ok" onClick={() => setTab('remediation')} />
        <Kpi label="AI Suggestions" value={data?.counts.ai ?? 0} sub="not curated — not in counts" tone="warn" onClick={() => setTab('ai')} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={listTabs.map((t) => ({ id: t.id, label: t.label, count: data?.counts[t.id as keyof typeof data.counts] ?? 0 }))} />
      <FilterBar right={filtered ? <Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset}>Reset</Button> : undefined}>
        <SearchBox value={q} onChange={setQ} placeholder="Search by ID or title…" className="w-full sm:w-64" />
        <Select aria-label="Severity" value={sev} onChange={(e) => setSev(e.target.value)} className="!w-auto"><option value="">All severities</option>{SEVS.map((s) => <option key={s} value={s}>{sevLabel[s]}</option>)}</Select>
        <Select aria-label="Operation" value={opf} onChange={(e) => setOpf(e.target.value)} className="!w-auto"><option value="">All operations</option>{(data?.ops ?? []).map((o) => <option key={o}>{o}</option>)}</Select>
        <MoreFilters active={moreActive}>
          {pid === 'all' && <Field label="Project"><Select value={prj} onChange={(e) => setPrj(e.target.value)}><option value="">All projects</option>{(data?.projects ?? []).map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>}
          <Field label="Owner"><Select value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">All owners</option>{(data?.owners ?? []).map((o) => <option key={o}>{o}</option>)}</Select></Field>
          <Field label="Asset"><Select value={asset} onChange={(e) => setAsset(e.target.value)}><option value="">All assets</option>{(data?.assets ?? []).map((o) => <option key={o}>{o}</option>)}</Select></Field>
          <Field label="Sort"><Select value={sort} onChange={(e) => setSort(e.target.value)}><option value="updated">Recently updated</option><option value="created">Newest recorded</option><option value="severity">Severity</option><option value="id">ID</option></Select></Field>
        </MoreFilters>
      </FilterBar>
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
          <Table
            rows={rows} rowKey={(it) => it.finding.id} onRow={(it) => go('finding', { id: it.finding.id })}
            empty={
              <Empty icon={tab === 'ai' ? Sparkles : Bug} title={tab === 'ai' ? 'No AI suggestions to review' : filtered ? 'No findings match the filters' : 'No findings yet'} action={filtered ? <Button onClick={reset}>Reset filters</Button> : <Button variant="primary" icon={Plus} disabled={!!reason} title={reason} onClick={() => go('finding-new')}>Create Finding</Button>}>
                {tab === 'ai' ? 'AI suggestions appear here when the AI Operator spots a possible gap in an operation.' : filtered ? 'Try removing some filters or the search term.' : 'No verified findings is a valid result. Findings are created from operation results, evidence or attack analysis — never invented to complete a report.'}
              </Empty>
            }
            cols={[
              { key: 'id', header: 'Finding ID', render: (it) => <span className="whitespace-nowrap"><Mono className="text-accent">{it.finding.id}</Mono></span> },
              { key: 't', header: 'Title', render: (it) => <div className="max-w-[300px]" title={it.finding.title}><div className="truncate font-medium">{it.finding.title}</div>{it.finding.producer && Object.values(it.finding.producer.quality ?? {}).some(Boolean) && <div className="mt-1 text-[11px] text-warn">Producer source needs review</div>}</div> },
              { key: 'p', header: 'Project', hideBelow: 'md', render: (it) => <div className="whitespace-nowrap"><Mono>{it.finding.projectId}</Mono><div className="text-xs text-muted">{it.projectClient}</div></div> },
              { key: 'sev', header: 'Severity', render: (it) => <span className="whitespace-nowrap"><Sev v={it.finding.severity} /></span> },
              { key: 'a', header: 'Affected asset', hideBelow: 'lg', render: (it) => <span className="whitespace-nowrap"><Mono>{it.finding.asset}</Mono></span> },
              { key: 'op', header: 'Operation', hideBelow: 'lg', render: (it) => <span className="whitespace-nowrap"><Mono>{it.finding.op}</Mono></span> },
              { key: 'o', header: 'Owner', hideBelow: 'md', render: (it) => <span className="whitespace-nowrap">{it.finding.owner}</span> },
              { key: 's', header: 'Status', render: (it) => <span className="whitespace-nowrap"><Status kind="finding" value={it.finding.status} />{it.finding.suggestionDisposition?.dismissed && <span className="ml-1.5 text-xs text-muted">dismissed</span>}</span> },
              { key: 'u', header: 'Updated', hideBelow: 'lg', render: (it) => <span className="whitespace-nowrap text-xs text-muted">{it.finding.updated}</span> },
              ...(tab === 'ai' ? [{ key: 'act', header: 'Actions', render: (it: { finding: Finding }) => {
                const f = it.finding
                const w = ai.why(f)
                const dismissWhy = ai.dismissWhy(f)
                return f.suggestionDisposition?.dismissed ? <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); void ai.restore(f) }}>Restore</Button> : (
                  <div className="flex gap-1.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="primary" disabled={!!w} title={w || 'Verify the suggestion and create a finding in review'} onClick={() => ai.verify(f)}>Verify & create finding</Button>
                    <Button size="sm" disabled={!!dismissWhy} title={dismissWhy || 'Dismiss with a reason'} onClick={() => ai.dismiss(f)}>Dismiss</Button>
                  </div>
                )
              } }] : []),
            ]}
          />
          <Pager page={data?.page ?? 1} pages={pages} total={data?.total ?? 0} setPage={setPage} />
        </>
      )}
    </div>
  )
}
