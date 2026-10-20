import { afterEach, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { PassThrough } from 'node:stream';
import { RuntimeReadClient } from '../src/integrations/runtime/read-client.js';

const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(app => app.close())); });
async function runtime(routes: (app: FastifyInstance) => void, timeout = 1000): Promise<RuntimeReadClient> {
  const app = Fastify(); servers.push(app); routes(app);
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  return new RuntimeReadClient(address, timeout);
}
it('discovers reachable graphs with deduplication and validates scoped thread/state identities', async () => {
  const client = await runtime(app => {
    app.get('/info', async () => ({ version: '0.10.0' }));
    app.post('/assistants/search', async () => [{ graph_id: 'soundwave' }, { graph_id: 'soundwave' }, { graph_id: 'decepticon' }]);
    app.get('/threads/thread', async () => ({ thread_id: 'thread', metadata: { engagement_id: 'owned' } }));
    app.get('/threads/thread/state', async () => ({ values: { engagement_name: 'owned' }, tasks: [{ interrupts: [{ value: { type: 'ask_user_question', id: 'call-1', question: 'Scope?', options: [] } }] }] }));
  });
  expect(await client.catalog()).toEqual(['decepticon', 'soundwave']);
  expect((await client.thread('thread')).metadata.engagement_id).toBe('owned');
  expect((await client.state('thread')).values.engagement_name).toBe('owned');
  expect((await client.state('thread')).tasks).toEqual([{ interrupts: [{ value: { type: 'ask_user_question', id: 'call-1', question: 'Scope?', options: [] } }] }]);
});
it('returns unavailable without static catalog fallback for malformed discovery and missing threads', async () => {
  const client = await runtime(app => {
    app.get('/info', async () => ({ version: '0.10.0' }));
    app.post('/assistants/search', async () => [{ graph_id: 42 }]);
    app.get('/threads/wrong', async () => ({ thread_id: 'other', metadata: {} }));
  });
  await expect(client.catalog()).rejects.toMatchObject({ statusCode: 503 });
  await expect(client.thread('wrong')).rejects.toMatchObject({ statusCode: 503 });
  await expect(client.state('missing')).rejects.toMatchObject({ statusCode: 503 });
});
it('keeps its deadline through delayed response bodies and bounds decoded JSON size', async () => {
  const slow = await runtime(app => {
    app.get('/info', (_request, reply) => {
      const stream = new PassThrough();
      reply.type('application/json').send(stream);
      stream.write('{"version":');
      setTimeout(() => stream.end('"late"}'), 100);
    });
  }, 20);
  await expect(slow.catalog()).rejects.toMatchObject({ statusCode: 503 });
  const oversized = await runtime(app => { app.get('/info', async () => 'x'.repeat(8 * 1024 * 1024 + 1)); });
  await expect(oversized.catalog()).rejects.toMatchObject({ statusCode: 503 });
});
it('does not follow upstream redirects or echo runtime error bodies', async () => {
  const client = await runtime(app => {
    app.get('/info', (_request, reply) => reply.redirect('http://unrelated.invalid'));
    app.get('/threads/thread', (_request, reply) => reply.status(500).send({ secret: 'private-runtime-detail' }));
  });
  await expect(client.catalog()).rejects.toMatchObject({ statusCode: 503 });
  await expect(client.thread('thread')).rejects.not.toThrow('private-runtime-detail');
});
