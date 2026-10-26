import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

vi.mock('../../../state/keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../state/keys')>()),
  useQueryScope: () => ({ actor: 'u-owner', role: 'operator', project: 'eng-1' }),
}))

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchWebShellConnections: vi.fn(),
    createWebShellConnection: vi.fn(),
    probeWebShellConnection: vi.fn(),
    fetchWebShellCommands: vi.fn(),
    executeWebShellCommand: vi.fn(),
    closeWebShellConnection: vi.fn(),
  }
})

vi.mock('../../c2/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../c2/api')>()
  return {
    ...actual,
    fetchC2Sessions: vi.fn(),
    fetchC2Grants: vi.fn(),
    fetchC2Commands: vi.fn(),
  }
})

const api = await import('../api')
const c2api = await import('../../c2/api')
const { RealFeatureServicesCtx } = await import('../../../state/real-services-provider')
const { createRealFeatureServices } = await import('../../../state/real-services')
const { RealContext } = await import('../../../state/real-context')
const { resetNavStores } = await import('../../../router/navigate')
const { WebShellPanel } = await import('./panel')
const { C2ProviderTab } = await import('../../c2/provider-tab')

const PROFILE = {
  provider: 'http-form-command' as const,
  target: '10.129.88.4',
  endpoint: 'http://10.129.88.4/dev/phpbash.php',
  method: 'POST' as const,
  content_type: 'application/x-www-form-urlencoded' as const,
  command_parameter: 'cmd',
  probe_command: 'id;hostname',
  probe_pattern: 'uid=33',
  expected_user: 'www-data',
}

const CONNECTION = {
  id: 'conn-1',
  engagementId: 'eng-1',
  name: 'phpbash',
  assetId: null,
  profile: PROFILE,
  state: 'reachable' as const,
  source: 'manual' as const,
  createdBy: 'u-owner',
  producerFindingId: null,
  producerPocSha256: null,
  producerSpecSha256: null,
  producerAcquisitionId: null,
  lastProbeState: 'reachable' as const,
  lastProbeAt: '2026-10-26T09:00:00.000Z',
  concurrencyVersion: 1,
  createdAt: '2026-10-26T09:00:00.000Z',
  updatedAt: '2026-10-26T09:00:00.000Z',
}

const PROBE = {
  id: 'probe-1',
  connectionId: 'conn-1',
  engagementId: 'eng-1',
  requestId: 'probe-request-1',
  state: 'reachable' as const,
  httpStatus: 200,
  matched: true,
  output: 'uid=33(www-data)',
  outputTruncated: false,
  error: null,
  durationMs: 12,
  createdAt: '2026-10-26T09:00:01.000Z',
}

const CAPABILITIES = {
  version: 1,
  mode: 'multi-user',
  independentReview: 'single-operator',
  capabilities: {
    webshell: { supported: true, available: true },
    c2: { supported: true, available: true },
    assets: { supported: false, available: false, reason: 'service_missing' },
  },
} as never

function renderPanel(content: ReactElement = <WebShellPanel engagementId="eng-1" />, document = CAPABILITIES): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const services = createRealFeatureServices(document)
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <RealContext.Provider value={{ document, identity: {} as never }}>
        <RealFeatureServicesCtx.Provider value={services}>{children}</RealFeatureServicesCtx.Provider>
      </RealContext.Provider>
    </QueryClientProvider>
  )
  render(content, { wrapper })
}

beforeEach(() => {
  window.location.hash = '#/c2?engagement=eng-1'
  resetNavStores()
  vi.mocked(api.fetchWebShellConnections).mockReset().mockResolvedValue({ engagementId: 'eng-1', connections: [] })
  vi.mocked(api.fetchWebShellCommands).mockReset().mockResolvedValue({ connectionId: 'conn-1', commands: [] })
  vi.mocked(api.createWebShellConnection).mockReset().mockResolvedValue(CONNECTION)
  vi.mocked(api.probeWebShellConnection).mockReset().mockResolvedValue(PROBE)
  vi.mocked(api.executeWebShellCommand).mockReset()
  vi.mocked(api.closeWebShellConnection).mockReset().mockResolvedValue({ ...CONNECTION, state: 'closed' })
  vi.mocked(c2api.fetchC2Sessions).mockReset().mockRejectedValue(new Error('C2 provider unavailable'))
  vi.mocked(c2api.fetchC2Grants).mockReset().mockResolvedValue({ engagementId: 'eng-1', grants: [], minGrantHours: 1, maxGrantHours: 24, source: 'db' } as never)
  vi.mocked(c2api.fetchC2Commands).mockReset().mockResolvedValue([])
})

afterEach(() => cleanup())

describe('WebShellPanel', () => {
  it('shows a loading state while the connection read is in flight', () => {
    vi.mocked(api.fetchWebShellConnections).mockReturnValue(new Promise(() => undefined))
    renderPanel()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows an honest empty state without a connection', async () => {
    renderPanel()
    expect(await screen.findByText('No WebShell connections')).toBeInTheDocument()
  })

  it('reports an unavailable WebShell service without a substitute connection', async () => {
    vi.mocked(api.fetchWebShellConnections).mockRejectedValue(new Error('WebShell is not available on this server.'))
    renderPanel()
    expect(await screen.findByText('WebShell unavailable')).toBeInTheDocument()
    expect(screen.getByText(/WebShell is not available on this server/)).toBeInTheDocument()
  })

  it('validates the endpoint host before creating a connection', async () => {
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /add connection/i }))
    await userEvent.type(screen.getByLabelText(/^Name$/), 'phpbash')
    await userEvent.type(screen.getByLabelText(/Target host/), '10.129.88.4')
    await userEvent.type(screen.getByLabelText(/Endpoint URL/), 'http://10.129.88.5/dev/phpbash.php')
    await userEvent.click(screen.getByRole('button', { name: /^Add connection$/ }))
    expect(await screen.findByText(/endpoint host must match/i)).toBeInTheDocument()
    expect(api.createWebShellConnection).not.toHaveBeenCalled()
  })

  it('creates a connection and shows the probe label from the runtime result', async () => {
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /add connection/i }))
    await userEvent.type(screen.getByLabelText(/^Name$/), 'phpbash')
    await userEvent.type(screen.getByLabelText(/Target host/), '10.129.88.4')
    await userEvent.type(screen.getByLabelText(/Endpoint URL/), 'http://10.129.88.4/dev/phpbash.php')
    await userEvent.click(screen.getByRole('button', { name: /^Add connection$/ }))
    await waitFor(() => expect(api.createWebShellConnection).toHaveBeenCalledWith('eng-1', expect.objectContaining({
      name: 'phpbash',
      profile: expect.objectContaining({ target: '10.129.88.4', command_parameter: 'cmd', probe_command: 'id;hostname' }),
    })))
    expect(await screen.findByText(/Reachable: the probe output matched/)).toBeInTheDocument()
    expect(api.probeWebShellConnection).toHaveBeenCalledWith('eng-1', 'conn-1', expect.any(String))
  })

  it('renders read-only when the deployment is not single-operator', async () => {
    vi.mocked(api.fetchWebShellConnections).mockResolvedValue({ engagementId: 'eng-1', connections: [CONNECTION] })
    renderPanel(undefined, { version: 1, mode: 'multi-user', independentReview: 'required', capabilities: { webshell: { supported: true, available: true } } } as never)
    expect(await screen.findByText('Read-only WebShell')).toBeInTheDocument()
    expect(screen.getByLabelText('WebShell command')).toBeDisabled()
    expect(screen.getByRole('button', { name: /run command/i })).toBeDisabled()
  })

  it('shows command history with the output truncation flag', async () => {
    vi.mocked(api.fetchWebShellConnections).mockResolvedValue({ engagementId: 'eng-1', connections: [CONNECTION] })
    vi.mocked(api.fetchWebShellCommands).mockResolvedValue({
      connectionId: 'conn-1',
      commands: [{
        id: 'cmd-1', connectionId: 'conn-1', engagementId: 'eng-1', requestId: 'cmd-request-1',
        command: 'id', status: 'delivered', httpStatus: 200, exitCode: null,
        output: 'uid=33(www-data)', outputTruncated: true, error: null,
        actorId: 'u-owner', runId: null, invocationId: null,
        createdAt: '2026-10-26T09:01:00.000Z', updatedAt: '2026-10-26T09:01:00.000Z',
      }],
    })
    renderPanel()
    expect(await screen.findByText(/Output truncated at the 192 KiB bound/)).toBeInTheDocument()
    expect(screen.getByText('uid=33(www-data)')).toBeInTheDocument()
  })

  it('does not clear or record a command when the server refuses it', async () => {
    vi.mocked(api.fetchWebShellConnections).mockResolvedValue({ engagementId: 'eng-1', connections: [CONNECTION] })
    vi.mocked(api.executeWebShellCommand).mockRejectedValue(new Error('Command refused by the runtime.'))
    renderPanel()
    const input = await screen.findByLabelText('WebShell command')
    await userEvent.type(input, 'id')
    await userEvent.click(screen.getByRole('button', { name: /run command/i }))
    expect(await screen.findByText('Command refused by the runtime.')).toBeInTheDocument()
    expect(input).toHaveValue('id')
    expect(screen.queryByText(/View output/)).not.toBeInTheDocument()
  })

  it('renders WebShell independently when the C2 provider is unavailable', { timeout: 10000 }, async () => {
    vi.mocked(api.fetchWebShellConnections).mockResolvedValue({ engagementId: 'eng-1', connections: [CONNECTION] })
    renderPanel(<C2ProviderTab engagementId="eng-1" />)
    // Wait for WebShell connections to resolve — the mock resolves but React Query runs async
    await new Promise((r) => setTimeout(r, 100))
    await waitFor(() => {
      expect(screen.queryByText('WebShell sessions')).toBeInTheDocument()
      expect(screen.queryAllByText('phpbash').length).toBeGreaterThan(0)
    }, { timeout: 5000 })
    // Switch to C2 tab — the C2 provider is mocked to reject, showing the unavailable banner
    await userEvent.click(screen.getByRole('tab', { name: /C2/ }))
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert')
      expect(alerts.some((a) => a.textContent?.includes('C2 provider unavailable'))).toBe(true)
    })
  })
})
