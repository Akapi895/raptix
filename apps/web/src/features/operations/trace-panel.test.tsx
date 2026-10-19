/** Tool trace page (real mode): thread selection from the route and explicit empty and error states. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const state = vi.hoisted(() => ({ pid: 'eng-1', routeId: undefined as string | undefined }))

vi.mock('../../router/navigate', () => ({
  go: vi.fn(),
  useRoute: () => ({ page: 'ai-trace', id: state.routeId }),
}))
vi.mock('../../state/stores', () => ({
  useProjectStore: (selector: (s: { pid: string }) => unknown) => selector({ pid: state.pid }),
}))
vi.mock('./runtime-query', () => ({
  messageOf: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
  useRuntimeThreads: vi.fn(),
  useRuntimeSnapshot: vi.fn(),
}))

const { RealTrace } = await import('./trace-panel')
const runtime = await import('./runtime-query')

const THREAD_A = { engagementId: 'eng-1', threadId: 'th-1', assistantId: 'executor', kind: 'execution', createdAt: '2026-10-14T09:00:00.000Z', updatedAt: '2026-10-14T09:05:00.000Z' }
const THREAD_B = { ...THREAD_A, threadId: 'th-2', assistantId: 'raptix' }

function threads(data: unknown[], over: { isError?: boolean; error?: unknown } = {}) {
  vi.mocked(runtime.useRuntimeThreads).mockReturnValue({ isPending: false, isError: over.isError ?? false, error: over.error, data } as never)
}

beforeEach(() => {
  cleanup()
  state.pid = 'eng-1'
  state.routeId = undefined
  vi.mocked(runtime.useRuntimeSnapshot).mockReturnValue({ isPending: false, isError: false, data: { transcripts: [], transcriptsTruncated: false } } as never)
})

describe('RealTrace', () => {
  it('asks for a project before showing any trace', () => {
    state.pid = 'all'
    threads([THREAD_A])
    render(<RealTrace />)
    expect(screen.getByText('Choose a project')).toBeInTheDocument()
  })

  it('shows the empty state when the engagement has no execution thread', () => {
    threads([])
    render(<RealTrace />)
    expect(screen.getByText('No execution thread yet')).toBeInTheDocument()
  })

  it('selects the thread named in the route and shows its tool trace', () => {
    state.routeId = 'th-2'
    threads([THREAD_A, THREAD_B])
    render(<RealTrace />)
    expect(screen.getByRole('combobox', { name: 'Execution thread' })).toHaveValue('th-2')
    expect(screen.getByRole('heading', { name: 'Tool trace' })).toBeInTheDocument()
  })

  it('falls back to the first execution thread when the route id is not owned by the engagement', () => {
    state.routeId = 'foreign-thread'
    threads([THREAD_A, THREAD_B])
    render(<RealTrace />)
    expect(screen.getByRole('combobox', { name: 'Execution thread' })).toHaveValue('th-1')
  })

  it('shows the thread source error and no substitute trace', () => {
    threads([], { isError: true, error: new Error('threads down') })
    render(<RealTrace />)
    expect(screen.getByText('Threads source unavailable')).toBeInTheDocument()
    expect(screen.getByText(/threads down/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tool trace' })).toBeNull()
  })
})
