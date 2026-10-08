import { expect, it } from 'vitest';
import { isRequestRecoveryView, isThreadBindingView } from '../src/ownership.js';
const timestamps = { createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' };
it('validates thread identity/kind/timestamps without inventing runtime state', () => {
  const thread = { engagementId: 'eng', threadId: 'thread', assistantId: 'soundwave', kind: 'planning', ...timestamps };
  expect(isThreadBindingView(thread)).toBe(true);
  expect(isThreadBindingView({ ...thread, kind: 'arbitrary' })).toBe(false);
  expect(isThreadBindingView({ ...thread, assistantId: '' })).toBe(false);
  expect(isThreadBindingView({ ...thread, updatedAt: null })).toBe(false);
});
it('distinguishes reserved/uncertain identities from acknowledged run identities', () => {
  const pending = { engagementId: 'eng', requestId: 'request', operation: 'create_run', state: 'uncertain', threadId: 'thread', runId: null, ...timestamps };
  expect(isRequestRecoveryView(pending)).toBe(true);
  expect(isRequestRecoveryView({ ...pending, state: 'accepted' })).toBe(false);
  expect(isRequestRecoveryView({ ...pending, state: 'accepted', runId: 'run' })).toBe(true);
  expect(isRequestRecoveryView({ ...pending, state: 'finished' })).toBe(false);
  expect(isRequestRecoveryView({ ...pending, threadId: null })).toBe(false);
});
it('does not misrepresent a thread-creation ACK as a run', () => {
  const threadRequest = { engagementId: 'eng', requestId: 'request', operation: 'create_thread', state: 'creating', threadId: null, runId: null, ...timestamps };
  expect(isRequestRecoveryView(threadRequest)).toBe(true);
  expect(isRequestRecoveryView({ ...threadRequest, state: 'accepted' })).toBe(false);
  expect(isRequestRecoveryView({ ...threadRequest, state: 'accepted', threadId: 'thread' })).toBe(true);
  expect(isRequestRecoveryView({ ...threadRequest, runId: 'run' })).toBe(false);
});
