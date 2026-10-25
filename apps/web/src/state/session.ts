/**
 * Session/transient-UI Zustand authority (ticket 67 enabler A — ADR-0067).
 *
 * Holds the confirm dialog, the dirty/unsaved navigation guard, persisted
 * list filters and the project-switch loading flag.
 *
 * `resetSessionStores` restores the initial values synchronously so a
 * provider mount never inherits a previous mount's session state.
 */
import { create } from 'zustand'
import { useEffect, useRef, useState, type ReactNode } from 'react'

/* ───────────── Modal / toast ───────────── */
export interface ConfirmOpts {
  title: string; body: ReactNode; confirmLabel: string; danger?: boolean
  reasonLabel?: string; reasonRequired?: boolean; cancelLabel?: string
  /** Returns a refusal message to keep the dialog open with that reason; returns nothing when the action was accepted. */
  onConfirm: (reason: string) => ConfirmOutcome | Promise<ConfirmOutcome>
}

/** A refusal message, or nothing once the action is accepted. */
export type ConfirmOutcome = string | void

/** Navigation held behind the unsaved-changes modal by the dirty guard. */
/** W21: a save is an async contract — the guard waits for the outcome before navigating. */
export interface UnsavedNav { next: () => void; save?: () => Promise<unknown> | unknown }

export interface SessionState {
  /* confirm dialog */
  confirmState: ConfirmOpts | null
  confirm(o: ConfirmOpts): void
  closeConfirm(): void
  /* dirty/unsaved navigation guard */
  dirty: boolean
  save: (() => Promise<unknown> | unknown) | undefined
  /** W21: every currently-dirty owner and its save callback; the public `dirty`/`save` derive from this so one form's unmount never clears another's draft. */
  owners: Record<string, (() => Promise<unknown> | unknown) | null>
  setDirty(on: boolean, save?: () => Promise<unknown> | unknown, owner?: string): void
  /** W21: only the owning form's unmount clears the shared dirty flag. */
  clearDirtyIf(owner: string): void
  /** W21: awaits every currently-dirty form's save callback (no form's draft is silently dropped). */
  saveAllDirty(): Promise<void>
  clearDirty(): void
  unsaved: UnsavedNav | null
  closeUnsaved(): void
  guarded(fn: () => void): void
  /* persisted list filters + project-switch loading */
  persistFilters: Record<string, unknown>
  setFilter(k: string, v: unknown): void
  loading: boolean
  setLoading(v: boolean): void
}

const initialSession = {
  confirmState: null as ConfirmOpts | null,
  dirty: false,
  save: undefined as (() => Promise<unknown> | unknown) | undefined,
  owners: {} as Record<string, (() => Promise<unknown> | unknown) | null>,
  unsaved: null as UnsavedNav | null,
  persistFilters: {} as Record<string, unknown>,
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
  /* W21: dirty ownership — an `on` claim takes over the flag; a `clear` only
     lands when the caller owns the current flag, so two mounted forms never
     erase each other's unsaved state. */
  setDirty: (on, save, owner) => {
    const s = get()
    const key = owner ?? ''
    const owners = { ...s.owners }
    if (on) owners[key] = save ?? null
    else if (owner === undefined) for (const existing of Object.keys(owners)) delete owners[existing]
    else delete owners[key]
    const keys = Object.keys(owners)
    const last = keys.length > 0 ? keys[keys.length - 1]! : null
    set({
      owners,
      dirty: keys.length > 0,
      save: last === null ? undefined : owners[last] ?? undefined,
    })
  },
  clearDirtyIf: (owner) => {
    const s = get()
    const key = owner ?? ''
    if (s.owners[key] === undefined) return
    const owners = { ...s.owners }
    delete owners[key]
    const keys = Object.keys(owners)
    const last = keys.length > 0 ? keys[keys.length - 1]! : null
    set({
      owners,
      dirty: keys.length > 0,
      save: last === null ? undefined : owners[last] ?? undefined,
    })
  },
  clearDirty: () => set({ dirty: false, save: undefined, owners: {} }),
  saveAllDirty: async () => {
    for (const callback of Object.values(get().owners)) if (callback) await callback()
  },
  closeUnsaved: () => set({ unsaved: null }),
  guarded: (fn) => {
    const s = get()
    if (s.dirty) {
      const hasSave = Object.values(s.owners).some((callback) => callback !== null && callback !== undefined)
      set({ unsaved: { next: fn, save: hasSave ? () => get().saveAllDirty() : undefined } })
    } else fn()
  },
  setFilter: (k, v) => set((s) => ({ persistFilters: { ...s.persistFilters, [k]: v } })),
  setLoading: (v) => set({ loading: v }),
}))

/** Restores every session value's initial state (provider-mount safety). */
export function resetSessionStores() {
  useSessionStore.setState({ ...initialSession })
}

/** Registers unsaved changes and the latest draft save callback (W21: async outcome, form-owned flag). */
export function useDirty(isDirty: boolean, save?: () => Promise<unknown> | unknown): void {
  const setDirty = useSessionStore((s) => s.setDirty)
  const clearDirtyIf = useSessionStore((s) => s.clearDirtyIf)
  const [owner] = useState(`form-${Math.random().toString(36).slice(2)}`)
  const saveRef = useRef(save)
  saveRef.current = save
  // W21: a form without a real save callback registers no save — the guard
  // must not offer "Save Draft" (and toast success) when nothing persists.
  const hasSave = save !== undefined
  useEffect(() => {
    setDirty(isDirty, hasSave ? () => saveRef.current?.() : undefined, owner)
    return () => { clearDirtyIf(owner) }
  }, [isDirty, hasSave, setDirty, clearDirtyIf, owner])
}
