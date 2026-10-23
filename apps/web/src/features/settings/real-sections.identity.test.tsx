/**
 * The Settings trusted identity card names the layer that applies (Phase A, identity investigation). With a sign-in session the
 * card shows the signed-in actor and the multi-user mode; without one it shows the single-user local operator. The card is display
 * only: no authentication or authorization decision reads it.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RealOrganizationSection } from './real-sections'

const session = vi.hoisted(() => ({ current: null as null | { actor?: { id: string; username: string; displayName: string } } }))

vi.mock('../../platform/session', () => ({
  useSession: () => ({ session: session.current, pending: false, error: null, retry: () => {} }),
}))

afterEach(() => {
  cleanup()
  session.current = null
})

describe('Settings trusted identity card', () => {
  it('shows the signed-in actor and the multi-user mode when a sign-in session exists', () => {
    session.current = { actor: { id: 'user-42', username: 'operator-42', displayName: 'Operator Forty-Two' } }
    render(<RealOrganizationSection />)
    expect(screen.getByText('Operator Forty-Two')).toBeInTheDocument()
    expect(screen.getByText('operator-42')).toBeInTheDocument()
    expect(screen.getByText('user-42')).toBeInTheDocument()
    expect(screen.getByText('Multi-user (sign-in required)')).toBeInTheDocument()
    expect(screen.queryByText('Local Operator')).toBeNull()
    expect(screen.queryByText('local-single-user')).toBeNull()
  })

  it('shows the local operator only when no sign-in session exists', () => {
    render(<RealOrganizationSection />)
    expect(screen.getByText('Local Operator')).toBeInTheDocument()
    expect(screen.getByText('local-single-user')).toBeInTheDocument()
  })
})
