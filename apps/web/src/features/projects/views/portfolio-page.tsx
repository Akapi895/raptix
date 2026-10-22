/**
 * The project portfolio (migration Mốc 2): one presentation for both modes, reading the projects port. A column the
 * connected source does not record shows as unavailable instead of a demo or zero value.
 */
import { useMemo, useState, type ReactElement } from 'react'
import { FolderPlus, RefreshCw, ServerCrash } from 'lucide-react'
import { useProjectRows } from '../list-query'
import type { ProjectRow } from '../service'
import { go } from '../../../router/navigate'
import { useProjectStore } from '../../../state/stores'
import { Button, Empty, Input, PageHeader, Skeleton, Status, Table, type Col } from '../../../ui/index'

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

/** A value the source does not record reads as unavailable, with its reason in the tooltip. */
function Unrecorded({ value, reason }: { value: string | null; reason: string }) {
  return value === null ? <span className="text-neutral" title={reason}>—</span> : <>{value}</>
}

export function ProjectPortfolio(): ReactElement {
  const list = useProjectRows()
  const setPid = useProjectStore((s) => s.setPid)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')

  const rows = useMemo(() => {
    const items = list.data ?? []
    const needle = q.trim().toLowerCase()
    return items.filter((p) => (!status || p.status === status)
      && (!needle || `${p.id} ${p.name} ${p.workspaceSlug ?? ''} ${p.target ?? ''} ${p.client ?? ''}`.toLowerCase().includes(needle)))
  }, [list.data, q, status])

  const statuses = useMemo(() => Array.from(new Set((list.data ?? []).map((p) => p.status))), [list.data])

  const open = (p: ProjectRow) => {
    setPid(p.id)
    go('project', { id: p.id })
  }

  const cols: Col<ProjectRow>[] = [
    { key: 'project', header: 'Project', render: (p) => (
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{p.name}</div>
        <div className="truncate font-mono text-xs text-muted">{p.id}{p.workspaceSlug ? ` · workspace ${p.workspaceSlug}` : ''}</div>
      </div>
    ) },
    { key: 'target', header: 'Target', render: (p) => (
      <div className="min-w-0 text-xs">
        <div className="font-mono"><Unrecorded value={p.target} reason="The source does not record a target for this project" /></div>
        {p.targetType && <div className="text-muted">{p.targetType}</div>}
      </div>
    ) },
    { key: 'metadata', header: 'Metadata', render: (p) => (p.metadataVerified === null
      ? <span className="text-neutral" title="The source does not verify metadata">—</span>
      : <Status kind="check" value={p.metadataVerified ? 'pass' : 'review'} size="sm" label={p.metadataVerified ? 'Verified' : 'Needs review'} />) },
    { key: 'status', header: 'Status', render: (p) => <Status kind="project" value={p.status} size="sm" /> },
    { key: 'client', header: 'Client', className: 'max-lg:hidden', render: (p) => <Unrecorded value={p.client} reason="The source does not carry a client for this project" /> },
    { key: 'updated', header: 'Updated', className: 'max-xl:hidden', render: (p) => <span className="whitespace-nowrap text-xs text-muted">{p.updatedAt}</span> },
  ]

  return (
    <>
      <PageHeader
        title="Projects"
        sub="Projects your account can access. A column the connected source does not record shows as unavailable rather than a placeholder value."
        actions={<Button variant="primary" icon={FolderPlus} onClick={() => go('project-new')}>New Project</Button>}
      />
      {list.isPending ? (
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
              title={(list.data ?? []).length === 0 ? 'No projects yet' : 'No projects match the filters'}
              action={<Button variant="primary" icon={FolderPlus} onClick={() => go('project-new')}>New Project</Button>}
            >
              {(list.data ?? []).length === 0
                ? 'Create the first project to start planning.'
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
