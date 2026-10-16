/**
 * Real project portfolio (integration ticket 03): the engagement API is the
 * only source. Columns the engagement contract does not carry (client,
 * owner, window, ROE) render as explicitly unavailable instead of demo
 * values, and every action goes through the typed engagement adapters with
 * actionable failure states (R02, R05, R06).
 */
import { useMemo, useState, type ReactElement } from 'react'
import { FolderPlus, RefreshCw, ServerCrash } from 'lucide-react'
import type { ProjectViewModel } from '@raptix/web-contracts'
import { useRealProjects } from '../queries'
import { go } from '../../router/navigate'
import { showCreateProject } from '../create-project-dialog'
import { useProjectStore } from '../../state/stores'
import { Button, Empty, Input, PageHeader, Skeleton, Status, Table, type Col } from '../../ui'
import { utcMinute } from '../format'

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

export function RealPortfolio(): ReactElement {
  const { ready, reason, list } = useRealProjects()
  const setPid = useProjectStore((s) => s.setPid)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')

  const rows = useMemo(() => {
    const items = list.data ?? []
    const needle = q.trim().toLowerCase()
    return items
      .filter((p) => (!status || p.lifecycleStatus === status) && (!needle || `${p.id} ${p.displayName} ${p.workspaceSlug} ${p.targetValue}`.toLowerCase().includes(needle)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [list.data, q, status])

  const statuses = useMemo(() => Array.from(new Set((list.data ?? []).map((p) => p.lifecycleStatus))), [list.data])

  const open = (p: ProjectViewModel) => {
    setPid(p.id)
    go('project', { id: p.id })
  }

  const cols: Col<ProjectViewModel>[] = [
    { key: 'project', header: 'Project', render: (p) => (
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{p.displayName}</div>
        <div className="truncate font-mono text-xs text-muted">{p.id} · workspace {p.workspaceSlug}</div>
      </div>
    ) },
    { key: 'target', header: 'Target', render: (p) => (
      <div className="min-w-0 text-xs">
        <div className="font-mono">{p.targetValue}</div>
        <div className="text-muted">{p.targetType}</div>
      </div>
    ) },
    { key: 'metadata', header: 'Metadata', render: (p) => <Status kind="check" value={p.metadataState === 'verified' ? 'pass' : 'review'} size="sm" label={p.metadataState === 'verified' ? 'Verified' : 'Needs review'} /> },
    { key: 'status', header: 'Status', render: (p) => <Status kind="project" value={p.lifecycleStatus} size="sm" /> },
    { key: 'client', header: 'Client', className: 'max-lg:hidden', render: () => <span className="text-neutral" title="Not carried by the engagement API">—</span> },
    { key: 'updated', header: 'Updated', className: 'max-xl:hidden', render: (p) => <span className="whitespace-nowrap text-xs text-muted">{utcMinute(p.updatedAt)}</span> },
  ]

  return (
    <>
      <PageHeader
        title="Projects"
        sub="Real engagements from the connected Raptix API. Columns without an API source show as unavailable rather than demo values."
        meta={<span className="inline-flex h-6 items-center rounded-full border border-cyan/30 bg-info-soft px-2.5 text-xs font-medium text-cyan">Real mode</span>}
        actions={<Button variant="primary" icon={FolderPlus} onClick={() => showCreateProject()}>New Project</Button>}
      />
      {!ready ? (
        <Empty icon={ServerCrash} title="Projects are unavailable on this server">
          {reason}
        </Empty>
      ) : list.isPending ? (
        <div className="space-y-3" aria-busy="true" role="status">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : list.isError ? (
        <LoadError error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by id, name, workspace or target…" aria-label="Search projects" className="max-w-xs" />
            <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-[10px] border border-line bg-panel px-2 text-sm text-fg">
              <option value="">All statuses</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {rows.length === 0 ? (
            <Empty
              icon={FolderPlus}
              title={list.data.length === 0 ? 'No engagements yet' : 'No engagements match the filters'}
              action={<Button variant="primary" icon={FolderPlus} onClick={() => showCreateProject()}>New Project</Button>}
            >
              {list.data.length === 0
                ? 'Create the first engagement to start planning against the real runtime.'
                : 'An empty result means no records match — this is not an error.'}
            </Empty>
          ) : (
            <Table cols={cols} rows={rows} rowKey={(p) => p.id} onRow={open} />
          )}
        </>
      )}
    </>
  )
}
