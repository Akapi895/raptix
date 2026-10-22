/**
 * Project switcher (ticket 08b, extracted from the shell monolith verbatim).
 *
 * Scope selection flows through the shared active-project authority (the
 * ticket-05 project store's `pid` read here; selection goes through the
 * navigate module's guarded `selectProject`) — this component owns no
 * project state. Access gating, search/filter tabs and the isolation
 * invariants are unchanged.
 */
import { useMemo, useState } from 'react'
import { Check as CheckIcon, ChevronDown, FolderKanban, Layers, Loader2, Lock, Pin } from 'lucide-react'
import { go, selectProject, useRoute } from '../router/navigate'
import { useAccessible, useActiveProject, useCan, usePolicyProjects, useMe } from '../state/console'
import { useSessionStore } from '../state/session'
import { useProjectStore, useUiStore } from '../state/stores'
import { Button, cx, SearchBox, Status } from '../ui/index'
import { DATA_MODE } from '../state/mode'
import { showCreateProject } from '../features/projects/create-dialog-state'

export function ProjectSwitcher() {
  const projects = usePolicyProjects()
  const accessible = useAccessible()
  const pid = useProjectStore((s) => s.pid)
  const project = useActiveProject()
  const switcherOpen = useUiStore((s) => s.switcherOpen)
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen)
  const can = useCan()
  const me = useMe()
  const loading = useSessionStore((s) => s.loading)
  const route = useRoute()
  const isNew = route.page === 'project-new'
  const [tab, setTab] = useState<'recent' | 'pinned' | 'all'>('recent')
  const [q, setQ] = useState('')
  const [st, setSt] = useState('')
  const [cl, setCl] = useState('')
  const accessIds = useMemo(() => new Set(accessible.map((p) => p.id)), [accessible])
  const clients = useMemo(() => Array.from(new Set(projects.map((p) => p.client))).sort(), [projects])
  const statuses = useMemo(() => Array.from(new Set(projects.map((p) => p.status))), [projects])
  const list = useMemo(() => {
    let l = tab === 'all' || q.trim() ? projects : accessible
    if (tab === 'pinned') l = l.filter((p) => p.pinned)
    if (tab === 'recent') l = l.filter((p) => p.status !== 'closed').slice(0, 5)
    if (st) l = l.filter((p) => p.status === st)
    if (cl) l = l.filter((p) => p.client === cl)
    const k = q.trim().toLowerCase()
    if (k) l = l.filter((p) => (p.id + p.name + p.client).toLowerCase().includes(k))
    return l
  }, [projects, accessible, tab, q, st, cl])
  const sel = 'h-9 min-w-0 flex-1 rounded-[10px] border border-line bg-panel px-2 text-xs text-fg'
  return (
    <div className="relative min-w-0 flex-1 sm:flex-none">
      <button onClick={() => setSwitcherOpen(!switcherOpen)} aria-haspopup="dialog" aria-expanded={switcherOpen} aria-label={`Project: ${isNew ? 'New project (draft)' : project ? project.id : 'All Projects'}`} title={isNew ? 'New project (draft)' : project ? `${project.id} · ${project.name}` : 'All Projects'} className="flex h-10 w-full min-w-0 max-w-[340px] items-center gap-2 rounded-[10px] border border-line bg-panel px-3 text-sm hover:bg-hover">
        {loading ? <Loader2 size={16} className="shrink-0 animate-spin text-cyan" aria-hidden /> : <FolderKanban size={16} className="shrink-0 text-accent" aria-hidden />}
        <span className="min-w-0 truncate font-medium">{isNew ? 'New project (draft)' : project ? <><span className="font-mono text-[13px]">{project.id}</span><span className="max-xl:hidden"> · {project.name}</span></> : 'All Projects'}</span>
        {project && !isNew && <span className="hidden 2xl:inline"><Status kind="project" value={project.status} size="sm" /></span>}
        <ChevronDown size={15} className="shrink-0 text-muted" aria-hidden />
      </button>
      {switcherOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setSwitcherOpen(false)} aria-hidden />
          <div role="dialog" aria-label="Select project" className="fixed left-3 right-3 top-[68px] z-50 rounded-2xl border border-line bg-panel p-3 shadow-xl sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 sm:w-[480px]">
            <SearchBox value={q} onChange={setQ} placeholder="Search by ID, name or client…" />
            <div className="my-3 flex gap-2">
              <select aria-label="Filter by client" value={cl} onChange={(e) => setCl(e.target.value)} className={sel}>
                <option value="">All clients</option>{clients.map((c) => <option key={c}>{c}</option>)}
              </select>
              <select aria-label="Filter by status" value={st} onChange={(e) => setSt(e.target.value)} className={sel}>
                <option value="">All statuses</option>{statuses.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            <div role="tablist" className="mb-2 flex gap-1 border-b border-line">
              {([['recent', 'Recent'], ['pinned', 'Pinned'], ['all', 'All']] as const).map(([id, l]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('h-9 border-b-2 px-3 text-xs font-medium', tab === id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}>{l}</button>
              ))}
            </div>
            <div className="no-scrollbar max-h-[320px] overflow-y-auto">
              <button onClick={() => selectProject('all')} className={cx('mb-1 flex min-h-12 w-full items-center gap-3 rounded-[10px] px-3 text-left hover:bg-hover', pid === 'all' && 'bg-hover')}>
                <Layers size={16} className="text-cyan" aria-hidden />
                <div className="flex-1"><div className="text-sm font-medium">All Projects</div><div className="text-xs text-muted">Aggregate view — read-only, cannot start operations</div></div>
                {pid === 'all' && <CheckIcon size={16} className="text-accent" aria-label="Current" />}
              </button>
              {list.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-muted">No matching projects. <button className="text-accent hover:underline" onClick={() => { setQ(''); setSt(''); setCl(''); setTab('all') }}>Clear filters</button></div>
              ) : list.map((p) => {
                const ok = accessIds.has(p.id)
                return (
                  <button key={p.id} disabled={!ok} title={ok ? `${p.id} · ${p.name} · ${p.client} · ${p.type}` : 'No access'} onClick={() => selectProject(p.id)} className={cx('flex min-h-14 w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left', ok ? 'hover:bg-hover' : 'cursor-not-allowed opacity-60', pid === p.id && 'bg-hover')}>
                    {p.pinned ? <Pin size={14} className="shrink-0 text-warn" aria-label="Pinned" /> : <span className="w-3.5" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium"><span className="font-mono text-[13px]">{p.id}</span> · {p.name}</div>
                      <div className="truncate text-xs text-muted">{p.client} · {p.type}{!ok && ' · '}{!ok && <span className="inline-flex items-center gap-1 text-neutral"><Lock size={11} aria-hidden />No access</span>}</div>
                    </div>
                    <Status kind="project" value={p.status} size="sm" />
                    {pid === p.id && <CheckIcon size={16} className="text-accent" aria-label="Current" />}
                  </button>
                )
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => { setSwitcherOpen(false); go('projects') }}>View all projects</Button>
              {can('createProject') && <Button variant="primary" className="flex-1" onClick={() => { setSwitcherOpen(false); if (DATA_MODE === 'real') showCreateProject(); else go('project-new') }}>New project</Button>}
            </div>
            {me.role === 'viewer' && <p className="mt-3 text-xs text-muted">Only projects you have been granted access to are available.</p>}
          </div>
        </>
      )}
    </div>
  )
}
