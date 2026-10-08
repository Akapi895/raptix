import type { Screen, Project } from '../types'
import { SCREEN_LABELS } from '../app/navigation'

interface Props {
  screen: Screen
  project: Project | null
  navigate: (s: Screen) => void
  onHitl: () => void
  hitlPending: boolean
  /** Mobile shell hooks — optional; desktop rendering is unchanged when omitted. */
  onMenu?: () => void
  open?: boolean
  onClose?: () => void
}

export default function Header({ screen, project, navigate, onHitl, hitlPending, onMenu, open, onClose }: Props) {
  const mobile = open !== undefined

  return (
    <header
      className={`app-shell-header fixed top-0 right-0 flex items-center z-20 ${mobile ? 'app-shell-header--mobile' : ''}`}
    >
      {/* Mobile navigation toggle */}
      {mobile && (open ? (
        <button
          onClick={onClose}
          aria-label="Close navigation"
          className="flex items-center justify-center rounded-lg transition-colors hover:bg-slate-50 shrink-0"
          style={{ width: 34, height: 34, border: '1px solid #E2E8F0', color: '#64748B' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      ) : (
        <button
          onClick={onMenu}
          aria-label="Open navigation"
          className="flex items-center justify-center rounded-lg transition-colors hover:bg-slate-50 shrink-0"
          style={{ width: 34, height: 34, border: '1px solid #E2E8F0', color: '#64748B' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      ))}

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <button
          onClick={() => navigate('projects')}
          className="app-shell-header__desktop-crumb transition-colors hover:text-red-600"
          style={{ fontSize: 13, color: '#94A3B8', fontWeight: 500, whiteSpace: 'nowrap' }}
        >
          Projects
        </button>
        <svg className="app-shell-header__desktop-crumb shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {project && (
          <>
            <button
              onClick={() => navigate('charter')}
              className="app-shell-header__desktop-crumb transition-colors hover:text-red-600 truncate"
              style={{ fontSize: 13, color: '#64748B', fontWeight: 500, maxWidth: 160 }}
            >
              {project.name}
            </button>
            <svg className="app-shell-header__desktop-crumb shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </>
        )}
        <span className="truncate" title={SCREEN_LABELS[screen]} style={{ fontSize: 13, color: '#0F172A', fontWeight: 600 }}>
          {SCREEN_LABELS[screen]}
        </span>
      </div>

      {/* Demo indicator — frontend visual only; fixtures, no backend */}
      <span
        className="app-shell-header__demo shrink-0"
        title="Demo build — mock data, no backend connected"
        style={{
          fontSize: 10, fontWeight: 700, color: '#94A3B8',
          backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0',
          borderRadius: 4, padding: '2px 6px', letterSpacing: '0.08em',
        }}
      >
        DEMO
      </span>

      {/* Search — visual only, matches source shell */}
      <div
        className="app-shell-header__search flex items-center gap-2 rounded-lg px-3"
        style={{ width: 220, height: 34, backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0' }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          aria-label="Search"
          placeholder="Search..."
          className="bg-transparent outline-none flex-1"
          style={{ fontSize: 13, color: '#0F172A' }}
        />
      </div>

      {/* HITL button */}
      {hitlPending && (
        <button
          onClick={onHitl}
          aria-label="HITL Pending"
          className="shrink-0 flex items-center gap-1.5 rounded-lg px-3 transition-all hover:brightness-95"
          style={{
            height: 34,
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            color: '#DC2626',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
          </span>
          <span className="app-shell-header__hitl-text">HITL Pending</span>
        </button>
      )}

      {/* Bell */}
      <button
        className="app-shell-header__bell flex items-center justify-center rounded-lg transition-colors hover:bg-slate-50"
        style={{ width: 34, height: 34, border: '1px solid #E2E8F0', color: '#64748B' }}
        aria-label="Notifications"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </button>

      {/* Avatar */}
      <div
        className="app-shell-header__avatar shrink-0 flex items-center justify-center rounded-full cursor-pointer"
        style={{ width: 32, height: 32, backgroundColor: '#DC2626', color: '#FFFFFF', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em' }}
      >
        AK
      </div>
    </header>
  )
}
