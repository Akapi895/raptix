/**
 * Guided walkthrough panel (ticket 61c).
 *
 * The `DemoGuide` shell panel: renders the active step from the walkthrough
 * state authority (src/demo/launch.ts) and the corpus
 * (src/demo/guides.ts). Identity/auth flow through the shared
 * ticket-05 auth authority, toasts through the toast authority, the projected
 * route comes from the router location; navigation and persona/project writes
 * go through the canonical seams the walkthrough seam composes (jump →
 * setMe/login/selectProject/go — ticket 67 wave 8), and the simulated agent
 * actions run through the demo runtime behind the corpus's {@link DemoKit}
 * seam.
 */
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { ChevronDown, ChevronLeft, ChevronRight, Compass, X } from 'lucide-react'
import { parseLocation } from '../router/history'
import { loseAgent, restoreAgent } from './runtime'
import { useAuthStore, useToastStore } from '../state/stores'
import { GUIDES, type DemoKit, type Dest } from './guides'
import { jump, jumpSeam, setGs, stepArgs, stopGuide, useGs } from './launch'

const same = (a: Dest, b: Dest) => a.page === b.page && (a.id ?? '') === (b.id ?? '') && (a.tab ?? '') === (b.tab ?? '')

/** The kit a simulated step runs with (the demo runtime's agent simulations + the toast authority). */
const kitOf = (toast: DemoKit['toast']): DemoKit => ({
  loseAgent: (id) => loseAgent(id),
  restoreAgent: (id) => restoreAgent(id),
  toast: (text, kind) => toast(text, kind),
})

export function DemoGuide() {
  const meName = useAuthStore((s) => s.meName)
  const authed = useAuthStore((s) => s.authed)
  const toast = useToastStore((s) => s.toast)
  const st = useGs()
  /* Ticket 67 wave 8: the walkthrough seam over the canonical authorities; the
     delayed jump navigate is scoped to this panel's mount. */
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const getS = jumpSeam(() => alive.current)
  const location = useLocation()
  const route = parseLocation({ pathname: location.pathname, search: location.search })
  const g = GUIDES.find((x) => x.id === st.id)

  // Auto-advance when the user reaches the next step's screen on their own.
  useEffect(() => {
    if (!g) return
    const nx = g.steps[st.step + 1]
    if (!nx) return
    const cur: Dest = g.steps[st.step].to
    if (same(nx.to, cur)) return
    if (nx.to.page === route.page && (!nx.to.id || nx.to.id === route.id) && (!nx.to.tab || nx.to.tab === route.tab) && !same(cur, route)) setGs({ step: st.step + 1 })
  }, [route.page, route.id, route.tab]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!g || !authed) return null
  const step = g.steps[st.step]
  const total = g.steps.length
  const a = stepArgs(g, st.step)
  const go = (i: number) => { setGs({ step: i }); const b = stepArgs(g, i); jump(getS, g.steps[i].to, b.persona, b.pid) }
  const onScreen = same(step.to, route)
  const personaMismatch = meName !== a.persona

  if (st.collapsed) {
    return (
      <button className="fixed bottom-3 left-3 z-40 flex items-center gap-2 rounded-full border border-accent-line bg-panel px-3 py-1.5 text-xs font-medium text-accent shadow-md hover:bg-accent-soft" onClick={() => setGs({ collapsed: false })} aria-label="Expand demo walkthrough">
        <Compass size={14} aria-hidden />Demo {g.id} · Step {st.step + 1}/{total}
      </button>
    )
  }
  return (
    <aside className="fixed bottom-3 left-3 z-40 w-72 rounded-lg border border-accent-line bg-panel text-sm shadow-lg" aria-label="Demo walkthrough">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Compass size={14} className="text-accent" aria-hidden />
        <div className="min-w-0 flex-1 leading-tight"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Demo walkthrough · {g.id}</div></div>
        <button className="rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => setGs({ collapsed: true })} aria-label="Collapse walkthrough"><ChevronDown size={14} /></button>
        <button className="rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={stopGuide} aria-label="End walkthrough"><X size={14} /></button>
      </div>
      <div className="space-y-2 px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2"><span className="font-semibold text-accent">Step {st.step + 1}/{total}</span><span className="truncate text-[11px] text-muted">{a.persona}</span></div>
        <div className="font-medium leading-snug">{step.t}</div>
        <p className="text-xs text-muted"><b className="text-fg">Why it matters:</b> {step.why}</p>
        <p className="text-xs text-muted"><b className="text-fg">Do this:</b> {step.act}</p>
        {personaMismatch && <p className="rounded border border-line bg-side px-2 py-1 text-[11px] text-muted">This step is played by {a.persona}; Go to this screen switches the demo persona.</p>}
        {onScreen
          ? <p className="text-[11px] text-ok">You are on this screen. Click Next when done{g.steps[st.step + 1] ? ', or open the next screen and the guide advances itself.' : '.'}</p>
          : <p className="text-[11px] text-muted">Tip: opening the next step's screen advances this guide automatically.</p>}
        {step.run && <button className="h-8 w-full rounded-md border border-accent-line bg-accent-soft px-3 text-xs font-medium text-accent hover:opacity-90" onClick={() => step.run!(kitOf(toast))}>Simulated action: {step.runLabel}</button>}
        <button className="h-8 w-full rounded-md bg-accent px-3 text-xs font-medium text-white hover:opacity-90" onClick={() => go(st.step)}>Go to this screen</button>
        <div className="flex items-center justify-between gap-2">
          <button className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-xs hover:bg-hover disabled:opacity-40" disabled={st.step === 0} onClick={() => go(st.step - 1)}><ChevronLeft size={13} aria-hidden />Prev</button>
          {st.step === total - 1
            ? <button className="h-7 rounded-md border border-line px-2 text-xs hover:bg-hover" onClick={stopGuide}>Finish</button>
            : <button className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-xs hover:bg-hover" onClick={() => go(st.step + 1)}>Next<ChevronRight size={13} aria-hidden /></button>}
        </div>
      </div>
    </aside>
  )
}
