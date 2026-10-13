import { useEffect, useState, type ComponentType } from 'react'
import { AlertTriangle, Copy, Download, Eye, FileText, History, Lock, Plus, Rocket, Send, Upload } from 'lucide-react'
import { useStore } from '../store'
import type { Template } from '../data'
import { Banner, Button, Card, Drawer, Empty, FilterBar, IdLink, Kpi, Mono, PageHeader, Pager, SearchBox, Select, Skeleton, Status, Table, Tabs, cx } from '../ui'
import { ReportNew, ReportEditor, ReportPreview, ReportReview, AiExclusion, reportChecks, type NoFind } from './f-report'
import { ReportReadError, useDeliveryHistory, useReportList, useTemplates } from '../features/reports/query'
import { SettingsPage } from './f-settings'

const PRIMARY: Record<string, { label: string; page: string; icon: typeof FileText }> = {
  draft: { label: 'Edit draft', page: 'report', icon: FileText },
  returned: { label: 'Revise', page: 'report', icon: FileText },
  review: { label: 'Review', page: 'report-review', icon: Eye },
  approved: { label: 'Export', page: 'report-review', icon: Download },
  exported: { label: 'Deliver', page: 'report-review', icon: Send },
  delivered: { label: 'View preview', page: 'report-preview', icon: Eye },
}

/** Shared read states for the migrated catalog tabs (ticket 34). */
function ReadError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <Empty icon={AlertTriangle} title="Could not load reports" action={<Button onClick={retry}>Retry</Button>}>
      {error instanceof ReportReadError ? error.failure.message : 'The report catalog is temporarily unavailable.'}
    </Empty>
  )
}

function ReportsPage() {
  const { route, go, pid, can, me, setSwitcherOpen } = useStore()
  const tab = route.tab || 'list'
  // Tab badges come from the typed reads; the ChangeSet bridge keeps every
  // tab live (a legacy export or status change refetches without a reload).
  const list = useReportList({})
  const tpls = useTemplates()
  const exportsQ = useDeliveryHistory({})
  const canCreate = pid !== 'all' && can('editReport')
  const whyNot = pid === 'all' ? 'Select a specific project to create a report.' : `Your role (${me.role}) cannot create reports, or the project is read-only. Ask a Red Team Manager or Operator to create one.`
  return (
    <>
      <PageHeader title="Reports" sub="Draft, review, approve, export and deliver assessment reports. Creating a draft is always allowed; Submit for Review is gated by policy."
        actions={<>
          <Button icon={FileText} onClick={() => go('reports', { tab: 'templates' })}>Templates</Button>
          <Button icon={History} onClick={() => go('reports', { tab: 'exports' })}>Export History</Button>
          <Button variant="primary" icon={Plus} disabled={!canCreate} title={canCreate ? undefined : whyNot} onClick={() => go('report-new')}>Create Draft</Button>
        </>} />
      {!canCreate && <p className="-mt-3 mb-4 flex items-center gap-1.5 text-xs text-muted"><Lock size={12} />{whyNot}{pid === 'all' && <button className="text-accent hover:underline" onClick={() => setSwitcherOpen(true)}>Select project</button>}</p>}
      {tab === 'list' && <AiExclusion projectId={pid === 'all' ? undefined : pid} />}
      <Tabs tabs={[
        { id: 'list', label: 'Reports', count: list.data?.total },
        { id: 'templates', label: 'Templates', count: tpls.data?.length },
        { id: 'exports', label: 'Delivery History', count: exportsQ.data?.total },
      ]} value={tab} onChange={(t) => go('reports', { tab: t })} />
      {tab === 'templates' ? <Templates /> : tab === 'exports' ? <Exports /> : <ReportList />}
    </>
  )
}

function ReportList() {
  const { go, pid, persistFilters, setFilter, can, me, db } = useStore()
  const [more, setMore] = useState(false)
  const [page, setPage] = useState(1)
  const nfAll = (persistFilters.repNoFind || {}) as Record<string, NoFind>
  const F = (persistFilters.repList || { q: '', st: '', proj: '', tpl: '', author: '' }) as { q: string; st: string; proj: string; tpl: string; author: string }
  const set = (patch: Partial<typeof F>) => setFilter('repList', { ...F, ...patch })
  const list = useReportList({
    status: F.st || undefined, project: F.proj || undefined, template: F.tpl || undefined, author: F.author || undefined,
    q: F.q || undefined, page: page > 1 ? page : undefined,
  })
  useEffect(() => { setPage(1) }, [F.q, F.st, F.proj, F.tpl, F.author])
  const data = list.data
  const counts = data?.counts
  const filtered = !!(F.q || F.st || F.proj || F.tpl || F.author)
  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Draft / Returned" value={counts?.open ?? 0} icon={FileText} />
        <Kpi label="In Review" value={counts?.review ?? 0} tone="warn" icon={Eye} />
        <Kpi label="Approved / Exported" value={counts?.approved ?? 0} tone="accent" icon={Rocket} />
        <Kpi label="Delivered" value={counts?.delivered ?? 0} tone="ok" icon={Send} />
      </div>
      <FilterBar>
        <SearchBox value={F.q} onChange={(q) => set({ q })} placeholder="Search by ID or title…" className="w-full sm:w-64" />
        {pid === 'all' && <Select aria-label="Project" className="w-44" value={F.proj} onChange={(e) => set({ proj: e.target.value })}><option value="">All projects</option>{(data?.projects ?? []).map((p) => <option key={p}>{p}</option>)}</Select>}
        <Select aria-label="Status" className="w-44" value={F.st} onChange={(e) => set({ st: e.target.value })}><option value="">All statuses</option>{(['draft', 'review', 'returned', 'approved', 'exported', 'delivered'] as const).map((s) => <option key={s} value={s}>{({ draft: 'Draft', review: 'In Review', returned: 'Returned', approved: 'Approved', exported: 'Exported', delivered: 'Delivered' })[s]}</option>)}</Select>
        <Button size="sm" variant={more || F.tpl || F.author ? 'primary' : 'secondary'} onClick={() => setMore(!more)} aria-expanded={more}>More filters{F.tpl || F.author ? ` (${[F.tpl, F.author].filter(Boolean).length})` : ''}</Button>
        {more && <>
          <Select aria-label="Template" className="w-48" value={F.tpl} onChange={(e) => set({ tpl: e.target.value })}><option value="">All templates</option>{(data?.templates ?? []).map((t) => <option key={t}>{t}</option>)}</Select>
          <Select aria-label="Author" className="w-44" value={F.author} onChange={(e) => set({ author: e.target.value })}><option value="">All authors</option>{(data?.authors ?? []).map((t) => <option key={t}>{t}</option>)}</Select>
        </>}
        {filtered && <Button variant="ghost" size="sm" onClick={() => { setPage(1); setFilter('repList', undefined) }}>Clear filters</Button>}
      </FilterBar>
      {list.isPending ? (
        <div aria-busy="true" aria-label="Loading reports"><Skeleton className="h-72" /></div>
      ) : list.isError ? (
        <ReadError error={list.error} retry={() => list.refetch()} />
      ) : (
        <>
          <Table rows={data!.items.map((it) => it.report)} rowKey={(r) => r.id} onRow={(r) => go('report', { id: r.id })}
            empty={data!.total === 0 && !filtered
              ? <Empty icon={FileText} title="No reports yet" action={<Button variant="primary" icon={Plus} disabled={pid === 'all' || !can('editReport')} title={pid === 'all' ? 'Select a project first' : undefined} onClick={() => go('report-new')}>Create Draft</Button>}>{pid === 'all' ? 'There are no reports in the projects you can access.' : 'This project has no reports yet. Create a draft now; it can be submitted once it has confirmed findings or a no-findings closure.'}</Empty>
              : <Empty icon={FileText} title="No reports match the filters" action={<Button onClick={() => { setPage(1); setFilter('repList', undefined) }}>Clear filters</Button>} />}
            cols={[
              { key: 't', header: 'Report Name', render: (r) => <div className="min-w-[220px]"><div className="font-medium">{r.title}</div><Mono className="whitespace-nowrap text-muted">{r.id}</Mono></div> },
              { key: 'p', header: 'Project', render: (r) => <IdLink onClick={() => go('project', { id: r.projectId })}>{r.projectId}</IdLink> },
              { key: 'tp', header: 'Template', hideBelow: 'lg', render: (r) => r.template },
              { key: 'a', header: 'Author', hideBelow: 'lg', render: (r) => r.author },
              { key: 'v', header: 'Version', render: (r) => <Mono className="whitespace-nowrap">{r.version}</Mono> },
              { key: 's', header: 'Status', render: (r) => {
                const open = r.status === 'draft' || r.status === 'returned'
                const bl = open ? reportChecks(db, r, nfAll[r.id]).filter((c) => c.state === 'fail') : []
                return <div className="whitespace-nowrap"><Status kind="report" value={r.status} />{open && <div className={cx('mt-0.5 text-[11px]', bl.length ? 'text-warn' : 'text-ok')} title={bl.map((c) => c.detail).join(' ')}>{bl.length ? `Submit blocked: ${bl[0].label}${bl.length > 1 ? ` +${bl.length - 1}` : ''}` : 'Ready to submit'}</div>}</div>
              } },
              { key: 'rv', header: 'Reviewer', hideBelow: 'lg', render: (r) => r.reviewer },
              { key: 'u', header: 'Updated', hideBelow: 'md', render: (r) => <span className="whitespace-nowrap text-muted">{r.updated}</span> },
              { key: 'd', header: 'Delivery Date', hideBelow: 'lg', render: (r) => <span className="whitespace-nowrap text-muted">{r.deliveredAt || '—'}</span> },
              { key: 'x', header: '', render: (r) => { const p = PRIMARY[r.status]; return <Button size="sm" icon={p.icon} onClick={(e) => { e.stopPropagation(); go(p.page, { id: r.id }) }} title={me.role === 'viewer' ? 'Read-only role' : undefined}>{p.label}</Button> } },
            ]} />
          <Pager page={data!.page} pages={Math.max(1, Math.ceil(data!.total / data!.pageSize))} total={data!.total} setPage={setPage} />
        </>
      )}
    </>
  )
}

function Templates() {
  const { go, me, toast, A, setFilter } = useStore()
  const tpls = useTemplates()
  const [sel, setSel] = useState<Template | null>(null)
  const admin = me.role === 'admin'
  const why = 'Only Organization Admins can create, duplicate or publish templates. Ask an admin to make the change.'
  const sim = (t: string) => toast(`${t} — simulated: the backend executes this and records an audit event.`, 'info')
  const use = (t: Template) => { setFilter('reportNewTemplate', t.name); go('report-new') }
  if (tpls.isPending) return <div aria-busy="true" aria-label="Loading templates"><Skeleton className="h-64" /></div>
  if (tpls.isError) return <ReadError error={tpls.error} retry={() => tpls.refetch()} />
  const templates = tpls.data!
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{templates.length} templates. Draft templates can be tried but cannot be used for formal delivery.</p>
        <Button icon={Plus} disabled={!admin} title={admin ? undefined : why} onClick={() => { sim('Create template'); A.audit('Created report template (simulated)', 'TP-new', '') }}>Create template</Button>
      </div>
      {!admin && <p className="-mt-2 mb-4 flex items-center gap-1.5 text-xs text-muted"><Lock size={12} />{why}</p>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {templates.map((t) => (
          <Card key={t.id} pad={false} className="flex flex-col overflow-hidden">
            <button onClick={() => setSel(t)} className="block h-36 border-b border-line bg-hover/50 p-4 text-left" aria-label={`View details for ${t.name}`}>
              <div className="mx-auto flex h-full w-24 flex-col justify-between rounded-sm bg-white p-2 shadow">
                <div><div className="h-1 w-10 rounded bg-slate-400" /><div className="mt-2 h-2 w-16 rounded bg-slate-800" /><div className="mt-1 h-1 w-14 rounded bg-slate-300" /></div>
                <div className="text-[7px] text-slate-500">{t.kind} · {t.version}</div>
              </div>
            </button>
            <div className="flex flex-1 flex-col gap-2 p-4">
              <div className="font-medium">{t.name}</div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted"><span>{t.kind}</span><span>·</span><span>{t.lang}</span><span>·</span><Mono className="whitespace-nowrap">{t.version}</Mono></div>
              <div className="flex flex-wrap gap-1.5"><span className={cx('inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px]', t.status === 'published' ? 'border-ok/30 bg-ok/10 text-ok' : 'border-neutral/30 bg-neutral/10 text-neutral')}>{t.status === 'published' ? 'Published' : 'Draft'}</span>{t.status !== 'published' && <span className="inline-flex w-fit rounded-full border border-warn/30 bg-warn/10 px-2 py-0.5 text-[11px] text-warn">Not for formal delivery</span>}</div>
              <div className="text-xs text-muted">Owner {t.owner} · {t.updated}</div>
              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                <Button size="sm" variant="primary" onClick={() => use(t)} title={t.status === 'published' ? undefined : 'Draft template: the report is tagged not for formal delivery'}>{t.status === 'published' ? 'Use template' : 'Try in Draft'}</Button>
                <Button size="sm" onClick={() => setSel(t)}>{t.status === 'published' ? 'Details' : 'Preview Draft'}</Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel?.name} footer={sel && <>
        <Button icon={Copy} disabled={!admin} title={admin ? undefined : why} onClick={() => { sim('Duplicate template'); A.audit('Duplicated report template (simulated)', sel.id, '') }}>Duplicate</Button>
        <Button icon={Upload} disabled={!admin || sel.status === 'published'} title={!admin ? why : sel.status === 'published' ? 'Template is already published' : undefined} onClick={() => { sim('Publish template'); A.audit('Published report template (simulated)', sel.id, '') }}>Publish</Button>
        <Button variant="primary" onClick={() => { use(sel) }}>{sel.status === 'published' ? 'Use template' : 'Try in Draft'}</Button>
      </>}>
        {sel && <div className="space-y-5">
          {sel.status !== 'published' && <Banner tone="warn" title="Template not approved">Reports using this template cannot be formally delivered.</Banner>}
          <div><div className="mb-2 text-xs font-medium text-muted">Default sections</div><ol className="space-y-1.5 text-sm">{sel.sections.map((s, i) => <li key={s} className="flex gap-2"><span className="w-5 text-neutral">{i + 1}</span>{s}</li>)}</ol></div>
          <div><div className="mb-2 text-xs font-medium text-muted">Mapped data sources</div><p className="text-sm">Objectives, scope and ROE, operations, verified findings, redacted evidence, coverage charts.</p></div>
          <div><div className="mb-2 text-xs font-medium text-muted">Usage guidance</div><p className="text-sm text-muted">Pick a template when creating a report. Only verified findings are included. Every report must be approved by a reviewer before export.</p></div>
        </div>}
      </Drawer>
    </>
  )
}

function Exports() {
  const { go, me, can, toast } = useStore()
  const [st, setSt] = useState('')
  const [page, setPage] = useState(1)
  const q = useDeliveryHistory({ status: st || undefined, page: page > 1 ? page : undefined })
  const data = q.data
  const dl = can('viewSensitive')
  return (
    <>
      <FilterBar>
        <Select aria-label="Export status" className="w-48" value={st} onChange={(e) => { setPage(1); setSt(e.target.value) }}><option value="">All statuses</option>{(data?.statuses ?? []).map((s) => <option key={s}>{s}</option>)}</Select>
      </FilterBar>
      <Banner tone="info" title="Exports are never replaced">Earlier exports are kept when a report is edited; a new export gets a new version and checksum.</Banner>
      {q.isPending ? (
        <div aria-busy="true" aria-label="Loading delivery history"><Skeleton className="h-64" /></div>
      ) : q.isError ? (
        <ReadError error={q.error} retry={() => q.refetch()} />
      ) : (
        <>
          <Table rows={data!.items} rowKey={(it) => it.rec.id} empty={<Empty icon={Download} title="No exports yet">A report must be approved before it can be exported to PDF or DOCX.</Empty>}
            cols={[
              { key: 'id', header: 'Job ID', render: (it) => <Mono className="whitespace-nowrap">{it.rec.id}</Mono> },
              { key: 'r', header: 'Report Name', render: (it) => <IdLink onClick={() => go('report-review', { id: it.rec.reportId })}>{it.rec.reportId}</IdLink> },
              { key: 'v', header: 'Version', render: (it) => <Mono className="whitespace-nowrap">{it.rec.version}</Mono> },
              { key: 'f', header: 'Format', render: (it) => it.rec.format },
              { key: 'by', header: 'Requested By', hideBelow: 'md', render: (it) => it.rec.by },
              { key: 'at', header: 'Timestamp', hideBelow: 'md', render: (it) => <span className="whitespace-nowrap text-muted">{it.rec.at}</span> },
              { key: 'rc', header: 'Recipient', hideBelow: 'lg', render: (it) => it.rec.recipient },
              { key: 's', header: 'Status', render: (it) => <Status kind="generic" value={it.rec.status === 'Delivered' ? 'ok' : it.rec.status === 'Completed' ? 'warn' : 'bad'} label={it.rec.status} /> },
              { key: 'c', header: 'Checksum', hideBelow: 'lg', render: (it) => <Mono className="whitespace-nowrap text-muted">{it.rec.checksum}</Mono> },
              { key: 'x', header: '', render: (it) => (
                <div className="flex gap-1.5">
                  <Button size="sm" icon={Eye} onClick={() => go('report-preview', { id: it.rec.reportId })}>View</Button>
                  <Button size="sm" icon={Download} disabled={!dl} title={dl ? undefined : 'Your role cannot download exports. Ask a Manager or Reviewer.'} onClick={() => toast(`Downloading ${it.rec.id}.${it.rec.format.toLowerCase()} (simulated, checksum ${it.rec.checksum})`, 'info')}>Download</Button>
                  <Button size="sm" icon={History} onClick={() => go('report-review', { id: it.rec.reportId })}>History</Button>
                </div>) },
            ]} />
          <Pager page={data!.page} pages={Math.max(1, Math.ceil(data!.total / data!.pageSize))} total={data!.total} setPage={setPage} />
        </>
      )}
      {me.role === 'viewer' && <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><Lock size={12} />The Client / Viewer role cannot download exports.</p>}
    </>
  )
}

export const routes: Record<string, ComponentType> = {
  reports: ReportsPage,
  'report-new': ReportNew,
  report: ReportEditor,
  'report-preview': ReportPreview,
  'report-review': ReportReview,
  settings: SettingsPage,
}
