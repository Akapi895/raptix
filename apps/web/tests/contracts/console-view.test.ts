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

it('collapses streaming message deltas into one card and never renders empty deltas', () => {
  let state = emptyStreamState('eng', 'thread');
  // Reasoning-model chunk stream: mostly empty deltas, a few text pieces, no ids.
  state = reduceStreamEvent(state, event('d1', { type: 'message', messageId: null, role: 'assistant', content: '', mode: 'delta', truncated: false }));
  state = reduceStreamEvent(state, event('d2', { type: 'message', messageId: null, role: 'assistant', content: '', mode: 'delta', truncated: false }));
  state = reduceStreamEvent(state, event('d2', { type: 'message', messageId: null, role: 'assistant', content: 'Rea', mode: 'delta', truncated: false }));
  state = reduceStreamEvent(state, event('d3', { type: 'message', messageId: null, role: 'assistant', content: 'soning', mode: 'delta', truncated: false }));
  state = reduceStreamEvent(state, event('d4', { type: 'message', messageId: null, role: 'assistant', content: ' text', mode: 'delta', truncated: false }));
  // The same line completes with a full snapshot carrying the message id.
  state = reduceStreamEvent(state, event('d5', { type: 'message', messageId: 'm-ai-1', role: 'assistant', content: 'Reasoning text final', mode: 'snapshot', truncated: false }));
  const items = consoleTimeline(state).filter(item => item.kind === 'agent');
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ text: 'Reasoning text final', messageId: 'm-ai-1', source: 'runtime' });
  // Checkpoint history for the same message id is deduped against the live card.
  expect(consoleTimeline(state).filter(item => item.kind === 'agent')).toHaveLength(1);
});

it('collapses consecutive anonymous deltas into one card and keeps tool cards separate', () => {
  let state = emptyStreamState('eng', 'thread');
  state = reduceStreamEvent(state, event('e1', { type: 'message', messageId: null, role: 'assistant', content: 'First thought.', mode: 'delta', truncated: false }));
  state = reduceStreamEvent(state, event('e2', { type: 'tool_call', toolCallId: 'c1', name: 'load_skill', argsPreview: '{}', delegation: false, truncated: false }));
  state = reduceStreamEvent(state, event('e3', { type: 'message', messageId: null, role: 'assistant', content: 'Second thought.', mode: 'delta', truncated: false }));
  const items = consoleTimeline(state);
  expect(items.map(item => item.kind)).toEqual(['agent', 'tools']);
  expect(items[0].text).toBe('First thought.Second thought.');
  expect(items[1]).toMatchObject({ kind: 'tools', tool: 'load_skill' });
});

it('never renders a card for an empty assistant snapshot (tool-only / reasoning-only turn)', () => {
  let state = emptyStreamState('eng', 'thread');
  state = reduceStreamEvent(state, event('e1', { type: 'message', messageId: 'm-empty', role: 'assistant', content: '', mode: 'snapshot', truncated: false }));
  state = reduceStreamEvent(state, event('e2', { type: 'message', messageId: 'm-ok', role: 'assistant', content: 'real reply', mode: 'snapshot', truncated: false }));
  const items = consoleTimeline(state);
  expect(items.filter(item => item.kind === 'agent')).toHaveLength(1);
  expect(items[0].text).toBe('real reply');
});

it('merges streamed reasoning deltas onto the message card and replaces them with the final snapshot trace', () => {
  let state = emptyStreamState('eng', 'thread');
  // GLM-style deltas: reasoning_content fragments alongside mostly-empty content.
  state = reduceStreamEvent(state, event('r1', { type: 'message', messageId: 'm-ai', role: 'assistant', content: '', mode: 'delta', truncated: false, reasoning: 'Thinking step 1. ' }));
  state = reduceStreamEvent(state, event('r2', { type: 'message', messageId: 'm-ai', role: 'assistant', content: '', mode: 'delta', truncated: false, reasoning: 'Step 2.' }));
  state = reduceStreamEvent(state, event('r3', { type: 'message', messageId: 'm-ai', role: 'assistant', content: 'Answer body', mode: 'delta', truncated: false }));
  const live = consoleTimeline(state).filter(item => item.kind === 'agent');
  expect(live).toHaveLength(1);
  expect(live[0]).toMatchObject({ text: 'Answer body', reasoning: 'Thinking step 1. Step 2.' });
  // The run-final snapshot carries the aggregated trace and replaces the deltas.
  state = reduceStreamEvent(state, event('r4', { type: 'message', messageId: 'm-ai', role: 'assistant', content: 'Answer body', mode: 'snapshot', truncated: false, reasoning: 'Full aggregated trace' }));
  const settled = consoleTimeline(state).filter(item => item.kind === 'agent');
  expect(settled).toHaveLength(1);
  expect(settled[0]).toMatchObject({ text: 'Answer body', reasoning: 'Full aggregated trace' });
});

it('renders a card for a reasoning-only turn (thinking without final text)', () => {
  let state = emptyStreamState('eng', 'thread');
  state = reduceStreamEvent(state, event('r1', { type: 'message', messageId: 'm-think', role: 'assistant', content: '', mode: 'snapshot', truncated: false, reasoning: 'Silent thinking turn' }));
  const items = consoleTimeline(state).filter(item => item.kind === 'agent');
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ text: '', reasoning: 'Silent thinking turn' });
});

it('keeps snapshot-history reasoning on the seeded message card', () => {
  let state = emptyStreamState('eng', 'thread');
  state = mergeThreadHistory(state, { binding, rawStatus: 'success', messages: [{ role: 'assistant', content: 'Historical reply', messageId: 'h1', reasoning: 'Historical trace' }], messagesTruncated: false, historyScope: 'root_messages_only', source: 'runtime', transcripts: [], transcriptsTruncated: false });
  const items = consoleTimeline(state).filter(item => item.kind === 'agent');
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ text: 'Historical reply', reasoning: 'Historical trace', source: 'checkpoint' });
});

it('renders one PLANNING QUESTION card per ask_user_question call, with its answer, and never a tool card', () => {
  let state = emptyStreamState('eng', 'thread');
  const askCall = (eventId: string, toolCallId: string | null, args: string): unknown => ({ type: 'tool_call', toolCallId, name: 'ask_user_question', argsPreview: args, delegation: false, truncated: false });
  const q1 = '{"header":"Thời gian","question":"Khung thời gian?"}';
  const q2 = '{"header":"Tên engagement","question":"Tên là gì?"}';
  // Same question replayed 3× (null id, then a stable id) must collapse to one card.
  state = reduceStreamEvent(state, event('r1', askCall('r1', null, q1)));
  state = reduceStreamEvent(state, event('r2', askCall('r2', null, q1)));
  state = reduceStreamEvent(state, event('r3', askCall('r3', 'tool-x', q1)));
  state = reduceStreamEvent(state, event('r4', askCall('r4', 'tool-y', q2)));
  state = reduceStreamEvent(state, event('r5', { type: 'tool_result', toolCallId: 'tool-y', name: 'ask_user_question', content: 'corporate', delegation: false, truncated: false }));
  const items = consoleTimeline(state);
  expect(items.filter(item => item.kind === 'tool')).toHaveLength(0);
  const questions = items.filter(item => item.kind === 'question');
  expect(questions.map(question => question.question)).toEqual(['Khung thời gian?', 'Tên là gì?']);
  expect(questions[1].answer).toBe('corporate');
});

it('maps the merged stream state into clock-ordered items with provenance', () => {
  let state = emptyStreamState('eng', 'thread');
  state = reduceStreamEvent(state, event('e1', { type: 'message', messageId: 'm1', role: 'user', content: 'Question', mode: 'snapshot', truncated: false }));
  state = reduceStreamEvent(state, event('e2', { type: 'tool_call', toolCallId: 'c1', name: 'nmap', argsPreview: '{"target":"x"}', delegation: false, truncated: false }));
  const transcripts: ThreadHistoryEvent[] = [
    { key: 's1::subagent_end@t', runId: null, source: 'checkpoint', truncated: false, payload: { type: 'subagent_end', agent: 'recon', sessionId: 's1', elapsedSeconds: 2.5, status: 'success', truncated: false } },
    { key: 's2::ask_user_question#q1', runId: null, source: 'checkpoint', truncated: false, payload: { type: 'ask_user_question', agent: 'soundwave', questionId: 'q1', question: 'Proceed?', header: 'Confirm', options: [{ label: 'Yes', description: 'go' }], multiSelect: true, allowOther: true, truncated: false } },
  ];
  state = mergeThreadHistory(state, { binding, rawStatus: 'success', messages: [], messagesTruncated: false, historyScope: 'root_messages_only', source: 'runtime', transcripts, transcriptsTruncated: false });
  const items = consoleTimeline(state);
  // Thread-level history has no stream clock, so it sorts ahead of the live cards.
  expect(items.map(item => item.kind)).toEqual(['invocation', 'question', 'operator', 'tools']);
  expect(items[2]).toMatchObject({ kind: 'operator', runId: 'run', source: 'runtime' });
  expect(items[0]).toMatchObject({ kind: 'invocation', agent: 'recon', runId: null, source: 'checkpoint', elapsedSeconds: 2.5 });
  expect(items[1]).toMatchObject({ kind: 'question', question: 'Proceed?', runId: null, source: 'checkpoint', options: [{ label: 'Yes' }], multiSelect: true, allowOther: true });
});

it('collapses consecutive tool calls into one activity group, broken by any other card', () => {
  let state = emptyStreamState('eng', 'thread');
  state = reduceStreamEvent(state, event('e1', { type: 'tool_call', toolCallId: 'c1', name: 'ls', argsPreview: '{"path":"/"}', delegation: false, truncated: false }));
  state = reduceStreamEvent(state, event('e2', { type: 'tool_call', toolCallId: 'c2', name: 'read_file', argsPreview: '{"path":"/a"}', delegation: false, truncated: false }));
  state = reduceStreamEvent(state, event('e3', { type: 'message', messageId: 'm1', role: 'assistant', content: 'done', mode: 'snapshot', truncated: false }));
  state = reduceStreamEvent(state, event('e4', { type: 'tool_call', toolCallId: 'c3', name: 'glob', argsPreview: '{"pattern":"*"}', delegation: false, truncated: false }));
  const items = consoleTimeline(state);
  expect(items.map(item => item.kind)).toEqual(['tools', 'agent', 'tools']);
  const group = items[0] as { tools?: { tool?: string }[] };
  expect(group.tools?.map(tool => tool.tool)).toEqual(['ls', 'read_file']);
});

it('renders a server-observed pending task interrupt once when no stream question exists', () => {
  const state = emptyStreamState('eng', 'thread');
  const pending = { questionId: 'q1', question: 'Which lab?', header: 'Scope', options: [{ label: 'Lab', description: 'isolated' }], multiSelect: false, allowOther: true, source: 'runtime' as const };
  expect(consoleTimeline(state, [pending])).toEqual([expect.objectContaining({ kind: 'question', questionId: 'q1', question: 'Which lab?', source: 'runtime' })]);
  const observed = reduceStreamEvent(state, event('e1', { type: 'ask_user_question', questionId: 'q1', question: 'Which lab?', header: 'Scope', options: pending.options, multiSelect: false, allowOther: true, truncated: false }));
  expect(consoleTimeline(observed, [pending]).filter(item => item.kind === 'question')).toHaveLength(1);
});

it('renders every server-observed pending interrupt in snapshot order behind stream cards', () => {
  const state = reduceStreamEvent(emptyStreamState('eng', 'thread'), event('e1', { type: 'message', messageId: 'm1', role: 'user', content: 'Question', mode: 'snapshot', truncated: false }));
  const pendings = [
    { questionId: 'q1', question: 'First?', header: 'A', options: [], multiSelect: false, allowOther: false, source: 'runtime' as const },
    { questionId: 'q2', question: 'Second?', header: 'B', options: [], multiSelect: false, allowOther: false, source: 'runtime' as const },
  ];
  const items = consoleTimeline(state, pendings);
  expect(items.filter(item => item.kind === 'question').map(item => (item as { questionId?: string }).questionId)).toEqual(['q1', 'q2']);
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
