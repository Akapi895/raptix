import { expect, it } from 'vitest';
import { isPublicStreamEvent } from '@raptix/web-contracts';
import { projectStreamFrame } from '../src/services/runtime/stream-projection.js';
const scope = { engagementId: 'eng', threadId: 'thread', runId: 'run' };
function frame(event: string, data: unknown, id?: string) { return { event, data: JSON.stringify(data), ...(id === undefined ? {} : { id }) }; }
it('preserves parallel invocation identity, nullable call ID, seconds and terminal flags', () => {
  const raw = { type: 'subagent_end', agent: 'recon', session_id: 'invocation-a', created_at: '2026-10-02T00:00:00+00:00', elapsed: 85.125, cancelled: true, error: true, status: 'error', proxy_api_key: 'PRIVATE' };
  const [event] = projectStreamFrame(scope, frame('custom|tools:node', raw, '100-1'), 'connection:1');
  expect(isPublicStreamEvent(event)).toBe(true);
  expect(event!.namespace).toEqual(['tools:node']);
  expect(event!.payload).toMatchObject({ sessionId: 'invocation-a', elapsedSeconds: 85.125, cancelled: true, error: true });
  expect(JSON.stringify(event)).not.toContain('PRIVATE');
  const [call] = projectStreamFrame(scope, frame('custom', { type: 'subagent_tool_call', agent: 'recon', session_id: 'invocation-b', id: null, tool: 'nmap' }, '100-2'), 'connection:2');
  expect(call!.payload).toMatchObject({ toolId: null, toolPhase: 'call' });
});
it('projects public messages/tool arguments without state, private reasoning, provider keys or system content', () => {
  const events = projectStreamFrame(scope, frame('values', { proxy_api_key: 'PRIVATE-KEY', private_reasoning: 'PRIVATE-THINK', messages: [{ type: 'system', content: 'PRIVATE-SYSTEM' }, { type: 'ai', id: 'message', content: [{ type: 'reasoning', text: 'PRIVATE-REASON' }, { type: 'text', text: 'Visible output' }], tool_calls: [{ id: 'call', name: 'task', args: { password: 'PRIVATE-PASS', nested: { Authorization: 'PRIVATE-AUTH' }, command: 'login --password PRIVATE-CMD' } }] }] }, '100-3'), 'connection:3');
  expect(events.every(isPublicStreamEvent)).toBe(true);
  expect(events).toHaveLength(2);
  for (const secret of ['PRIVATE-KEY', 'PRIVATE-THINK', 'PRIVATE-SYSTEM', 'PRIVATE-REASON', 'PRIVATE-PASS', 'PRIVATE-AUTH', 'PRIVATE-CMD']) expect(JSON.stringify(events)).not.toContain(secret);
  expect(events[1]!.payload).toMatchObject({ delegation: true });
  expect(events[0]!.runId).toBeNull(); expect(events[0]!.source).toBe('checkpoint');
  expect(events[0]!.upstreamCursor).toBeUndefined(); expect(events[1]!.upstreamCursor).toBe('100-3');
});
it('distinguishes tuple message chunks from legacy cumulative arrays and commits only the final projected event cursor', () => {
  const tuple = projectStreamFrame(scope, frame('messages', [{ type: 'AIMessageChunk', id: 'm', content: 'Hi' }, { langgraph_checkpoint_ns: 'model:child', api_key: 'PRIVATE' }], '200-1'), 'conn:1');
  expect(tuple[0]!.payload).toMatchObject({ type: 'message', mode: 'delta', content: 'Hi' });
  expect(tuple[0]!.namespace).toEqual(['model:child']);
  const snapshot = projectStreamFrame(scope, frame('messages/complete', [{ type: 'human', id: 'a', content: 'A' }, { type: 'ai', id: 'b', content: 'B' }], '200-2'), 'conn:2');
  expect(snapshot).toHaveLength(2); expect(snapshot.map(e => e.payload.type)).toEqual(['message', 'message']);
  expect(snapshot[0]!.upstreamCursor).toBeUndefined(); expect(snapshot[1]!.upstreamCursor).toBe('200-2');
});
it('keeps historical transcript attribution unknown and recovers structured interrupt questions', () => {
  const custom = { type: 'subagent_tool_result', agent: 'recon', session_id: 's', id: 'call', tool: 'nmap', content: 'x'.repeat(8000) + '…[truncated]' };
  const checkpoint = projectStreamFrame(scope, frame('values', { subagent_transcripts: [custom] }, '300-1'), 'conn:1');
  expect(checkpoint[0]!.runId).toBeNull(); expect(checkpoint[0]!.payload).toMatchObject({ toolId: 'call', truncated: true });
  const question = { type: 'ask_user_question', agent: 'soundwave', id: 'question-call', question: 'Choose?', options: [{ label: 'A', description: 'First' }], multi_select: true };
  const recovered = projectStreamFrame(scope, frame('updates', { __interrupt__: [{ id: 'graph-interrupt', value: question }] }, '300-2'), 'conn:2');
  expect(recovered[0]!.payload).toMatchObject({ type: 'ask_user_question', questionId: 'question-call', multiSelect: true });
});
it('rejects mismatched stream metadata and never forwards raw debug/error objects', () => {
  expect(() => projectStreamFrame(scope, frame('metadata', { run_id: 'foreign' }), 'x')).toThrow();
  expect(projectStreamFrame(scope, frame('debug', { secret: 'PRIVATE' }, '100-4'), 'x')).toEqual([]);
  expect(() => projectStreamFrame(scope, frame('error', { message: 'PRIVATE' }), 'x')).toThrow();
});
