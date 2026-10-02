import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import Fastify from 'fastify';
import { Readable } from 'node:stream';
import { decodeSse, SseDecoder } from '@raptix/streaming';
import { StreamService } from '../src/services/runtime/stream-service.js';
import { RuntimeJoinClient } from '../src/integrations/runtime/join-client.js';
import { buildApp } from '../src/app.js';
import { createDbClient } from '../src/db/client.js';
import { EngagementsRepository } from '../src/repositories/engagements-repository.js';
import { ProjectsService } from '../src/services/projects-service.js';
import { RuntimeOwnershipService } from '../src/services/runtime-ownership.js';
import { RuntimeContextService } from '../src/services/runtime/runtime-context.js';
import { RunService } from '../src/services/runtime/run-service.js';
import { RuntimeExecutionClient } from '../src/integrations/runtime/execution-client.js';
import { loadRuntimeConfig } from '../src/config/runtime.js';
import { isRequestRecoveryView, isScopedRunView, isScopedThreadView } from '@raptix/web-contracts';

const database = process.env.W07_TEST_DATABASE_URL ?? '';
assert.match(database, /@127\.0\.0\.1:5433\/raptix_web_w02_(fresh|oldcopy)_20261001$/);
const workspace = process.env.W07_TEST_WORKSPACE!;
assert.ok(workspace.includes('opencode') && workspace.includes('w07'));
await mkdir(workspace, { recursive: true });
const db = createDbClient({ connectionString: database });
const provider = Fastify();
type RemoteThread = { thread_id: string; metadata: Record<string, unknown>; status: string; values: Record<string, unknown> };
type RemoteRun = { run_id: string; thread_id: string; status: string; created_at: string; updated_at: string; metadata: Record<string, unknown> };
const threads = new Map<string, RemoteThread>();
const runs = new Map<string, RemoteRun>();
const streamTrace = { joins: 0, cursors: [] as unknown[], cancel: [] as unknown[] };
const control = { threadCreates: 0, runCreates: 0, runReads: 0, loseThreadAck: false, loseRunAck: false, rejectRun: false, catalogDown: false, authDefaultBug: false };
let barrierMode = false, barrierReads = 0;
let releaseFirst: () => void = () => {}, releaseSecond: () => void = () => {};
let firstReady: Promise<void>, secondReady: Promise<void>;
provider.get('/info', async (_request, reply) => control.catalogDown ? reply.status(503).send({ secret: 'private' }) : { version: '0.10.0' });
provider.post('/assistants/search', async () => [{ graph_id: 'soundwave' }, { graph_id: 'decepticon' }]);
provider.post('/threads', async request => {
  control.threadCreates++;
  const body = request.body as { thread_id: string; metadata: Record<string, unknown>; supersteps?: { updates: { values: Record<string, unknown> }[] }[] };
  const thread = { thread_id: body.thread_id, metadata: body.metadata, status: 'idle', values: body.supersteps?.[0]?.updates[0]?.values ?? {} };
  threads.set(thread.thread_id, thread);
  if (control.loseThreadAck) { control.loseThreadAck = false; await new Promise(resolve => setTimeout(resolve, 180)); }
  return thread;
});
provider.get('/threads/:id', async (request, reply) => threads.get((request.params as { id: string }).id) ?? reply.status(404).send({ error: 'missing' }));
provider.get('/threads/:id/state', async (request, reply) => {
  if (barrierMode) {
    barrierReads++;
    if (barrierReads === 1) await firstReady;
    else if (barrierReads === 2) { releaseFirst(); await secondReady; await new Promise(resolve => setTimeout(resolve, 75)); }
  }
  const thread = threads.get((request.params as { id: string }).id);
  return thread ? { values: thread.values, metadata: { graph_id: thread.metadata.graph_id } } : reply.status(404).send({ error: 'missing' });
});
provider.post('/threads/:id/runs', async (request, reply) => {
  if (control.rejectRun) { control.rejectRun = false; return reply.status(409).send({ private: 'provider detail' }); }
  control.runCreates++;
  const id = (request.params as { id: string }).id;
  const body = request.body as { input: { messages: { role: string; content: string }[] }; config: { configurable: Record<string, unknown> }; metadata: Record<string, unknown>; multitask_strategy: string; if_not_exists: string };
  assert.equal(body.multitask_strategy, 'reject'); assert.equal(body.if_not_exists, 'reject');
  assert.deepEqual(Object.keys(body.input), ['messages']);
  const run = { run_id: randomUUID(), thread_id: id, status: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), metadata: body.metadata };
  runs.set(run.run_id, run);
  const thread = threads.get(id)!;
  const authorization = control.authDefaultBug ? thread.values.authorization_confirmed === true : body.config.configurable.authorization_confirmed;
  thread.status = 'busy'; thread.values = { ...body.config.configurable, authorization_confirmed: authorization, messages: [...body.input.messages, { type: 'system', content: 'SECRET-SYSTEM' }, { type: 'tool', content: 'SECRET-TOOL' }, { type: 'ai', content: 'Acknowledged' }], proxy_api_key: 'SECRET-KEY' };
  if (barrierMode) releaseSecond();
  if (control.loseRunAck) { control.loseRunAck = false; await new Promise(resolve => setTimeout(resolve, 180)); }
  return { ...run, kwargs: { secret: 'SECRET-KWARGS' } };
});
provider.get('/threads/:id/runs', async request => {
  const { offset = '0', limit = '100' } = request.query as { offset?: string; limit?: string };
  return [...runs.values()].filter(row => row.thread_id === (request.params as { id: string }).id).slice(Number(offset), Number(offset) + Number(limit));
});
provider.get('/threads/:id/runs/:run', async (request, reply) => { control.runReads++; return runs.get((request.params as { run: string }).run) ?? reply.status(404).send({ error: 'missing' }); });
provider.get('/threads/:id/runs/:run/stream', (request, reply) => {
  const { run } = request.params as { run: string };
  streamTrace.joins++; streamTrace.cursors.push(request.headers['last-event-id']); streamTrace.cancel.push((request.query as Record<string, unknown>).cancel_on_disconnect);
  return reply.type('text/event-stream').send(Readable.from((async function* () {
    yield `event: metadata\nid: 100-0\ndata: ${JSON.stringify({ run_id: run })}\n\n`;
    yield 'event: custom|tools:child\nid: 100-1\ndata: {"type":"subagent_start","agent":"recon","session_id":"parallel-a","prompt":"Inspect","proxy_api_key":"PRIVATE"}\n\n';
    await new Promise(resolve => setTimeout(resolve, 40));
    yield 'event: custom|tools:child\nid: 100-2\ndata: {"type":"subagent_end","agent":"recon","session_id":"parallel-a","elapsed":85.125,"cancelled":true,"error":true}\n\n';
  })()));
});
const runtimeUrl = await provider.listen({ port: 0, host: '127.0.0.1' });
const runtime = new RuntimeExecutionClient(runtimeUrl, 1000, 80);
const ownership = new RuntimeOwnershipService(db);
const projects = new ProjectsService({ repository: new EngagementsRepository(db.engagement), workspaceRoot: workspace, identity: { id: 'local', mode: 'local-single-user' } });
const context = new RuntimeContextService({ projects, ownership, runtime, workspaceRoot: workspace, config: loadRuntimeConfig({ LANGGRAPH_API_URL: runtimeUrl, RAPTIX_RUNTIME_WORKSPACE_ROOT: '/workspace' })! });
const service = new RunService({ ownership, context, runtime, reads: runtime });
const app = await buildApp({ projectsService: projects, runtimeOwnership: ownership, runtimeContext: context, runsService: service, streamService: new StreamService(service, new RuntimeJoinClient(runtimeUrl), 10) });
const checks: string[] = [];
async function http(method: 'GET' | 'POST', endpoint: string, body?: unknown, status?: number) {
  const response = await app.inject({ method, url: endpoint, ...(body === undefined ? {} : { payload: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) });
  if (status !== undefined) assert.equal(response.statusCode, status, response.body);
  return { status: response.statusCode, body: response.json() };
}
try {
  const suffix = randomUUID();
  const project = await projects.createProject('local', { name: `w07-fault-${suffix}`, targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true });
  const base = `/api/engagements/${project.id}`;
  const create = { requestId: `thread-${suffix}`, kind: 'planning' };
  const threadAcks = await Promise.all(Array.from({ length: 8 }, () => http('POST', `${base}/threads`, create)));
  assert.ok(threadAcks.every(ack => [201, 202].includes(ack.status)), JSON.stringify(threadAcks));
  assert.equal(control.threadCreates, 1);
  const ack = (await http('GET', `${base}/requests/${create.requestId}`, undefined, 200)).body;
  assert.ok(isRequestRecoveryView(ack)); assert.equal(ack.state, 'accepted');
  const thread = ack.threadId as string;
  assert.ok(isScopedThreadView((await http('GET', `${base}/threads/${thread}`, undefined, 200)).body));
  checks.push('8 simultaneous thread intents produce one acknowledged owned thread');

  const runInput = { requestId: `run-${suffix}`, message: 'Controlled transport test' };
  const runAcks = await Promise.all(Array.from({ length: 8 }, () => http('POST', `${base}/threads/${thread}/runs`, runInput)));
  assert.ok(runAcks.every(result => result.status === 202), JSON.stringify(runAcks));
  assert.equal(control.runCreates, 1);
  const accepted = (await http('GET', `${base}/requests/${runInput.requestId}`, undefined, 200)).body;
  assert.equal(accepted.state, 'accepted'); assert.ok(accepted.runId);
  await http('POST', `${base}/threads/${thread}/runs`, { ...runInput, message: 'changed' }, 409);
  await http('POST', `${base}/threads/${thread}/runs`, { requestId: `new-${suffix}`, message: 'new intent' }, 409);
  const view = (await http('GET', `${base}/threads/${thread}/runs/${accepted.runId}`, undefined, 200)).body;
  assert.ok(isScopedRunView(view)); assert.equal(view.rawStatus, 'pending');
  const snapshot = (await http('GET', `${base}/threads/${thread}`, undefined, 200)).body;
  assert.ok(isScopedThreadView(snapshot));
  for (const secret of ['SECRET-SYSTEM', 'SECRET-TOOL', 'SECRET-KEY', 'SECRET-KWARGS', 'dispatchConfigHash', 'reservationToken']) assert.ok(!JSON.stringify({ snapshot, view }).includes(secret));
  const reads = control.runReads;
  await http('GET', `${base}/threads/${thread}/runs/${randomUUID()}`, undefined, 404);
  assert.equal(control.runReads, reads);
  const foreign = await db.engagement.create({ data: { name: `w07-foreign-${suffix}`, userId: 'foreign', targetType: 'web_url', targetValue: project.targetValue, authorizationConfirmed: true } });
  await http('POST', `/api/engagements/${foreign.id}/threads`, { requestId: `foreign-${suffix}`, kind: 'planning' }, 404);
  await http('POST', `${base}/threads/${thread}/runs`, { requestId: `unsafe-${suffix}`, message: 'hello', command: { goto: 'unsafe' } }, 400);
  checks.push('8 simultaneous run intents dispatch once; stable replay, active-run conflict, strict input, redaction and pre-network ownership');

  runs.get(accepted.runId)!.status = 'success'; threads.get(thread)!.status = 'idle';
  await http('GET', `${base}/threads/${thread}/runs/${accepted.runId}`, undefined, 200);
  firstReady = new Promise(resolve => { releaseFirst = resolve; }); secondReady = new Promise(resolve => { releaseSecond = resolve; });
  barrierMode = true;
  const racedIntent = { requestId: `barrier-${suffix}`, message: 'ACK wins while duplicate is resolving context' };
  const raced = await Promise.all([http('POST', `${base}/threads/${thread}/runs`, racedIntent), http('POST', `${base}/threads/${thread}/runs`, racedIntent)]);
  barrierMode = false;
  assert.ok(raced.every(row => row.status === 202), JSON.stringify(raced));
  const racedAck = (await ownership.recover('local', project.id, racedIntent.requestId));
  runs.get(racedAck.runId!)!.status = 'success'; threads.get(thread)!.status = 'idle';
  await http('GET', `${base}/threads/${thread}/runs/${racedAck.runId}`, undefined, 200);
  checks.push('deterministic late duplicate preflight returns the winning intent instead of a spurious active-run conflict');
  control.loseRunAck = true;
  const uncertainId = `uncertain-run-${suffix}`;
  await http('POST', `${base}/threads/${thread}/runs`, { requestId: uncertainId, message: 'Lost ACK test' }, 503);
  assert.equal((await ownership.recover('local', project.id, uncertainId)).state, 'uncertain');
  const dispatched = control.runCreates;
  await http('POST', `${base}/threads/${thread}/runs`, { requestId: uncertainId, message: 'Lost ACK test' }, 202);
  assert.equal(control.runCreates, dispatched);
  const recovered = (await http('POST', `${base}/requests/${uncertainId}/reconcile`, undefined, 200)).body;
  assert.equal(recovered.state, 'accepted'); assert.ok(recovered.runId); assert.equal(control.runCreates, dispatched);
  runs.get(recovered.runId)!.status = 'interrupted'; threads.get(thread)!.status = 'interrupted';
  await http('GET', `${base}/threads/${thread}/runs/${recovered.runId}`, undefined, 200);
  await http('POST', `${base}/threads/${thread}/runs`, { requestId: `no-blind-resume-${suffix}`, message: 'new input' }, 409);
  checks.push('lost run ACK remains uncertain; metadata reconciliation restores ID without resubmit; interrupted run retains slot');

  control.loseThreadAck = true;
  const uncertainThreadId = `uncertain-thread-${suffix}`;
  await http('POST', `${base}/threads`, { requestId: uncertainThreadId, kind: 'planning' }, 503);
  const persisted = await ownership.inspect('local', project.id, uncertainThreadId);
  assert.equal(persisted.state, 'uncertain'); assert.ok(persisted.candidateThreadId);
  const threadCreates = control.threadCreates;
  const threadRecovered = (await http('POST', `${base}/requests/${uncertainThreadId}/reconcile`, undefined, 200)).body;
  assert.equal(threadRecovered.threadId, persisted.candidateThreadId); assert.equal(control.threadCreates, threadCreates);
  checks.push('durable candidate thread identity repairs lost thread ACK without duplicate creation');

  runs.get(recovered.runId)!.status = 'error'; threads.get(thread)!.status = 'error';
  await http('GET', `${base}/threads/${thread}/runs/${recovered.runId}`, undefined, 200);
  control.rejectRun = true;
  const rejectedId = `rejected-${suffix}`;
  await http('POST', `${base}/threads/${thread}/runs`, { requestId: rejectedId, message: 'Reject test' }, 409);
  assert.equal((await ownership.recover('local', project.id, rejectedId)).state, 'rejected');
  assert.equal(await ownership.active('local', project.id, thread), null);
  await http('POST', `${base}/threads/${thread}/runs`, { requestId: rejectedId, message: 'Reject test' }, 202);
  const executionAck = (await http('POST', `${base}/threads`, { requestId: `execution-${suffix}`, kind: 'execution' }, 201)).body;
  await http('POST', `${base}/threads/${executionAck.threadId}/runs`, { requestId: `blocked-exec-${suffix}`, message: 'No documents yet' }, 409);
  const page = (await http('GET', `${base}/threads/${thread}/runs?limit=1`, undefined, 200)).body;
  assert.equal(page.runs.length, 1); assert.equal(page.nextOffset, 1);
  await http('GET', `${base}/threads/${thread}/runs?limit=26`, undefined, 400);
  await http('POST', `${base}/requests/${uncertainId}/reconcile`, { config: 'forged' }, 400);
  checks.push('known rejection clears slot but does not replay, execution readiness blocks, pagination and reconciliation body are scoped');

  const name = 'W07 controlled handoff';
  const docs = { roe: { engagement_name: name, client: 'Local fixture', start_date: '2026-10-02', end_date: '2026-10-02', engagement_type: 'external', testing_window: 'Context-only testing', authorization_reference: 'W07 fixture', in_scope: [{ target: project.targetValue, type: 'web-url' }] }, conops: { engagement_name: name, executive_summary: 'Transport fixture' }, deconfliction: { engagement_name: name }, 'threat-profile': { engagement_name: name, actor_name: 'Test', tier: 'tier-1', sophistication: 'low', motivation: 'testing' }, contact: { engagement_name: name, primary_operator: { name: 'Operator', role: 'Owner', channel: 'local' } }, 'data-handling': { engagement_name: name }, abort: { engagement_name: name }, cleanup: { engagement_name: name } };
  for (const [key, doc] of Object.entries(docs)) await writeFile(path.join(workspace, project.workspaceSlug, 'plan', `${key}.json`), JSON.stringify(doc));
  const planningActive = (await http('POST', `${base}/threads/${thread}/runs`, { requestId: `planning-active-${suffix}`, message: 'Hold the planning handoff' }, 202)).body;
  const beforeHandoff = control.runCreates;
  await http('POST', `${base}/threads/${executionAck.threadId}/runs`, { requestId: `handoff-blocked-${suffix}`, message: 'Execution must wait' }, 409);
  assert.equal(control.runCreates, beforeHandoff);
  runs.get(planningActive.runId)!.status = 'success'; threads.get(thread)!.status = 'idle';
  await http('GET', `${base}/threads/${thread}/runs/${planningActive.runId}`, undefined, 200);
  const executionRun = (await http('POST', `${base}/threads/${executionAck.threadId}/runs`, { requestId: `execution-ready-${suffix}`, message: 'Document gate is ready without OPPLAN' }, 202)).body;
  checks.push('planning/execution handoff is transaction guarded; complete runtime bundle permits initial root run without OPPLAN');

  control.catalogDown = true;
  await http('POST', `${base}/threads`, create, 201);
  const beforeOutage = control.threadCreates;
  await http('POST', `${base}/threads`, { requestId: `outage-${suffix}`, kind: 'planning' }, 503);
  assert.equal(control.threadCreates, beforeOutage);
  checks.push('historical intent replay survives discovery outage; new mutation remains unavailable');
  control.catalogDown = false;
  runs.get(executionRun.runId)!.status = 'success'; threads.get(executionAck.threadId)!.status = 'idle';
  await http('GET', `${base}/threads/${executionAck.threadId}/runs/${executionRun.runId}`, undefined, 200);
  control.authDefaultBug = true;
  const bootstrap = (await http('POST', `${base}/threads`, { requestId: `bootstrap-${suffix}`, kind: 'planning' }, 201)).body;
  await http('POST', `${base}/threads/${bootstrap.threadId}/runs`, { requestId: `bootstrap-run-${suffix}`, message: 'Persisted authorization must not be masked by the default false channel' }, 202);
  await http('GET', `${base}/threads/${bootstrap.threadId}`, undefined, 200);
  assert.equal(threads.get(bootstrap.threadId)!.values.authorization_confirmed, true);
  checks.push('fresh-only trusted context bootstrap prevents default-false authorization masking without changing user message input');
  if (process.env.W08_STREAM_GATE === '1') {
    const current = await ownership.recover('local', project.id, `bootstrap-run-${suffix}`);
    const streamPath = `${base}/threads/${bootstrap.threadId}/runs/${current.runId}/events`;
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const before = control.runCreates;
    const controller = new AbortController();
    const response = await fetch(`${address}${streamPath}`, { signal: controller.signal });
    assert.equal(response.status, 200);
    try { for await (const frame of decodeSse(response.body!)) if (frame.event === 'run-event') { controller.abort(); break; } } catch (error) { if (!controller.signal.aborted) throw error; }
    const joined = await fetch(`${address}${streamPath}`, { headers: { 'Last-Event-ID': '100-1' } });
    const frames = new SseDecoder().push(await joined.text());
    assert.ok(frames.some(frame => frame.event === 'run-event' && JSON.parse(frame.data).payload.elapsedSeconds === 85.125));
    assert.ok(!JSON.stringify(frames).includes('PRIVATE'));
    const joinedBeforeDenial = streamTrace.joins;
    await http('GET', `${base}/threads/${bootstrap.threadId}/runs/${randomUUID()}/events`, undefined, 404);
    await http('GET', `${streamPath}?cursor=http://unrelated.invalid`, undefined, 400);
    assert.equal(streamTrace.joins, joinedBeforeDenial);
    assert.equal(control.runCreates, before); assert.ok(streamTrace.cancel.every(value => value === '0'));
    assert.ok(await ownership.active('local', project.id, bootstrap.threadId));
    assert.equal(runs.get(current.runId!)!.status, 'pending');
    checks.push('actual PostgreSQL SSE owner/cursor denial, peer abort/reconnect, seconds/flags/redaction and no extra execution/cancel/slot release');
  }
  await writeFile(process.env.W07_EVIDENCE_PATH!, JSON.stringify({ ok: true, checks, provider: 'controlled HTTP fault runtime, real PostgreSQL and new Fastify service', threadCreates: control.threadCreates, runCreates: control.runCreates }, null, 2) + '\n');
  console.log(`W07 PostgreSQL/HTTP concurrency and failure gates passed (${checks.length} groups)`);
} finally { await app.close(); await provider.close(); await db.$disconnect(); }
