/**
 * Session subscriptions, synchronous navigation guards, demo lifecycle and
 * cross-mount isolation on the canonical provider and Zustand authority.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { mountServices } from '../test/helpers'
import { currentRoute, go } from '../router/navigate'
import { createChatHandlers } from '../features/aichat/handlers'
import { fastForward, sendChat, stopChat } from '../features/demo/runtime'
import { useSessionStore, type ConfirmOpts } from './session'

afterEach(() => { cleanup() })

const confirmOpts = (over: Partial<ConfirmOpts> = {}): ConfirmOpts => ({
  title: 'Confirm', body: 'body', confirmLabel: 'Go', onConfirm: () => {}, ...over,
})

describe('confirm dialog subscriptions', () => {
  it('a session confirm reaches a mounted subscriber and closes cleanly', () => {
    const h = mountServices()
    const { result } = renderHook(() => useSessionStore((s) => s.confirmState))
    act(() => { useSessionStore.getState().confirm(confirmOpts({ title: 'From session' })) })
    expect(result.current?.title).toBe('From session')
    act(() => { useSessionStore.getState().closeConfirm() })
    expect(result.current).toBeNull()
    h.unmount()
  })

  it('confirm and close update both imperative and subscribed state', () => {
    const h = mountServices()
    const { result } = renderHook(() => useSessionStore((s) => s.confirmState))
    act(() => { useSessionStore.getState().confirm(confirmOpts({ title: 'From legacy' })) })
    expect(useSessionStore.getState().confirmState?.title).toBe('From legacy')
    expect(result.current?.title).toBe('From legacy')
    act(() => { useSessionStore.getState().closeConfirm() })
    expect(result.current).toBeNull()
    expect(useSessionStore.getState().confirmState).toBeNull()
    h.unmount()
  })
})

describe('dirty/unsaved navigation guard', () => {
  it('a dirty session holds navigation and captures its save callback', () => {
    const h = mountServices()
    const save = () => {}
    act(() => { useSessionStore.getState().setDirty(true, save) })
    expect(useSessionStore.getState().dirty).toBe(true)
    h.run(() => { go('projects') })
    const unsaved = useSessionStore.getState().unsaved
    expect(unsaved).not.toBeNull()
    expect(unsaved?.save).toBe(save)
    expect(currentRoute().page).toBe('login')
    act(() => { unsaved!.next() })
    expect(currentRoute().page).toBe('projects')
    expect(useSessionStore.getState().dirty).toBe(false)
    h.unmount()
  })

  it('clear-then-navigate in the same tick is not held by the guard', () => {    const h = mountServices()
    h.run(() => {
      useSessionStore.getState().setDirty(true, () => {})
      useSessionStore.getState().setDirty(false)
      go('projects')
    })
    expect(useSessionStore.getState().unsaved).toBeNull()
    expect(currentRoute().page).toBe('projects')
    h.unmount()
  })

  it('clearing dirty state also clears the save callback', () => {
    const h = mountServices()
    const save = () => {}
    act(() => { useSessionStore.getState().setDirty(true, save) })
    expect(useSessionStore.getState().dirty).toBe(true)
    expect(useSessionStore.getState().save).toBe(save)
    act(() => { useSessionStore.getState().setDirty(false) })
    expect(useSessionStore.getState().dirty).toBe(false)
    expect(useSessionStore.getState().save).toBeUndefined()
    h.unmount()
  })

  it('W21: one form unmounting never clears another form\'s dirty state', () => {
    const h = mountServices()
    act(() => { useSessionStore.getState().setDirty(true, undefined, 'form-a') })
    expect(useSessionStore.getState().dirty).toBe(true)
    act(() => { useSessionStore.getState().setDirty(false, undefined, 'form-b') })
    expect(useSessionStore.getState().dirty).toBe(true)
    act(() => { useSessionStore.getState().clearDirtyIf('form-b') })
    expect(useSessionStore.getState().dirty).toBe(true)
    act(() => { useSessionStore.getState().clearDirtyIf('form-a') })
    expect(useSessionStore.getState().dirty).toBe(false)
    expect(useSessionStore.getState().save).toBeUndefined()
    h.unmount()
  })
})

describe('demo log subscriptions', () => {
  it('a pushed session log reaches a mounted subscriber', () => {
    const h = mountServices()
    const { result } = renderHook(() => useSessionStore((s) => s.logs))
    act(() => { useSessionStore.getState().pushLog('OP-014', { level: 'WARN', agent: '—', stepId: '—', text: 'from session' }, '10:42:00') })
    const lines = result.current['OP-014']
    expect(lines[lines.length - 1]?.text).toBe('from session')
    h.unmount()
  })

  it('demo fast-forward publishes its log mirror to the session authority', () => {
    const h = mountServices()
    h.run(() => { fastForward('OP-014') })
    const lines = useSessionStore.getState().logs['OP-014']
    expect(lines.some((l) => l.text.startsWith('Simulation fast-forward'))).toBe(true)
    h.unmount()
  })
})

describe('transient session subscriptions', () => {
  it('stale-operation marks reach mounted consumers', () => {
    const h = mountServices()
    const { result } = renderHook(() => useSessionStore((s) => s.staleOps))
    h.run(() => { useSessionStore.getState().setStale('OP-014', true) })
    expect(useSessionStore.getState().staleOps['OP-014']).toBe(true)
    act(() => { useSessionStore.getState().setStale('OP-013', true) })
    expect(result.current['OP-013']).toBe(true)
    h.unmount()
  })

  it('persisted list filters reach mounted consumers', () => {
    const h = mountServices()
    const { result } = renderHook(() => useSessionStore((s) => s.persistFilters))
    h.run(() => { useSessionStore.getState().setFilter('agents.status', 'online') })
    expect(useSessionStore.getState().persistFilters['agents.status']).toBe('online')
    act(() => { useSessionStore.getState().setFilter('findings.severity', 'high') })
    expect(result.current['findings.severity']).toBe('high')
    h.unmount()
  })

  it('the emergency-stop outcome switch reaches mounted consumers', () => {
    const h = mountServices()
    const { result } = renderHook(() => useSessionStore((s) => s.stopOutcome))
    h.run(() => { useSessionStore.getState().setStopOutcome('fail') })
    expect(useSessionStore.getState().stopOutcome).toBe('fail')
    act(() => { useSessionStore.getState().setStopOutcome('unknown') })
    expect(result.current).toBe('unknown')
    h.unmount()
  })

  it('the chat lifecycle clears its busy flag and publishes later updates', () => {
    const h = mountServices()
    const { result } = renderHook(() => useSessionStore((s) => s.aiBusy))
    const created = h.run(() => createChatHandlers(h.svc(), { id: 'Alex Morgan', role: 'manager' }, 'all').create('RT-2026-015', 'propose'))
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(created.failure.message)
    const convId = created.data.id
    h.run(() => { sendChat(convId, 'Plan a validation run for the in-scope cloud assets.') })
    expect(useSessionStore.getState().aiBusy).toBe(convId)
    h.run(() => { stopChat(convId) })
    expect(useSessionStore.getState().aiBusy).toBeNull()
    act(() => { useSessionStore.getState().setAiBusy('SS-041') })
    expect(result.current).toBe('SS-041')
    h.unmount()
  })
})

describe('provider mount lifecycle', () => {
  it('repeated mounts never inherit the previous mount\'s session state', () => {
    const a = mountServices()
    act(() => {
      useSessionStore.getState().confirm(confirmOpts())
      useSessionStore.getState().setDirty(true, () => {})
      useSessionStore.getState().pushLog('OP-TEST', { level: 'INFO', agent: '—', stepId: '—', text: 'stale' }, '10:42:00')
      useSessionStore.getState().setStale('OP-014', true)
      useSessionStore.getState().setFilter('agents.status', 'online')
      useSessionStore.getState().setStopOutcome('fail')
      useSessionStore.getState().setAiBusy('conv-1')
      useSessionStore.getState().setLoading(true)
    })
    a.unmount()
    const b = mountServices()
    expect(useSessionStore.getState().confirmState).toBeNull()
    expect(useSessionStore.getState().dirty).toBe(false)
    expect(useSessionStore.getState().save).toBeUndefined()
    expect(useSessionStore.getState().unsaved).toBeNull()
    expect(useSessionStore.getState().logs['OP-TEST']).toBeUndefined()
    expect(useSessionStore.getState().staleOps).toEqual({})
    expect(useSessionStore.getState().persistFilters).toEqual({})
    expect(useSessionStore.getState().stopOutcome).toBe('ack')
    expect(useSessionStore.getState().aiBusy).toBeNull()
    expect(useSessionStore.getState().loading).toBe(false)
    b.unmount()
  })
})
