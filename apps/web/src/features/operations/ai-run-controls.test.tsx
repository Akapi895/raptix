import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const threadsState = vi.fn()

vi.mock('./runtime-query', () => ({
  useRuntimeThreads: () => threadsState(),
  messageOf: (_error: unknown, fallback: string) => fallback,
}))
vi.mock('./runtime-runs', () => ({
  ThreadRuns: ({ engagementId, thread }: { engagementId: string; thread: { threadId: string } }) => (
    <li data-testid="thread-runs">{`${engagementId}:${thread.threadId}`}</li>
  ),
}))

beforeEach(() => {
  threadsState.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('AI workspace run controls', () => {
  it('shows the runs of every execution thread of the engagement with their controls', async () => {
    threadsState.mockReturnValue({ isPending: false, isError: false, data: [{ threadId: 'thr-1' }, { threadId: 'thr-2' }] })
    const { AiRunControls } = await import('./ai-run-controls')
    render(<AiRunControls engagementId="eng-1" />)
    const rows = screen.getAllByTestId('thread-runs').map((item) => item.textContent)
    expect(rows).toEqual(['eng-1:thr-1', 'eng-1:thr-2'])
  })

  it('says so when the engagement has no execution thread yet', async () => {
    threadsState.mockReturnValue({ isPending: false, isError: false, data: [] })
    const { AiRunControls } = await import('./ai-run-controls')
    render(<AiRunControls engagementId="eng-1" />)
    expect(screen.getByText('No execution thread for this engagement yet.')).toBeTruthy()
    expect(screen.queryByTestId('thread-runs')).toBeNull()
  })

  it('names the failed threads source instead of showing an empty control list', async () => {
    threadsState.mockReturnValue({ isPending: false, isError: true, error: new Error('down'), data: undefined })
    const { AiRunControls } = await import('./ai-run-controls')
    render(<AiRunControls engagementId="eng-1" />)
    expect(screen.getByText('Threads source unavailable')).toBeTruthy()
    expect(screen.queryByTestId('thread-runs')).toBeNull()
  })
})
