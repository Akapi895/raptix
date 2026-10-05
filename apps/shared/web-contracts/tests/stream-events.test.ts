import { expect, it } from 'vitest';
import { isPublicStreamEvent } from '../src/stream-events.js';
const event = { version: 1, eventId: 'event', engagementId: 'eng', threadId: 'thread', streamRunId: 'run', runId: 'run', source: 'runtime', namespace: [], observedAt: '2026-10-02T00:00:00.000Z', occurredAt: null, identity: 'upstream', payload: { type: 'message', messageId: 'message', role: 'assistant', content: 'Public text', mode: 'delta', truncated: false } };
it('validates typed public payloads and keeps checkpoint attribution distinct from the stream attempt', () => {
  expect(isPublicStreamEvent(event)).toBe(true);
  expect(isPublicStreamEvent({ ...event, source: 'checkpoint', runId: null })).toBe(true);
  expect(isPublicStreamEvent({ ...event, source: 'checkpoint', runId: 'run' })).toBe(false);
  expect(isPublicStreamEvent({ ...event, runId: 'foreign' })).toBe(false);
  expect(isPublicStreamEvent({ ...event, payload: { ...event.payload, role: ['assistant'] } })).toBe(false);
  expect(isPublicStreamEvent({ ...event, source: ['runtime'] })).toBe(false);
  expect(isPublicStreamEvent({ ...event, identity: ['upstream'] })).toBe(false);
});
