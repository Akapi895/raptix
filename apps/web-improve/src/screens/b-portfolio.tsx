/**
 * Project portfolio (ticket 16, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The migrated project list: search/status/owner/client filters, pagination,
 * CSV export and pinning run on the typed project service through Query —
 * scope-keyed cache entries, ChangeSet invalidation and cancel-on-switch
 * come from the shared bridges, never from this screen. Creation and the
 * wizard/detail links still use the bridged legacy routes (owners 17–20).
 * Authorization reasons come from the shared permission policy (ticket 06).
 *
 * The readiness column and CSV enrichment reuse the store's `eligibility`
 * helper: execution readiness derives from operations/assets/agents owned by
 * later tickets, so the portfolio consumes the established projection until
 * those handlers migrate.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Download, Eye, FolderPlus, MoreHorizontal, Pencil, Pin, PinOff, Plus, SlidersHorizontal } from 'lucide-react'
import { useServices } from '../store'
import { eligibility } from '../features/operations/preflight'
import { readOnlyContext } from '../auth/policy'
import type { Project } from '../domain/entities'
import { consoleKeys, useQueryScope } from '../state/keys'
import { useCan, useDb, useMe } from '../state/console'
import { useSessionStore } from '../state/session'
import { useProjectStore, useToastStore } from '../state/stores'
import { go } from '../router/navigate'
import { Button, Empty, FilterBar, IdLink, Locked, Menu, PageHeader, Pager, Person, SearchBox, Select, Skeleton, Status, Table, usePaged, type Col } from '../ui'
import { createPortfolioHandlers, ServiceReadError } from './portfolio-handlers'

const ST = [['draft', 'Draft'], ['pending', 'Pending Approval'], ['approved', 'Approved'], ['active', 'Active'], ['review', 'Closing'], ['paused', 'Paused'], ['rejected', 'Rejected'], ['closed', 'Closed']]

interface PrjFilters { q: string; status: string; type: string; owner: string; client: string }
const EMPTY_FILTERS: PrjFilters = { q: '', status: '', type: '', owner: '', client: '' }

export function ProjectPortfolio() {
  const svc = useServices()
  const db = useDb()
  const me = useMe()
  const pid = useProjectStore((s) => s.pid)
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const persistFilters = useSessionStore((s) => s.persistFilters)
  const setFilter = useSessionStore((s) => s.setFilter)
  const scope = useQueryScope()
  const [more, setMore] = useState(false)

  const handlers = useMemo(
    () => createPortfolioHandlers(svc, { id: scope.actor, role: scope.role }, scope.project),
    [svc, scope.actor, scope.role, scope.project],
  )
  const list = useQuery({
    queryKey: consoleKeys.list('project', scope),
    queryFn: async () => {
      const res = await handlers.listAccessible()
      if (!res.ok) throw new ServiceReadError(res.failure)
      return res.data.items
    },
  })
  const accessible = useMemo(() => list.data ?? [], [list.data])

  const f: PrjFilters = { ...EMPTY_FILTERS, ...(persistFilters.prj || {}) }
  const set = (k: keyof PrjFilters, v: string) => setFilter('prj', { ...f, [k]: v })
  const clear = () => setFilter('prj', EMPTY_FILTERS)
  const viewer = me.role === 'viewer'
  const canCreate = can('createProject')

  const types = useMemo(() => Array.from(new Set(accessible.map((p) => p.type))), [accessible])
  const clients = useMemo(() => Array.from(new Set(accessible.map((p) => p.client))), [accessible])
  const owners = useMemo(() => Array.from(new Set(accessible.map((p) => p.owner))), [accessible])
  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    return accessible
      .filter((p) => (!f.status || p.status === f.status) && (!f.type || p.type === f.type) && (!f.owner || p.owner === f.owner) && (!f.client || p.client === f.client) && (!q || [p.id, p.name, p.client].some((x) => x.toLowerCase().includes(q))))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned))
  }, [accessible, f.q, f.status, f.type, f.owner, f.client])
  const pg = usePaged(rows, 8)
  const filtered = !!(f.q || f.status || f.type || f.owner || f.client)

  const open = (p: Project, tab?: string) => go('project', { id: p.id, tab })

  const pin = useMutation({
    mutationFn: (p: Project) => handlers.setPinned(p.id, !p.pinned),
    onSuccess: (res, p) => {
      if (res.ok) toast(res.data.pinned ? `Pinned ${p.id}` : `Unpinned ${p.id}`)
      else toast(res.failure.message, 'bad')
    },
  })

  const opCount = (id: string) => db.operations.filter((o) => o.projectId === id).length
  const exportCsv = () => {
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`
    const head = ['Project ID', 'Name', 'Client', 'Type', 'Owner', 'Start', 'End', 'Operations', 'ROE', 'Execution Readiness', 'Status', 'Updated']
    const body = rows.map((p) => [p.id, p.name, p.client, p.type, p.owner, p.start, p.end, String(opCount(p.id)), `${p.roeVersion} ${p.roeStatus}`, eligibility(db, p.id).label, p.status, p.updated].map(esc).join(','))
    const blob = new Blob(['﻿' + [head.map(esc).join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = 'projects.csv'; a.click(); URL.revokeObjectURL(a.href)
    toast(`Exported ${rows.length} projects (demo data)`)
  }

  const cols: Col<Project>[] = [
    { key: 'id', header: 'Project ID', render: (p) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[13px]">{p.pinned && <Pin size={12} className="text-accent" aria-label="Pinned" />}<IdLink onClick={() => open(p)}>{p.id}</IdLink></span> },
    { key: 'name', header: 'Name', render: (p) => <span className="font-medium">{p.name}</span> },
    { key: 'client', header: 'Client', render: (p) => p.client, hideBelow: 'md' },
    { key: 'type', header: 'Type', render: (p) => <span className="whitespace-nowrap text-muted">{p.type}</span>, hideBelow: 'lg' },
    { key: 'owner', header: 'Owner', render: (p) => <span className="whitespace-nowrap"><Person name={p.owner} /></span>, hideBelow: 'lg' },
    { key: 'roe', header: 'ROE', render: (p) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="font-mono text-xs">{p.roeVersion}</span><Status kind="roe" value={p.roeStatus} size="sm" /></span>, hideBelow: 'md' },
    {
      key: 'elig', header: 'Execution Readiness', render: (p) => {
        const e = eligibility(db, p.id)
        const t = e.tone === 'cyan' ? 'ok' : e.tone
        return <span title={e.reasons.map((r) => r.text).join('; ') || undefined}><Status kind="generic" value={t} size="sm" label={e.label} /></span>
      },
    },
    { key: 'st', header: 'Status', render: (p) => <Status kind="project" value={p.status} /> },
    { key: 'up', header: 'Updated', render: (p) => <span className="whitespace-nowrap font-mono text-xs text-muted">{p.updated}</span>, hideBelow: 'lg' },
    {
      key: 'act', header: '', render: (p) => {
        const edit = can('editScope', p.id)
        const actor = { id: me.name, role: me.role }
        const ro = readOnlyContext(p, actor)
        return (
          <span className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" icon={Eye} onClick={() => open(p)}>View Details</Button>
            {/* Ticket 64: a real button — the span was unfocusable, so the row menu could not be opened by keyboard at all. */}
            <Menu trigger={<button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-hover" aria-label={`More actions for ${p.id}`}><MoreHorizontal size={16} /></button>} items={[
              { label: 'Edit Project', icon: Pencil, disabled: !edit, hint: edit ? undefined : 'Requires permission to edit scope', onClick: () => open(p, 'scope') },
              { label: p.pinned ? 'Unpin' : 'Pin to top', icon: p.pinned ? PinOff : Pin, disabled: ro, hint: ro ? (viewer ? 'Viewers have read-only access' : 'This project is closed or cancelled and is read-only.') : undefined, onClick: () => pin.mutate(p) },
              { label: 'Open Operations tab', icon: Eye, onClick: () => open(p, 'operations') },
            ]} />
          </span>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader
        title="Projects"
        sub="Projects you can access. Open one to review scope, ROE, operations and approvals."
        actions={<>
          <Button icon={Download} disabled={viewer || rows.length === 0} title={viewer ? 'Viewers cannot export the list' : rows.length === 0 ? 'Nothing to export. Clear the filters first.' : undefined} onClick={exportCsv}>Export List</Button>
          <Button variant="primary" icon={Plus} disabled={!canCreate} title={canCreate ? undefined : 'Only a Red Team Manager or Organization Admin can create projects'} onClick={() => go('project-new')}>Create Project</Button>
        </>}
      />
      {!canCreate && <div className="-mt-3 mb-4"><Locked reason="You cannot create projects. Ask a Red Team Manager or Organization Admin." /></div>}

      <FilterBar right={<>{filtered && <Button size="sm" variant="ghost" onClick={clear}>Clear filters</Button>}<Button size="sm" icon={SlidersHorizontal} aria-expanded={more} onClick={() => setMore(!more)}>More filters{(f.owner ? 1 : 0) + (f.client ? 1 : 0) > 0 ? ` (${(f.owner ? 1 : 0) + (f.client ? 1 : 0)})` : ''}</Button></>}>
        <SearchBox value={f.q} onChange={(v) => set('q', v)} placeholder="Search ID, name, client…" className="w-64" />
        <Select aria-label="Filter by status" className="w-40" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">All statuses</option>{ST.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        <Select aria-label="Filter by type" className="w-40" value={f.type} onChange={(e) => set('type', e.target.value)}><option value="">All types</option>{types.map((t) => <option key={t}>{t}</option>)}</Select>
      </FilterBar>
      {more && (
        <div className="-mt-2 mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel p-3">
          <Select aria-label="Filter by owner" className="w-48" value={f.owner} onChange={(e) => set('owner', e.target.value)}><option value="">All owners</option>{owners.map((t) => <option key={t}>{t}</option>)}</Select>
          <Select aria-label="Filter by client" className="w-56" value={f.client} onChange={(e) => set('client', e.target.value)}><option value="">All clients</option>{clients.map((t) => <option key={t}>{t}</option>)}</Select>
        </div>
      )}

      {list.isPending ? (
        <div aria-busy="true" aria-label="Loading projects"><Skeleton className="h-72" /></div>
      ) : list.isError ? (
        <Empty icon={AlertTriangle} title="Could not load projects" action={<Button onClick={() => list.refetch()}>Retry</Button>}>
          {(list.error as ServiceReadError).failure.message}
        </Empty>
      ) : (
        <>
          <Table
            cols={cols} rows={pg.rows} rowKey={(p) => p.id} onRow={(p) => open(p)} selectedKey={pid !== 'all' ? pid : undefined}
            empty={accessible.length === 0 ? (
              <Empty icon={FolderPlus} title="No projects yet" action={canCreate ? <Button variant="primary" icon={Plus} onClick={() => go('project-new')}>Create Project</Button> : undefined}>
                No projects yet. Create the first project to define scope and objectives.{!canCreate && ' Ask a Red Team Manager to add you to a project.'}
              </Empty>
            ) : (
              <Empty title="No matching projects" action={<Button onClick={() => clear()}>Clear filters</Button>}>No project matches the current search and filters.</Empty>
            )}
          />
          <Pager {...pg} />
        </>
      )}
    </>
  )
}
