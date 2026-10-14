/**
 * Real-mode shell parts (integration ticket 03, ADR-0068). The demo header
 * and context ribbon keep their implementations untouched; the shell mounts
 * these replacements when DATA_MODE is 'real'. Every control here is either
 * backed by the engagement API (project switcher, active engagement) or
 * honestly marked unavailable — no demo surfaces, persona switcher, global
 * search, AI-mode preference or demo Emergency Stop are rendered.
 */
import { useState, type ReactElement } from 'react'
import { Bell, ChevronDown, FolderKanban, Layers, Menu as MenuIcon, PlugZap } from 'lucide-react'
import { go, useRoute } from '../router/navigate'
import { useActiveProject } from '../state/console'
import { useProjectStore, useThemeStore } from '../state/stores'
import { REAL_IDENTITY, REAL_PERSONA } from './bootstrap'
import { switchDataMode } from './mode'
import { ProjectSwitcher } from '../shell/project-switcher'
import { Pop } from '../shell/pop'
import { Avatar, Button, IconButton, Segmented, Status, cx } from '../ui'

function RealNotices(): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative">
      <IconButton icon={Bell} label="Notifications (not integrated in real mode)" onClick={() => setOpen(!open)} aria-expanded={open} />
      <Pop open={open} onClose={() => setOpen(false)} label="Notifications" align="right" width={340}>
        <div className="text-sm font-semibold">Notifications are not integrated yet</div>
        <p className="mt-1 text-xs text-muted">Real mode does not generate demo notices. Notification integration arrives with a later ticket of the approved plan.</p>
      </Pop>
    </span>
  )
}

function RealProfileMenu(): ReactElement {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const [open, setOpen] = useState(false)
  const item = 'flex h-10 w-full items-center gap-2 rounded-[10px] px-3 text-left text-sm text-fg hover:bg-hover'
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" className="ml-1 flex h-10 items-center gap-2 rounded-[10px] px-2 hover:bg-hover">
        <Avatar name={REAL_PERSONA.name} size={30} />
        <div className="hidden text-left leading-tight xl:block">
          <div className="text-sm font-medium">{REAL_IDENTITY.name}</div>
          <div className="text-xs text-muted">Single-user deployment</div>
        </div>
        <ChevronDown size={14} className="text-muted max-xl:hidden" aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-[320px] rounded-2xl border border-line bg-panel p-2 shadow-xl">
            <div className="px-3 pb-1 pt-2">
              <div className="text-sm font-semibold">{REAL_IDENTITY.name}</div>
              <div className="text-xs text-muted">Local single-user mode · no sign-in</div>
            </div>
            <div className="flex items-center justify-between px-3 py-1">
              <span className="text-sm">Theme</span>
              <Segmented value={theme} onChange={(v) => setTheme(v)} options={[{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]} />
            </div>
            <div className="my-2 border-t border-line" />
            <button role="menuitem" className={item} onClick={() => { setOpen(false); switchDataMode('mock') }}>
              <PlugZap size={15} aria-hidden />Switch to demo mode
            </button>
            <p className="px-3 pb-2 pt-1 text-xs text-neutral">Demo mode shows simulated data. Switching modes reloads the console.</p>
          </div>
        </>
      )}
    </div>
  )
}

export function RealTopbar({ openMobile }: { openMobile: () => void }): ReactElement {
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-line bg-side px-4 lg:px-6 xl:gap-3">
      <IconButton icon={MenuIcon} label="Open menu" onClick={openMobile} className="lg:hidden" />
      <ProjectSwitcher />
      <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-cyan/30 bg-info-soft px-2.5 text-xs font-medium text-cyan">Real mode</span>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <RealNotices />
        <RealProfileMenu />
      </div>
    </header>
  )
}

export function RealContextRibbon({ openSwitcher }: { openSwitcher: () => void }): ReactElement {
  const project = useActiveProject()
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const ribbon = 'sticky top-16 z-20 flex min-h-11 shrink-0 items-center gap-3 border-b border-line px-4 py-1.5 text-xs text-muted lg:px-8'
  if (route.page === 'project-new') {
    return (
      <div className={cx(ribbon, 'bg-subtle')}>
        <FolderKanban size={14} className="shrink-0 text-neutral" aria-hidden />
        <span className="min-w-0 flex-1"><span className="font-semibold text-fg">New engagement — not yet saved</span> · no engagement context applies until the API creates it</span>
      </div>
    )
  }
  if (!project || pid === 'all') {
    return (
      <div className={cx(ribbon, 'bg-subtle')}>
        <Layers size={14} className="shrink-0 text-neutral" aria-hidden />
        <span className="min-w-0 flex-1"><span className="font-semibold text-fg">All engagements</span> · aggregate view. Select an engagement to open its real detail.</span>
        <Button size="sm" variant="secondary" onClick={openSwitcher}>Select Project</Button>
      </div>
    )
  }
  return (
    <div className="sticky top-16 z-20 flex min-h-11 shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line bg-panel px-4 py-1.5 text-xs text-muted lg:px-8">
      <button onClick={() => go('project', { id: project.id })} title={`${project.id} — open the real engagement detail`} className="max-w-[min(420px,50vw)] truncate rounded-md text-left text-[13px] font-semibold text-fg hover:text-accent hover:underline">
        <span className="font-mono">{project.id}</span> — {project.name}
      </button>
      <Status kind="project" value={project.status} size="sm" />
      <span className="min-w-0 flex-1 truncate">Engagement identity from the connected Raptix API.</span>
    </div>
  )
}

/** The copilot drawer has no real integration yet; the slot renders nothing. */
export function RealCopilotStub(): null {
  return null
}
