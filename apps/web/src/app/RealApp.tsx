/**
 * Real-mode workspace: URL-scoped project and planning reads from the new API.
 *
 * - Home is the peer real Projects list; entering a project routes to its
 *   Charter landing (native 13-page nav registry, default 'charter').
 * - Charter and Scope show validated planning documents, never demo content.
 *   Other workspace pages render a
 *   source-styled container with its unavailable state from
 *   src/app/real-capabilities.ts.
 * - Chrome identity is the local operator: no fake owner/member avatars, no
 *   fake counters ('—' for unknown counts), no fake HITL/live badges.
 * - Create waits for the server ACK (peer hook seeds detail + refreshes the
 *   list), then routes to the new real id; unknown projects offer retry of
 *   the root read. All mock App behavior/visuals stay untouched.
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Screen } from '../types'
import type { ProjectViewModel } from '@raptix/web-contracts'
import { useAppRoute, navigateUrl, routePath } from './router'
import { NAV_GROUPS, SCREEN_LABELS } from './navigation'
import { useNarrowViewport } from '../shared/hooks/useNarrowViewport'
import { ApiStatusError } from '../shared/api/errors'
import { useRealProject, useRealProjects } from '../features/projects/hooks/use-real-projects'
import type { CreateProjectInput, RealNewProjectFormError } from '../features/projects/real-project.types'
import { REAL_HOME_COLORS as C, REAL_LIFECYCLE_META, formatPublicCount, formatUpdatedAt } from '../features/projects/real-project.types'
import RealProjectsHome from '../features/projects/components/RealProjectsHome'
import RealNewProjectModal from '../features/projects/components/RealNewProjectModal'
import { ChevronDownIcon, ShieldIcon, UserIcon, XIcon } from '../components/Icons'
import { REAL_FALLBACK_REASON, REAL_UNAVAILABLE_REASONS, toCreateFormError } from './real-capabilities'
import { RealProviders } from './providers'
import RealPlanning from '../features/planning/RealPlanning'
import RealConsole from '../features/agent-runs/RealConsole'
import ConsoleUxDemo, { isUxDemoActive } from '../features/agent-runs/consoleUxDemo'
import RealFindings from '../features/findings-evidence/RealFindings'
import RealInfrastructure from '../features/infrastructure/RealInfrastructure'
import RealAssets from '../features/infrastructure/RealAssets'
import RealLogs from '../features/operations-log/RealLogs'
import RealReports from '../features/reports/RealReports'
import RealSettings from '../features/settings/RealSettings'
import RealCampaigns from '../features/campaigns/RealCampaigns'
import RealC2 from '../features/c2/RealC2'
import RealVault from '../features/vault/RealVault'
import RealMembers from '../features/members/RealMembers'

const MONO = "'JetBrains Mono', monospace"
const CARD_HEAD: CSSProperties = { padding: '14px 16px', borderBottom: `1px solid ${C.border}` }
const NAV_BUTTON = (active: boolean): CSSProperties => ({
  padding: '6px 10px', backgroundColor: active ? '#FEE2E2' : 'transparent',
  borderLeft: active ? '3px solid #DC2626' : '3px solid transparent',
  color: active ? '#991B1B' : '#64748B', fontWeight: active ? 600 : 400, fontSize: 13,
})

export default function RealApp() {
  return <RealProviders><RealRoot /></RealProviders>
}

function RealRoot() {
  const route = useAppRoute()
  const { status, projects, error, reload, createProject } = useRealProjects()
  const [createOpen, setCreateOpen] = useState(false)
  const [createPending, setCreatePending] = useState(false)
  const [createError, setCreateError] = useState<RealNewProjectFormError | null>(null)
  // Refs, not state alone: synchronous double clicks must never double-POST,
  // and a late ACK after a route change must not hijack navigation.
  const createInFlight = useRef(false)
  const createOpenRef = useRef(false)

  useEffect(() => {
    // Browser history navigation must close/clear the modal, never leave an
    // in-flight dialog over an unrelated page (same pattern as mock App).
    createOpenRef.current = false
    setCreateOpen(false)
    setCreateError(null)
  }, [route.screen, route.projectId, route.notFound])

  const openCreate = () => { createOpenRef.current = true; setCreateOpen(true) }
  const closeCreate = () => { createOpenRef.current = false; setCreateOpen(false) }

  const handleCreate = async (input: CreateProjectInput) => {
    if (createInFlight.current) return
    createInFlight.current = true
    setCreatePending(true)
    setCreateError(null)
    try {
      const created = await createProject(input) // server ACK: seeds detail, refreshes list
      if (createOpenRef.current) {
        createOpenRef.current = false
        setCreateOpen(false)
        // Briefing-first flow: the brief is drafted with Soundwave in the
        // Operator Console before execution unlocks, so land there directly.
        navigateUrl(routePath('operator-console', created.id))
      }
    } catch (cause) {
      setCreateError(toCreateFormError(cause))
    } finally {
      createInFlight.current = false
      setCreatePending(false)
    }
  }

  if (route.notFound) {
    return (
      <RealPage>
        <RealStateCard title="Project or page not found" message="This build serves only the 13 workspace pages of real projects.">
          <ActionButton ghost onClick={() => { reload(); navigateUrl('/projects') }}>Retry root read</ActionButton>
          <ActionButton onClick={() => navigateUrl('/projects')}>All projects</ActionButton>
        </RealStateCard>
      </RealPage>
    )
  }
  if (route.screen === 'projects' || !route.projectId) {
    return (
      <>
        <RealProjectsHome
          projects={[...projects]} loading={status === 'loading'} error={error?.message ?? null}
          onEnter={selected => navigateUrl(routePath('charter', selected.id))}
          onCreate={openCreate} onRefresh={reload}
        />
        {createOpen && (
          <RealNewProjectModal onClose={closeCreate} onCreate={handleCreate} pending={createPending} error={createError} />
        )}
      </>
    )
  }
  return (
    <RealProjectWorkspace
      projectId={route.projectId} screen={route.screen} projects={projects}
      listLoading={status === 'loading'} onReloadList={reload}
    />
  )
}

function RealProjectWorkspace({ projectId, screen, projects, listLoading, onReloadList }: {
  projectId: string
  screen: Screen
  projects: readonly ProjectViewModel[]
  listLoading: boolean
  onReloadList: () => void
}) {
  const detail = useRealProject(projectId)
  const narrow = useNarrowViewport()
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => { setMenuOpen(false) }, [projectId, screen])
  const navigate = (next: Screen) => navigateUrl(routePath(next, projectId))

  if (detail.status === 'error') {
    const notFound = detail.error instanceof ApiStatusError && detail.error.isNotFound
    return (
      <RealPage>
        <RealStateCard
          title={notFound ? 'Project not found' : 'Project unavailable'}
          message={detail.error?.message ?? 'The project could not be loaded from the API.'}
        >
          <ActionButton onClick={() => { detail.reload(); onReloadList() }}>Retry</ActionButton>
          <ActionButton ghost onClick={() => navigateUrl('/projects')}>All projects</ActionButton>
        </RealStateCard>
      </RealPage>
    )
  }
  const project = detail.project
  if (!project) {
    return <RealPage><p role="status" style={{ fontSize: 14, color: C.muted }}>Loading project…</p></RealPage>
  }
  return (
    <RealShell
      project={project} projects={projects} listLoading={listLoading} screen={screen}
      navigate={navigate} narrow={narrow} menuOpen={menuOpen}
      onMenu={() => setMenuOpen(true)} onCloseMenu={() => setMenuOpen(false)}
    >
      {screen === 'charter' ? <RealCharterLanding project={project} /> : screen === 'scope-boundaries' ? <div style={{ background: C.page, minHeight: '100%', padding: 24 }}><RealPlanning key={project.id} project={project} scope /></div> : screen === 'operator-console' ? (isUxDemoActive() ? <ConsoleUxDemo key={project.id} project={project} /> : <RealConsole key={project.id} project={project} />) : screen === 'findings' ? <div style={{ height: '100vh' }}><RealFindings key={project.id} project={project} /></div> : screen === 'infrastructure' ? <RealInfrastructure key={project.id} project={project} /> : screen === 'assets' ? <RealAssets key={project.id} project={project} /> : screen === 'logs' ? <RealLogs key={project.id} project={project} /> : screen === 'reports' ? <RealReports key={project.id} project={project} /> : screen === 'project-settings' ? <RealSettings key={project.id} project={project} onDeleted={() => navigateUrl('/projects')} /> : screen === 'vector-campaigns' ? <RealCampaigns key={project.id} project={project} /> : screen === 'c2-sessions' ? <RealC2 key={project.id} project={project} /> : screen === 'credentials' ? <RealVault key={project.id} project={project} /> : screen === 'members' ? <RealMembers key={project.id} project={project} /> : <RealUnavailableScreen screen={screen} project={project} />}
    </RealShell>
  )
}

function RealShell({ project, projects, listLoading, screen, navigate, narrow, menuOpen, onMenu, onCloseMenu, children }: {
  project: ProjectViewModel
  projects: readonly ProjectViewModel[]
  listLoading: boolean
  screen: Screen
  navigate: (next: Screen) => void
  narrow: boolean
  menuOpen: boolean
  onMenu: () => void
  onCloseMenu: () => void
  children: ReactNode
}) {
  const drawerOpen = narrow && menuOpen
  const drawerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!drawerOpen) return
    const previous = document.activeElement as HTMLElement | null
    const drawer = drawerRef.current
    drawer?.querySelector<HTMLElement>('button')?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseMenu(); return }
      if (event.key !== 'Tab' || !drawer) return
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]'))
        .filter(el => el.offsetParent !== null)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus() }
  }, [drawerOpen, onCloseMenu])
  const shellState = !narrow ? 'app-shell-sidebar--static' : drawerOpen ? 'app-shell-sidebar--open' : 'app-shell-sidebar--closed'
  const crumbSep = (
    <svg className="app-shell-header__desktop-crumb shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
  return (
    <div className="flex h-dvh overflow-hidden bg-slate-50">
      {drawerOpen && <div className="app-shell-sidebar-overlay fixed inset-0 z-30" onClick={onCloseMenu} aria-hidden="true" />}
      <aside
        ref={drawerRef}
        inert={narrow && !drawerOpen}
        aria-hidden={narrow && !drawerOpen ? true : undefined}
        role={drawerOpen ? 'dialog' : undefined}
        aria-modal={drawerOpen ? true : undefined}
        aria-label={drawerOpen ? 'Project navigation' : undefined}
        className={`app-shell-sidebar fixed left-0 top-0 h-full flex flex-col z-30 ${narrow ? 'transition-transform duration-200' : ''} ${shellState}`}
        style={{ backgroundColor: '#FFFFFF', borderRight: '1px solid #E2E8F0', maxWidth: narrow ? '85vw' : undefined }}
      >
        <div className="flex items-center px-5 shrink-0" style={{ height: 60, borderBottom: '1px solid #E2E8F0' }}>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center rounded-lg" style={{ width: 30, height: 30, backgroundColor: '#DC2626' }}>
              <ShieldIcon size={14} color="#FFFFFF" />
            </div>
            <div className="flex flex-col leading-tight">
              <span style={{ fontWeight: 800, fontSize: 13, color: '#0F172A', letterSpacing: '0.04em' }}>RAPTIX</span>
              <span style={{ fontWeight: 500, fontSize: 9, color: '#DC2626', letterSpacing: '0.1em' }}>AI OPS</span>
            </div>
          </div>
          {drawerOpen && <button type="button" onClick={onCloseMenu} aria-label="Close navigation" className="ml-auto rounded-lg border px-2 py-1">×</button>}
        </div>
        <div className="px-3 pt-3 pb-2 shrink-0">
          <RealProjectSwitcher project={project} projects={projects} listLoading={listLoading}
            onEnter={selected => navigateUrl(routePath('charter', selected.id))} />
        </div>
        <nav className="flex-1 overflow-y-auto py-2 px-3" style={{ scrollbarWidth: 'none' }}>
          {NAV_GROUPS.map((group, index) => (
            <div key={group.id} className={index > 0 ? 'mt-3' : ''}>
              {group.label && (
                <div className="px-2 pb-1">
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: '#94A3B8', textTransform: 'uppercase' }}>{group.label}</span>
                </div>
              )}
              {group.items.map(item => (
                <button
                  key={item.id} onClick={() => navigate(item.id)} aria-current={screen === item.id ? 'page' : undefined}
                  aria-label={item.label} className="w-full flex items-center gap-2.5 rounded-md text-left transition-all mb-0.5"
                  style={NAV_BUTTON(screen === item.id)}
                >
                  <span className="flex-1 truncate">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="px-4 py-3 flex items-center gap-2.5 shrink-0" style={{ borderTop: '1px solid #E2E8F0' }}>
          <div className="flex items-center justify-center rounded-full shrink-0"
            style={{ width: 28, height: 28, backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0' }}>
            <UserIcon size={13} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="truncate" style={{ fontSize: 11, fontWeight: 600, color: '#0F172A' }}>Local Operator</div>
            <div style={{ fontSize: 10, color: '#64748B' }}>Single-user session</div>
          </div>
        </div>
      </aside>
      <div className="app-shell-content flex-1 min-w-0 flex flex-col overflow-hidden">
        <header className={`app-shell-header fixed top-0 right-0 flex items-center z-20 ${narrow ? 'app-shell-header--mobile' : ''}`}>
          {narrow && (
            <button
              onClick={menuOpen ? onCloseMenu : onMenu} aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
              className="flex items-center justify-center rounded-lg transition-colors hover:bg-slate-50 shrink-0"
              style={{ width: 34, height: 34, border: '1px solid #E2E8F0', color: '#64748B' }}
            >
              {menuOpen ? <XIcon size={15} /> : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              )}
            </button>
          )}
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <button onClick={() => navigateUrl('/projects')} className="app-shell-header__desktop-crumb transition-colors hover:text-red-600"
              style={{ fontSize: 13, color: '#94A3B8', fontWeight: 500, whiteSpace: 'nowrap' }}>
              Projects
            </button>
            {crumbSep}
            <button onClick={() => navigate('charter')} className="app-shell-header__desktop-crumb transition-colors hover:text-red-600 truncate"
              style={{ fontSize: 13, color: '#64748B', fontWeight: 500, maxWidth: 160 }}>
              {project.displayName}
            </button>
            {crumbSep}
            <span className="truncate" title={SCREEN_LABELS[screen]} style={{ fontSize: 13, color: '#0F172A', fontWeight: 600 }}>
              {SCREEN_LABELS[screen]}
            </span>
          </div>
          <span title="Live data from the new Raptix API — no demo data"
            style={{ fontSize: 10, fontWeight: 700, color: '#166534', backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 4, padding: '2px 6px', letterSpacing: '0.08em' }}>
            REAL
          </span>
        </header>
        <main className="app-shell-main flex-1 min-w-0 overflow-auto" id="main-content">
          {children}
        </main>
      </div>
    </div>
  )
}

function RealProjectSwitcher({ project, projects, listLoading, onEnter }: {
  project: ProjectViewModel
  projects: readonly ProjectViewModel[]
  listLoading: boolean
  onEnter: (selected: ProjectViewModel) => void
}) {
  const [open, setOpen] = useState(false)
  const status = REAL_LIFECYCLE_META[project.lifecycleStatus]
  return (
    <div>
      <button onClick={() => setOpen(value => !value)} aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors"
        style={{ border: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
        <div className="flex-1 min-w-0">
          <div className="truncate" style={{ fontSize: 11, fontWeight: 700, color: '#0F172A' }}>{project.displayName}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: status.dot }} />
            <span className="truncate" style={{ fontSize: 10, color: '#64748B' }}>{status.label} • {project.workspaceSlug}</span>
          </div>
        </div>
        <ChevronDownIcon size={12} color="#94A3B8" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-1 rounded-lg overflow-hidden" style={{ border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
          {projects.map(candidate => (
            <button key={candidate.id} onClick={() => { onEnter(candidate); setOpen(false) }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-slate-50"
              style={{ borderBottom: '1px solid #F1F5F9' }}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: REAL_LIFECYCLE_META[candidate.lifecycleStatus].dot }} />
              <span className="truncate flex-1" style={{ fontSize: 12, color: '#0F172A', fontWeight: candidate.id === project.id ? 600 : 400 }}>
                {candidate.displayName}
              </span>
              {candidate.id === project.id && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: '#DC2626' }} />}
            </button>
          ))}
          {projects.length === 0 && (
            <div className="px-3 py-2" style={{ fontSize: 11, color: '#94A3B8' }}>
              {listLoading ? 'Loading projects…' : 'No other projects reported'}
            </div>
          )}
          <button onClick={() => { navigateUrl('/projects'); setOpen(false) }}
            className="w-full px-3 py-2 text-left transition-colors hover:bg-slate-50" style={{ fontSize: 11, color: '#64748B' }}>
            ← All projects
          </button>
        </div>
      )}
    </div>
  )
}

function RealCharterLanding({ project }: { project: ProjectViewModel }) {
  const status = REAL_LIFECYCLE_META[project.lifecycleStatus]
  const reviewed = project.metadataState === 'verified'
  return (
    <div style={{ background: C.page, minHeight: '100%', padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: '0 0 10px', fontSize: 20, fontWeight: 700, color: C.ink }}>
          {project.displayName} — Charter & Rules of Engagement
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: status.bg, color: status.text, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: status.dot, display: 'inline-block' }} />
            {status.label}
          </span>
          <span style={{ background: reviewed ? '#DCFCE7' : '#FFFBEB', color: reviewed ? '#16A34A' : '#D97706', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, border: reviewed ? undefined : '1px solid #FDE68A' }}>
            Metadata {reviewed ? 'verified' : 'needs review'}
          </span>
          <span style={{ background: '#F1F5F9', color: '#475569', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500 }}>
            Updated {formatUpdatedAt(project.updatedAt)}
          </span>
        </div>
      </div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={CARD_HEAD}><span style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>Engagement Identity</span></div>
        <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <IdentityRow label="Workspace slug" value={project.workspaceSlug} mono />
          <IdentityRow label="Display name" value={project.displayName} />
          <IdentityRow label="Target" value={`${project.targetType}: ${project.targetValue}`} mono />
          <IdentityRow label="Authorization" value={project.authorizationConfirmed ? 'Confirmed at creation' : 'Not confirmed'} tone={project.authorizationConfirmed ? 'good' : 'warn'} />
          <IdentityRow label="Metadata state" value={project.metadataState} mono tone={reviewed ? 'good' : 'warn'} />
          <IdentityRow label="Created" value={formatUpdatedAt(project.createdAt)} />
          <IdentityRow label="Reported counts"
            value={`findings ${formatPublicCount(project.findingCount)} • assets ${formatPublicCount(project.assetCount)} • active agents ${formatPublicCount(project.activeAgentCount)}`} />
        </div>
      </div>
      <RealPlanning key={project.id} project={project} />
    </div>
  )
}

function RealUnavailableScreen({ screen, project }: { screen: Screen; project: ProjectViewModel }) {
  return (
    <div style={{ background: C.page, minHeight: '100%', padding: 24 }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ ...CARD_HEAD, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{SCREEN_LABELS[screen]}</span>
          <span style={{ background: '#F1F5F9', color: '#64748B', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
            NOT CONNECTED
          </span>
        </div>
        <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: C.body, lineHeight: 1.6 }}>
            {REAL_UNAVAILABLE_REASONS[screen] ?? REAL_FALLBACK_REASON}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Real mode never falls back to demo fixtures.</p>
          {screen === 'project-settings' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <IdentityRow label="Workspace slug" value={project.workspaceSlug} mono />
              <IdentityRow label="Display name" value={project.displayName} />
              <IdentityRow label="Target" value={`${project.targetType}: ${project.targetValue}`} mono />
              <IdentityRow label="Authorization" value={project.authorizationConfirmed ? 'Confirmed' : 'Not confirmed'} tone={project.authorizationConfirmed ? 'good' : 'warn'} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function IdentityRow({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: 'good' | 'warn' }) {
  return (
    <div style={{ background: C.page, border: `1px solid ${C.border}`, borderRadius: 7, padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{
        fontSize: 13, fontWeight: 500, overflowWrap: 'anywhere',
        color: tone === 'good' ? '#16A34A' : tone === 'warn' ? '#D97706' : C.ink, fontFamily: mono ? MONO : undefined,
      }}>
        {value}
      </div>
    </div>
  )
}

function RealPage({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: C.page, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 48, fontFamily: 'Inter, system-ui, sans-serif' }}>
      {children}
    </div>
  )
}

function RealStateCard({ title, message, children }: { title: string; message: string; children?: ReactNode }) {
  return (
    <div role="alert" style={{ background: '#FEF2F2', border: `1.5px solid ${C.redAlert}`, borderRadius: 10, padding: '20px 24px', maxWidth: 640 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.redAlert }}>{title}</div>
      <div style={{ fontSize: 13, color: C.body, marginTop: 4, lineHeight: 1.5 }}>{message}</div>
      {children && <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>{children}</div>}
    </div>
  )
}

function ActionButton({ ghost, onClick, children }: { ghost?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} style={ghost
      ? { background: '#FFFFFF', color: '#475569', border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 500 }
      : { background: C.red, color: '#FFFFFF', border: 'none', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
      {children}
    </button>
  )
}
