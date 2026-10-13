import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity, Bell, BookOpen, Bot, CheckCheck, ChevronDown, Crosshair, FileText, FolderKanban, Layers, LayoutDashboard, LogOut, Menu as MenuIcon, Moon, Network, OctagonX, PanelLeftClose, PanelLeftOpen,
  Pin, RadioTower, Phone, MoreHorizontal, Building2, Clock, AlertTriangle, FlaskConical, RotateCcw, Info, X as XIcon, Search, Server, Settings, ShieldAlert, Sparkles, Sun, Lock, Check as CheckIcon, Loader2, Monitor, Home, History, CornerDownLeft, type LucideIcon,
} from 'lucide-react'
import { ROLE_LABEL, useStore, eligibility, sessionPerm, type Route, type Store } from './store'
import { USERS } from './data'
import { Banner, Button, IconButton, Modal, Field, Textarea, Status, SearchBox, Tabs, Segmented, Avatar, Check, cx } from './ui'
import { CopilotDrawer } from './screens/ai-copilot'
import { DemoGuide } from './screens/demo-guide'

type CopilotCtx = { kind: string; id?: string; label: string }
type Ext = {
  copilotOpen: boolean
  setCopilotOpen: (open: boolean, ctx?: CopilotCtx) => void
  copilotCtx?: CopilotCtx | null
}
const useS = () => useStore() as unknown as Store & Ext

/* ───────────── Navigation: 12 items ───────────── */
export const NAV: { group: string; items: { page: string; label: string; icon: LucideIcon; match: string[] }[] }[] = [
  { group: 'OVERVIEW', items: [{ page: 'command-center', label: 'Command Center', icon: LayoutDashboard, match: ['command-center', 'dashboard', 'tasks'] }] },
  {
    group: 'PLANNING',
    items: [
      { page: 'projects', label: 'Projects', icon: FolderKanban, match: ['projects', 'project-new', 'project', 'approval'] },
      { page: 'playbooks', label: 'Playbooks & TTPs', icon: BookOpen, match: ['playbooks', 'playbook', 'technique', 'playbook-review'] },
    ],
  },
  {
    group: 'AI & EXECUTION',
    items: [
      { page: 'ai-operator', label: 'AI Operator', icon: Bot, match: ['ai-operator', 'ai-plan', 'ai-plan-review', 'ai-plan-compare', 'ai-trace', 'ai-history'] },
      { page: 'operations', label: 'Operations', icon: Activity, match: ['operations', 'operation-new', 'preflight', 'operation', 'operation-schedule'] },
      { page: 'c2', label: 'C2 & Sessions', icon: RadioTower, match: ['c2', 'c2-session', 'c2-console', 'c2-channel'] },
    ],
  },
  {
    group: 'INFRASTRUCTURE',
    items: [
      { page: 'agents', label: 'Agents', icon: Monitor, match: ['agents', 'agent'] },
      { page: 'assets', label: 'Assets', icon: Server, match: ['assets', 'asset', 'asset-new', 'asset-scope'] },
    ],
  },
  {
    group: 'INTELLIGENCE',
    items: [
      { page: 'analysis', label: 'Attack Analysis', icon: Network, match: ['analysis'] },
      { page: 'findings', label: 'Findings', icon: ShieldAlert, match: ['findings', 'finding', 'finding-new'] },
      { page: 'reports', label: 'Reports', icon: FileText, match: ['reports', 'report-new', 'report', 'report-preview', 'report-review'] },
    ],
  },
  { group: 'SYSTEM', items: [{ page: 'settings', label: 'Settings', icon: Settings, match: ['settings'] }] },
]
const WIDE_PAGES = ['c2-console', 'ai-operator']
const isWide = (r: Route) => WIDE_PAGES.includes(r.page) || (r.page === 'operation' && r.tab === 'live')

function useBadges() {
  const { db, scoped, me, can } = useS()
  const d = db as any
  const pendingAppr = (d.approvals || []).filter((a: any) => a.status === 'pending').length
  return {
    projects: me.role === 'reviewer' || can('approve') ? pendingAppr : 0,
    'ai-operator': (d.plans?.filter((p: any) => p.status === 'in_review' || p.status === 'proposed').length as number) || 0,
    c2: (d.sessionRequests?.filter((r: any) => r.status === 'pending').length as number) || 0,
    operations: scoped(db.operations).filter((o) => o.status === 'running').length,
  } as Record<string, number>
}

function Sidebar({ collapsed, setCollapsed, mobileOpen, closeMobile }: { collapsed: boolean; setCollapsed: (b: boolean) => void; mobileOpen: boolean; closeMobile: () => void }) {
  const { route, go } = useS()
  const badges = useBadges()
  const navKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-nav]'))
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    e.preventDefault()
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)
    items[n].focus()
  }
  useEffect(() => {
    if (!mobileOpen) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && closeMobile()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [mobileOpen, closeMobile])
  const body = (compact: boolean) => (
    <>
      <div className={cx('flex h-16 shrink-0 items-center gap-3 border-b border-line px-4', compact && 'justify-center px-0')}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent text-white"><Crosshair size={19} aria-hidden /></div>
        {!compact && <div className="leading-tight"><div className="text-[15px] font-semibold tracking-tight text-fg">Raptix</div><div className="text-xs text-muted">AI Red Team Platform</div></div>}
      </div>
      <nav aria-label="Main navigation" onKeyDown={navKey} className="no-scrollbar flex-1 overflow-y-auto px-3 py-4">
        {NAV.map((g) => (
          <div key={g.group} className="mb-4">
            {!compact ? <div className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-neutral">{g.group}</div> : <div className="mx-3 mb-2 border-t border-line" />}
            {g.items.map((it) => {
              const active = it.match.includes(route.page)
              const n = badges[it.page] || 0
              return (
                <button
                  key={it.page} data-nav onClick={() => { go(it.page); closeMobile() }} aria-current={active ? 'page' : undefined} aria-label={compact ? (n ? `${it.label}, ${n} pending` : it.label) : undefined} title={compact ? (n ? `${it.label} (${n} pending)` : it.label) : undefined}
                  className={cx('relative mb-0.5 flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition', compact && 'justify-center px-0', 'focus-visible:outline-2 focus-visible:-outline-offset-2', active ? 'bg-accent-soft font-semibold text-fg' : 'text-muted hover:bg-hover hover:text-fg')}
                >
                  {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-accent" aria-hidden />}
                  <it.icon size={18} className={cx('shrink-0', active && 'text-accent')} aria-hidden />
                  {!compact && <span className="flex-1 truncate text-left">{it.label}</span>}
                  {n > 0 && (compact
                    ? <span className="absolute right-1 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-side bg-accent" aria-hidden />
                    : <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold tnum text-white" aria-label={`${n} pending`}>{n}</span>)}
                </button>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="hidden shrink-0 border-t border-line p-3 lg:block">
        <button onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className={cx('flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-sm text-muted hover:bg-hover hover:text-fg', compact && 'justify-center px-0')}>
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}{!compact && 'Collapse'}
        </button>
      </div>
    </>
  )
  return (
    <>
      <aside style={{ width: collapsed ? 72 : 248 }} className="hidden shrink-0 flex-col border-r border-line bg-side transition-[width] lg:flex">{body(collapsed)}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={closeMobile} aria-hidden />
          <aside role="dialog" aria-label="Navigation" className="absolute left-0 top-0 flex h-full w-[280px] flex-col border-r border-line bg-side shadow-xl">{body(false)}</aside>
        </div>
      )}
    </>
  )
}

/* ───────────── Project switcher ───────────── */
function ProjectSwitcher() {
  const { db, accessible, pid, setPid, project, switcherOpen, setSwitcherOpen, go, can, me, loading, route } = useS()
  const isNew = route.page === 'project-new'
  const [tab, setTab] = useState<'recent' | 'pinned' | 'all'>('recent')
  const [q, setQ] = useState('')
  const [st, setSt] = useState('')
  const [cl, setCl] = useState('')
  const accessIds = useMemo(() => new Set(accessible.map((p) => p.id)), [accessible])
  const clients = useMemo(() => Array.from(new Set(db.projects.map((p) => p.client))).sort(), [db.projects])
  const statuses = useMemo(() => Array.from(new Set(db.projects.map((p) => p.status))), [db.projects])
  const list = useMemo(() => {
    let l = tab === 'all' || q.trim() ? db.projects : accessible
    if (tab === 'pinned') l = l.filter((p) => p.pinned)
    if (tab === 'recent') l = l.filter((p) => p.status !== 'closed').slice(0, 5)
    if (st) l = l.filter((p) => p.status === st)
    if (cl) l = l.filter((p) => p.client === cl)
    const k = q.trim().toLowerCase()
    if (k) l = l.filter((p) => (p.id + p.name + p.client).toLowerCase().includes(k))
    return l
  }, [db.projects, accessible, tab, q, st, cl])
  const sel = 'h-9 min-w-0 flex-1 rounded-[10px] border border-line bg-panel px-2 text-xs text-fg'
  return (
    <div className="relative min-w-0">
      <button onClick={() => setSwitcherOpen(!switcherOpen)} aria-haspopup="dialog" aria-expanded={switcherOpen} aria-label={`Project: ${isNew ? 'New project (draft)' : project ? project.id : 'All Projects'}`} className="flex h-10 max-w-[340px] items-center gap-2 rounded-[10px] border border-line bg-panel px-3 text-sm hover:bg-hover">
        {loading ? <Loader2 size={16} className="shrink-0 animate-spin text-cyan" aria-hidden /> : <FolderKanban size={16} className="shrink-0 text-accent" aria-hidden />}
        <span className="truncate font-medium">{isNew ? 'New project (draft)' : project ? <><span className="font-mono text-[13px]">{project.id}</span><span className="max-xl:hidden"> · {project.name}</span></> : 'All Projects'}</span>
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
              <button onClick={() => setPid('all')} className={cx('mb-1 flex min-h-12 w-full items-center gap-3 rounded-[10px] px-3 text-left hover:bg-hover', pid === 'all' && 'bg-hover')}>
                <Layers size={16} className="text-cyan" aria-hidden />
                <div className="flex-1"><div className="text-sm font-medium">All Projects</div><div className="text-xs text-muted">Aggregate view — read-only, cannot start operations</div></div>
                {pid === 'all' && <CheckIcon size={16} className="text-accent" aria-label="Current" />}
              </button>
              {list.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-muted">No matching projects. <button className="text-accent hover:underline" onClick={() => { setQ(''); setSt(''); setCl(''); setTab('all') }}>Clear filters</button></div>
              ) : list.map((p) => {
                const ok = accessIds.has(p.id)
                return (
                  <button key={p.id} disabled={!ok} title={ok ? undefined : 'No access'} onClick={() => setPid(p.id)} className={cx('flex min-h-14 w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left', ok ? 'hover:bg-hover' : 'cursor-not-allowed opacity-60', pid === p.id && 'bg-hover')}>
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
              {can('createProject') && <Button variant="primary" className="flex-1" onClick={() => { setSwitcherOpen(false); go('project-new') }}>New project</Button>}
            </div>
            {me.role === 'viewer' && <p className="mt-3 text-xs text-muted">Only projects you have been granted access to are available.</p>}
          </div>
        </>
      )}
    </div>
  )
}

/* ───────────── Global search / command palette (APP-05) ───────────── */
let RECENT: string[] = []
type Hit = { group: string; id: string; label: string; meta?: string; to: () => void }
const GROUP_ORDER = ['Projects', 'Operations', 'Plans', 'Findings', 'Sessions', 'Agents', 'Pages']
function GlobalSearch() {
  const { accessible, db, scoped, go, project, me } = useS()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  useEffect(() => { if (open) { setQ(''); setIdx(0); setTimeout(() => inputRef.current?.focus(), 0) } }, [open])
  useEffect(() => setIdx(0), [q])
  const hits = useMemo<Hit[]>(() => {
    const k = q.trim().toLowerCase()
    if (!k) return []
    const m = (...s: (string | undefined)[]) => s.join(' ').toLowerCase().includes(k)
    const d = db as any
    const pName = (id: string) => id
    const ags = scoped((d.agents || []) as { projectId: string; id: string; host: string; status: string }[])
    const plans = scoped((d.plans || []) as { projectId: string; id: string; title: string; status: string; ver?: string; version: number }[])
    const sess = scoped((d.sessions || []) as any[]).filter((x) => sessionPerm(db, me, x) !== 'none')
    const all: Hit[] = [
      ...accessible.filter((p) => m(p.id, p.name, p.client)).map((p) => ({ group: 'Projects', id: p.id, label: p.name, meta: `${p.status} · ${p.client}`, to: () => go('project', { id: p.id }) })),
      ...scoped(db.operations).filter((o) => m(o.id, o.name)).map((o) => ({ group: 'Operations', id: o.id, label: o.name, meta: `${o.status} · ${pName(o.projectId)}`, to: () => go('operation', { id: o.id }) })),
      ...plans.filter((p) => m(p.id, p.title)).map((p) => ({ group: 'Plans', id: p.id, label: p.title, meta: `${p.ver ?? 'v' + p.version} · ${p.status.replace('_', ' ')} · ${p.projectId}`, to: () => go('ai-plan', { id: p.id }) })),
      ...scoped(db.findings).filter((f) => m(f.id, f.title)).map((f) => ({ group: 'Findings', id: f.id, label: f.title, meta: `${f.status === 'ai_suggested' ? 'AI suggestion' : f.status} · ${f.projectId}`, to: () => go('finding', { id: f.id }) })),
      ...sess.filter((x) => m(x.id, x.asset, x.account)).map((x) => ({ group: 'Sessions', id: x.id as string, label: `${x.asset}`, meta: `${x.state} · ${x.projectId}`, to: () => go('c2-session', { id: x.id }) })),
      ...ags.filter((a) => m(a.id, a.host)).map((a) => ({ group: 'Agents', id: a.id, label: a.host, meta: `${a.status} · ${a.projectId}`, to: () => go('agent', { id: a.id }) })),
      ...NAV.flatMap((g) => g.items).filter((i) => m(i.label, i.page)).map((i) => ({ group: 'Pages', id: i.label, label: 'Open page', to: () => go(i.page) })),
    ]
    return GROUP_ORDER.flatMap((g) => all.filter((h) => h.group === g).slice(0, 4))
  }, [q, db, accessible, scoped, go, me])
  const choose = (h: Hit) => {
    const k = q.trim()
    if (k) RECENT = [k, ...RECENT.filter((x) => x !== k)].slice(0, 5)
    setOpen(false)
    h.to()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(hits.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' && hits[idx]) { e.preventDefault(); choose(hits[idx]) }
  }
  const groups = GROUP_ORDER.filter((g) => hits.some((h) => h.group === g))
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Search (Ctrl+K)" className="flex h-10 min-w-0 max-w-md flex-1 items-center gap-2 rounded-[10px] border border-line bg-panel px-3 text-sm text-neutral hover:bg-hover max-md:hidden">
        <Search size={16} aria-hidden />
        <span className="flex-1 truncate text-left">Search projects, operations, plans…</span>
        <kbd className="rounded border border-line bg-subtle px-1.5 font-mono text-xs text-muted max-xl:hidden">⌘K</kbd>
      </button>
      <IconButton icon={Search} label="Search" onClick={() => setOpen(true)} className="md:hidden" />
      {open && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[10vh]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <div role="dialog" aria-modal="true" aria-label="Global search" onKeyDown={onKey} className="relative flex max-h-[70vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-xl">
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search size={18} className="shrink-0 text-neutral" aria-hidden />
              <input ref={inputRef} role="combobox" aria-expanded aria-controls="cmdk-list" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects, operations, plans, findings, sessions, agents, pages…" className="h-14 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-neutral" />
              <span className="shrink-0 rounded-full border border-line bg-subtle px-2.5 py-0.5 text-xs font-medium text-muted">{project ? project.id : 'All accessible projects'}</span>
            </div>
            <div id="cmdk-list" role="listbox" className="no-scrollbar flex-1 overflow-y-auto p-2">
              {!q.trim() ? (
                <div className="px-2 py-2">
                  <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-neutral">Recent searches</div>
                  {RECENT.length === 0 ? <div className="px-1 py-3 text-sm text-muted">No recent searches. Type to search within {project ? project.id : 'all accessible projects'}.</div> : RECENT.map((r) => (
                    <button key={r} onClick={() => setQ(r)} className="flex h-10 w-full items-center gap-3 rounded-[10px] px-2 text-left text-sm hover:bg-hover"><History size={15} className="text-neutral" aria-hidden />{r}</button>
                  ))}
                </div>
              ) : hits.length === 0 ? (
                <div className="px-4 py-10 text-center"><div className="text-sm font-semibold">No results</div><div className="mt-1 text-sm text-muted">Try a project ID, operation name or agent hostname{project ? ', or switch to All Projects' : ''}.</div></div>
              ) : groups.map((g) => (
                <div key={g} className="mb-1">
                  <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-neutral">{g}</div>
                  {hits.map((h, i) => h.group === g && (
                    <button key={h.group + h.id} role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onClick={() => choose(h)} className={cx('flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left text-sm', i === idx ? 'bg-accent-soft' : 'hover:bg-hover')}>
                      <span className={cx('whitespace-nowrap text-[13px]', h.group !== 'Pages' && 'font-mono')}>{h.id}</span><span className="min-w-0 flex-1 truncate text-muted">{h.label}</span>{h.meta && <span className="shrink-0 whitespace-nowrap text-xs text-neutral max-sm:hidden">{h.meta}</span>}
                      {i === idx && <CornerDownLeft size={14} className="text-neutral" aria-hidden />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-xs text-muted"><span>↑↓ navigate</span><span>↵ open</span><span>Esc close</span></div>
          </div>
        </div>
      )}
    </>
  )
}

/* ───────────── Default AI Mode (global preference for NEW conversations only) ───────────── */
const AI_MODES = [
  { id: 'observe', label: 'Observe', text: 'AI reads data and answers questions. It cannot change anything or run tools.' },
  { id: 'propose', label: 'Propose', text: 'AI drafts plans and tool calls. Nothing runs until a person approves it.' },
  { id: 'execution', label: 'Approved Execution', text: 'AI may act only on artifacts that were already approved. A prompt never starts execution.' },
] as const
function Pop({ open, onClose, label, align = 'left', width = 340, children }: { open: boolean; onClose: () => void; label: string; align?: 'left' | 'right'; width?: number; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div role="dialog" aria-label={label} style={{ width }} className={cx('absolute top-full z-50 mt-2 max-w-[calc(100vw-1.5rem)] whitespace-normal rounded-2xl border border-line bg-panel p-4 text-left text-sm font-normal text-fg shadow-xl', align === 'right' ? 'right-0' : 'left-0')}>{children}</div>
    </>
  )
}
function AiStatus() {
  const s = useS()
  const [open, setOpen] = useState(false)
  const mode = s.aiMode || 'propose'
  const cur = AI_MODES.find((m) => m.id === mode) || AI_MODES[1]
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} aria-label={`Default AI Mode: ${cur.label}`} title={`Default AI Mode: ${cur.label}`} className="flex h-10 items-center gap-2 rounded-[10px] border border-line bg-panel px-3 text-sm hover:bg-hover">
        <span className="h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <Bot size={16} className="shrink-0 text-muted" aria-hidden />
        <span className="hidden text-xs text-muted min-[1500px]:inline">Default AI Mode</span>
        <span className="whitespace-nowrap font-medium max-xl:hidden">{cur.label}</span>
        <ChevronDown size={14} className="shrink-0 text-muted max-xl:hidden" aria-hidden />
      </button>
      <Pop open={open} onClose={() => setOpen(false)} label="Default AI Mode" align="right" width={360}>
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold"><span className="h-2 w-2 rounded-full bg-ok" aria-hidden />Default AI Mode</div>
        <p className="mb-3 text-xs text-muted">Applies to new AI conversations only. It never changes existing conversations; each conversation keeps its own mode. Approved Execution is not permission: policy, approvals and Execution Eligibility still apply.</p>
        <div role="radiogroup" aria-label="Default AI Mode" className="space-y-2">
          {AI_MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={m.id === mode} onClick={() => { s.setAiMode(m.id); s.toast(`Default AI Mode set to ${m.label}. Existing conversations are unchanged.`, 'info'); setOpen(false) }} className={cx('block w-full rounded-xl border p-3 text-left', m.id === mode ? 'border-accent-line bg-accent-soft' : 'border-line hover:bg-hover')}>
              <div className="flex items-center justify-between text-sm font-medium">{m.label}{m.id === mode && <span className="text-xs font-semibold text-accent">Default</span>}</div>
              <p className="mt-0.5 text-xs text-muted">{m.text}</p>
            </button>
          ))}
        </div>
      </Pop>
    </div>
  )
}

/* ───────────── Workspace switcher ───────────── */
function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative hidden shrink-0 xl:block">
      <button onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} aria-label="Workspace: Raptix Workspace — Test Lab" title="Raptix Workspace — Test Lab" className="flex h-10 items-center gap-2 rounded-[10px] border border-line bg-panel px-3 text-sm hover:bg-hover">
        <Building2 size={16} className="shrink-0 text-muted" aria-hidden />
        <span className="hidden max-w-[190px] truncate text-xs font-medium min-[1600px]:inline">Raptix Workspace — Test Lab</span>
        <ChevronDown size={14} className="shrink-0 text-muted" aria-hidden />
      </button>
      <Pop open={open} onClose={() => setOpen(false)} label="Select workspace" width={320}>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral">Organization · Acme Security (Demo)</div>
        <button onClick={() => setOpen(false)} className="flex min-h-12 w-full items-center gap-3 rounded-[10px] bg-hover px-3 text-left"><Building2 size={16} className="text-accent" aria-hidden /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">Raptix Workspace — Test Lab</div><div className="text-xs text-muted">Current workspace</div></div><CheckIcon size={16} className="text-accent" aria-label="Current" /></button>
        <button disabled title="Your account has no other workspaces in this demo." className="mt-1 flex min-h-12 w-full cursor-not-allowed items-center gap-3 rounded-[10px] px-3 text-left opacity-60"><Lock size={16} className="text-neutral" aria-hidden /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">Production Workspace</div><div className="text-xs text-muted">No access</div></div></button>
        <p className="mt-2 text-xs text-muted">Simulated: only one workspace is available in this prototype.</p>
      </Pop>
    </div>
  )
}

/* ───────────── Notices ───────────── */
const CHIPS = ['Approvals', 'Agents', 'Sessions', 'AI plans', 'Reports', 'System'] as const
type Chip = (typeof CHIPS)[number]
const catOf = (n: any): Chip => {
  const c = String(n.category || '').toLowerCase()
  if (c) {
    if (c.startsWith('approv')) return 'Approvals'
    if (c.startsWith('agent')) return 'Agents'
    if (c.startsWith('session') || c.startsWith('c2')) return 'Sessions'
    if (c.startsWith('ai') || c.startsWith('plan')) return 'AI plans'
    if (c.startsWith('report')) return 'Reports'
    if (c.startsWith('system')) return 'System'
  }
  const t = String(n.to?.name || '')
  if (t === 'project' || t === 'approval' || t === 'projects') return 'Approvals'
  if (t.startsWith('agent')) return 'Agents'
  if (t.startsWith('c2') || t.startsWith('session')) return 'Sessions'
  if (t.startsWith('ai')) return 'AI plans'
  if (t.startsWith('report')) return 'Reports'
  return 'System'
}
function Notices() {
  const s = useS()
  const { db, noticesOpen, setNoticesOpen, go, A, accessible } = s
  const [tab, setTab] = useState<'unread' | 'all'>('unread')
  const [chip, setChip] = useState<Chip | ''>('')
  const ids = new Set(accessible.map((p) => p.id))
  const all = db.notices.filter((n) => n.projectId === '' || ids.has(n.projectId))
  const unread = all.filter((n) => !n.read).length
  const list = all.filter((n) => (tab === 'all' || !n.read) && (!chip || catOf(n) === chip))
  const toggle = () => { if (!noticesOpen) s.setCopilotOpen(false); setNoticesOpen(!noticesOpen) }
  const open = (n: (typeof all)[number]) => { setNoticesOpen(false); go(n.to.name, { id: n.to.id }) }
  return (
    <div className="relative">
      <IconButton icon={Bell} label={`Notifications${unread ? ` (${unread} unread)` : ''}`} onClick={toggle} aria-expanded={noticesOpen} />
      {unread > 0 && <span className="pointer-events-none absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold leading-none tnum text-white">{unread}</span>}
      {noticesOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setNoticesOpen(false)} aria-hidden />
          <div role="dialog" aria-label="Notifications" className="fixed left-3 right-3 top-[68px] z-50 rounded-2xl border border-line bg-panel p-3 shadow-xl sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[420px]">
            <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Notifications</h2><button onClick={A.markNoticesRead} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"><CheckCheck size={13} aria-hidden />Mark all read</button></div>
            <div role="tablist" className="mb-2 flex gap-1 border-b border-line">
              {([['unread', `Unread (${unread})`], ['all', 'All']] as const).map(([id, l]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('h-9 border-b-2 px-3 text-xs font-medium', tab === id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}>{l}</button>
              ))}
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {CHIPS.map((c) => (
                <button key={c} aria-pressed={chip === c} onClick={() => setChip(chip === c ? '' : c)} className={cx('h-7 rounded-full border px-2.5 text-xs font-medium', chip === c ? 'border-accent-line bg-accent-soft text-accent' : 'border-line text-muted hover:bg-hover')}>{c}</button>
              ))}
            </div>
            <div className="no-scrollbar max-h-[340px] overflow-y-auto">
              {list.length === 0 ? <div className="py-10 text-center text-sm text-muted">You're all caught up.</div> : list.map((n) => (
                <div key={n.id} className="flex items-start gap-3 rounded-[10px] px-3 py-2.5 hover:bg-hover">
                  <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-accent')} aria-label={n.read ? 'Read' : 'Unread'} />
                  <div className="min-w-0 flex-1"><div className="text-sm">{n.text}</div><div className="mt-0.5 text-xs text-muted">{catOf(n)} · {n.projectId || 'System'} · {n.at}</div></div>
                  <Button size="sm" variant={n.group === 'todo' ? 'primary' : 'secondary'} onClick={() => open(n)}>{n.group === 'todo' ? 'Review' : 'Open'}</Button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ───────────── Profile menu + Demo Tools (V3-22) ───────────── */
const ROLE_DESC: Record<string, { can: string; cannot: string }> = {
  admin: { can: 'Manage organization settings and policies, stop the whole workspace, confirm closure, reopen projects, approve plans.', cannot: 'Run operations or create plans.' },
  manager: { can: 'Create projects, edit scope, create plans, run operations, approve session access, Emergency Stop a project.', cannot: 'Approve projects, plans or reports (a Reviewer decides).' },
  reviewer: { can: 'Approve projects, plans, findings and reports; confirm closure.', cannot: 'Run operations, edit scope or open interactive sessions.' },
  operator: { can: 'Create plans, run approved operations, request session access, open granted sessions.', cannot: 'Approve anything, edit scope or change policies.' },
  analyst: { can: 'Create findings, evidence and report drafts; view analysis.', cannot: 'Run operations, approve, or open sessions.' },
  viewer: { can: 'View projects you are granted and delivered reports.', cannot: 'Edit data, view sensitive evidence or sessions.' },
}
function ProfileMenu() {
  const { me, setMe, theme, setTheme, go, logout, resetDemo, stopOutcome, setStopOutcome, confirm } = useS()
  const [open, setOpen] = useState(false)
  const item = 'flex h-10 w-full items-center gap-2 rounded-[10px] px-3 text-left text-sm text-fg hover:bg-hover'
  const desc = ROLE_DESC[me.role]
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" className="ml-1 flex h-10 items-center gap-2 rounded-[10px] px-2 hover:bg-hover">
        <Avatar name={me.name} size={30} />
        <div className="hidden text-left leading-tight xl:block"><div className="text-sm font-medium">{me.name}</div><div className="text-xs text-muted">{ROLE_LABEL[me.role]}</div></div>
        <ChevronDown size={14} className="text-muted max-xl:hidden" aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div role="menu" className="no-scrollbar absolute right-0 top-full z-50 mt-2 max-h-[calc(100vh-90px)] w-[340px] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border border-line bg-panel p-2 shadow-xl">
            <div className="px-3 pb-1 pt-2"><div className="text-sm font-semibold">{me.name}</div><div className="text-xs text-muted">{ROLE_LABEL[me.role]} · Acme Security (Demo)</div></div>
            <div className="flex items-center justify-between px-3 py-1">
              <span className="text-sm">Theme</span>
              <Segmented value={theme} onChange={(v) => setTheme(v)} options={[{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]} />
            </div>
            <button role="menuitem" className={item} onClick={() => { setOpen(false); go('settings') }}><Settings size={15} aria-hidden />Settings</button>
            <button role="menuitem" className={item} onClick={() => { setOpen(false); logout() }}><LogOut size={15} aria-hidden />Sign out</button>
            <div className="my-2 border-t border-line" />
            <section aria-label="Demo Tools" className="rounded-xl border border-dashed border-line bg-subtle p-2">
              <div className="flex items-center gap-1.5 px-1 pb-1 text-xs font-semibold uppercase tracking-wider text-neutral"><FlaskConical size={13} aria-hidden />Demo Tools</div>
              <p className="px-1 pb-2 text-xs text-muted">Prototype only, hidden in production. Switching persona changes the permissions you see, not real access.</p>
              <div className="px-1 pb-1 text-xs font-medium text-muted">Persona / role</div>
              <div className="no-scrollbar max-h-[200px] overflow-y-auto">
                {USERS.map((u) => (
                  <button key={u.name} role="menuitemradio" aria-checked={u.name === me.name} onClick={() => { setMe(u.name); setOpen(false) }} className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-2 py-1 text-left hover:bg-hover">
                    <Avatar name={u.name} size={26} />
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{u.name}</div><div className="truncate text-xs text-muted">{ROLE_LABEL[u.role]}</div></div>
                    {u.name === me.name && <CheckIcon size={16} className="text-accent" aria-hidden />}
                  </button>
                ))}
              </div>
              {desc && (
                <div className="mx-1 mt-2 rounded-lg border border-line bg-panel p-2 text-xs">
                  <div className="font-semibold">{ROLE_LABEL[me.role]}</div>
                  <p className="mt-1"><span className="font-medium text-ok">Can:</span> <span className="text-muted">{desc.can}</span></p>
                  <p className="mt-1"><span className="font-medium text-bad">Cannot:</span> <span className="text-muted">{desc.cannot}</span></p>
                </div>
              )}
              <div className="px-1 pb-1 pt-3 text-xs font-medium text-muted">Next Emergency Stop ends with</div>
              <div className="px-1"><Segmented value={stopOutcome} onChange={setStopOutcome} options={[{ id: 'ack', label: 'Acknowledged' }, { id: 'fail', label: 'Failed' }, { id: 'unknown', label: 'Unknown' }]} /></div>
              <p className="px-1 pt-1 text-xs text-neutral">Simulates agent acknowledgement. Operations stop only after an acknowledgement.</p>
              <button role="menuitem" className={cx(item, 'mt-2')} onClick={() => confirm({ title: 'Reset demo data?', body: 'All simulated changes are discarded and the seed data is restored. You stay signed in.', confirmLabel: 'Reset demo', danger: true, onConfirm: () => { setOpen(false); resetDemo() } })}><RotateCcw size={15} aria-hidden />Reset demo</button>
              <button role="menuitem" className={item} onClick={() => { setOpen(false); go('scenarios') }}><Home size={15} aria-hidden />Prototype Home</button>
            </section>
          </div>
        </>
      )}
    </div>
  )
}

/* ───────────── Topbar ───────────── */
function Topbar({ openMobile }: { openMobile: () => void }) {
  const s = useS()
  const { route, setNoticesOpen } = s
  const askAi = () => {
    const nav = NAV.flatMap((g) => g.items).find((i) => i.match.includes(route.page))
    const ctx: CopilotCtx = { kind: route.page, id: route.id, label: `${nav?.label || route.page}${route.id ? ' ' + route.id : ''}` }
    setNoticesOpen(false)
    s.setCopilotOpen(true, ctx)
  }
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-line bg-side px-4 lg:px-6 xl:gap-3">
      <IconButton icon={MenuIcon} label="Open menu" onClick={openMobile} className="lg:hidden" />
      <WorkspaceSwitcher />
      <ProjectSwitcher />
      <GlobalSearch />
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <AiStatus />
        {route.page !== 'login' && route.page !== 'ai-operator' && (
          <Button variant="secondary" icon={Sparkles} onClick={askAi} aria-label="Ask AI" title="Ask AI about this page (Copilot)" className="max-xl:!px-3"><span className="max-xl:hidden">Ask AI</span></Button>
        )}
        <Notices />
        <ProfileMenu />
      </div>
    </header>
  )
}

/* ───────────── Project context ribbon + emergency stop ───────────── */
function EmergencyStop({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, project, me, A, go } = useS()
  const [scope, setScope] = useState<'project' | 'workspace'>('project')
  const [reason, setReason] = useState('')
  const [ack, setAck] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (open) { setScope('project'); setReason(''); setAck(false); setErr('') } }, [open])
  if (!project) return null
  const d = db as any
  const running = db.operations.filter((o) => (scope === 'workspace' || o.projectId === project.id) && ['running', 'paused'].includes(o.status))
  const live = ((d.sessions || []) as any[]).filter((x) => (scope === 'workspace' || x.projectId === project.id) && ['connected', 'awaiting'].includes(x.state))
  const submit = () => {
    if (reason.trim().length < 5) { setErr('A reason is required (at least 5 characters). It is recorded in the audit log.'); return }
    if (!ack) { setErr('Confirm that you understand the impact.'); return }
    ;(A as any).emergencyStop(scope, scope === 'workspace' ? 'workspace' : project.id, reason.trim())
    onClose()
    void go
  }
  return (
    <Modal open={open} onClose={onClose} danger title="Emergency Stop" width={560}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="destructive" icon={OctagonX} onClick={submit}>Stop now</Button></>}>
      <div className="space-y-4">
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-muted">Scope</legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-line px-3 text-sm"><input type="radio" name="es-scope" checked={scope === 'project'} onChange={() => setScope('project')} className="accent-[var(--c-accent)]" />This project — {project.id}</label>
          <label className={cx('mt-2 flex min-h-11 items-center gap-2 rounded-[10px] border border-line px-3 text-sm', me.role === 'admin' ? 'cursor-pointer' : 'cursor-not-allowed opacity-50')} title={me.role === 'admin' ? undefined : 'Only workspace admins can stop the entire workspace'}>
            <input type="radio" name="es-scope" disabled={me.role !== 'admin'} checked={scope === 'workspace'} onChange={() => setScope('workspace')} className="accent-[var(--c-accent)]" />Entire workspace{me.role !== 'admin' && <span className="text-xs text-muted"> (admin only)</span>}
          </label>
        </fieldset>
        <div className="rounded-xl border border-bad/30 bg-bad-soft p-3 text-sm">
          <div className="mb-1 font-semibold text-bad">Impact</div>
          <p>{running.length} running or paused operation{running.length === 1 ? '' : 's'}{running.length ? `: ${running.map((o) => o.id).join(', ')}` : ''}.</p>
          <p>{live.length} live session{live.length === 1 ? '' : 's'} will be revoked{live.length ? `: ${live.map((x) => x.id).join(', ')}` : ''}.</p>
          <p className="mt-1 text-muted">Agents stop taking new steps. In-flight steps are marked Unknown.</p>
        </div>
        <Field label="Reason" required error={err}><Textarea value={reason} onChange={(e) => { setReason(e.target.value); setErr('') }} placeholder="Why is this stop needed?" /></Field>
        <Check checked={ack} onChange={(v) => { setAck(v); setErr('') }} label="I understand this halts all activity in the selected scope immediately." />
      </div>
    </Modal>
  )
}

function StopBanner() {
  const { db, pid, A } = useS()
  const st = (db as any).stopState as null | { scope: string; id: string; phase: 'requested' | 'acknowledged' | 'failed' | 'unknown' | 'stopping' | 'stopped'; reason: string; at: string; by?: string }
  const { go } = useS()
  if (!st) return null
  const opProj = st.scope === 'operation' ? db.operations.find((o) => o.id === st.id)?.projectId : ''
  const relevant = pid === 'all' || st.scope === 'workspace' || (st.scope === 'project' && st.id === pid) || opProj === pid
  if (!relevant) return null
  const target = st.scope === 'workspace' ? 'the entire workspace' : `${st.scope} ${st.id}`
  const audit = <Button size="sm" onClick={() => go('settings', { tab: 'audit' })}>View audit log</Button>
  const dismiss = <Button size="sm" variant="ghost" onClick={() => A.resolveStop('dismiss')}>Dismiss</Button>
  const m = {
    requested: { tone: 'warn', icon: Loader2, title: 'Emergency Stop requested — waiting for agent acknowledgement', body: `Nothing has stopped yet. Waiting for agents to confirm halt for ${target}. Do not treat activity as stopped until acknowledged.`, action: audit },
    acknowledged: { tone: 'info', icon: Loader2, title: 'Emergency Stop acknowledged — revoking sessions', body: `Agents confirmed halt for ${target}. Live sessions are being revoked.`, action: audit },
    stopping: { tone: 'info', icon: Loader2, title: 'Emergency Stop acknowledged — revoking sessions', body: `Agents confirmed halt for ${target}. Live sessions are being revoked.`, action: audit },
    stopped: { tone: 'ok', icon: OctagonX, title: 'Stopped — acknowledged by agents', body: `Activity for ${target} has stopped and sessions are revoked.`, action: <div className="flex gap-2">{audit}{dismiss}</div> },
    failed: { tone: 'bad', icon: AlertTriangle, title: 'Emergency Stop failed — no acknowledgement received', body: `Activity for ${target} may still be running. Retry the stop or contact the emergency contact now.`, action: <div className="flex gap-2"><Button size="sm" variant="destructive" icon={RotateCcw} onClick={() => A.retryStop()}>Retry</Button>{audit}{dismiss}</div> },
    unknown: { tone: 'warn', icon: AlertTriangle, title: 'Emergency Stop status unknown — acknowledgement timed out', body: `Cannot confirm that ${target} has halted. Verify out-of-band before confirming.`, action: <div className="flex flex-wrap gap-2"><Button size="sm" variant="primary" onClick={() => A.resolveStop('confirmed-stopped')}>Confirm stopped manually</Button><Button size="sm" variant="destructive" icon={RotateCcw} onClick={() => A.retryStop()}>Retry</Button>{dismiss}</div> },
  }[st.phase] as { tone: 'warn' | 'info' | 'ok' | 'bad'; icon: LucideIcon; title: string; body: string; action: ReactNode }
  return (
    <div className="px-4 pt-4 lg:px-8">
      <Banner tone={m.tone} icon={m.icon} title={m.title} action={m.action}>{m.body} Requested by {st.by || 'unknown'} at {st.at}. Reason: {st.reason}</Banner>
    </div>
  )
}

const TONE_CLS: Record<string, string> = { ok: 'border-ok/30 bg-ok-soft text-ok', warn: 'border-warn/30 bg-warn-soft text-warn', bad: 'border-bad/30 bg-bad-soft text-bad', neutral: 'border-line bg-subtle text-muted', cyan: 'border-cyan/30 bg-info-soft text-cyan' }
const eligLabel = (e: ReturnType<typeof eligibility>) => e.kind === 'closed' ? 'Read-only (closed)' : e.kind === 'locked' ? 'Execution Locked' : 'Execution Eligible'
function EligBadge({ pid }: { pid: string }) {
  const { db, go } = useS()
  const [open, setOpen] = useState(false)
  const e = eligibility(db, pid)
  const label = eligLabel(e)
  const tone = e.kind === 'locked' ? 'bad' : e.kind === 'closed' ? 'neutral' : e.reasons.length ? 'warn' : 'ok'
  return (
    <span className="relative inline-flex">
      <button onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} aria-label={`Execution Eligibility: ${label}. Show conditions`} className={cx('inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium', TONE_CLS[tone])}>
        {e.kind === 'locked' ? <Lock size={12} aria-hidden /> : <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
        {label}<Info size={12} aria-hidden />
      </button>
      <Pop open={open} onClose={() => setOpen(false)} label="Execution eligibility details" width={360}>
        <div className="mb-1 text-sm font-semibold text-fg">{label}</div>
        <p className="mb-1 text-xs text-fg">{e.label}</p>
        <p className="mb-2 text-xs text-muted">Execution Eligibility is project-level and separate from AI mode and operation runtime state. Drafts can always be saved; only Preflight, Run and Submit are gated.</p>
        {e.reasons.length === 0 ? <p className="text-xs text-muted">{e.kind === 'closed' ? 'This project is closed. Reopen it to run operations.' : 'All preflight conditions are met. Preflight must still pass before each run.'}</p> : (
          <ul className="space-y-1.5">
            {e.reasons.map((r) => (
              <li key={r.text} className="flex items-start gap-2 text-xs text-fg"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden /><span className="min-w-0 flex-1">{r.text}</span>{r.to && <button className="shrink-0 font-medium text-accent hover:underline" onClick={() => { setOpen(false); go(r.to!.page, { id: r.to!.id, tab: r.to!.tab }) }}>Fix</button>}</li>
            ))}
          </ul>
        )}
      </Pop>
    </span>
  )
}

function ContextRibbon({ openSwitcher }: { openSwitcher: () => void }) {
  const { project, go, route, pid } = useS()
  const ribbon = 'sticky top-16 z-20 flex min-h-11 shrink-0 items-center gap-3 border-b border-line px-4 py-1.5 text-xs text-muted lg:px-8'
  if (route.page === 'project-new') {
    return (
      <div className={cx(ribbon, 'bg-subtle')}>
        <FolderKanban size={14} className="shrink-0 text-neutral" aria-hidden />
        <span className="min-w-0 flex-1"><span className="font-semibold text-fg">New project — draft not yet saved</span> · no project context applies until it is saved</span>
      </div>
    )
  }
  if (route.page === 'settings') {
    return (
      <div className={cx(ribbon, 'bg-subtle')}>
        <Settings size={14} className="shrink-0 text-neutral" aria-hidden />
        <span className="min-w-0 flex-1"><span className="font-semibold text-fg">Organization-wide settings</span> · Acme Security (Demo) · changes affect every project in the workspace</span>
        {project && <button className="shrink-0 whitespace-nowrap text-accent hover:underline max-md:hidden" onClick={() => go('project', { id: project.id })}>Back to {project.id}</button>}
      </div>
    )
  }
  if (!project || pid === 'all') {
    return (
      <div className={cx(ribbon, 'bg-subtle')}>
        <Layers size={14} className="shrink-0 text-neutral" aria-hidden />
        <span className="min-w-0 flex-1"><span className="font-semibold text-fg">All Projects</span> · aggregate view, read-only. Select a project to run operations or open sessions.</span>
        <Button size="sm" variant="secondary" onClick={openSwitcher}>Select Project</Button>
      </div>
    )
  }
  return <ProjectHeader project={project} />
}

function opRuntime(db: any, pid: string) {
  const ops = (db.operations as any[]).filter((o) => o.projectId === pid)
  const o = ops.find((x) => ['running', 'paused', 'estop'].includes(x.status))
  if (!o) return null
  const review = o.steps.some((x: any) => x.status === 'review')
  const done = o.steps.filter((x: any) => ['ok', 'done'].includes(x.status)).length
  const text = o.status === 'estop' ? 'Emergency stopped' : o.status === 'paused' ? 'Paused' : review ? 'Paused — Awaiting Review' : `Running ${done}/${o.steps.length} steps`
  const tone = o.status === 'estop' ? 'bad' : o.status === 'paused' || review ? 'warn' : 'cyan'
  return { id: o.id as string, text, tone }
}

function ProjectHeader({ project }: { project: NonNullable<ReturnType<typeof useS>['project']> }) {
  const { db, go, can, setFilter, me } = useS()
  const [esOpen, setEsOpen] = useState(false)
  const [det, setDet] = useState(false)
  const [ct, setCt] = useState(false)
  const running = db.operations.filter((o) => o.projectId === project.id && o.status === 'running').length
  const stoppable = db.operations.filter((o) => o.projectId === project.id && ['running', 'paused'].includes(o.status)).length
  const inScope = db.assets.filter((a) => a.projectId === project.id && a.scope === 'in').length
  const rt = opRuntime(db, project.id)
  const stopBusy = !!(db as any).stopState && ['requested', 'acknowledged', 'stopping', 'unknown', 'failed'].includes((db as any).stopState.phase)
  const allowed = (can as any)('estop')
  const stopWhy = !allowed ? 'Your role cannot trigger an Emergency Stop. Ask a Manager or Admin.' : stopBusy ? 'An Emergency Stop is already in progress. See the banner below.' : stoppable === 0 ? 'No running operations to stop in this project.' : ''
  const roe = project.roeStatus === 'approved' ? 'Approved' : project.roeStatus === 'none' ? 'Missing' : project.roeStatus.charAt(0).toUpperCase() + project.roeStatus.slice(1)
  const chip = 'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs hover:bg-hover'
  const goRunning = () => { setFilter('operations.status', 'running'); setDet(false); go('operations') }
  const goInScope = () => { setFilter('assets.scope', 'in'); setDet(false); go('assets') }
  const goRt = () => { setDet(false); if (rt) go('operation', { id: rt.id }) }
  const canContact = (can as any)('viewSensitive')
  const rtChip = rt && <button className={cx(chip, 'border font-medium', TONE_CLS[rt.tone])} onClick={goRt} title={`Operation runtime state: ${rt.id} · ${rt.text}`}><Clock size={12} aria-hidden /><span className="font-mono">{rt.id}</span> · {rt.text}</button>
  return (
    <>
      <div className="sticky top-16 z-20 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line bg-panel px-4 py-1.5 text-xs text-muted lg:px-8">
        {/* Main */}
        <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Project">
          <button onClick={() => go('project', { id: project.id, tab: 'overview' })} title={`${project.id} — ${project.name}. Open project overview`} className="max-w-[min(420px,50vw)] truncate rounded-md text-left text-[13px] font-semibold text-fg hover:text-accent hover:underline"><span className="font-mono">{project.id}</span> — {project.name}</button>
          <Status kind="project" value={project.status} size="sm" />
          <button className={cx(chip, 'border border-line text-fg')} onClick={() => go('project', { id: project.id, tab: 'scope' })} title="Open Scope & ROE"><span className="text-muted">ROE</span> <span className="font-mono">{project.roeVersion.replace(/^.*-(v\d+)$/, '$1')}</span> · {roe}</button>
          <EligBadge pid={project.id} />
        </div>
        {/* Activity (wide screens only; otherwise inside Project details) */}
        <div className="hidden items-center gap-1 min-[1500px]:flex" role="group" aria-label="Activity">
          <button className={cx(chip, running ? 'text-cyan' : '')} onClick={goRunning} title="Open Operations filtered to running"><span className="font-semibold tnum">{running}</span> Running Op{running === 1 ? '' : 's'}</button>
          <button className={chip} onClick={goInScope} title="Open Assets filtered to Approved In Scope"><span className="font-semibold tnum">{inScope}</span> In-Scope Assets</button>
          {rtChip}
        </div>
        {/* Details + Safety */}
        <div className="ml-auto flex shrink-0 items-center gap-2" role="group" aria-label="Safety">
          <span className="relative">
            <button onClick={() => setDet(!det)} aria-haspopup="dialog" aria-expanded={det} className={cx(chip, 'border border-line text-fg')}><MoreHorizontal size={14} aria-hidden />Project details</button>
            <Pop open={det} onClose={() => setDet(false)} label="Project details" align="right" width={380}>
              <div className="mb-2 text-sm font-semibold">{project.id} — {project.name}</div>
              <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-muted">Client</dt><dd>{project.client}</dd>
                <dt className="text-muted">Owner</dt><dd>{project.owner}</dd>
                <dt className="text-muted">Type</dt><dd>{project.type}</dd>
                <dt className="text-muted">Period</dt><dd>{project.start} – {project.end} (UTC+7)</dd>
                <dt className="text-muted">ROE</dt><dd>{project.roeVersion} · {roe}</dd>
              </dl>
              <div className="mt-3 flex flex-col gap-1 border-t border-line pt-2 min-[1500px]:hidden">
                <div className="text-xs font-semibold uppercase tracking-wider text-neutral">Activity</div>
                <button className="flex h-9 items-center justify-between rounded-lg px-2 text-left text-sm hover:bg-hover" onClick={goRunning}>Running Operations<span className="font-semibold tnum">{running}</span></button>
                <button className="flex h-9 items-center justify-between rounded-lg px-2 text-left text-sm hover:bg-hover" onClick={goInScope}>In-Scope Assets<span className="font-semibold tnum">{inScope}</span></button>
                {rt ? <button className="flex h-9 items-center justify-between gap-2 rounded-lg px-2 text-left text-sm hover:bg-hover" onClick={goRt}>Operation runtime<span className="truncate text-xs"><span className="font-mono">{rt.id}</span> · {rt.text}</span></button> : <div className="px-2 text-xs text-muted">No operation is running.</div>}
              </div>
              <div className="mt-3 flex gap-2 border-t border-line pt-3"><Button size="sm" variant="secondary" onClick={() => { setDet(false); go('project', { id: project.id, tab: 'overview' }) }}>Project overview</Button><Button size="sm" variant="secondary" onClick={() => { setDet(false); go('project', { id: project.id, tab: 'scope' }) }}>Scope &amp; ROE</Button></div>
            </Pop>
          </span>
          <span className="relative">
            <button onClick={() => setCt(!ct)} aria-haspopup="dialog" aria-expanded={ct} aria-label={`Emergency contact: ${project.emergency ? 'set' : 'not set'}`} className={cx(chip, 'border text-fg', project.emergency ? 'border-line' : 'border-warn/30 bg-warn-soft text-warn')}>
              <Phone size={13} aria-hidden /><span className="max-2xl:hidden">Emergency contact{project.emergency ? '' : ': not set'}</span><span className="2xl:hidden">Contact</span>
            </button>
            <Pop open={ct} onClose={() => setCt(false)} label="Emergency contact" align="right" width={320}>
              <div className="mb-1 text-sm font-semibold">Emergency contact · {project.id}</div>
              {!canContact ? <p className="text-xs text-muted">Contact details are restricted for your role ({ROLE_LABEL[me.role]}). Ask a project manager.</p>
                : project.emergency ? <><p className="font-medium">{project.emergency}</p><p className="mt-1 text-xs text-muted">Use this contact if an Emergency Stop is not acknowledged. Demo data, not a real number.</p></>
                : <><p className="text-xs text-muted">No emergency contact is set. Execution stays locked until one is added.</p><Button size="sm" className="mt-2" onClick={() => { setCt(false); go('project', { id: project.id, tab: 'scope' }) }}>Set in Scope &amp; ROE</Button></>}
            </Pop>
          </span>
          <Button size="sm" variant="destructive" icon={OctagonX} disabled={!!stopWhy} title={stopWhy || 'Open Emergency Stop confirmation'} onClick={() => setEsOpen(true)}>Emergency Stop</Button>
        </div>
      </div>
      <EmergencyStop open={esOpen} onClose={() => setEsOpen(false)} />
    </>
  )
}

/* ───────────── Global modals ───────────── */
function GlobalModals() {
  const { confirmState, closeConfirm, unsaved, closeUnsaved, toast } = useS()
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { setReason(''); setErr('') }, [confirmState])
  return (
    <>
      <Modal
        open={!!confirmState} onClose={closeConfirm} title={confirmState?.title} danger={confirmState?.danger}
        footer={confirmState && (
          <>
            <Button variant="ghost" onClick={closeConfirm}>{confirmState.cancelLabel || 'Cancel'}</Button>
            <Button variant={confirmState.danger ? 'destructive' : 'primary'} onClick={() => {
              if (confirmState.reasonRequired && reason.trim().length < 5) { setErr('Please enter a reason (at least 5 characters). It will be recorded in the audit log.'); return }
              const f = confirmState.onConfirm; closeConfirm(); f(reason.trim())
            }}>{confirmState.confirmLabel}</Button>
          </>
        )}
      >
        {confirmState && (
          <div className="space-y-4">
            <div className="text-muted">{confirmState.body}</div>
            {confirmState.reasonLabel && <Field label={confirmState.reasonLabel} required={confirmState.reasonRequired} error={err}><Textarea value={reason} onChange={(e) => { setReason(e.target.value); setErr('') }} autoFocus placeholder="Enter a reason…" /></Field>}
            <p className="text-xs text-neutral">This action is recorded in the audit log.</p>
          </div>
        )}
      </Modal>
      <Modal
        open={!!unsaved} onClose={closeUnsaved} title="Unsaved changes"
        footer={unsaved && (
          <>
            <Button variant="ghost" onClick={closeUnsaved}>Stay</Button>
            <Button variant="danger" onClick={() => { const n = unsaved.next; closeUnsaved(); n() }}>Discard &amp; Leave</Button>
            <Button variant="primary" onClick={() => { const u = unsaved; closeUnsaved(); u.save?.(); toast('Draft saved.'); u.next() }}>Save Draft</Button>
          </>
        )}
      >
        <p className="text-muted">You have unsaved changes in this form. If you leave now, they will be lost.</p>
      </Modal>
    </>
  )
}
function Toasts() {
  const { toasts } = useS()
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('pointer-events-auto flex items-start gap-2 rounded-xl border bg-panel px-4 py-3 text-sm shadow-xl', { ok: 'border-ok/50', warn: 'border-warn/50', bad: 'border-bad/50', info: 'border-cyan/50' }[t.kind])}>
          <span className={cx('mt-0.5 font-semibold', { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', info: 'text-cyan' }[t.kind])} aria-hidden>{t.kind === 'ok' ? '✓' : t.kind === 'info' ? 'ℹ' : '!'}</span>{t.text}
        </div>
      ))}
    </div>
  )
}

/* ───────────── Shell ───────────── */
export function Shell({ children }: { children: ReactNode }) {
  const s = useS()
  const { project, loading, me, go, route, copilotOpen, setNoticesOpen, setSwitcherOpen } = s
  const [collapsed, setCollapsed] = useState(false)
  const [mobile, setMobile] = useState(false)
  useEffect(() => { document.title = 'Raptix — AI Red Team Platform' }, [])
  useEffect(() => { if (copilotOpen) setNoticesOpen(false) }, [copilotOpen, setNoticesOpen])
  const wide = isWide(route)
  return (
    <div className="flex h-full bg-bg text-fg">
      <a href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus() }} className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[200] focus:rounded-[10px] focus:bg-accent focus:px-4 focus:py-2 focus:text-white">Skip to main content</a>
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} mobileOpen={mobile} closeMobile={() => setMobile(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar openMobile={() => setMobile(true)} />
        <ContextRibbon openSwitcher={() => setSwitcherOpen(true)} />
        <StopBanner />
        {project && (project.status === 'closed' || project.status === 'cancelled') && (
          <div className="px-4 pt-4 lg:px-8">
            <Banner tone="warn" icon={Lock} title={`Project ${project.id} is ${project.status === 'closed' ? 'closed' : 'cancelled'} — read-only`} action={me.role === 'admin' ? <Button size="sm" onClick={() => go('project', { id: project.id, tab: 'overview' })}>Reopen project</Button> : undefined}>
              Operations, scope edits and finding changes are disabled. Data and reports remain viewable.
            </Banner>
          </div>
        )}
        <main id="main" data-wide={wide ? '' : undefined} className={cx('no-scrollbar min-h-0 flex-1 overflow-y-auto', wide ? 'p-0' : 'px-5 py-6 lg:px-8')} tabIndex={-1}>
          <div className={wide ? 'h-full' : 'mx-auto max-w-[1360px]'}>{loading ? <LoadingState /> : children}</div>
        </main>
      </div>
      <CopilotDrawer />
      <GlobalModals />
      <Toasts />
      <DemoGuide />
    </div>
  )
}
function LoadingState() {
  return (
    <div aria-busy="true" role="status" className="animate-pulse">
      <div className="mb-3 h-7 w-64 rounded bg-hover" /><div className="mb-8 h-4 w-96 max-w-full rounded bg-hover" />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-hover" />)}</div>
      <div className="h-72 rounded-xl bg-hover" />
      <span className="sr-only">Switching project context…</span>
    </div>
  )
}
export type { Route }
export { Tabs, Segmented, Activity, ShieldAlert }
