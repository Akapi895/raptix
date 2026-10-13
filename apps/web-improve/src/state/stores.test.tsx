/**
 * Ticket 05: the shared Zustand authorities are the one owner of persona,
 * active-project, theme, toast and transient UI state. Legacy consumers
 * (store context) and migrated consumers (the stores directly) observe the
 * same changes from either side without duplicate state, every provider
 * mount starts from the initial values, and toast timers are disposed on
 * teardown so they never fire into a later mount.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import { mountStore } from '../test/helpers'
import { useAuthStore, useProjectStore, useThemeStore, useToastStore, useUiStore } from './stores'

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('auth/persona authority', () => {
  it('a persona change through the shared store is observed by legacy consumers', () => {
    const h = mountStore()
    expect(h.store().me.name).toBe('Alex Morgan')
    act(() => { useAuthStore.getState().setMe('Pat Kim') })
    expect(h.store().me.name).toBe('Pat Kim')
    h.unmount()
  })

  it('a legacy setMe forwards into the shared authority (single source of state)', () => {
    const h = mountStore()
    act(() => { h.store().setMe('Taylor Chen') })
    expect(useAuthStore.getState().meName).toBe('Taylor Chen')
    expect(h.store().me.name).toBe(useAuthStore.getState().meName)
    h.unmount()
  })
})

describe('active-project authority', () => {
  it('project switches flow both directions and derive the same project object', () => {
    const h = mountStore()
    act(() => { useProjectStore.getState().setPid('RT-2026-014') })
    expect(h.store().pid).toBe('RT-2026-014')
    expect(h.store().project?.id).toBe('RT-2026-014')
    act(() => { h.store().setPid('RT-2026-015') })
    expect(useProjectStore.getState().pid).toBe('RT-2026-015')
    expect(h.store().project?.id).toBe('RT-2026-015')
    h.unmount()
  })
})

describe('theme authority', () => {
  it('theme changes flow both directions and toggle the document class once', () => {
    const h = mountStore()
    act(() => { useThemeStore.getState().setTheme('dark') })
    expect(h.store().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    act(() => { h.store().setTheme('light') })
    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    h.unmount()
  })
})

describe('toast authority', () => {
  it('toasts raised on either side land in the same list', () => {
    const h = mountStore()
    act(() => { useToastStore.getState().toast('from shared', 'info') })
    act(() => { h.store().toast('from legacy', 'warn') })
    expect(h.store().toasts.map((t) => t.text)).toEqual(['from shared', 'from legacy'])
    expect(useToastStore.getState().toasts).toEqual(h.store().toasts)
    h.unmount()
  })
})

describe('transient UI authority', () => {
  it('panels and AI mode stay consistent across legacy and shared consumers', () => {
    const h = mountStore()
    act(() => { h.store().setCopilotOpen(true, { kind: 'findings', label: 'Findings' }) })
    expect(useUiStore.getState().copilotOpen).toBe(true)
    expect(useUiStore.getState().copilotCtx?.label).toBe('Findings')
    act(() => { useUiStore.getState().setNoticesOpen(true) })
    expect(h.store().noticesOpen).toBe(true)
    expect(h.store().copilotOpen).toBe(false)
    act(() => { useUiStore.getState().setAiMode('execution') })
    expect(h.store().aiMode).toBe('execution')
    h.unmount()
  })
})

describe('provider mount lifecycle', () => {
  it('every mount restores the shared authorities (no cross-mount leakage)', () => {
    const a = mountStore()
    act(() => {
      a.store().setMe('Pat Kim')
      a.store().setPid('RT-2026-014')
      a.store().setTheme('dark')
      a.store().toast('stale toast')
      a.store().setCopilotOpen(true)
      a.store().setAiMode('execution')
    })
    a.unmount()
    const b = mountStore()
    expect(b.store().me.name).toBe('Alex Morgan')
    expect(b.store().pid).toBe('all')
    expect(b.store().theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(b.store().toasts).toEqual([])
    expect(b.store().copilotOpen).toBe(false)
    expect(b.store().copilotCtx).toBeNull()
    expect(b.store().aiMode).toBe('propose')
    b.unmount()
  })

  it('toast timers are disposed on teardown and never fire into the next mount', () => {
    vi.useFakeTimers()
    const a = mountStore()
    act(() => { a.store().toast('ephemeral') })
    a.unmount()
    const b = mountStore()
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(b.store().toasts.some((t) => t.text === 'ephemeral')).toBe(false)
    b.unmount()
  })
})
