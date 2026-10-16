import { afterEach, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { buildApp } from '../src/app.js';
import { StreamService } from '../src/services/runtime/stream-service.js';
import { RuntimeJoinClient } from '../src/integrations/runtime/join-client.js';
import { ProjectNotFoundError } from '../src/services/projects-service.js';
import { SseDecoder } from '@raptix/streaming';
import { isPublicStreamEvent } from '@raptix/web-contracts';

const servers: FastifyInstance[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(servers.splice(0).map(s => s.close())); });
async function setup() {
  const upstream = Fastify(); servers.push(upstream);
  const trace = { joins: [] as string[], cursors: [] as unknown[], cancels: [] as unknown[], authorizations: 0 };
  upstream.addHook('onRequest', async request => { trace.joins.push(request.method); });
  upstream.get('/threads/thread/runs/run/stream', (request, reply) => {
    trace.cursors.push(request.headers['last-event-id']); trace.cancels.push((request.query as Record<string, unknown>).cancel_on_disconnect);
    return reply.type('text/event-stream').send(Readable.from((async function* () {
      yield 'event: metadata\nid: 100-0\ndata: {"run_id":"run"}\n\n';
      // Long enough that the 5ms re-attestation cadence still fires when the
      // event loop is starved by the rest of the parallel suite.
      await new Promise(resolve => setTimeout(resolve, 120));
      yield 'event: values\nid: 100-1\ndata: {"proxy_api_key":"PRIVATE","messages":[{"type":"human","id":"user","content":"đúng"},{"type":"ai","id":"answer","content":"Hello"}]}\n\n';
    })()));
  });
  const url = await upstream.listen({ port: 0, host: '127.0.0.1' });
  const service = new StreamService({ async getRun(user, engagement, thread, run) {
    trace.authorizations++;
    if (user !== 'local' || engagement !== 'eng' || thread !== 'thread' || run !== 'run') throw new ProjectNotFoundError();
    return { engagementId: engagement, threadId: thread, runId: run, requestId: 'request', rawStatus: 'running', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: 'runtime' };
  } }, new RuntimeJoinClient(url), 5);
  const api = await buildApp({ streamService: service }); servers.push(api);
  return { api, trace };
}
it('authorizes each join/reconnect, forwards only upstream cursors and observes through GET without runtime cancellation', async () => {
  const { api, trace } = await setup();
  const path = '/api/engagements/eng/threads/thread/runs/run/events';
  const response = await api.inject(path);
  expect(response.statusCode).toBe(200); expect(response.headers['content-type']).toContain('text/event-stream');
  expect(response.headers['cache-control']).toBe('no-cache, no-transform'); expect(response.headers['x-accel-buffering']).toBe('no');
  expect(response.body).toContain(': heartbeat'); expect(response.body).not.toContain('PRIVATE');
  const frames = new SseDecoder().push(response.body);
  const events = frames.filter(f => f.event === 'run-event');
  expect(events).toHaveLength(2); expect(events.map(f => JSON.parse(f.data)).every(isPublicStreamEvent)).toBe(true);
  expect(events[0]!.id).toBeUndefined(); expect(events[1]!.id).toBe('100-1');
  expect(frames.find(f => f.event === 'control')!.id).toBeUndefined();
  await api.inject({ url: path, headers: { 'last-event-id': '100-1' } });
  // Two opens, plus the per-heartbeat authorization re-attestations of the
  // first (long-enough) stream.
  expect(trace.authorizations).toBeGreaterThanOrEqual(2); expect(trace.cursors).toEqual(['-1', '100-1']); expect(trace.joins).toEqual(['GET', 'GET']); expect(trace.cancels).toEqual(['0', '0']);
});
it('closes the stream with recovery required when authorization is revoked mid-stream', async () => {
  const upstream = Fastify(); servers.push(upstream);
  const gate = { resolve: () => {} };
  const held = new Promise<void>(resolve => { gate.resolve = resolve; });
  upstream.get('/threads/thread/runs/run/stream', (_request, reply) =>
    reply.type('text/event-stream').send(Readable.from((async function* () {
      yield 'event: values\nid: 100-1\ndata: {"messages":[]}\n\n';
      await held;
    })())));
  const url = await upstream.listen({ port: 0, host: '127.0.0.1' });
  const trace = { authorizations: 0 };
  let revoked = false;
  const service = new StreamService({ async getRun() {
    trace.authorizations++;
    if (revoked) throw new ProjectNotFoundError();
    return { engagementId: 'eng', threadId: 'thread', runId: 'run', requestId: 'request', rawStatus: 'running', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: 'runtime' };
  } }, new RuntimeJoinClient(url), 5);
  const api = await buildApp({ streamService: service }); servers.push(api);
  setTimeout(() => { revoked = true; }, 20);
  const response = await api.inject('/api/engagements/eng/threads/thread/runs/run/events');
  expect(response.statusCode).toBe(200);
  expect(response.body).toContain('100-1');
  expect(response.body).toContain('event: control');
  expect(response.body).toContain('stream_closed');
  expect(trace.authorizations).toBeGreaterThan(1);
});
it('denies foreign run scope and malformed/arbitrary cursor options before joining upstream', async () => {
  const { api, trace } = await setup();
  expect((await api.inject('/api/engagements/foreign/threads/thread/runs/run/events')).statusCode).toBe(404);
  expect((await api.inject('/api/engagements/eng/threads/thread/runs/run/events?cursor=https://unrelated.invalid')).statusCode).toBe(400);
  expect((await api.inject('/api/engagements/eng/threads/thread/runs/run/events?url=http://unrelated.invalid')).statusCode).toBe(400);
  expect(trace.joins).toHaveLength(0);
});

it('re-attests revoked membership during continuous event traffic before publishing further frames', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(0);
  let revoked = false;
  let closed = false;
  const service = new StreamService({ async getRun() {
    if (revoked) throw new ProjectNotFoundError();
    return { engagementId: 'eng', threadId: 'thread', runId: 'run', requestId: 'request', rawStatus: 'running', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: 'runtime' };
  } }, { async open() {
    return { close: () => { closed = true; }, frames: (async function* () {
      for (let index = 0; index < 20; index++) {
        vi.setSystemTime(index * 10);
        if (index === 2) revoked = true;
        yield { event: 'values', id: `frame-${index}`, data: JSON.stringify({ messages: [{ type: 'ai', id: `msg-${index}`, content: index >= 3 ? 'AFTER_AUTH_DEADLINE' : 'BEFORE_AUTH_DEADLINE' }] }) };
      }
    })() };
  } }, 30);
  const stream = await service.open('member', { engagementId: 'eng', threadId: 'thread', runId: 'run' }, '-1', new AbortController().signal);
  let output = '';
  for await (const chunk of stream) output += String(chunk);
  expect(output).toContain('BEFORE_AUTH_DEADLINE');
  expect(output).not.toContain('AFTER_AUTH_DEADLINE');
  expect(output).toContain('stream_closed');
  expect(closed).toBe(true);
});
