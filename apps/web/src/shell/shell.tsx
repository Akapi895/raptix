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
import { useEffect, lazy, Suspense, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Activity, Lock, ShieldAlert } from 'lucide-react'
import { go, useRoute } from '../router/navigate'
import type { Route } from '../router/history'
import { useActiveProject, useMe } from '../state/console'
import { useSessionStore } from '../state/session'
import { useToastStore, useUiStore } from '../state/stores'
import { Banner, Button, Modal, Field, Textarea, Tabs, Segmented, cx } from '../ui/index'
import { LazyCopilotDrawer } from '../features/copilot/lazy'
import { DATA_MODE } from '../state/mode'
import { RealContextRibbon, RealTopbar } from '../real/shell-parts'
import { RealCopilotDrawer } from '../real/copilot-drawer'
import { isWide, NAV } from './nav'
import { Sidebar } from './sidebar'
import { Topbar, type HeaderSlots } from './header'
import { ContextRibbon, StopBanner } from './context-ribbon'

/** Shell mount points for the later feature owners (tickets 59/60). */
export interface ShellSlots extends HeaderSlots {
  /** Copilot drawer root (ticket 60 replaces the legacy default). */
  copilotDrawer?: ComponentType
}

/* ───────────── Global modals ───────────── */
/** Exported for the W21 save-contract tests; the Shell renders it once. */
export function GlobalModals() {
  const confirmState = useSessionStore((s) => s.confirmState)
  const closeConfirm = useSessionStore((s) => s.closeConfirm)
  const unsaved = useSessionStore((s) => s.unsaved)
  const closeUnsaved = useSessionStore((s) => s.closeUnsaved)
  const toast = useToastStore((s) => s.toast)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [pending, setPending] = useState(false)
  // W21: Save Draft waits for the save outcome before leaving.
  const [savingDraft, setSavingDraft] = useState(false)
  useEffect(() => { setReason(''); setErr('') }, [confirmState])
  return (
    <>
      <Modal
        open={!!confirmState} onClose={closeConfirm} title={confirmState?.title} danger={confirmState?.danger}
        footer={confirmState && (
          <>
            <Button variant="ghost" onClick={closeConfirm}>{confirmState.cancelLabel || 'Cancel'}</Button>
            <Button variant={confirmState.danger ? 'destructive' : 'primary'} disabled={pending} onClick={() => {
              if (confirmState.reasonRequired && reason.trim().length < 5) { setErr('Please enter a reason (at least 5 characters). It will be recorded in the audit log.'); return }
              const opened = confirmState
              setPending(true)
              // A refusal keeps the dialog open with its reason; an accepted action closes it, unless it has opened another dialog meanwhile.
              new Promise<string | void>((resolve) => resolve(opened.onConfirm(reason.trim()))).then((refusal) => {
                setPending(false)
                if (refusal) { setErr(refusal); return }
                if (useSessionStore.getState().confirmState === opened) closeConfirm()
              }, (error: unknown) => {
                setPending(false)
                setErr(error instanceof Error ? error.message : 'The action could not be completed.')
              })
            }}>{confirmState.confirmLabel}</Button>
          </>
        )}
      >
        {confirmState && (
          <div className="space-y-4">
            <div className="text-muted">{confirmState.body}</div>
            {err && !confirmState.reasonLabel && <p role="alert" className="text-sm text-bad">{err}</p>}
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
            {unsaved.save !== undefined && (
              <Button
                variant="primary"
                disabled={savingDraft}
                onClick={async () => {
                  const u = unsaved
                  setSavingDraft(true)
                  try {
                    await u.save?.()
                    closeUnsaved()
                    toast('Draft saved.')
                    u.next()
                  } catch (err) {
                    toast(err instanceof Error ? `The draft was not saved: ${err.message}` : 'The draft was not saved.', 'bad')
                  } finally { setSavingDraft(false) }
                }}
              >Save Draft</Button>
            )}
          </>
        )}
      >
        <p className="text-muted">You have unsaved changes in this form. If you leave now, they will be lost.</p>
      </Modal>
    </>
  )
}
function Toasts() {
  const toasts = useToastStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" aria-live="polite" aria-atomic="true">
      {toasts.map((t) => (
        <div key={t.id} className={cx('pointer-events-auto flex items-start gap-3 rounded-xl border-l-4 bg-panel px-4 py-3 text-sm shadow-xl', { ok: 'border-l-ok border-ok/30 bg-ok-soft text-ok', warn: 'border-l-warn border-warn/30 bg-warn-soft text-warn', bad: 'border-l-bad border-bad/30 bg-bad-soft text-bad', info: 'border-l-cyan border-cyan/30 bg-info-soft text-cyan' }[t.kind])}>
          <span className={cx('mt-0.5 shrink-0 font-semibold')} aria-hidden>{t.kind === 'ok' ? '✓' : t.kind === 'info' ? 'ℹ' : '!'}</span><span className="flex-1">{t.text}</span>
        </div>
      ))}
    </div>
  )
}

/* ───────────── Route announcement (ticket 64) ───────────── */
/**
 * One polite live region for route changes: the text is written after mount
 * and only when page/id actually changes, so a navigation announces once and
 * same-page tab/filter updates stay silent (no duplicate live-region output).
 */
function RouteAnnouncer() {
  const route = useRoute()
  const ref = useRef<HTMLParagraphElement>(null)
  const nav = NAV.flatMap((g) => g.items).find((i) => i.match.includes(route.page))
  const text = `Navigated to ${nav?.label || route.page}${route.id ? ` ${route.id}` : ''}`
  useEffect(() => {
    if (ref.current) ref.current.textContent = text
  }, [text])
  return <p ref={ref} role="status" aria-live="polite" className="sr-only" data-testid="route-announcer" />
}

/* ───────────── Shell ───────────── */
/* Ticket 70: the walkthrough panel (and the guide corpus it renders) loads on
   demand; the walkthrough state authority (demo/launch) is untouched. */
const DemoGuide = lazy(() => import('../demo/guide').then((m) => ({ default: m.DemoGuide })))

export function Shell({ children, slots = {} }: { children: ReactNode; slots?: ShellSlots }) {
  const project = useActiveProject()
  const loading = useSessionStore((s) => s.loading)
  const me = useMe()
  const copilotOpen = useUiStore((s) => s.copilotOpen)
  const setNoticesOpen = useUiStore((s) => s.setNoticesOpen)
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen)
  const route = useRoute()
  const [collapsed, setCollapsed] = useState(false)
  const [mobile, setMobile] = useState(false)
  useEffect(() => { document.title = 'Raptix — AI Red Team Platform' }, [])
  useEffect(() => { if (copilotOpen) setNoticesOpen(false) }, [copilotOpen, setNoticesOpen])
  const wide = isWide(route)
  const real = DATA_MODE === 'real'
  const CopilotDrawerSlot = real ? RealCopilotDrawer : (slots.copilotDrawer ?? LazyCopilotDrawer)
  return (
    <div className="flex h-full bg-bg text-fg">
      <a href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus() }} className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[200] focus:rounded-[10px] focus:bg-accent focus:px-4 focus:py-2 focus:text-white">Skip to main content</a>
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} mobileOpen={mobile} closeMobile={() => setMobile(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        {real ? <RealTopbar openMobile={() => setMobile(true)} /> : <Topbar openMobile={() => setMobile(true)} slots={slots} />}
        {real ? <RealContextRibbon openSwitcher={() => setSwitcherOpen(true)} /> : <ContextRibbon openSwitcher={() => setSwitcherOpen(true)} />}
        {!real && <StopBanner />}
        {project && (project.status === 'closed' || project.status === 'cancelled') && (
          <div className="px-4 pt-4 lg:px-8">
            <Banner tone="warn" icon={Lock} title={`Project ${project.id} is ${project.status === 'closed' ? 'closed' : 'cancelled'} — read-only`} action={me.role === 'admin' ? <Button size="sm" onClick={() => go('project', { id: project.id, tab: 'overview' })}>Reopen project</Button> : undefined}>
              Operations, scope edits and finding changes are disabled. Data and reports remain viewable.
            </Banner>
          </div>
        )}
        <main id="main" data-wide={wide ? '' : undefined} className={cx('no-scrollbar min-h-0 flex-1 overflow-y-auto', wide ? 'p-0' : 'px-5 py-6 lg:px-8')} tabIndex={-1}>
          <div className={wide ? 'mx-auto h-full max-w-6xl' : 'mx-auto max-w-[1360px]'}>{loading ? <LoadingState /> : children}</div>
        </main>
      </div>
      <CopilotDrawerSlot />
      <GlobalModals />
      <Toasts />
      <RouteAnnouncer />
      {!real && <Suspense fallback={null}><DemoGuide /></Suspense>}
    </div>
  )
}
function LoadingState() {
  return (
    <div aria-busy="true" role="status" className="animate-pulse [animation-duration:1.5s]">
      <div className="mb-3 h-7 w-64 rounded bg-hover" /><div className="mb-8 h-4 w-96 max-w-full rounded bg-hover" />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-hover" />)}</div>
      <div className="h-72 rounded-xl bg-hover" />
      <span className="sr-only">Loading project data…</span>
    </div>
  )
}

/* Legacy re-exports kept on the shell root module for compatibility. */
export type { Route }
export { Tabs, Segmented, Activity, ShieldAlert }
