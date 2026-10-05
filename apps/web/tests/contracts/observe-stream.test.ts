import { afterEach, expect, it, vi } from 'vitest';
import { observeRunStream } from '../../src/features/agent-runs/observe-stream';
const time = '2026-10-02T00:00:00.000Z';
const scope = { engagementId: 'eng', threadId: 'thread', runId: 'run' };
afterEach(() => { vi.unstubAllGlobals(); });
it('refetches owned status/snapshot after EOF, reconnects by native cursor and never sends a mutation', async () => {
  const calls: { url: string; method: string; cursor: unknown }[] = [];
  let joins = 0, recoveries = 0;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', cursor: init?.headers && (init.headers as Record<string, string>)['Last-Event-ID'] });
    if (url.endsWith('/events')) { joins++; return new Response('event: cursor\nid: 100-1\ndata: {"upstreamCursor":"100-1"}\n\nevent: control\ndata: {"type":"stream_closed","recoveryRequired":true}\n\n', { headers: { 'content-type': 'text/event-stream' } }); }
    if (url.endsWith('/runs/run')) return Response.json({ ...scope, requestId: 'request', rawStatus: joins === 1 ? 'running' : 'success', createdAt: time, updatedAt: time, source: 'runtime' });
    return Response.json({ binding: { engagementId: 'eng', threadId: 'thread', assistantId: 'soundwave', kind: 'planning', createdAt: time, updatedAt: time }, rawStatus: joins === 1 ? 'busy' : 'idle', messages: [], messagesTruncated: false, historyScope: 'root_messages_only', source: 'runtime' });
  });
  const result = await observeRunStream({ scope, baseUrl: '/api', signal: new AbortController().signal, onEvent() { throw new Error('Control cursor is not a domain event'); }, onTransport() {}, onRecovery() { recoveries++; } });
  expect(result).toEqual({ cursor: '100-1', recoveryRequired: false }); expect(recoveries).toBe(2);
  expect(calls.every(c => c.method === 'GET')).toBe(true);
  expect(calls.filter(c => c.url.endsWith('/events')).map(c => c.cursor)).toEqual([undefined, '100-1']);
});
it('refuses stream scope mismatch without letting event identity become a replay cursor', async () => {
  const event = { version: 1, eventId: 'fake-cursor', engagementId: 'foreign', threadId: 'thread', streamRunId: 'run', runId: 'run', source: 'runtime', namespace: [], observedAt: time, occurredAt: null, identity: 'upstream', payload: { type: 'message', messageId: 'm', role: 'assistant', content: 'secret', mode: 'delta', truncated: false } };
  vi.stubGlobal('fetch', async () => new Response(`event: run-event\ndata: ${JSON.stringify(event)}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
  await expect(observeRunStream({ scope, signal: new AbortController().signal, onEvent() { throw new Error('Foreign event must not reach consumer'); }, onTransport() {}, onRecovery() {} })).rejects.toThrow('scope or payload mismatch');
});
