/**
 * W15: the C2 surface exposes the real provider management contract —
 * listeners are listed from the provider registry, started for the
 * supported protocols, stopped by job id, and profiles are created with the
 * validated name; nothing fabricates provider state.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import type { C2View } from '@raptix/web-contracts'

const fetchC2Grants = vi.fn()
const fetchC2Sessions = vi.fn()
const fetchC2Commands = vi.fn()
const requestC2Grant = vi.fn()
const decideC2Grant = vi.fn()
const dispatchC2Command = vi.fn()
const reconcileC2Command = vi.fn()
const configureC2Listener = vi.fn()
const configureC2Profile = vi.fn()
const stopC2Listener = vi.fn()

vi.mock('../api', () => ({
  fetchC2Grants: (...a: unknown[]) => fetchC2Grants(...a),
  fetchC2Sessions: (...a: unknown[]) => fetchC2Sessions(...a),
  fetchC2Commands: (...a: unknown[]) => fetchC2Commands(...a),
  requestC2Grant: (...a: unknown[]) => requestC2Grant(...a),
  decideC2Grant: (...a: unknown[]) => decideC2Grant(...a),
  dispatchC2Command: (...a: unknown[]) => dispatchC2Command(...a),
  reconcileC2Command: (...a: unknown[]) => reconcileC2Command(...a),
  configureC2Listener: (...a: unknown[]) => configureC2Listener(...a),
  configureC2Profile: (...a: unknown[]) => configureC2Profile(...a),
  stopC2Listener: (...a: unknown[]) => stopC2Listener(...a),
}))

const GRANTS = { engagementId: 'eng-1', grants: [], minGrantHours: 1, maxGrantHours: 24, source: 'db' as const }
const SESSIONS: C2View = {
  engagementId: 'eng-1',
  sessions: [],
  listeners: [{ engagementId: 'eng-1', protocol: 'mtls', port: 8888, jobId: 7, active: true }],
  profiles: [],
  source: 'sliver',
}

async function renderPanel(): Promise<void> {
  const { RealC2Panel } = await import('./c2-panel')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<RealC2Panel engagementId="eng-1" />, { wrapper })
}

beforeEach(() => {
  fetchC2Grants.mockReset().mockResolvedValue(GRANTS)
  fetchC2Sessions.mockReset().mockResolvedValue(SESSIONS)
  fetchC2Commands.mockReset().mockResolvedValue([])
  requestC2Grant.mockReset()
  decideC2Grant.mockReset()
  dispatchC2Command.mockReset()
  reconcileC2Command.mockReset()
  configureC2Listener.mockReset().mockResolvedValue({ listener: SESSIONS.listeners[0] })
  configureC2Profile.mockReset().mockResolvedValue({ profile: { name: 'lab-prof', created: 1, userAgent: 'ua', headerCount: 0, cookieCount: 0, parameterCount: 0, pathSegmentCount: 0 } })
  stopC2Listener.mockReset().mockResolvedValue({})
})

afterEach(() => {
  cleanup()
})

describe('RealC2Panel infrastructure (W15)', () => {
  it('lists provider listeners with their job id and stops them by job id', async () => {
    await renderPanel()
    expect(await screen.findByText('mtls · port 8888 · job 7')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /stop listener 7/i }))
    await waitFor(() => expect(stopC2Listener).toHaveBeenCalledWith('eng-1', 7))
  })

  it('starts a listener for a supported protocol and creates a lab profile by name', async () => {
    await renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /start http listener/i }))
    await waitFor(() => expect(configureC2Listener).toHaveBeenCalledWith('eng-1', 'http'))
    await userEvent.type(screen.getByLabelText(/profile name/i), 'lab-prof')
    await userEvent.click(screen.getByRole('button', { name: /create profile/i }))
    await waitFor(() => expect(configureC2Profile).toHaveBeenCalledWith('eng-1', 'lab-prof'))
  })
})
