/**
 * Walkthrough state authority and launch entries (ticket 61c).
 *
 * Module-local state (no persistence): the active guide, step and collapsed
 * flag, subscribed with `useSyncExternalStore`. `jump` switches persona/
 * project as needed (entering the app if needed) and navigates; it drives
 * exactly the navigation a user click would — the persona/project writes go
 * through the shared authorities and the guarded navigate/selectProject
 * seams (ticket 67 wave 8: the seam is narrowed from the legacy store
 * surface, which both panels construct over the canonical authorities).
 */
import { useSyncExternalStore } from 'react'
import { signIn } from '../../auth/persona'
import { currentRoute, go, navRawRoute, selectProject } from '../../router/navigate'
import { isKnownPage, OUTSIDE_SHELL } from '../../router/history'
import { useAuthStore, useProjectStore, useToastStore, type Toast } from '../../state/stores'
import { useSessionStore } from '../../state/session'
import { GUIDES, type Dest, type Guide } from './guides'

/* ── walkthrough state authority (module-local; no localStorage) ── */
interface GS { id: string | null; step: number; collapsed: boolean }
let gs: GS = { id: null, step: 0, collapsed: false }
const subs = new Set<() => void>()
export const setGs = (n: Partial<GS>) => { gs = { ...gs, ...n }; subs.forEach((f) => f()) }
export const useGs = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => gs)
export const stopGuide = () => setGs({ id: null, step: 0 })

/** The navigation seam `jump`/`launchGuide` drive (narrowed from the legacy Store surface — ticket 67 wave 8). */
export interface JumpSeam {
  me: { name: string }
  authed: boolean
  setMe(name: string): void
  login(): void
  pid: string
  setPid(id: string): void
  go(page: string, opts?: { id?: string; tab?: string }): void
  toast(text: string, kind?: Toast['kind']): void
}

/**
 * Builds the seam over the canonical authorities (ticket 67 wave 8). The
 * `login` entry mirrors the legacy store's byte-for-byte (sign in through the
 * auth action, then either reveal the requested route — the safe return — or
 * fall back to the Command Center). `live` scopes the captured navigate to a
 * live component mount: jump's delayed navigate must not move a later
 * mount's route (the mount-epoch isolation the store's epoch-scoped `go`
 * used to give — the wave-6 `useDelayedNav` pattern).
 */
export function jumpSeam(live?: () => boolean): () => JumpSeam {
  return () => ({
    me: { name: useAuthStore.getState().meName },
    authed: useAuthStore.getState().authed,
    setMe: (name) => useAuthStore.getState().setMe(name),
    login: () => {
      signIn(useAuthStore.getState().meName)
      const r = currentRoute()
      if (isKnownPage(r.page) && r.page !== 'login' && !OUTSIDE_SHELL.has(r.page)) {
        useSessionStore.getState().clearDirty()
        return
      }
      navRawRoute({ page: 'command-center' })
    },
    pid: useProjectStore.getState().pid,
    setPid: (id) => selectProject(id),
    go: (page, opts) => { if (!live || live()) go(page, opts) },
    toast: (text, kind) => useToastStore.getState().toast(text, kind),
  })
}

/** Switch persona/project as needed (entering the app if needed), then navigate. */
export function jump(getS: () => JumpSeam, to: Dest, persona?: string, pid?: string) {
  const S = getS()
  if (persona && S.me.name !== persona) S.setMe(persona)
  if (!S.authed) S.login()
  if (pid && S.pid !== pid) S.setPid(pid)
  setTimeout(() => getS().go(to.page, { id: to.id, tab: to.tab }), 120)
}
export const stepArgs = (g: Guide, i: number) => ({ persona: g.steps[i].persona || g.persona, pid: g.steps[i].pid || g.pid })

export function launchGuide(getS: () => JumpSeam, id: string, at = 0) {
  const g = GUIDES.find((x) => x.id === id)
  if (!g) return
  setGs({ id, step: at, collapsed: false })
  const a = stepArgs(g, at)
  jump(getS, g.steps[at].to, a.persona, a.pid)
  setTimeout(() => getS().toast(`${g.id} started as ${a.persona}. Use the Demo walkthrough panel (bottom-left) to follow the steps.`, 'info'), 200)
}
