import { expect, it } from 'vitest';
import { isScopedRunView, isScopedThreadView } from '../src/run-api.js';
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
