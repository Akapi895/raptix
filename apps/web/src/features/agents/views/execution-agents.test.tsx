/**
 * The Agents tab shows the runtime dispatch roster: a recorded role is named, a
 * legacy row says the role was not recorded, and a thread the runtime cannot
 * read is named as unavailable rather than shown as empty.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

const fetchRuntimeInstances = vi.fn()

vi.mock('../remote', () => ({
  fetchRuntimeInstances: (...a: unknown[]) => fetchRuntimeInstances(...a),
}))

const ROSTER = {
  engagementId: 'eng-1',
  source: 'runtime',
  threads: [
    { threadId: 'thread-aaaa1111', read: 'read', reason: null },
    { threadId: 'thread-bbbb2222', read: 'unavailable', reason: 'Runtime discovery or context verification is unavailable' },
  ],
  instances: [
    { instanceId: 'thread-aaaa1111:dispatch-recon:1', threadId: 'thread-aaaa1111', dispatchId: 'dispatch-recon', attempt: 1, role: 'recon', objectiveId: 'OBJ-002', parentDispatchId: null, outcome: 'success', terminal: false, source: 'dispatch_ledger' },
    { instanceId: 'thread-aaaa1111:dispatch-legacy:2', threadId: 'thread-aaaa1111', dispatchId: 'dispatch-legacy', attempt: 2, role: null, objectiveId: null, parentDispatchId: null, outcome: 'failed', terminal: true, source: 'dispatch_ledger' },
  ],
}

function instance(dispatchId: string, role: string, attempt: number, parentDispatchId: string | null) {
  return { instanceId: `thread-aaaa1111:${dispatchId}:${attempt}`, threadId: 'thread-aaaa1111', dispatchId, attempt, role, objectiveId: 'OBJ-002', parentDispatchId, outcome: 'success', terminal: false, source: 'dispatch_ledger' }
}

async function renderAgents(threadId: string | null): Promise<void> {
  const { RealExecutionAgents } = await import('./execution-agents')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<RealExecutionAgents engagementId="eng-1" assistantId="decepticon" threadId={threadId} branches={[]} selectedKey={null} onSelect={() => undefined} sourceError={null} />, { wrapper })
}

afterEach(() => {
  cleanup()
  fetchRuntimeInstances.mockReset()
})

describe('Agents tab runtime roster', () => {
  it('names the recorded role and marks a legacy row as role not recorded', async () => {
    fetchRuntimeInstances.mockResolvedValue(ROSTER)
    await renderAgents(null)
    expect(await screen.findByText('recon · attempt 1')).toBeInTheDocument()
    expect(screen.getByText('role not recorded · attempt 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /role not recorded · attempt 2, Failed/ })).toBeInTheDocument()
    expect(screen.getByTitle(/runtime outcome: failed · terminal/)).toBeInTheDocument()
  })

  it('names a thread the runtime cannot read instead of showing it as empty', async () => {
    fetchRuntimeInstances.mockResolvedValue(ROSTER)
    await renderAgents(null)
    expect(await screen.findByText('Some threads could not be read')).toBeInTheDocument()
    expect(screen.getByText(/thread-b: Runtime discovery/)).toBeInTheDocument()
  })

  it('shows only the instances of the selected thread', async () => {
    fetchRuntimeInstances.mockResolvedValue(ROSTER)
    await renderAgents('thread-bbbb2222')
    expect(await screen.findByText('No dispatch instances are recorded on this thread.')).toBeInTheDocument()
    expect(screen.queryByText('recon · attempt 1')).not.toBeInTheDocument()
  })

  it('reports a failed roster read as unavailable', async () => {
    fetchRuntimeInstances.mockRejectedValue(new Error('The runtime roster read failed.'))
    await renderAgents(null)
    expect(await screen.findByText('Runtime roster unavailable')).toBeInTheDocument()
  })

  it('nests a dispatch under the dispatch that started it', async () => {
    fetchRuntimeInstances.mockResolvedValue({ ...ROSTER, instances: [instance('dispatch-orch', 'surface_exploit', 1, null), instance('dispatch-recon', 'recon', 1, 'dispatch-orch')] })
    await renderAgents(null)
    const parent = (await screen.findByText('surface_exploit · attempt 1')).closest('li')
    expect(parent?.textContent).toContain('recon · attempt 1')
  })

  it('hangs a child under the newest attempt of its parent only', async () => {
    fetchRuntimeInstances.mockResolvedValue({ ...ROSTER, instances: [instance('dispatch-orch', 'surface_exploit', 1, null), instance('dispatch-orch', 'surface_exploit', 2, null), instance('dispatch-recon', 'recon', 1, 'dispatch-orch')] })
    await renderAgents(null)
    expect(await screen.findByText('recon · attempt 1')).toBeInTheDocument()
    expect(screen.getAllByText('recon · attempt 1')).toHaveLength(1)
    expect(screen.getByText('surface_exploit · attempt 1').closest('li')?.textContent).not.toContain('recon · attempt 1')
  })

  it('keeps every dispatch visible when recorded parents form a loop', async () => {
    fetchRuntimeInstances.mockResolvedValue({ ...ROSTER, instances: [instance('dispatch-a', 'alpha', 1, 'dispatch-b'), instance('dispatch-b', 'beta', 1, 'dispatch-a')] })
    await renderAgents(null)
    expect(await screen.findByText('alpha · attempt 1')).toBeInTheDocument()
    expect(screen.getByText('beta · attempt 1')).toBeInTheDocument()
  })
})
