/**
 * Shared UI Zustand authorities (ticket 05, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Persona/auth, active project, theme, toasts and transient UI panels live
 * here as the one authority. The legacy store context forwards its writes
 * into these stores and reads them back out, so legacy and migrated
 * consumers observe the same state without duplicating it. Server entities
 * are NOT here — they belong to the services/Query layer.
 *
 * `resetSharedStores` restores the initial values so a provider mount always
 * starts clean (module singletons would otherwise leak state across mounts),
 * and disposes pending toast timers.
 */
import { create } from 'zustand'
import type { AiMode } from '../domain/entities'

export interface Toast { id: number; kind: 'ok' | 'warn' | 'bad' | 'info'; text: string }
export interface CopilotCtx { kind: string; id?: string; label: string }

/* ── active-project authority ── */
export interface ProjectState {
  pid: string
  setPid(pid: string): void
}
const initialProject = { pid: 'all' }
export const useProjectStore = create<ProjectState>()((set) => ({
  ...initialProject,
  setPid: (pid) => set({ pid }),
}))

/* ── theme authority ── */
export type ThemeName = 'dark' | 'light'
export interface ThemeState {
  theme: ThemeName
  setTheme(theme: ThemeName): void
}
const initialTheme = { theme: 'light' as ThemeName }
export const useThemeStore = create<ThemeState>()((set) => ({
  ...initialTheme,
  setTheme: (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    set({ theme })
  },
}))

/* ── toast authority ── */
export interface ToastState {
  toasts: Toast[]
  toast(text: string, kind?: Toast['kind']): void
  clear(): void
}
const toastTimers = new Set<number>()
export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  toast: (text, kind = 'ok') => {
    const id = Date.now() + Math.random()
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    const timer = window.setTimeout(() => {
      toastTimers.delete(timer)
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))
    }, 4200)
    toastTimers.add(timer)
  },
  clear: () => {
    toastTimers.forEach((t) => window.clearTimeout(t))
    toastTimers.clear()
    set({ toasts: [] })
  },
}))

/* ── transient UI authority (panels, AI mode) ── */
export interface UiState {
  switcherOpen: boolean
  noticesOpen: boolean
  copilotOpen: boolean
  copilotCtx: CopilotCtx | null
  aiMode: AiMode
  setSwitcherOpen(open: boolean): void
  setNoticesOpen(open: boolean): void
  setCopilotOpen(open: boolean, ctx?: CopilotCtx): void
  setAiMode(mode: AiMode): void
  clearTransient(): void
}
const initialUi = {
  switcherOpen: false,
  noticesOpen: false,
  copilotOpen: false,
  copilotCtx: null as CopilotCtx | null,
  aiMode: 'propose' as AiMode,
}
export const useUiStore = create<UiState>()((set) => ({
  ...initialUi,
  setSwitcherOpen: (switcherOpen) => set({ switcherOpen }),
  setNoticesOpen: (noticesOpen) => set(noticesOpen ? { noticesOpen, copilotOpen: false } : { noticesOpen }),
  setCopilotOpen: (copilotOpen, ctx) =>
    set(copilotOpen ? { copilotOpen, noticesOpen: false, ...(ctx ? { copilotCtx: ctx } : {}) } : { copilotOpen }),
  setAiMode: (aiMode) => set({ aiMode }),
  clearTransient: () =>
    set({ switcherOpen: initialUi.switcherOpen, noticesOpen: initialUi.noticesOpen, copilotOpen: initialUi.copilotOpen, copilotCtx: initialUi.copilotCtx }),
}))

/** Restores every authority's initial values and disposes pending toast timers. */
export function resetSharedStores() {
  useProjectStore.setState({ ...initialProject })
  useThemeStore.setState({ ...initialTheme })
  document.documentElement.classList.toggle('dark', initialTheme.theme === 'dark')
  useUiStore.setState({ ...initialUi })
  useToastStore.getState().clear()
}
