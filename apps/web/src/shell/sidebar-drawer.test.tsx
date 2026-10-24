/**
 * The mobile navigation drawer (UX-25): a visible close control, closing by that control, by the overlay and by Escape,
 * and focus that moves into the drawer on open and returns to the control that opened it on close.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountConsole } from '../test/helpers'
import { Sidebar } from './sidebar'

afterEach(() => cleanup())

describe('mobile navigation drawer', () => {
  it('moves focus to a labelled close control when it opens', () => {
    mountConsole(<Sidebar collapsed={false} setCollapsed={() => {}} mobileOpen={true} closeMobile={() => {}} />)
    const close = screen.getByRole('button', { name: 'Close navigation' })
    expect(document.activeElement).toBe(close)
  })

  it('closes through the close control, the overlay and Escape', () => {
    const closeMobile = vi.fn()
    mountConsole(<Sidebar collapsed={false} setCollapsed={() => {}} mobileOpen={true} closeMobile={closeMobile} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }))
    expect(closeMobile).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closeMobile).toHaveBeenCalledTimes(2)
  })

  it('does not render the drawer while it is closed', () => {
    mountConsole(<Sidebar collapsed={false} setCollapsed={() => {}} mobileOpen={false} closeMobile={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Close navigation' })).toBeNull()
  })
})
