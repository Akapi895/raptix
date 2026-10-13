/**
 * Walkthrough state authority and launch entries (ticket 61c).
 *
 * Module-local state (no persistence): the active guide, step and collapsed
 * flag, subscribed with `useSyncExternalStore`. `jump` switches persona/
 * project as needed (entering the app if needed) and navigates; it stays on
 * the store's guarded entries, so the walkthrough drives exactly the
 * navigation a user click would.
 */
import { useSyncExternalStore } from 'react'
import type { Store } from '../../store'
import { GUIDES, type Dest, type Guide } from './guides'

/* ── walkthrough state authority (module-local; no localStorage) ── */
interface GS { id: string | null; step: number; collapsed: boolean }
let gs: GS = { id: null, step: 0, collapsed: false }
const subs = new Set<() => void>()
export const setGs = (n: Partial<GS>) => { gs = { ...gs, ...n }; subs.forEach((f) => f()) }
export const useGs = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => gs)
export const stopGuide = () => setGs({ id: null, step: 0 })

/** Switch persona/project as needed (entering the app if needed), then navigate. */
export function jump(getS: () => Store, to: Dest, persona?: string, pid?: string) {
  const S = getS()
  if (persona && S.me.name !== persona) S.setMe(persona)
  if (!S.authed) S.login()
  if (pid && S.pid !== pid) S.setPid(pid)
  setTimeout(() => getS().go(to.page, { id: to.id, tab: to.tab }), 120)
}
export const stepArgs = (g: Guide, i: number) => ({ persona: g.steps[i].persona || g.persona, pid: g.steps[i].pid || g.pid })

export function launchGuide(getS: () => Store, id: string, at = 0) {
  const g = GUIDES.find((x) => x.id === id)
  if (!g) return
  setGs({ id, step: at, collapsed: false })
  const a = stepArgs(g, at)
  jump(getS, g.steps[at].to, a.persona, a.pid)
  setTimeout(() => getS().toast(`${g.id} started as ${a.persona}. Use the Demo walkthrough panel (bottom-left) to follow the steps.`, 'info'), 200)
}
