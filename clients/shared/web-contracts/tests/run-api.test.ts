import { expect, it } from 'vitest';
import { isScopedRunView, isScopedThreadListView, isScopedThreadView } from '../src/run-api.js';
const time = '2026-10-02T00:00:00.000Z';
it('preserves raw runtime status and requires acknowledged scoped run identity', () => {
  const run = { engagementId: 'eng', threadId: 'thread', runId: 'run', requestId: 'request', rawStatus: 'pending', createdAt: time, updatedAt: time, source: 'runtime' };
  expect(isScopedRunView(run)).toBe(true);
  expect(isScopedRunView({ ...run, runId: null })).toBe(false);
  expect(isScopedRunView({ ...run, source: 'fixture' })).toBe(false);
  expect(isScopedRunView({ ...run, rawStatus: 'new-upstream-state' })).toBe(true);
});
it('labels bounded root messages without pretending to supply transcript history', () => {
  const thread = { binding: { engagementId: 'eng', threadId: 'thread', assistantId: 'soundwave', kind: 'planning', createdAt: time, updatedAt: time }, rawStatus: null, messages: [{ role: 'assistant', content: 'Acknowledged' }], messagesTruncated: false, historyScope: 'root_messages_only', source: 'runtime' };
  expect(isScopedThreadView(thread)).toBe(true);
  expect(isScopedThreadView({ ...thread, messages: [{ role: 'system', content: 'private' }] })).toBe(false);
  expect(isScopedThreadView({ ...thread, messages: [{ role: ['user'], content: 'malformed role' }] })).toBe(false);
});
it('validates optional thread-level transcript history and message ids additively', () => {
  const thread = { binding: { engagementId: 'eng', threadId: 'thread', assistantId: 'soundwave', kind: 'planning', createdAt: time, updatedAt: time }, rawStatus: 'success', messages: [{ role: 'user', content: 'Question', messageId: 'm1' }], messagesTruncated: false, historyScope: 'root_messages_only', source: 'runtime', transcripts: [{ key: 's1::subagent_end@2026-10-02T00:00:01+00:00', runId: null, source: 'checkpoint', truncated: false, payload: { type: 'subagent_end', agent: 'recon', sessionId: 's1', truncated: false } }], transcriptsTruncated: false };
  expect(isScopedThreadView(thread)).toBe(true);
  expect(isScopedThreadView({ ...thread, messages: [{ role: 'user', content: 'Question', messageId: 42 }] })).toBe(false);
  expect(isScopedThreadView({ ...thread, transcripts: [{ ...thread.transcripts[0], runId: 'run' }] })).toBe(false);
  expect(isScopedThreadView({ ...thread, transcripts: [{ ...thread.transcripts[0], source: 'runtime' }] })).toBe(false);
  expect(isScopedThreadView({ ...thread, transcripts: [{ ...thread.transcripts[0], payload: { type: 'unknown', agent: 'x' } }] })).toBe(false);
  expect(isScopedThreadView({ ...thread, transcripts: [{ ...thread.transcripts[0], truncated: false }, { ...thread.transcripts[0] }], transcriptsTruncated: undefined })).toBe(false);
  expect(isScopedThreadView({ ...thread, transcripts: undefined, transcriptsTruncated: undefined })).toBe(true);
});
it('validates the owner-scoped thread selector list', () => {
  const list = { engagementId: 'eng', threads: [{ engagementId: 'eng', threadId: 'thread', assistantId: 'soundwave', kind: 'planning', createdAt: time, updatedAt: time }], source: 'runtime' };
  expect(isScopedThreadListView(list)).toBe(true);
  expect(isScopedThreadListView({ ...list, source: 'fixture' })).toBe(false);
  expect(isScopedThreadListView({ ...list, threads: [{ ...list.threads[0], kind: 'unknown' }] })).toBe(false);
  expect(isScopedThreadListView({ ...list, engagementId: '' })).toBe(false);
});
