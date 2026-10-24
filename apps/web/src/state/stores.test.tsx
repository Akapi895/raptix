/** Shared state subscriptions, DOM effects and provider isolation on the final interfaces. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { mountConsole } from '../test/helpers'
import { useAuthStore, useProjectStore, useThemeStore, useToastStore, useUiStore } from './stores'
import { selectProject } from '../router/navigate'

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('auth/persona authority', () => {
  it('a persona change reaches mounted selector subscribers', () => {
    const h = mountConsole()
    const { result } = renderHook(() => useAuthStore((s) => s.meName))
    expect(result.current).toBe('Alex Morgan')
    act(() => { useAuthStore.getState().setMe('Pat Kim') })
    expect(result.current).toBe('Pat Kim')
    h.unmount()
  })

  it('independent consumers share persona selection without duplicate state', () => {
    const h = mountConsole()
    const first = renderHook(() => useAuthStore((s) => s.meName))
    const second = renderHook(() => useAuthStore((s) => s.meName))
    act(() => { useAuthStore.getState().setMe('Taylor Chen') })
    expect(first.result.current).toBe('Taylor Chen')
    expect(second.result.current).toBe('Taylor Chen')
    h.unmount()
  })
})

describe('active-project authority', () => {
  it('router project selection reaches mounted selectors', () => {
    const h = mountConsole()
    const { result } = renderHook(() => useProjectStore((s) => s.pid))
    act(() => { useProjectStore.getState().setPid('RT-2026-014') })
    expect(result.current).toBe('RT-2026-014')
    act(() => { selectProject('RT-2026-015') })
    expect(useProjectStore.getState().pid).toBe('RT-2026-015')
    expect(result.current).toBe('RT-2026-015')
    h.unmount()
  })
})

describe('theme authority', () => {
  it('theme changes update subscribers and the document class', () => {
    const h = mountConsole()
    const { result } = renderHook(() => useThemeStore((s) => s.theme))
    act(() => { useThemeStore.getState().setTheme('dark') })
    expect(result.current).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    act(() => { useThemeStore.getState().setTheme('light') })
    expect(result.current).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    h.unmount()
  })
})

describe('toast authority', () => {
  it('ordered notifications reach independent subscribers', () => {
    const h = mountConsole()
    const first = renderHook(() => useToastStore((s) => s.toasts))
    const second = renderHook(() => useToastStore((s) => s.toasts))
    act(() => { useToastStore.getState().toast('from service', 'info') })
    act(() => { useToastStore.getState().toast('from screen', 'warn') })
    expect(first.result.current.map((t) => t.text)).toEqual(['from service', 'from screen'])
    expect(second.result.current.map((t) => t.kind)).toEqual(['info', 'warn'])
    h.unmount()
  })
})

describe('transient UI authority', () => {
  it('opening notices closes the copilot and mode changes reach subscribers', () => {
    const h = mountConsole()
    const { result } = renderHook(() => useUiStore((s) => s))
    act(() => { useUiStore.getState().setCopilotOpen(true, { kind: 'findings', label: 'Findings' }) })
    expect(result.current.copilotOpen).toBe(true)
    expect(result.current.copilotCtx?.label).toBe('Findings')
    act(() => { useUiStore.getState().setNoticesOpen(true) })
    expect(result.current.noticesOpen).toBe(true)
    expect(result.current.copilotOpen).toBe(false)
    act(() => { useUiStore.getState().setAiMode('execution') })
    expect(result.current.aiMode).toBe('execution')
    h.unmount()
  })
})

describe('provider mount lifecycle', () => {
  it('every mount restores shared authorities without cross-mount leakage', () => {
    const a = mountConsole()
    act(() => {
      useAuthStore.getState().setMe('Pat Kim')
      selectProject('RT-2026-014')
      useThemeStore.getState().setTheme('dark')
      useToastStore.getState().toast('stale toast')
      useUiStore.getState().setCopilotOpen(true)
      useUiStore.getState().setAiMode('execution')
    })
    a.unmount()
    const b = mountConsole()
    expect(useAuthStore.getState().meName).toBe('Alex Morgan')
    expect(useProjectStore.getState().pid).toBe('all')
    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(useToastStore.getState().toasts).toEqual([])
    expect(useUiStore.getState().copilotOpen).toBe(false)
    expect(useUiStore.getState().copilotCtx).toBeNull()
    expect(useUiStore.getState().aiMode).toBe('propose')
    b.unmount()
  })

  it('toast timers never restore notifications from a previous mount', () => {
    vi.useFakeTimers()
    const a = mountConsole()
    act(() => { useToastStore.getState().toast('ephemeral') })
    a.unmount()
    const b = mountConsole()
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(useToastStore.getState().toasts.some((t) => t.text === 'ephemeral')).toBe(false)
    b.unmount()
  })
})
