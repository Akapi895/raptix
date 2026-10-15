/**
 * W21: the unsaved-changes dialog honours the save contract — Save Draft is
 * only offered when a real save exists, navigation only after a successful
 * await, and a failed save keeps the guard and reports the failure instead of
 * toasting a fake success.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore, resetSessionStores } from '../state/session'
import { useToastStore } from '../state/stores'
import { GlobalModals } from './shell'

vi.mock('../real/shell-parts', () => ({ RealContextRibbon: () => null, RealTopbar: () => null }))
vi.mock('../features/copilot/lazy', () => ({ LazyCopilotDrawer: () => null }))
vi.mock('../real/screens/copilot', () => ({ RealCopilotDrawer: () => null }))

function openGuard(save: (() => Promise<unknown> | unknown) | undefined, navigate: () => void): void {
  act(() => {
    useSessionStore.getState().setDirty(true, save)
    useSessionStore.getState().guarded(navigate)
  })
}

beforeEach(() => {
  resetSessionStores()
})

afterEach(() => {
  cleanup()
  act(() => { useToastStore.getState().clear() })
})

describe('unsaved-changes save contract (W21)', () => {
  it('navigates only after the awaited save resolves', async () => {
    render(<GlobalModals />)
    const save = vi.fn(async () => undefined)
    openGuard(save, () => { window.location.hash = '#home' })
    await screen.findByText('Unsaved changes')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save draft/i }))
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    })
    await waitFor(() => {
      expect(useSessionStore.getState().unsaved).toBeNull()
      expect(useToastStore.getState().toasts.some((t) => /draft saved/i.test(t.text))).toBe(true)
    })
  })

  it('keeps the guard open and reports failure when the save throws', async () => {
    render(<GlobalModals />)
    const save = vi.fn(async () => { throw new Error('409 conflict') })
    openGuard(save, () => { window.location.hash = '#home' })
    await screen.findByText('Unsaved changes')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save draft/i }))
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    })
    await waitFor(() => expect(useToastStore.getState().toasts.some((t) => /not saved|409/i.test(t.text))).toBe(true))
    expect(useSessionStore.getState().unsaved).not.toBeNull()
  })

  it('offers Save Draft only when a real save callback exists', async () => {
    render(<GlobalModals />)
    openGuard(undefined, () => { window.location.hash = '#home' })
    await screen.findByText('Unsaved changes')
    expect(screen.queryByRole('button', { name: /save draft/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /stay/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /discard/i })).toBeInTheDocument()
  })
})
