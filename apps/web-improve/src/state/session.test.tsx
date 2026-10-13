/**
 * Ticket 67 enabler A: the session authority (src/state/session.ts) backs the
 * legacy store context's transient UI state. Writes through the session store
 * are observed by legacy `useStore()` consumers and legacy writes are visible
 * in the session store (duality both directions), the dirty/unsaved guard
 * reads synchronous store state (a clear-then-navigate in the same tick is
 * never held), and repeated provider mounts never inherit a previous mount's
 * session state.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import { mountStore } from '../test/helpers'
import { useSessionStore, type ConfirmOpts } from './session'

afterEach(() => { cleanup() })

const confirmOpts = (over: Partial<ConfirmOpts> = {}): ConfirmOpts => ({
  title: 'Confirm', body: 'body', confirmLabel: 'Go', onConfirm: () => {}, ...over,
})

describe('confirm dialog duality', () => {
  it('a write through the session store is observed by the legacy consumer', () => {
    const h = mountStore()
    act(() => { useSessionStore.getState().confirm(confirmOpts({ title: 'From session' })) })
    expect(h.store().confirmState?.title).toBe('From session')
    act(() => { useSessionStore.getState().closeConfirm() })
    expect(h.store().confirmState).toBeNull()
    h.unmount()
  })

  it('a legacy confirm/close forwards into the session authority', () => {
    const h = mountStore()
    act(() => { h.store().confirm(confirmOpts({ title: 'From legacy' })) })
    expect(useSessionStore.getState().confirmState?.title).toBe('From legacy')
    act(() => { h.store().closeConfirm() })
    expect(useSessionStore.getState().confirmState).toBeNull()
    h.unmount()
  })
})

describe('dirty/unsaved guard duality', () => {
  it('a dirty write through the session store holds a legacy navigation behind the unsaved modal', () => {
    const h = mountStore()
    const save = () => {}
    act(() => { useSessionStore.getState().setDirty(true, save) })
    expect(h.store().dirty).toBe(true)
    h.run(() => { h.store().go('projects') })
    const unsaved = useSessionStore.getState().unsaved
    expect(unsaved).not.toBeNull()
    expect(unsaved?.save).toBe(save)
    expect(h.store().route.page).toBe('login')
    act(() => { unsaved!.next() })
    expect(h.store().route.page).toBe('projects')
    expect(useSessionStore.getState().dirty).toBe(false)
    h.unmount()
  })

  it('a legacy clear-then-navigate in the same tick is not held by the guard', () => {
    const h = mountStore()
    h.run(() => {
      h.store().setDirty(true, () => {})
      h.store().setDirty(false)
      h.store().go('projects')
    })
    expect(useSessionStore.getState().unsaved).toBeNull()
    expect(h.store().route.page).toBe('projects')
    h.unmount()
  })

  it('a legacy setDirty forwards into the session authority (save cleared when off)', () => {
    const h = mountStore()
    const save = () => {}
    act(() => { h.store().setDirty(true, save) })
    expect(useSessionStore.getState().dirty).toBe(true)
    expect(useSessionStore.getState().save).toBe(save)
    act(() => { h.store().setDirty(false) })
    expect(useSessionStore.getState().dirty).toBe(false)
    expect(useSessionStore.getState().save).toBeUndefined()
    h.unmount()
  })
})

describe('demo log duality', () => {
  it('a write through the session store is observed by the legacy consumer', () => {
    const h = mountStore()
    act(() => { useSessionStore.getState().pushLog('OP-014', { level: 'WARN', agent: '—', stepId: '—', text: 'from session' }, '10:42:00') })
    const lines = h.store().logs['OP-014']
    expect(lines[lines.length - 1]?.text).toBe('from session')
    h.unmount()
  })

  it('a legacy demo log mirror lands in the session authority', () => {
    const h = mountStore()
    h.run(() => { h.store().A.fastForward('OP-014') })
    const lines = useSessionStore.getState().logs['OP-014']
    expect(lines.some((l) => l.text.startsWith('Simulation fast-forward'))).toBe(true)
    h.unmount()
  })
})

describe('stale marks, filters, stop outcome and AI busy duality', () => {
  it('stale-operation marks flow both directions', () => {
    const h = mountStore()
    h.run(() => { h.store().setStale('OP-014', true) })
    expect(useSessionStore.getState().staleOps['OP-014']).toBe(true)
    act(() => { useSessionStore.getState().setStale('OP-013', true) })
    expect(h.store().staleOps['OP-013']).toBe(true)
    h.unmount()
  })

  it('persisted list filters flow both directions', () => {
    const h = mountStore()
    h.run(() => { h.store().setFilter('agents.status', 'online') })
    expect(useSessionStore.getState().persistFilters['agents.status']).toBe('online')
    act(() => { useSessionStore.getState().setFilter('findings.severity', 'high') })
    expect(h.store().persistFilters['findings.severity']).toBe('high')
    h.unmount()
  })

  it('the emergency-stop outcome switch flows both directions', () => {
    const h = mountStore()
    h.run(() => { h.store().setStopOutcome('fail') })
    expect(useSessionStore.getState().stopOutcome).toBe('fail')
    act(() => { useSessionStore.getState().setStopOutcome('unknown') })
    expect(h.store().stopOutcome).toBe('unknown')
    h.unmount()
  })

  it('the AI busy flag flows both directions through the chat lifecycle', () => {
    const h = mountStore()
    const convId = h.store().A.createConversation('RT-2026-015', 'propose')
    h.run(() => { h.store().A.sendChat(convId, 'Plan a validation run for the in-scope cloud assets.') })
    expect(useSessionStore.getState().aiBusy).toBe(convId)
    h.run(() => { h.store().A.stopChat(convId) })
    expect(useSessionStore.getState().aiBusy).toBeNull()
    act(() => { useSessionStore.getState().setAiBusy('SS-041') })
    expect(h.store().aiBusy).toBe('SS-041')
    h.unmount()
  })
})

describe('provider mount lifecycle', () => {
  it('repeated mounts never inherit the previous mount\'s session state', () => {
    const a = mountStore()
    act(() => {
      a.store().confirm(confirmOpts())
      a.store().setDirty(true, () => {})
      useSessionStore.getState().pushLog('OP-TEST', { level: 'INFO', agent: '—', stepId: '—', text: 'stale' }, '10:42:00')
      useSessionStore.getState().setStale('OP-014', true)
      useSessionStore.getState().setFilter('agents.status', 'online')
      a.store().setStopOutcome('fail')
      useSessionStore.getState().setAiBusy('conv-1')
      useSessionStore.getState().setLoading(true)
    })
    a.unmount()
    const b = mountStore()
    expect(b.store().confirmState).toBeNull()
    expect(b.store().dirty).toBe(false)
    expect(useSessionStore.getState().save).toBeUndefined()
    expect(useSessionStore.getState().unsaved).toBeNull()
    expect(b.store().logs['OP-TEST']).toBeUndefined()
    expect(b.store().staleOps).toEqual({})
    expect(b.store().persistFilters).toEqual({})
    expect(b.store().stopOutcome).toBe('ack')
    expect(b.store().aiBusy).toBeNull()
    expect(b.store().loading).toBe(false)
    b.unmount()
  })
})
