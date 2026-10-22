import { useEffect, useState } from 'react'
import { Download, Eye, FileText, History, Lock, Plus, Rocket, Send } from 'lucide-react'
import { Banner, Button, Empty, FilterBar, IdLink, Kpi, Mono, PageHeader, Pager, SearchBox, Select, Skeleton, Status, Table, Tabs, cx } from '../../../ui/index'
import type { NoFind } from '../service';
import { useReportValidation } from '../projection'
import { ReadError } from './read-error'
import { SimulatedTemplates } from './simulated-templates'
import { useDeliveryHistory, useReportCapabilities, useReportList, useTemplates } from '../query'
import { TemplateCreateForm } from './template-create-form';
import { AiExclusion } from './report-pages'
import { go, useRoute } from '../../../router/navigate'
import { useCan, useMe } from '../../../state/console'
import { useProjectStore, useToastStore } from '../../../state/stores'
import { useSessionStore } from '../../../state/session'

const PRIMARY: Record<string, { label: string; page: string; icon: typeof FileText }> = {
  draft: { label: 'Edit draft', page: 'report', icon: FileText },
  returned: { label: 'Revise', page: 'report', icon: FileText },
  review: { label: 'Review', page: 'report-review', icon: Eye },
  approved: { label: 'Export', page: 'report-review', icon: Download },
  exported: { label: 'Deliver', page: 'report-review', icon: Send },
  delivered: { label: 'View preview', page: 'report-preview', icon: Eye },
}

/** Shared read states for the migrated catalog tabs (ticket 34). */

export function ReportsPage() {
  const caps = useReportCapabilities()
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const can = useCan()
  const me = useMe()
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
          {!caps.storedTemplates && <Button icon={FileText} onClick={() => go('reports', { tab: 'templates' })}>Templates</Button>}
          <Button icon={History} onClick={() => go('reports', { tab: 'exports' })}>Export History</Button>
          {pid !== 'all' && <Button variant="primary" icon={Plus} disabled={!canCreate} title={canCreate ? undefined : whyNot} onClick={() => go('report-new')}>Create Draft</Button>}
        </>} />
      {pid !== 'all' && !canCreate && <p className="-mt-3 mb-4 flex items-center gap-1.5 text-xs text-muted"><Lock size={12} />{whyNot}</p>}
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
  const pid = useProjectStore((s) => s.pid)
  const persistFilters = useSessionStore((s) => s.persistFilters)
  const setFilter = useSessionStore((s) => s.setFilter)
  const can = useCan()
  const me = useMe()
  const validation = useReportValidation()
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
                const bl = open ? validation.checks(r, nfAll[r.id]).filter((c) => c.state === 'fail') : []
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

/** Real-mode template gallery (P06): the versioned templates the server holds, and an admin/manager create form. */
function RealTemplates() {
  const me = useMe()
  const tpls = useTemplates()
  const [creating, setCreating] = useState(false)
  const allowed = me.role === 'admin' || me.role === 'manager'
  const why = 'Only organization admins and managers can create report templates.'

  if (tpls.isPending) return <div aria-busy="true" aria-label="Loading templates"><Skeleton className="h-64" /></div>
  if (tpls.isError) return <ReadError error={tpls.error} retry={() => tpls.refetch()} />
  const templates = tpls.data!
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{templates.length} templates. Each save is a new immutable version; a report pins the version it uses.</p>
        <Button icon={Plus} disabled={!allowed} title={allowed ? undefined : why} onClick={() => setCreating(true)}>New template</Button>
      </div>
      {!allowed && <p className="-mt-2 mb-4 flex items-center gap-1.5 text-xs text-muted"><Lock size={12} />{why}</p>}
      {creating && <TemplateCreateForm requireAll onDone={() => { setCreating(false); void tpls.refetch() }} onCancel={() => setCreating(false)} />}
      {templates.length === 0 ? <Empty title="No templates yet">Create the first template before drafting a report.</Empty> : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {templates.map((t) => <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"><span className="font-medium">{t.name}</span><span className="text-muted">{t.version}</span><span className="text-muted">owner {t.owner}</span></li>)}
        </ul>
      )}
    </>
  )
}

/** Simulated template gallery: mock-only authority; real mode never reaches it. */
function Templates() {
  const caps = useReportCapabilities()
  return caps.storedTemplates ? <RealTemplates /> : <SimulatedTemplates />
}


function Exports() {
  const me = useMe()
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
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
