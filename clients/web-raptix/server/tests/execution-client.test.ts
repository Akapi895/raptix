import { afterEach, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { RuntimeExecutionClient } from '../src/integrations/runtime/execution-client.js';
import { RuntimeRejectedError } from '../src/integrations/runtime/read-client.js';
import type { TrustedRuntimeContext } from '../src/services/runtime/runtime-context.js';
const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(app => app.close())); });
const context: TrustedRuntimeContext = { engagementId: 'eng', workspaceSlug: 'scope', kind: 'planning', assistantId: 'soundwave', bindingHash: 'test', runtimeConfigHash: 'test', configurable: { engagement_name: 'scope', workspace_path: '/workspace/scope', target_type: 'web_url', target_value: 'https://authorized.invalid', authorization_confirmed: true }, metadata: { engagement_id: 'eng', ui_assistant_id: 'soundwave' }, publicView: { engagementId: 'eng', workspaceSlug: 'scope', assistantId: 'soundwave', kind: 'planning', authorizationConfirmed: true, planningState: 'blocked', executionReady: false, threadVerified: false, source: 'runtime' } };
it('sends one native background create with reject policy and trusted config outside message input', async () => {
  const app = Fastify(); servers.push(app); let creates = 0;
  app.post('/threads', async request => { const body = request.body as { thread_id: string; metadata: Record<string, unknown>; if_exists: string; supersteps: unknown }; expect(body.if_exists).toBe('raise'); expect(body.supersteps).toEqual([{ updates: [{ values: context.configurable, as_node: '__start__' }] }]); return { thread_id: body.thread_id, metadata: body.metadata }; });
  app.post('/threads/thread/runs', async request => {
    creates++;
    const body = request.body as Record<string, unknown>;
    expect(body.input).toEqual({ messages: [{ role: 'user', content: 'hello' }] });
    expect(body.config).toEqual({ configurable: context.configurable });
    expect(body.assistant_id).toBe('soundwave'); expect(body.multitask_strategy).toBe('reject'); expect(body.if_not_exists).toBe('reject');
    expect(body.stream_mode).toEqual(['values', 'messages', 'updates', 'custom']); expect(body.stream_subgraphs).toBe(true); expect(body.stream_resumable).toBe(true);
    return { run_id: 'run', thread_id: 'thread', status: 'pending', metadata: body.metadata, created_at: '2026-10-02T00:00:00+00:00', updated_at: '2026-10-02T00:00:00+00:00' };
  });
  const client = new RuntimeExecutionClient(await app.listen({ port: 0, host: '127.0.0.1' }));
  expect((await client.createThread('thread', context.metadata, context.configurable)).threadId).toBe('thread');
  expect((await client.createRun('thread', context, 'request-0001', 'hello')).status).toBe('pending');
  expect(creates).toBe(1);
});
it('distinguishes explicit rejection from lost/malformed ACK without retrying mutations', async () => {
  const app = Fastify(); servers.push(app); let creates = 0;
  app.post('/threads', async (_request, reply) => reply.status(409).send({ private: 'do not echo' }));
  app.post('/threads/thread/runs', async () => { creates++; return { wrong: 'ACK identity missing' }; });
  const client = new RuntimeExecutionClient(await app.listen({ port: 0, host: '127.0.0.1' }));
  await expect(client.createThread('thread', {}, context.configurable)).rejects.toBeInstanceOf(RuntimeRejectedError);
  await expect(client.createRun('thread', context, 'request-0001', 'hello')).rejects.toMatchObject({ statusCode: 503 });
  expect(creates).toBe(1);
});
