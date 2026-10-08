import { useEffect, useRef, useState } from 'react'
import type { Screen, Project, ProjectStatus } from '../types'
import { NAV_GROUPS, SCREEN_LABELS } from '../app/navigation'

interface Props {
  screen: Screen
  navigate: (s: Screen) => void
  project: Project | null
  allProjects: Project[]
  onHitl: () => void
  hitlPending: boolean
  onSwitchProject: (p: Project) => void
  /** Mobile shell hooks — optional; desktop rendering is unchanged when omitted. */
  open?: boolean
  onClose?: () => void
}

const statusColors: Record<ProjectStatus, string> = {
  active:    '#16A34A',
  planning:  '#2563EB',
  paused:    '#D97706',
  completed: '#64748B',
}

export default function Sidebar({ screen, navigate, project, allProjects, hitlPending, onSwitchProject, open, onClose }: Props) {
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const mobile = open !== undefined
  const drawerOpen = mobile && open === true
  const drawerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!drawerOpen) return
    const previous = document.activeElement as HTMLElement | null
    const drawer = drawerRef.current
    drawer?.querySelector<HTMLButtonElement>('button')?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose?.(); return }
      if (event.key !== 'Tab' || !drawer) return
      const buttons = Array.from(drawer.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled]), a[href]')).filter(button => button.offsetParent !== null)
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus() }
  }, [drawerOpen, onClose])
  const shellState = !mobile
    ? 'app-shell-sidebar--static'
    : drawerOpen
      ? 'app-shell-sidebar--open'
      : 'app-shell-sidebar--closed'

  return (
    <>
      {drawerOpen && (
        <div
          className="app-shell-sidebar-overlay fixed inset-0 z-30"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.45)' }}
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        ref={drawerRef}
        inert={mobile && !drawerOpen}
        aria-hidden={mobile && !drawerOpen ? true : undefined}
        role={drawerOpen ? 'dialog' : undefined}
        aria-modal={drawerOpen ? true : undefined}
        aria-label={drawerOpen ? 'Project navigation' : undefined}
        className={`app-shell-sidebar fixed left-0 top-0 h-full flex flex-col z-30 ${mobile ? 'transition-transform duration-200' : ''} ${shellState}`}
        style={{
          width: 240,
          maxWidth: mobile ? '85vw' : undefined,
          transform: mobile && !drawerOpen ? 'translateX(-100%)' : undefined,
          backgroundColor: '#FFFFFF',
          borderRight: '1px solid #E2E8F0',
        }}
      >
        {/* Logo */}
        <div
          className="flex items-center px-5 shrink-0"
          style={{ height: 60, borderBottom: '1px solid #E2E8F0' }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="flex items-center justify-center rounded-lg"
              style={{ width: 30, height: 30, backgroundColor: '#DC2626' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <div className="flex flex-col leading-tight">
              <span style={{ fontWeight: 800, fontSize: 13, color: '#0F172A', letterSpacing: '0.04em' }}>RAPTIX</span>
              <span style={{ fontWeight: 500, fontSize: 9, color: '#DC2626', letterSpacing: '0.1em' }}>AI OPS</span>
            </div>
          </div>
          {drawerOpen && <button type="button" onClick={onClose} aria-label="Close navigation" className="ml-auto rounded-lg border px-2 py-1">×</button>}
        </div>

        {/* Project selector */}
        {project && (
          <div className="px-3 pt-3 pb-2 shrink-0">
            <button
              onClick={() => setSwitcherOpen(o => !o)}
              aria-expanded={switcherOpen}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors"
              style={{ border: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }}
            >
              <div
                className="flex items-center justify-center rounded shrink-0"
                style={{ width: 22, height: 22, backgroundColor: '#FEE2E2' }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 11, fontWeight: 700, color: '#0F172A', letterSpacing: '0.01em' }} className="truncate">
                  {project.name}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColors[project.status] }} />
                  <span style={{ fontSize: 10, color: '#64748B' }}>{project.currentPhase}</span>
                </div>
              </div>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={`shrink-0 transition-transform ${switcherOpen ? 'rotate-180' : ''}`}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {switcherOpen && (
              <div className="mt-1 rounded-lg overflow-hidden" style={{ border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                {allProjects.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { onSwitchProject(p); setSwitcherOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-slate-50"
                    style={{ borderBottom: '1px solid #F1F5F9' }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: statusColors[p.status] }} />
                    <span style={{ fontSize: 12, color: '#0F172A', fontWeight: p.id === project.id ? 600 : 400 }} className="truncate flex-1">{p.name}</span>
                    {p.id === project.id && (
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: '#DC2626' }} />
                    )}
                  </button>
                ))}
                <button
                  onClick={() => { navigate('projects'); setSwitcherOpen(false) }}
                  className="w-full px-3 py-2 text-left transition-colors hover:bg-slate-50"
                  style={{ fontSize: 11, color: '#64748B' }}
                >
                  ← All projects
                </button>
              </div>
            )}
          </div>
        )}

        {/* Nav — single source of truth: app/navigation NAV_GROUPS */}
        <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-0" style={{ scrollbarWidth: 'none' }}>
          {project ? (
            NAV_GROUPS.map((group, gi) => (
              <div key={gi} className={gi > 0 ? 'mt-3' : ''}>
                {group.label && (
                  <div className="px-2 pb-1">
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: '#94A3B8', textTransform: 'uppercase' }}>
                      {group.label}
                    </span>
                  </div>
                )}
                {group.items.map(item => (
                  <NavButton
                    key={item.id}
                    item={item}
                    active={screen === item.id}
                    onClick={() => navigate(item.id)}
                    hitl={hitlPending && item.id === 'operator-console'}
                  />
                ))}
              </div>
            ))
          ) : (
            <NavButton
              item={{ id: 'projects', label: SCREEN_LABELS.projects }}
              active={true}
              onClick={() => {}}
              hitl={false}
            />
          )}
        </nav>

        {/* User footer */}
        <div
          className="px-4 py-3 flex items-center gap-2.5 shrink-0"
          style={{ borderTop: '1px solid #E2E8F0' }}
        >
          <div
            className="flex items-center justify-center rounded-full shrink-0"
            style={{ width: 28, height: 28, backgroundColor: '#DC2626', color: '#FFFFFF', fontSize: 11, fontWeight: 700 }}
          >
            AK
          </div>
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 11, fontWeight: 600, color: '#0F172A' }} className="truncate">Alex Kim</div>
            <div style={{ fontSize: 10, color: '#64748B' }}>Lead Pentester</div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </div>
      </aside>
    </>
  )
}

function NavButton({
  item, active, onClick, hitl,
}: {
  item: { id: Screen; label: string }
  active: boolean
  onClick: () => void
  hitl: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={item.label}
      className="w-full flex items-center gap-2.5 rounded-md text-left transition-all mb-0.5"
      style={{
        padding: '6px 10px',
        backgroundColor: active ? '#FEE2E2' : 'transparent',
        borderLeft: active ? '3px solid #DC2626' : '3px solid transparent',
        color: active ? '#991B1B' : '#64748B',
        fontWeight: active ? 600 : 400,
        fontSize: 13,
      }}
    >
      <span className="flex-1 truncate">{item.label}</span>

      {/* HITL pending pulse */}
      {hitl && (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: '#EF4444' }} />
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: '#DC2626' }} />
        </span>
      )}

      {/* C2 live badge — demo fixtures only, never a real session feed */}
      {item.id === 'c2-sessions' && !active && (
        <span title="Demo data — no live sessions" style={{
          fontSize: 9, fontWeight: 700, color: '#16A34A',
          backgroundColor: '#DCFCE7', borderRadius: 4,
          padding: '1px 5px', letterSpacing: '0.04em',
        }}>
          3 Live
        </span>
      )}
      {item.id === 'c2-sessions' && active && (
        <span title="Demo data — no live sessions" style={{
          fontSize: 9, fontWeight: 700, color: '#991B1B',
          backgroundColor: '#FECACA', borderRadius: 4,
          padding: '1px 5px', letterSpacing: '0.04em',
        }}>
          3 Live
        </span>
      )}
    </button>
  )
}
