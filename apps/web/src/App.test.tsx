import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import App from './App'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('shows the real bootstrap, never a demo sign-in, when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    render(<App />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Raptix is unavailable right now'), { timeout: 5000 })
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  })
})
