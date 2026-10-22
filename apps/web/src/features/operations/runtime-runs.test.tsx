import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRun, RuntimeThread } from './runtime'

const cancelRun = vi.fn()
let runs: RuntimeRun[] = []

vi.mock('./runtime-query', () => ({
  messageOf: (_error: unknown, fallback: string) => fallback,
  useRuntimeSnapshot: () => ({ isPending: false, isError: false, data: { transcripts: [], transcriptsTruncated: false } }),
  useRuntimeRuns: () => ({ isPending: false, isError: false, data: runs }),
  useRuntimeOperation: () => ({ isError: false, data: { state: 'running', latestRunStatus: null } }),
  useRuntimeOperationControls: () => ({ pause: vi.fn(), resume: vi.fn(), complete: vi.fn() }),
  useRuntimeCancel: () => cancelRun,
}))
vi.mock('./views/execution-logs', () => ({ ExecutionLogs: () => null }))

const thread: RuntimeThread = { threadId: 'thr-1', assistantId: 'raptix', createdAt: '2026-10-21T02:00:00Z' }

function run(rawStatus: string): RuntimeRun {
  return { runId: 'run-1', requestId: 'req-1', threadId: 'thr-1', rawStatus, createdAt: '2026-10-21T02:00:00Z', updatedAt: '2026-10-21T02:01:00Z' }
}

async function renderThread() {
  const { ThreadRuns } = await import('./runtime-runs')
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const tree = (
    <QueryClientProvider client={client}>
      <ul>
        <ThreadRuns engagementId="eng-1" thread={thread} />
      </ul>
    </QueryClientProvider>
  )
  return render(tree)
}

beforeEach(() => {
  runs = [run('running')]
  cancelRun.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('execution thread runs: a stop is requested until the runtime reports the run ended', () => {
  it('shows the stop as requested after the runtime accepts it, and names the status only once the runtime reports the run ended', async () => {
    cancelRun.mockResolvedValue(run('running'))
    const view = await renderThread()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }))
    expect(await screen.findByText('The runtime accepted the stop; it has not yet confirmed that the run ended.')).toBeTruthy()
    expect(cancelRun).toHaveBeenCalledWith('thr-1', 'run-1')
    expect((screen.getByRole('button', { name: 'Stop requested' }) as HTMLButtonElement).disabled).toBe(true)

    runs = [run('interrupted')]
    const { ThreadRuns } = await import('./runtime-runs')
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    view.rerender(
      <QueryClientProvider client={client}>
        <ul>
          <ThreadRuns engagementId="eng-1" thread={thread} />
        </ul>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Run ended after the stop request; the runtime reports interrupted.')).toBeTruthy()
    expect(screen.queryByText('The runtime accepted the stop; it has not yet confirmed that the run ended.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop requested' })).toBeNull()
  })

  it('keeps the run in flight and shows the refusal when the runtime refuses the stop', async () => {
    cancelRun.mockRejectedValue(new Error('runtime refused the stop'))
    await renderThread()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }))
    expect(await screen.findByText('The cancel was refused.')).toBeTruthy()
    expect(screen.queryByText('The runtime accepted the stop; it has not yet confirmed that the run ended.')).toBeNull()
    expect((screen.getByRole('button', { name: 'Cancel run' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
