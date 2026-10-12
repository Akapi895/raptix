import { expect, it } from 'vitest';
import { isScopedThreadView } from '@raptix/web-contracts'
import type { ScopedThreadView, PublicStreamEvent } from '@raptix/web-contracts'
import { emptyStreamState, reduceStreamEvent, streamDisconnected } from '../../src/features/agent-runs/stream-reducer'
import { mergeThreadHistory } from '../../src/features/agent-runs/history-merge'

const time = '2026-10-02T00:00:00.000Z'
const binding = { engagementId: 'eng', threadId: 'thread', assistantId: 'soundwave', kind: 'planning' as const, createdAt: time, updatedAt: time }
const snapshot = (overrides: Partial<ScopedThreadView>): ScopedThreadView => ({ binding, rawStatus: 'success', messages: [], messagesTruncated: false, historyScope: 'root_messages_only', source: 'runtime', ...overrides })
const run = (runId: string, payload: unknown, source: 'runtime' | 'checkpoint' = 'runtime'): PublicStreamEvent => ({
  version: 1, eventId: `${source}-${runId}-${Math.random().toString(36).slice(2)}`, engagementId: 'eng', threadId: 'thread', streamRunId: 'run', runId: source === 'runtime' ? runId : null, source, namespace: [], occurredAt: null, observedAt: time, identity: 'domain', payload,
} as PublicStreamEvent)

it('merges owned checkpoint history as thread-level entries without run attribution', () => {
  const state = mergeThreadHistory(emptyStreamState('eng', 'thread'), snapshot({
    transcripts: [
      { key: 's1::subagent_end@2026-10-02T00:00:01+00:00', runId: null, source: 'checkpoint', truncated: false, payload: { type: 'subagent_end', agent: 'recon', sessionId: 's1', elapsedSeconds: 1.5, status: 'success', truncated: false } },
      { key: null, runId: null, source: 'checkpoint', truncated: false, payload: { type: 'subagent_message', agent: 'recon', text: 'note', truncated: false } },
    ],
  }))
  expect(Object.values(state.invocations)).toHaveLength(2)
  expect(state.invocations['s1'] ?? Object.values(state.invocations).find(i => i.sessionId === 's1')).toMatchObject({ runId: null, status: 'completed', agent: 'recon' })
  expect(isScopedThreadView(snapshot({}))).toBe(true)
})

it('is idempotent when the same snapshot is merged after reconnects', () => {
  const view = snapshot({ transcripts: [{ key: 's1::subagent_tool_result#call-1', runId: null, source: 'checkpoint', truncated: false, payload: { type: 'subagent_tool_result', agent: 'recon', sessionId: 's1', toolId: 'call-1', tool: 'nmap', content: 'result', truncated: false } }] })
  const once = mergeThreadHistory(emptyStreamState('eng', 'thread'), view)
  const twice = mergeThreadHistory(once, view)
  expect(Object.keys(twice.tools)).toEqual(Object.keys(once.tools))
  expect(twice.tools).toEqual(once.tools)
})

it('never downgrades full live content with capped checkpoint replays', () => {
  const state = reduceStreamEvent(emptyStreamState('eng', 'thread'), run('run', { type: 'subagent_tool_result', agent: 'recon', sessionId: 's1', toolId: 'call-1', tool: 'nmap', content: 'full live output', truncated: false }))
  const merged = mergeThreadHistory(state, snapshot({ transcripts: [{ key: 's1::subagent_tool_result#call-1', runId: null, source: 'checkpoint', truncated: true, payload: { type: 'subagent_tool_result', agent: 'recon', sessionId: 's1', toolId: 'call-1', tool: 'nmap', content: 'capped…[truncated]', truncated: true } }] }))
  const key = Object.keys(merged.tools)[0]!
  expect(merged.tools[key]).toMatchObject({ content: 'full live output', source: 'runtime', truncated: false })
})

it('preserves existing run attribution and live-only handoff state from history', () => {
  const state = reduceStreamEvent(emptyStreamState('eng', 'thread'), run('run', { type: 'engagement_ready', agent: 'soundwave' }))
  const merged = mergeThreadHistory({ ...state, invocations: { ...state.invocations, [JSON.stringify(['s1', 's1'])]: { agent: 'recon', sessionId: 's1', status: 'running', runId: 'run', order: 0 } } }, snapshot({
    transcripts: [
      { key: 's1::subagent_end@2026-10-02T00:00:01+00:00', runId: null, source: 'checkpoint', truncated: false, payload: { type: 'subagent_end', agent: 'recon', sessionId: 's1', status: 'success', truncated: false } },
      { key: null, runId: null, source: 'checkpoint', truncated: false, payload: { type: 'engagement_ready', agent: 'soundwave', truncated: false } },
    ],
  }))
  expect(Object.values(merged.invocations).find(i => i.sessionId === 's1')!.runId).toBe('run')
  expect(merged.handoffPending).toBe(true)
})

it('fills missing messages by id and never overwrites keyed runtime messages', () => {
  const state = reduceStreamEvent(emptyStreamState('eng', 'thread'), run('run', { type: 'message', messageId: 'm1', role: 'assistant', content: 'live full answer', mode: 'snapshot', truncated: false }))
  const merged = mergeThreadHistory(state, snapshot({ messages: [
    { role: 'assistant', content: 'capped live answer…[truncated]', messageId: 'm1' },
    { role: 'user', content: 'Question', messageId: 'm0' },
  ] }))
  const m1 = merged.messages[JSON.stringify([[], 'm1'])]!
  expect(m1).toMatchObject({ content: 'live full answer', source: 'runtime' })
  expect(merged.messages[JSON.stringify([[], 'm0'])]).toMatchObject({ content: 'Question', source: 'checkpoint', runId: null })
})

it('ignores snapshots from a different scope', () => {
  const state = emptyStreamState('eng', 'thread')
  const foreign = { ...snapshot({}), binding: { ...binding, threadId: 'other' } } as ScopedThreadView
  expect(mergeThreadHistory(state, foreign)).toBe(state)
})

it('keeps recovery state machine intact across history merge', () => {
  const state = streamDisconnected(emptyStreamState('eng', 'thread'))
  const merged = mergeThreadHistory(state, snapshot({}))
  expect(merged.transport).toBe('disconnected')
  expect(merged.recoveryRequired).toBe(true)
})
