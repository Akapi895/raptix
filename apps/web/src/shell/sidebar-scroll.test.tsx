/**
 * Sidebar scroll cue (quick win UX-07). The navigation scrollbar is hidden, so
 * a fade marks items below the fold and disappears at the end of the list.
 * jsdom has no layout engine, so the scroll geometry is stubbed.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountServices } from '../test/helpers'
import { Sidebar } from './sidebar'

let scrollTop = 0

beforeEach(() => {
  scrollTop = 0
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 1000 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 500 })
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => { scrollTop = value },
  })
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTop')
})

describe('sidebar scroll cue', () => {
  it('fades the bottom while navigation sits below the fold, and clears it at the end', () => {
    mountServices(<Sidebar collapsed={false} setCollapsed={() => {}} mobileOpen={false} closeMobile={() => {}} />)
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(nav.parentElement?.querySelector('[data-scroll-fade]')).not.toBeNull()
    scrollTop = 500
    fireEvent.scroll(nav)
    expect(nav.parentElement?.querySelector('[data-scroll-fade]')).toBeNull()
  })
})
