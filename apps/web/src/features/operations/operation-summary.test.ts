/**
 * An operation read from its runs and branches: no run means nothing started, the span runs from the first start to the last
 * change, each run's status is counted as the runtime words it, and only the agent instances bound to this thread count.
 */
import { describe, expect, it } from 'vitest'
import type { RuntimeFleetBranch, RuntimeRun, RuntimeThread } from './runtime'
import { formatSpan, summariseOperation } from './operation-summary'

const thread: RuntimeThread = { threadId: 'th-exec', assistantId: 'recon', createdAt: '2026-10-20T09:00:00.000Z' }

function run(overrides: Partial<RuntimeRun>): RuntimeRun {
  return { runId: 'run-1', requestId: 'req-1', threadId: 'th-exec', rawStatus: 'success', createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:01:00.000Z', ...overrides }
}

function branch(overrides: Partial<RuntimeFleetBranch>): RuntimeFleetBranch {
  return { threadId: 'th-exec', key: 'b-1', agent: 'recon', state: 'running', outcome: null, startedAt: null, endedAt: null, ...overrides }
}

describe('operation summary', () => {
  it('reports nothing started for an operation with no run', () => {
    const summary = summariseOperation(thread, [], [])
    expect(summary).toMatchObject({ runCount: 0, latestRun: null, startedAt: null, updatedAt: null, spanMs: null })
  })

  it('spans from the first start to the last change, and names the latest run', () => {
    const summary = summariseOperation(thread, [
      run({ runId: 'run-b', createdAt: '2026-10-20T10:05:00.000Z', updatedAt: '2026-10-20T10:07:00.000Z' }),
      run({ runId: 'run-a', createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:03:00.000Z' }),
    ], [])
    expect(summary.startedAt).toBe('2026-10-20T10:00:00.000Z')
    expect(summary.updatedAt).toBe('2026-10-20T10:07:00.000Z')
    expect(summary.spanMs).toBe(7 * 60 * 1000)
    expect(summary.latestRun?.runId).toBe('run-b')
  })

  it('counts each run once by the outcome its status words name', () => {
    const summary = summariseOperation(thread, [
      run({ runId: 'a', rawStatus: 'success' }),
      run({ runId: 'b', rawStatus: 'error' }),
      run({ runId: 'c', rawStatus: 'running' }),
    ], [])
    expect({ succeeded: summary.succeeded, failed: summary.failed, open: summary.open }).toEqual({ succeeded: 1, failed: 1, open: 1 })
  })

  it('counts only the agent instances bound to this thread', () => {
    const summary = summariseOperation(thread, [], [
      branch({ key: 'b-1', state: 'running' }),
      branch({ key: 'b-2', state: 'ended' }),
      branch({ key: 'b-3', threadId: 'th-other', state: 'running' }),
    ])
    expect({ agents: summary.agents, runningAgents: summary.runningAgents }).toEqual({ agents: 2, runningAgents: 1 })
  })
})

describe('formatSpan', () => {
  it('reads a span in seconds, then minutes and seconds, then hours and minutes', () => {
    expect(formatSpan(42_000)).toBe('42s')
    expect(formatSpan(7 * 60_000)).toBe('7m 0s')
    expect(formatSpan(2 * 3_600_000 + 5 * 60_000)).toBe('2h 5m')
  })
})
