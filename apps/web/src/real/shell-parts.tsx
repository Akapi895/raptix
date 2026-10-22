/**
 * Real-mode shell parts (integration ticket 03, ADR-0068). The demo header
 * and context ribbon keep their implementations untouched; the shell mounts
 * these replacements when DATA_MODE is 'real'. Every control here is either
 * backed by the engagement API (project switcher, active engagement) or
 * honestly marked unavailable — no demo surfaces, persona switcher, global
 * search, AI-mode preference or demo Emergency Stop are rendered.
 */
import { useState, type ReactElement } from 'react'
import { ChevronDown, FolderKanban, Layers, Menu as MenuIcon, PlugZap } from 'lucide-react'
import { go, useRoute } from '../router/navigate'
import { useActiveProject } from '../state/console'
import { useProjectStore, useThemeStore, useUiStore } from '../state/stores'
import { REAL_IDENTITY } from './bootstrap'
import { useSession } from '../platform/session'
import { HeaderNotices } from '../features/notices/header-notices'
import { RealSearch } from './screens/search'
import { switchDataMode } from '../state/mode'
import { ProjectSwitcher } from '../shell/project-switcher'
import { RealProjectCreateDialog } from '../features/projects/views/create-page'
import { Avatar, Button, IconButton, Segmented, cx } from '../ui/index'

function RealProfileMenu(): ReactElement {
  const { session } = useSession()
  const name = session?.actor?.displayName ?? REAL_IDENTITY.name
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const [open, setOpen] = useState(false)
  const item = 'flex h-10 w-full items-center gap-2 rounded-[10px] px-3 text-left text-sm text-fg hover:bg-hover'
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" className="ml-1 flex h-10 items-center gap-2 rounded-[10px] px-2 hover:bg-hover">
        <Avatar name={name} size={30} />
        <div className="hidden text-left leading-tight xl:block">
          <div className="text-sm font-medium">{name}</div>
          <div className="text-xs text-muted">{session ? 'Multi-user deployment' : 'Single-user deployment'}</div>
        </div>
        <ChevronDown size={14} className="text-muted max-xl:hidden" aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-[320px] rounded-2xl border border-line bg-panel p-2 shadow-xl">
            <div className="px-3 pb-1 pt-2">
              <div className="text-sm font-semibold">{name}</div>
              <div className="text-xs text-muted">{session ? `Signed in as ${session.actor?.username}` : 'Local single-user mode · no sign-in'}</div>
            </div>
            <div className="flex items-center justify-between px-3 py-1">
              <span className="text-sm">Theme</span>
              <Segmented value={theme} onChange={(v) => setTheme(v)} options={[{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]} />
            </div>
            <div className="my-2 border-t border-line" />
            {session && <button role="menuitem" className={item} onClick={() => { setOpen(false); go('login') }}>Account / sign out</button>}
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
  const setCopilotOpen = useUiStore((s) => s.setCopilotOpen)
  const pid = useProjectStore((s) => s.pid)
  return (
    <header className="sticky top-0 z-30 flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-side px-4 py-2 sm:h-16 sm:flex-nowrap sm:py-0 lg:px-6 xl:gap-3">
      <IconButton icon={MenuIcon} label="Open menu" onClick={openMobile} className="lg:hidden" />
      <ProjectSwitcher />
      <RealProjectCreateDialog />
      <span className="hidden h-6 shrink-0 items-center rounded-full border border-cyan/30 sm:inline-flex bg-info-soft px-2.5 text-xs font-medium text-cyan">Real mode</span>
      <RealSearch />
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {pid !== 'all' && <Button onClick={() => setCopilotOpen(true)}>Ask AI</Button>}
        <HeaderNotices />
        <RealProfileMenu />
      </div>
    </header>
  )
}

export function RealContextRibbon({ openSwitcher }: { openSwitcher: () => void }): ReactElement | null {
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
  /* With an engagement selected there is no separate context bar: identity
     lives in the sidebar header (plan 2026-10-16 §3.1), the same as demo mode. */
  return null
}

/** The copilot drawer has no real integration yet; the slot renders nothing. */
export function RealCopilotStub(): null {
  return null
}
