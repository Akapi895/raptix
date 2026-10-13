/**
 * Session/transient-UI Zustand authority (ticket 67 enabler A — ADR-0067).
 *
 * The legacy store context (src/store.tsx) used to own its transient UI
 * state in local useState/refs: the confirm dialog, the dirty/unsaved
 * navigation guard, the demo live logs, stale-operation marks, persisted
 * list filters, the emergency-stop outcome switch, the AI busy flag and the
 * project-switch loading flag. The backing state lives here as the one
 * authority and the legacy context forwards its reads/writes to it, so
 * legacy and migrated consumers observe the same state without duplicating
 * it. The provider keeps the runtime orchestration (services, timers, demo
 * log rebuilds and the demo wall clock the log timestamps use) — only the
 * state moved.
 *
 * `resetSessionStores` restores the initial values synchronously so a
 * provider mount never inherits a previous mount's session state.
 */
import { create } from 'zustand'
import type { ReactNode } from 'react'

/* ───────────── Live log ───────────── */
export interface LogLine { id: string; ts: string; level: 'INFO' | 'WARN' | 'ERROR'; agent: string; stepId: string; text: string }

/* ───────────── Modal / toast ───────────── */
export interface ConfirmOpts {
  title: string; body: ReactNode; confirmLabel: string; danger?: boolean
  reasonLabel?: string; reasonRequired?: boolean; cancelLabel?: string
  onConfirm: (reason: string) => void
}

/** Navigation held behind the unsaved-changes modal by the dirty guard. */
export interface UnsavedNav { next: () => void; save?: () => void }

export interface SessionState {
  /* confirm dialog */
  confirmState: ConfirmOpts | null
  confirm(o: ConfirmOpts): void
  closeConfirm(): void
  /* dirty/unsaved navigation guard */
  dirty: boolean
  save: (() => void) | undefined
  setDirty(on: boolean, save?: () => void): void
  clearDirty(): void
  unsaved: UnsavedNav | null
  closeUnsaved(): void
  guarded(fn: () => void): void
  /* demo live logs */
  logs: Record<string, LogLine[]>
  setLogs(logs: Record<string, LogLine[]>): void
  pushLog(opId: string, line: Omit<LogLine, 'id' | 'ts'>, ts: string): void
  /* stale-operation marks + persisted list filters */
  staleOps: Record<string, boolean>
  setStale(opId: string, v: boolean): void
  persistFilters: Record<string, unknown>
  setFilter(k: string, v: unknown): void
  /* emergency-stop outcome switch + AI busy + project-switch loading */
  stopOutcome: 'ack' | 'fail' | 'unknown'
  setStopOutcome(o: 'ack' | 'fail' | 'unknown'): void
  aiBusy: string | null
  setAiBusy(v: string | null): void
  loading: boolean
  setLoading(v: boolean): void
  /** Clears the demo's transient state (guard, modals, AI busy, stale marks, filters); the provider rebuilds logs and resetDemo leaves loading/stopOutcome alone. */
  clearTransient(): void
}

const initialSession = {
  confirmState: null as ConfirmOpts | null,
  dirty: false,
  save: undefined as (() => void) | undefined,
  unsaved: null as UnsavedNav | null,
  logs: {} as Record<string, LogLine[]>,
  staleOps: {} as Record<string, boolean>,
  persistFilters: {} as Record<string, unknown>,
  stopOutcome: 'ack' as 'ack' | 'fail' | 'unknown',
  aiBusy: null as string | null,
  loading: false,
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  ...initialSession,
  confirm: (o) => set({ confirmState: o }),
  closeConfirm: () => set({ confirmState: null }),
  /* The guard reads synchronous store state (get()), not a render-synced
     ref: a post-write redirect clears its dirty state and navigates in the
     same tick ("dirty cleared first, the unsaved guard must not hold the
     redirect") before any re-render. zustand's set is synchronous, so the
     clear is visible to the next guarded() call without ref bookkeeping —
     the old dirtyRef staleness hazard cannot recur. */
  setDirty: (on, save) => set(on ? { dirty: true, save } : { dirty: false, save: undefined }),
  clearDirty: () => set({ dirty: false, save: undefined }),
  closeUnsaved: () => set({ unsaved: null }),
  guarded: (fn) => {
    const s = get()
    if (s.dirty) set({ unsaved: { next: fn, save: s.save } })
    else fn()
  },
  setLogs: (logs) => set({ logs }),
  pushLog: (opId, line, ts) =>
    set((s) => ({ logs: { ...s.logs, [opId]: [...(s.logs[opId] || []), { ...line, id: Math.random().toString(36).slice(2), ts }] } })),
  setStale: (opId, v) => set((s) => ({ staleOps: { ...s.staleOps, [opId]: v } })),
  setFilter: (k, v) => set((s) => ({ persistFilters: { ...s.persistFilters, [k]: v } })),
  setStopOutcome: (o) => set({ stopOutcome: o }),
  setAiBusy: (v) => set({ aiBusy: v }),
  setLoading: (v) => set({ loading: v }),
  clearTransient: () =>
    set({ dirty: false, save: undefined, confirmState: null, unsaved: null, aiBusy: null, staleOps: {}, persistFilters: {} }),
}))

/** Restores every session value's initial state (provider-mount safety). */
export function resetSessionStores() {
  useSessionStore.setState({ ...initialSession })
}
