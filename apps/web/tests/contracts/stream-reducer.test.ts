import { expect, it } from 'vitest';
import type { PublicStreamEvent, PublicStreamPayload } from '@raptix/web-contracts';
import { emptyStreamState, reduceStreamEvent, streamDisconnected, mergeRunObservation, observedExecutionCount } from '../../src/features/agent-runs/stream-reducer';
const time = '2026-10-02T00:00:00.000Z';
function event(payload: PublicStreamPayload, eventId: string, source: 'runtime' | 'checkpoint' = 'runtime'): PublicStreamEvent {
  return { version: 1, eventId, engagementId: 'eng', threadId: 'thread', streamRunId: 'run', runId: source === 'runtime' ? 'run' : null, source, namespace: [], observedAt: time, occurredAt: null, identity: 'upstream', payload };
}
it('appends one message by ID, replaces snapshots and deduplicates replay instead of appending whole history', () => {
  let state = emptyStreamState('eng', 'thread');
  const first = event({ type: 'message', messageId: 'm', role: 'assistant', content: 'Hello', mode: 'delta', truncated: false }, '1');
  state = reduceStreamEvent(state, first);
  state = reduceStreamEvent(state, event({ ...first.payload, type: 'message', messageId: 'm', role: 'assistant', content: ' world', mode: 'delta', truncated: false }, '2'));
  state = reduceStreamEvent(state, event({ type: 'message', messageId: 'm', role: 'assistant', content: 'Hello world', mode: 'snapshot', truncated: false }, '3', 'checkpoint'));
  state = reduceStreamEvent(state, first);
  expect(Object.values(state.messages)).toHaveLength(1);
  expect(Object.values(state.messages)[0]).toMatchObject({ content: 'Hello world', runId: 'run' });
  state = reduceStreamEvent(state, event({ type: 'message', messageId: 'old', role: 'user', content: 'Older attempt', mode: 'snapshot', truncated: false }, '4', 'checkpoint'));
  expect(Object.values(state.messages).find(m => m.messageId === 'old')!.runId).toBeNull();
});
it('keeps parallel same-name invocations/tools distinct and never downgrades full live output with truncated checkpoint output', () => {
  let state = emptyStreamState('eng', 'thread');
  for (const sessionId of ['a', 'b']) state = reduceStreamEvent(state, event({ type: 'subagent_start', agent: 'recon', sessionId, truncated: false }, `start-${sessionId}`));
  state = reduceStreamEvent(state, event({ type: 'subagent_tool_result', agent: 'recon', sessionId: 'a', toolId: 'call', tool: 'nmap', content: 'full live result', truncated: false }, 'live'));
  state = reduceStreamEvent(state, event({ type: 'subagent_tool_result', agent: 'recon', sessionId: 'a', toolId: 'call', tool: 'nmap', content: 'partial', truncated: true }, 'checkpoint', 'checkpoint'));
  state = reduceStreamEvent(state, event({ type: 'subagent_tool_call', agent: 'recon', sessionId: 'b', toolId: 'call', tool: 'nmap', truncated: false }, 'call-b'));
  state = reduceStreamEvent(state, event({ type: 'subagent_end', agent: 'recon', sessionId: 'a', elapsedSeconds: 85.125, error: true, cancelled: true, truncated: false }, 'end-a'));
  expect(Object.values(state.invocations)).toHaveLength(2);
  expect(state.invocations.a).toMatchObject({ status: 'cancelled', error: true, cancelled: true, elapsedSeconds: 85.125 });
  expect(Object.values(state.tools)).toHaveLength(2);
  expect(Object.values(state.tools).find(t => t.resultSeen)!.content).toBe('full live result');
});
it('deduplicates question tool identity, marks handoff, and does not count root delegation as a second execution', () => {
  let state = emptyStreamState('eng', 'thread');
  for (const id of ['1', '2']) state = reduceStreamEvent(state, event({ type: 'ask_user_question', agent: 'soundwave', questionId: 'q', question: 'Choose', truncated: false }, id));
  state = reduceStreamEvent(state, event({ type: 'tool_call', toolCallId: 'task', name: 'task', delegation: true, truncated: false }, '3'));
  state = reduceStreamEvent(state, event({ type: 'subagent_tool_call', agent: 'recon', sessionId: 'a', toolId: 'scan', tool: 'nmap', truncated: false }, '4'));
  state = reduceStreamEvent(state, event({ type: 'engagement_ready', agent: 'soundwave', truncated: false }, '5'));
  expect(Object.keys(state.questions)).toHaveLength(1); expect(state.handoffPending).toBe(true); expect(observedExecutionCount(state)).toBe(1);
});
it('keeps transport loss separate from execution status and refuses other scopes', () => {
  let state = emptyStreamState('eng', 'thread');
  state = mergeRunObservation(state, { engagementId: 'eng', threadId: 'thread', runId: 'run', requestId: 'intent', rawStatus: 'running', createdAt: time, updatedAt: time, source: 'runtime' });
  const disconnected = streamDisconnected(state);
  expect(disconnected.attempts.run!.rawStatus).toBe('running'); expect(disconnected.recoveryRequired).toBe(true);
  expect(reduceStreamEvent(disconnected, { ...event({ type: 'interrupt', interruptId: 'x' }, 'x'), engagementId: 'foreign' })).toBe(disconnected);
});
