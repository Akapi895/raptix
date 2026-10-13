/**
 * Shell root composition (ticket 08e, extracted from the shell monolith):
 * skip link, sidebar, topbar, context ribbon, stop banner, closed-project
 * banner, main region and the global overlays. State stays composed with the
 * shared ticket-05 authorities via the store context — nothing duplicated.
 *
 * Named compatibility slots (tickets 59/60): `notifications` and `askAi`
 * forward to the header; `copilotDrawer` replaces the drawer root. Omitted
 * slots keep the legacy implementations, so this composition is not edited by
 * later feature owners — the integrator wires replacements at the mount site.
 */
import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { Activity, Lock, ShieldAlert } from 'lucide-react'
import { useStore, type Route } from '../store'
import { Banner, Button, Modal, Field, Textarea, Tabs, Segmented, cx } from '../ui'
import { CopilotDrawer } from '../screens/ai-copilot'
import { DemoGuide } from '../screens/demo-guide'
import { isWide } from './nav'
import { Sidebar } from './sidebar'
import { Topbar, type HeaderSlots } from './header'
import { ContextRibbon, StopBanner } from './context-ribbon'

/** Shell mount points for the later feature owners (tickets 59/60). */
export interface ShellSlots extends HeaderSlots {
  /** Copilot drawer root (ticket 60 replaces the legacy default). */
  copilotDrawer?: ComponentType
}

/* ───────────── Global modals ───────────── */
function GlobalModals() {
  const { confirmState, closeConfirm, unsaved, closeUnsaved, toast } = useStore()
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
  const { toasts } = useStore()
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
export function Shell({ children, slots = {} }: { children: ReactNode; slots?: ShellSlots }) {
  const { project, loading, me, go, route, copilotOpen, setNoticesOpen, setSwitcherOpen } = useStore()
  const [collapsed, setCollapsed] = useState(false)
  const [mobile, setMobile] = useState(false)
  useEffect(() => { document.title = 'Raptix — AI Red Team Platform' }, [])
  useEffect(() => { if (copilotOpen) setNoticesOpen(false) }, [copilotOpen, setNoticesOpen])
  const wide = isWide(route)
  const CopilotDrawerSlot = slots.copilotDrawer ?? CopilotDrawer
  return (
    <div className="flex h-full bg-bg text-fg">
      <a href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus() }} className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[200] focus:rounded-[10px] focus:bg-accent focus:px-4 focus:py-2 focus:text-white">Skip to main content</a>
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} mobileOpen={mobile} closeMobile={() => setMobile(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar openMobile={() => setMobile(true)} slots={slots} />
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
      <CopilotDrawerSlot />
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

/* Legacy re-exports kept on the shell root module for compatibility. */
export type { Route }
export { Tabs, Segmented, Activity, ShieldAlert }
