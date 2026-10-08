import { expect, it } from 'vitest';
import type { PublicStreamEvent, ScopedRunView, ThreadHistoryEvent } from '@raptix/web-contracts';
import { emptyStreamState, reduceStreamEvent } from '../../src/features/agent-runs/stream-reducer';
import { mergeThreadHistory } from '../../src/features/agent-runs/history-merge';
import { activeRunFromPage, consoleInspector, consoleTimeline, isTerminalRunStatus } from '../../src/features/agent-runs/console-view';

const time = '2026-10-02T00:00:00.000Z';
const binding = { engagementId: 'eng', threadId: 'thread', assistantId: 'soundwave', kind: 'planning' as const, createdAt: time, updatedAt: time };
const event = (eventId: string, payload: unknown, source: 'runtime' | 'checkpoint' = 'runtime'): PublicStreamEvent => ({
  version: 1, eventId, engagementId: 'eng', threadId: 'thread', streamRunId: 'run', runId: source === 'runtime' ? 'run' : null, source, namespace: [], occurredAt: null, observedAt: time, identity: 'domain', payload,
} as PublicStreamEvent);

it('maps the merged stream state into ordered real timeline items with provenance', () => {
  let state = emptyStreamState('eng', 'thread');
  state = reduceStreamEvent(state, event('e1', { type: 'message', messageId: 'm1', role: 'user', content: 'Question', mode: 'snapshot', truncated: false }));
  state = reduceStreamEvent(state, event('e2', { type: 'tool_call', toolCallId: 'c1', name: 'nmap', argsPreview: '{"target":"x"}', delegation: false, truncated: false }));
  const transcripts: ThreadHistoryEvent[] = [
    { key: 's1::subagent_end@t', runId: null, source: 'checkpoint', truncated: false, payload: { type: 'subagent_end', agent: 'recon', sessionId: 's1', elapsedSeconds: 2.5, status: 'success', truncated: false } },
    { key: 's2::ask_user_question#q1', runId: null, source: 'checkpoint', truncated: false, payload: { type: 'ask_user_question', agent: 'soundwave', questionId: 'q1', question: 'Proceed?', header: 'Confirm', options: [{ label: 'Yes', description: 'go' }], multiSelect: true, allowOther: true, truncated: false } },
  ];
  state = mergeThreadHistory(state, { binding, rawStatus: 'success', messages: [], messagesTruncated: false, historyScope: 'root_messages_only', source: 'runtime', transcripts, transcriptsTruncated: false });
  const items = consoleTimeline(state);
  expect(items.map(item => item.kind)).toEqual(['operator', 'tool', 'invocation', 'question']);
  expect(items[0]).toMatchObject({ kind: 'operator', runId: 'run', source: 'runtime' });
  expect(items[2]).toMatchObject({ kind: 'invocation', agent: 'recon', runId: null, source: 'checkpoint', elapsedSeconds: 2.5 });
  expect(items[3]).toMatchObject({ kind: 'question', question: 'Proceed?', runId: null, source: 'checkpoint', options: [{ label: 'Yes' }], multiSelect: true, allowOther: true });
});

it('renders a server-observed pending task interrupt once when no stream question exists', () => {
  const state = emptyStreamState('eng', 'thread');
  const pending = { questionId: 'q1', question: 'Which lab?', header: 'Scope', options: [{ label: 'Lab', description: 'isolated' }], multiSelect: false, allowOther: true, source: 'runtime' as const };
  expect(consoleTimeline(state, pending)).toEqual([expect.objectContaining({ kind: 'question', questionId: 'q1', question: 'Which lab?', source: 'runtime' })]);
  const observed = reduceStreamEvent(state, event('e1', { type: 'ask_user_question', questionId: 'q1', question: 'Which lab?', header: 'Scope', options: pending.options, multiSelect: false, allowOther: true, truncated: false }));
  expect(consoleTimeline(observed, pending).filter(item => item.kind === 'question')).toHaveLength(1);
});

it('summarizes inspector sessions/tools/questions without inventing identity', () => {
  let state = emptyStreamState('eng', 'thread');
  state = reduceStreamEvent(state, event('e1', { type: 'subagent_start', agent: 'recon', sessionId: 's1', prompt: 'Scan', truncated: false }));
  state = reduceStreamEvent(state, event('e2', { type: 'subagent_tool_call', agent: 'recon', sessionId: 's1', toolId: 'c1', tool: 'nmap', truncated: false }));
  const inspector = consoleInspector(state);
  expect(inspector.invocations).toEqual([expect.objectContaining({ agent: 'recon', sessionId: 's1', status: 'running', runId: 'run' })]);
  expect(inspector.tools).toEqual([expect.objectContaining({ name: 'nmap', delegation: false, runId: 'run' })]);
  expect(inspector.questions).toBe(0);
});

it('picks the latest non-terminal run and classifies terminal statuses', () => {
  const run = (rawStatus: string): ScopedRunView => ({ engagementId: 'eng', threadId: 'thread', runId: `r-${rawStatus}`, requestId: `req-${rawStatus}`, rawStatus, createdAt: time, updatedAt: time, source: 'runtime' });
  expect(activeRunFromPage([run('success'), run('running')])).toMatchObject({ runId: 'r-running' });
  expect(activeRunFromPage([run('success'), run('error')])).toBeNull();
  expect(isTerminalRunStatus('interrupted')).toBe(true);
  expect(isTerminalRunStatus('pending')).toBe(false);
  expect(isTerminalRunStatus(undefined)).toBe(false);
});
