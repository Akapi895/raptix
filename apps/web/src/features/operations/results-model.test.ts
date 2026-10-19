/** Thread results summary (P12): runtime words are counted as reported, and a non-success branch is never counted as success. */
import { describe, expect, it } from 'vitest'
import type { CuratedFindingView } from '@raptix/web-contracts'
import type { RuntimeFleetBranch, RuntimeRun } from './runtime'
import { summariseThreadResults } from './results-model'

const run = (runId: string, rawStatus: string): RuntimeRun => ({ runId, requestId: `req-${runId}`, threadId: 'th-1', rawStatus, createdAt: '2026-10-19T09:00:00.000Z', updatedAt: '2026-10-19T09:01:00.000Z' })
const branch = (key: string, threadId: string, state: RuntimeFleetBranch['state'], outcome: string | null): RuntimeFleetBranch => ({ threadId, key, agent: 'recon', state, outcome, startedAt: null, endedAt: null })
const finding = (id: string, threadId: string | null, runId: string | null): CuratedFindingView => ({ id, title: id, references: { threadId, runId } } as unknown as CuratedFindingView)

describe('summariseThreadResults', () => {
  it('counts run statuses as the runtime words them, most frequent first', () => {
    const result = summariseThreadResults('th-1', [run('a', 'success'), run('b', 'success'), run('c', 'error')], [], [])
    expect(result.runsByStatus).toEqual([{ status: 'success', count: 2 }, { status: 'error', count: 1 }])
    expect(result.partial).toBe(false)
  })

  it('marks results partial while a run is in flight or stopped early', () => {
    expect(summariseThreadResults('th-1', [run('a', 'running')], [], []).partial).toBe(true)
    expect(summariseThreadResults('th-1', [run('a', 'interrupted')], [], []).partial).toBe(true)
  })

  it('counts an ended branch without a success outcome, and never an unreported one as success', () => {
    const result = summariseThreadResults('th-1', [], [
      branch('k1', 'th-1', 'ended', 'success'),
      branch('k2', 'th-1', 'ended', 'error'),
      branch('k3', 'th-1', 'ended', null),
      branch('k4', 'th-1', 'running', null),
      branch('k5', 'th-other', 'ended', 'error'),
    ], [])
    expect(result.branches.map((b) => b.key)).toEqual(['k1', 'k2', 'k3', 'k4'])
    expect(result.unsuccessfulBranches).toBe(2)
  })

  it('attaches a finding that cites the thread or one of its runs, and nothing else', () => {
    const result = summariseThreadResults('th-1', [run('run-9', 'success')], [], [
      finding('by-thread', 'th-1', null),
      finding('by-run', null, 'run-9'),
      finding('other', 'th-2', 'run-2'),
      finding('unlinked', null, null),
    ])
    expect(result.findings.map((f) => f.id)).toEqual(['by-thread', 'by-run'])
  })
})
