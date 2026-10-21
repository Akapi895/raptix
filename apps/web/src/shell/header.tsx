/**
 * Header composition (ticket 08c, extracted from the shell monolith).
 *
 * Named compatibility slots: the notifications surface and the copilot
 * trigger mount at fixed positions here. Their default implementations are
 * the legacy components moved verbatim; tickets 59 (notifications) and 60
 * (copilot) replace them through the typed `HeaderSlots` props instead of
 * editing this shared composition, and the integrator serializes that wiring
 * (execution.md). No store state is duplicated: persona/theme/UI panel state
 * reads the shared ticket-05 authorities directly (ticket 67 wave 2 moved
 * this file off the legacy store context).
 */
import { useState, type ComponentType } from 'react'
import {
  Bell, Building2, Check as CheckIcon, CheckCheck, ChevronDown, FlaskConical, Home, Lock, LogOut, Menu as MenuIcon, RotateCcw, Settings, Sparkles,
} from 'lucide-react'
import { useServices } from '../state/services'
import { go, navRawRoute, useRoute } from '../router/navigate'
import { useActiveProject, useMe } from '../state/console'
import { useServiceProjection } from '../state/projection'
import { readHeaderNotices, markAllNoticesRead, type NoticeView } from '../features/notices/service'
import { useSessionStore } from '../state/session'
import { useAuthStore, useProjectStore, useThemeStore, useUiStore, type CopilotCtx } from '../state/stores'
import { signOut } from '../auth/persona'
import { resetDemo } from '../features/demo/runtime'
import { ROLE_LABEL } from '../domain/policy'
import { USERS } from '../domain/catalog';
import { Button, IconButton, Segmented, Avatar, cx } from '../ui/index'
import { MOCK_PROJECT_NAV, NAV } from './nav'
import { Pop } from './pop'
import { ProjectStopControl } from './context-ribbon'
import { ProjectSwitcher } from './project-switcher'
import { GlobalSearch } from './search'

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
const catOf = (n: NoticeView): Chip => {
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
  const read = useServiceProjection(readHeaderNotices)
  const me = useMe()
  const noticesOpen = useUiStore((s) => s.noticesOpen)
  const setNoticesOpen = useUiStore((s) => s.setNoticesOpen)
  const setCopilotOpen = useUiStore((s) => s.setCopilotOpen)
  const services = useServices()
  // Mark only notices visible to the captured persona.
  const markAllRead = () => markAllNoticesRead(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId: 'all', corr: 'legacy' })
  const [tab, setTab] = useState<'unread' | 'all'>('unread')
  const [chip, setChip] = useState<Chip | ''>('')
  const all = read.items
  const unread = all.filter((n) => !n.read).length
  const list = all.filter((n) => (tab === 'all' || !n.read) && (!chip || catOf(n) === chip))
  const toggle = () => { if (!noticesOpen) setCopilotOpen(false); setNoticesOpen(!noticesOpen) }
  const open = (n: (typeof all)[number]) => { setNoticesOpen(false); go(n.to.name, { id: n.to.id }) }
  return (
    <div className="relative">
      <IconButton icon={Bell} label={`Notifications${unread ? ` (${unread} unread)` : ''}`} onClick={toggle} aria-expanded={noticesOpen} />
      {unread > 0 && <span className="pointer-events-none absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold leading-none tnum text-white">{unread}</span>}
      {noticesOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setNoticesOpen(false)} aria-hidden />
          <div role="dialog" aria-label="Notifications" className="fixed left-3 right-3 top-[68px] z-50 rounded-2xl border border-line bg-panel p-3 shadow-xl sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[420px]">
            <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Notifications</h2><button onClick={markAllRead} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"><CheckCheck size={13} aria-hidden />Mark all read</button></div>
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
  const me = useMe()
  const setMe = useAuthStore((s) => s.setMe)
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const stopOutcome = useSessionStore((s) => s.stopOutcome)
  const setStopOutcome = useSessionStore((s) => s.setStopOutcome)
  const confirm = useSessionStore((s) => s.confirm)
  /* The store's logout, verbatim: sign-out through the auth feature action,
     then the raw login navigation (the store entry passed this mount's epoch;
     module callers always write). */
  const logout = () => { signOut(); navRawRoute({ page: 'login' }) }
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

/* ───────────── Copilot trigger (slot default; ticket 60 owns the replacement) ───────────── */
function AskAiButton() {
  const route = useRoute()
  const setNoticesOpen = useUiStore((s) => s.setNoticesOpen)
  const setCopilotOpen = useUiStore((s) => s.setCopilotOpen)
  // The project nav owns project pages; the global nav's Overview also matches some of them.
  const nav = MOCK_PROJECT_NAV.flatMap((g) => g.items).find((i) => i.match.includes(route.page)) ?? NAV.flatMap((g) => g.items).find((i) => i.match.includes(route.page))
  const ctx: CopilotCtx = { kind: route.page, id: route.id, label: `${nav?.label || route.page}${route.id ? ' ' + route.id : ''}` }
  const askAi = () => {
    setNoticesOpen(false)
    setCopilotOpen(true, ctx)
  }
  return <Button variant="secondary" icon={Sparkles} onClick={askAi} aria-label="Ask AI" title="Ask AI about this page (Copilot)" className="max-xl:!px-3"><span className="max-xl:hidden">Ask AI</span></Button>
}

/** Named header mount points (ticket 08). `notifications` → ticket 59, `askAi` → ticket 60; omitted slots keep the legacy implementations. */
export interface HeaderSlots {
  /** Notification bell + panel (ticket 59 replaces the legacy default). */
  notifications?: ComponentType
  /** Copilot trigger button (ticket 60 replaces the legacy default). */
  askAi?: ComponentType
}

/* ───────────── Topbar ───────────── */
export function Topbar({ openMobile, slots = {} }: { openMobile: () => void; slots?: HeaderSlots }) {
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const project = useActiveProject()
  const Notifications = slots.notifications ?? Notices
  const AskAi = slots.askAi ?? AskAiButton
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-line bg-side px-4 lg:px-6 xl:gap-3">
      <IconButton icon={MenuIcon} label="Open menu" onClick={openMobile} className="lg:hidden" />
      <WorkspaceSwitcher />
      <ProjectSwitcher />
      <GlobalSearch />
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {/* Emergency Stop lives in the shared header while a project is open
            (plan 2026-10-16 §3.1): one place, independent of the page. */}
        {project && <ProjectStopControl />}
        {/* Copilot is page-scoped: it only appears inside a project. At the
            global scope there is no page context to ask about (plan 2026-10-16 §5). */}
        {pid !== 'all' && route.page !== 'login' && route.page !== 'ai-operator' && <AskAi />}
        <Notifications />
        <ProfileMenu />
      </div>
    </header>
  )
}
