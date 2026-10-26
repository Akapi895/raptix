/**
 * C2 provider tab (real mode) through the real C2 adapter: the provider's listeners
 * are listed from its registry and stopped by job id, listeners and profiles are
 * created with the validated name, a session and a channel resolve only inside the
 * engagement namespace, and nothing fabricates provider state.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

vi.mock('../../state/mode', () => ({ DATA_MODE: 'real', isRealMode: () => true, resolveDataMode: () => 'real' }))
vi.mock('../../state/keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../state/keys')>()),
  useQueryScope: () => ({ actor: 'u-owner', role: 'manager', project: 'eng-1' }),
}))

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    fetchC2Grants: vi.fn(),
    fetchC2Sessions: vi.fn(),
    fetchC2Commands: vi.fn(),
    configureC2Listener: vi.fn(),
    configureC2Profile: vi.fn(),
    stopC2Listener: vi.fn(),
    dispatchC2Command: vi.fn(),
  }
})

const api_c2 = await import('./api');
const { RealFeatureServicesCtx } = await import('../../state/real-services-provider')
const { createRealFeatureServices } = await import('../../state/real-services')
const { resetNavStores } = await import('../../router/navigate')
const { C2ProviderTab } = await import('./provider-tab')
const { ConsoleCard } = await import('./provider-console')

const CAPABILITIES = { version: 1, mode: 'multi-user', capabilities: { c2: { supported: true, available: true } } } as never

const GRANTS = { engagementId: 'eng-1', grants: [], minGrantHours: 1, maxGrantHours: 24, source: 'db' }
const SESSIONS = {
  engagementId: 'eng-1',
  sessions: [],
  listeners: [{ engagementId: 'eng-1', protocol: 'mtls', port: 8888, jobId: 7, active: true }],
  profiles: [],
  source: 'sliver',
}

function renderTab(content: ReactElement = <C2ProviderTab engagementId="eng-1" />): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const services = createRealFeatureServices(CAPABILITIES)
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <RealFeatureServicesCtx.Provider value={services}>{children}</RealFeatureServicesCtx.Provider>
    </QueryClientProvider>
  )
  render(content, { wrapper })
}

beforeEach(() => {
  vi.mocked(api_c2.fetchC2Grants).mockReset().mockResolvedValue(GRANTS as never)
  vi.mocked(api_c2.fetchC2Sessions).mockReset().mockResolvedValue(SESSIONS as never)
  vi.mocked(api_c2.fetchC2Commands).mockReset().mockResolvedValue([])
  vi.mocked(api_c2.configureC2Listener).mockReset().mockResolvedValue({ listener: SESSIONS.listeners[0] })
  vi.mocked(api_c2.configureC2Profile).mockReset().mockResolvedValue({ profile: { name: 'lab-prof', created: 1, userAgent: 'ua', headerCount: 0, cookieCount: 0, parameterCount: 0, pathSegmentCount: 0 } })
  vi.mocked(api_c2.stopC2Listener).mockReset().mockResolvedValue({})
  vi.mocked(api_c2.dispatchC2Command).mockReset().mockResolvedValue(SESSION_COMMAND)
})

afterEach(() => {
  cleanup()
})

describe('C2ProviderTab infrastructure (W15)', () => {
  it('lists provider listeners with their job id and stops them by job id', async () => {
    renderTab()
    await userEvent.click(await screen.findByRole('tab', { name: /C2/ }))
    expect(await screen.findByText('mtls · port 8888 · job 7')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /stop listener 7/i }))
    await waitFor(() => expect(api_c2.stopC2Listener).toHaveBeenCalledWith('eng-1', 7))
  })

  it('starts a listener for a supported protocol and creates a lab profile by name', async () => {
    renderTab()
    await userEvent.click(await screen.findByRole('tab', { name: /C2/ }))
    await userEvent.click(await screen.findByRole('button', { name: /start http listener/i }))
    await waitFor(() => expect(api_c2.configureC2Listener).toHaveBeenCalledWith('eng-1', 'http'))
    await userEvent.type(screen.getByLabelText(/profile name/i), 'lab-prof')
    await userEvent.click(screen.getByRole('button', { name: /create profile/i }))
    await waitFor(() => expect(api_c2.configureC2Profile).toHaveBeenCalledWith('eng-1', 'lab-prof'))
  })
})

const LIVE_SESSION = {
  id: 'sess-1', name: 's1', hostname: 'host-9', username: 'svc', os: 'linux', arch: 'amd64',
  transport: 'mtls', remoteAddress: '10.0.0.9:443', activeC2: 'mtls', version: '1.5', pid: 42,
  listenerPort: 8888, lastCheckin: 1_700_000_000, isDead: false,
}
const OTHER_SESSION = { ...LIVE_SESSION, id: 'sess-other', hostname: 'host-2' }
const SESSION_COMMAND = {
  id: 'cmd-1', engagementId: 'eng-1', sessionId: 'sess-1', requestId: 'req-1', path: '/usr/bin/printf',
  args: ['native-output'], status: 'succeeded' as const, exitCode: 0, pid: 7, stdout: 'x', stderr: '',
  stdoutTruncated: false, stderrTruncated: false, createdAt: '2026-10-14T09:00:00.000Z',
}

function renderDetail(hash: string): void {
  window.location.hash = hash
  resetNavStores()
  renderTab()
}

describe('C2 provider command input and output', () => {
  beforeEach(() => {
    window.location.hash = '#/c2?engagement=eng-1'
    resetNavStores()
    vi.mocked(api_c2.fetchC2Sessions).mockResolvedValue({ ...SESSIONS, sessions: [LIVE_SESSION] } as never)
  })

  it('preserves spaces, empty arguments and Windows paths as explicit argv values', async () => {
    renderTab(<ConsoleCard engagementId="eng-1" />)
    await userEvent.type(await screen.findByLabelText('Session id'), 'sess-1')
    await userEvent.type(screen.getByLabelText('Absolute binary path'), '/usr/bin/printf')
    const args = ['hello world', '', 'C:\\Program Files\\Lab']
    await userEvent.clear(screen.getByLabelText(/Arguments/))
    await userEvent.paste(JSON.stringify(args))
    await userEvent.click(screen.getByRole('button', { name: 'Dispatch command' }))
    await waitFor(() => expect(api_c2.dispatchC2Command).toHaveBeenCalledWith('eng-1', 'sess-1', expect.objectContaining({ args })), { timeout: 1000 })
  })

  it('refuses a non-string argv array without dispatching', async () => {
    renderTab(<ConsoleCard engagementId="eng-1" />)
    await userEvent.type(await screen.findByLabelText('Session id'), 'sess-1')
    await userEvent.type(screen.getByLabelText('Absolute binary path'), '/usr/bin/printf')
    await userEvent.clear(screen.getByLabelText(/Arguments/))
    await userEvent.paste('[1]')
    await userEvent.click(screen.getByRole('button', { name: 'Dispatch command' }))
    expect(await screen.findByRole('alert', {}, { timeout: 1000 })).toHaveTextContent('Arguments must be a JSON array of strings')
    expect(api_c2.dispatchC2Command).not.toHaveBeenCalled()
  })

  it('shows retained stdout beyond the preview and stderr with provider truncation flags', async () => {
    const stdout = `${'x'.repeat(140)}END_OF_RETAINED_STDOUT`
    vi.mocked(api_c2.fetchC2Commands).mockResolvedValue([{ ...SESSION_COMMAND, stdout, stderr: 'permission denied', stderrTruncated: true }])
    renderTab(<ConsoleCard engagementId="eng-1" />)
    expect(await screen.findByText(stdout, { exact: true }, { timeout: 1000 })).toBeInTheDocument()
    expect(screen.getByText('permission denied', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('stderr truncated by provider')).toBeInTheDocument()
  })
})

describe('C2ProviderTab detail routes (W22)', () => {
  beforeEach(() => {
    vi.mocked(api_c2.fetchC2Sessions).mockResolvedValue({ ...SESSIONS, sessions: [LIVE_SESSION, OTHER_SESSION] } as never)
    vi.mocked(api_c2.fetchC2Commands).mockResolvedValue([SESSION_COMMAND] as never)
  })

  it('says there is no interactive console in this build, and keeps the session list under the address', async () => {
    renderDetail('#/c2-console/sess-1?engagement=eng-1')
    expect(await screen.findByText('No interactive console in this build')).toBeInTheDocument()
    expect(await screen.findByText(/Session commands run only under an approved grant/)).toBeInTheDocument()
  })

  it('renders a single owned session with its own command audit', async () => {
    renderDetail('#/c2-session/sess-1?engagement=eng-1')
    expect(await screen.findByText(/C2 session sess-1/)).toBeInTheDocument()
    expect(await screen.findByText('host-9')).toBeInTheDocument()
    expect(screen.getByText(/native-output/)).toBeInTheDocument()
    expect(screen.queryByText('sess-other')).not.toBeInTheDocument()
    expect(screen.queryByText(/Listeners & profiles/i)).not.toBeInTheDocument()
  })

  it('renders an explicit not-found for a session id outside the engagement namespace', async () => {
    renderDetail('#/c2-session/sess-foreign?engagement=eng-1')
    expect(await screen.findByText('Session not found')).toBeInTheDocument()
    expect(screen.getByText(/The provider reports no session/)).toBeInTheDocument()
    expect(screen.queryByText('host-9')).not.toBeInTheDocument()
  })

  it('lists the sessions observed on a transport channel without reusing the id as a session', async () => {
    renderDetail('#/c2-channel/mtls?engagement=eng-1')
    expect(await screen.findByText(/C2 channel mtls/)).toBeInTheDocument()
    expect(await screen.findByText('sess-1')).toBeInTheDocument()
    expect(screen.getByText('sess-other')).toBeInTheDocument()
    expect(screen.queryByText(/native-output/)).not.toBeInTheDocument()
  })

  it('renders an honest empty state for a channel with no observed sessions', async () => {
    renderDetail('#/c2-channel/smb?engagement=eng-1')
    expect(await screen.findByText('No sessions on this channel')).toBeInTheDocument()
  })
})
