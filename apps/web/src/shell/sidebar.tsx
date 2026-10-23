/**
 * Sidebar (ticket 08a, extracted from the shell monolith verbatim): desktop
 * rail with collapse, mobile drawer with overlay/Escape close, and roving
 * keyboard navigation over the nav buttons. State stays composed with the
 * shared store context — nothing is duplicated here.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Crosshair, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { go, goGlobal, useRoute } from '../router/navigate'
import { useActiveProject } from '../state/console'
import { useProjectStore } from '../state/stores'
import { Status, cx } from '../ui/index'
import { NAV, projectNavGroups, projectSection, useBadges } from './nav'

/* The navigation scroller keeps its scrollbar hidden, so a fade at the bottom signals items below the fold. */
function ScrollableNav({ onKeyDown, children }: { onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const [more, setMore] = useState(false)
  const measure = useCallback(() => {
    const el = ref.current
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4)
  }, [])
  useEffect(() => {
    measure()
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure])
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <nav ref={ref} aria-label="Main navigation" onKeyDown={onKeyDown} onScroll={measure} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {children}
      </nav>
      {more && <div data-scroll-fade aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-10" style={{ background: 'linear-gradient(to top, var(--c-side), transparent)' }} />}
    </div>
  )
}

export function Sidebar({ collapsed, setCollapsed, mobileOpen, closeMobile }: { collapsed: boolean; setCollapsed: (b: boolean) => void; mobileOpen: boolean; closeMobile: () => void }) {
  const route = useRoute()
  const badges = useBadges()
  const pid = useProjectStore((s) => s.pid)
  const project = useActiveProject()
  /* Project shell ownership (plan §3.3): the project page itself, or any page
     whose owning section resolves while a project is selected — drill-down to
     operation/session/finding/report keeps the project sidebar. Global pages
     (and any route at the All-Projects scope) keep the global groups. */
  const groups = projectNavGroups()
  const section = projectSection(route, groups)
  const onProjectPage = route.page === 'project' && route.id !== undefined
  const inProject = onProjectPage || (pid !== 'all' && section !== undefined)
  const projectId = onProjectPage ? route.id! : pid
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
      <ScrollableNav onKeyDown={navKey}>
        {inProject ? (
          <div className="mb-4">
            <button
              data-nav onClick={() => { goGlobal('projects'); closeMobile() }}
              className={cx('relative mb-0.5 flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-sm font-medium text-muted transition hover:bg-hover hover:text-fg', compact && 'justify-center px-0', 'focus-visible:outline-2 focus-visible:-outline-offset-2')}
              aria-label={compact ? 'All projects' : undefined} title={compact ? 'All projects' : undefined}
            >
              <ArrowLeft size={18} className="shrink-0" aria-hidden />
              {!compact && <span className="flex-1 truncate text-left">All projects</span>}
            </button>
            {/* Project identity lives here (plan §3.1) — one place, not repeated
                across a ribbon and every page header. */}
            {project && !compact && (
              <button
                data-nav onClick={() => { go('project', { id: projectId, tab: 'overview' }); closeMobile() }}
                className="mb-1 mt-2 flex w-full items-start gap-2 rounded-[10px] px-3 py-2 text-left transition hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2"
                title={`${project.id} — ${project.name}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-fg">{project.name}</span>
                  <span className="mt-1 flex items-center gap-1.5"><Status kind="project" value={project.status} size="sm" /><span className="truncate font-mono text-[11px] text-muted">{project.id}</span></span>
                </span>
              </button>
            )}
            {groups.map((g) => (
              <div key={g.group} className="mt-3">
                {!compact ? <div className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-neutral">{g.group}</div> : <div className="mx-3 mb-2 border-t border-line" />}
                {g.items.map((it) => {
                  /* The project page highlights its tab's owning section (unknown tabs fall back to Overview); a drilled-down resource page highlights its owning section only. */
                  const active = onProjectPage ? (section?.to ?? 'overview') === it.to : section?.to === it.to
                  return (
                    <button
                      key={it.to} data-nav onClick={() => { go('project', { id: projectId, tab: it.to }); closeMobile() }}
                      aria-current={active ? 'page' : undefined}
                      aria-label={compact ? it.label : undefined} title={compact ? it.label : undefined}
                      className={cx('relative mb-0.5 flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition', compact && 'justify-center px-0', 'focus-visible:outline-2 focus-visible:-outline-offset-2', active ? 'bg-accent-soft font-semibold text-fg' : 'text-muted hover:bg-hover hover:text-fg')}
                    >
                      {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-accent" aria-hidden />}
                      <it.icon size={18} className={cx('shrink-0', active && 'text-accent')} aria-hidden />
                      {!compact && <span className="flex-1 truncate text-left">{it.label}</span>}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        ) : NAV.map((g) => (
          <div key={g.group} className="mb-4">
            {!compact ? <div className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-neutral">{g.group}</div> : <div className="mx-3 mb-2 border-t border-line" />}
            {g.items.map((it) => {
              const active = it.match.includes(route.page)
              const n = badges[it.page] || 0
              return (
                <button
                  key={it.page} data-nav onClick={() => { goGlobal(it.page); closeMobile() }} aria-current={active ? 'page' : undefined} aria-label={compact ? (n ? `${it.label}, ${n} pending` : it.label) : undefined} title={compact ? (n ? `${it.label} (${n} pending)` : it.label) : undefined}
                  className={cx('relative mb-0.5 flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition', compact && 'justify-center px-0', 'focus-visible:outline-2 focus-visible:-outline-offset-2', active ? 'bg-accent-soft font-semibold text-fg' : 'text-muted hover:bg-hover hover:text-fg')}
                >
                  {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-accent" aria-hidden />}
                  <it.icon size={18} className={cx('shrink-0', active && 'text-accent')} aria-hidden />
                  {!compact && <span className="flex-1 truncate text-left">{it.label}</span>}
                  {n > 0 && (compact
                    ? <span className="absolute right-1 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-side bg-accent" aria-hidden />
                    : <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-fill px-1.5 text-xs font-semibold tnum text-white" aria-label={`${n} pending`}>{n}</span>)}
                </button>
              )
            })}
          </div>
        ))}
      </ScrollableNav>
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
