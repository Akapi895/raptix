/**
 * Real-mode unavailable panel (quick win UX-04). The demo escape hatch and the
 * developer wording exist only in the development server; a deployed build
 * shows the panel without them. The mode switch itself is unchanged.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RealNotIntegrated } from './not-integrated'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('RealNotIntegrated', () => {
  it('offers the demo switch in the development server', () => {
    vi.stubEnv('DEV', true)
    render(<RealNotIntegrated page="operations" />)
    expect(screen.getByRole('button', { name: 'Switch to demo mode' })).toBeInTheDocument()
  })

  it('hides the demo switch and internal ticket wording in a deployed build', () => {
    vi.stubEnv('DEV', false)
    render(<RealNotIntegrated page="operations" />)
    expect(screen.queryByRole('button', { name: 'Switch to demo mode' })).toBeNull()
    expect(screen.queryByText(/integration ticket/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Go to Projects' })).toBeInTheDocument()
  })
})
