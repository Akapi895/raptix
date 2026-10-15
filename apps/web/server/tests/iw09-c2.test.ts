import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { C2Service } from '../src/services/c2-service.js';
import { SliverClient } from '../src/integrations/c2/sliver-client.js';
import { loadServerEnv } from '../src/config/env.js';
import { ProjectApiError } from '../src/services/projects-service.js';
const closes: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closes.splice(0)) await close(); });
const SESSION = { id: 'session-1', name: 'Native', hostname: 'target', username: 'operator', os: 'linux', arch: 'amd64', transport: 'http', remoteAddress: '172.18.0.3', activeC2: 'http://sliver:18081', version: '1.7.7', pid: 123, listenerPort: 18081, lastCheckin: Math.floor(Date.now()/1000), isDead: false };
const input = { requestId: 'request-123', path: '/usr/bin/printf', args: ['native-output'] };
function database(authorized = true) {
  const rows: Array<Record<string, unknown>> = [];
  return { rows, engagement: { findFirst: async ({ where }: { where: { id: string; userId?: string } }) =>
    ['eng-1','eng-2'].includes(where.id) ? { id: where.id, userId: 'local', authorizationConfirmed: authorized } : null },
    webMembership: { findFirst: async () => null },
    c2Command: {
      findUnique: async ({ where }: { where: { engagementId_requestId: { engagementId: string; requestId: string } } }) => rows.find(r => r.engagementId === where.engagementId_requestId.engagementId && r.requestId === where.engagementId_requestId.requestId) ?? null,
      findFirst: async ({ where }: { where: { id: string; engagementId: string } }) => rows.find(r => r.id === where.id && r.engagementId === where.engagementId) ?? null,
      findMany: async ({ where }: { where: { engagementId: string } }) => rows.filter(r => r.engagementId === where.engagementId),
      create: async ({ data }: { data: Record<string, unknown> }) => { if (rows.some(r => r.activeSessionId === data.activeSessionId)) throw Object.assign(new Error('conflict'), { code: 'P2002' });
        const row = { id: `command-${rows.length}`, createdAt: new Date(), status: 'creating', exitCode: null, pid: null, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false, ...data }; rows.push(row); return row; },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(rows.find(r => r.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: { id: string; status: { in: string[] } }; data: Record<string, unknown> }) => {
        const row = rows.find(r => r.id === where.id && where.status.in.includes(String(r.status)));
        if (!row) return { count: 0 }; Object.assign(row,data); return { count: 1 };
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => rows.find(r => r.id === where.id),
    } };
}
async function setup(mode: 'valid' | 'dead' | 'fail' | 'oversized' = 'valid', authorized = true, gate = async (_eng: string, _session: string, _actor: string, _path?: string): Promise<void> => {}) {
  const app = Fastify({ logger: false, forceCloseConnections: true }); let executions = 0;
  app.post('/v1/c2', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    if (body.engagementId === 'eng-2' && body.op === 'sessions.get') return reply.code(404).send({ error: 'not owned' });
    if (body.op === 'sessions.get') return { session: { ...SESSION, isDead: mode === 'dead' } };
    if (body.op === 'sessions.list') return { sessions: body.engagementId === 'eng-1' ? [SESSION] : [] };
    if (body.op === 'listeners.list') return { listeners: [] };
    if (body.op === 'profiles.list') return { profiles: [] };
    if (body.op === 'sessions.execute') { executions++; if (mode === 'fail') return reply.code(503).send({ secret: 'never public' });
      if (mode === 'oversized') return reply.send('x'.repeat(600000)); }
    return { state: 'succeeded', outcome: { status: 0, pid: 333, stdout: { text: 'native-output', truncated: false }, stderr: { text: '', truncated: false } } };
  });
  const apiUrl = await app.listen({ host: '127.0.0.1', port: 0 }); closes.push(() => app.close());
   const db = database(authorized); const service = new C2Service(db as never, new SliverClient({ apiUrl, apiKey: 'a'.repeat(64) }), gate);
  return { service, db, executions: () => executions };
}
describe('IW-09 C2 ownership and durable command audit', () => {
  it('refuses a grant revoked during reservation before invoking the provider', async () => {
    let checks = 0;
    const { service, db, executions } = await setup('valid', true, async () => {
      if (++checks > 1) throw new ProjectApiError(403, 'Grant revoked');
    });
    await expect(service.dispatchCommand('local', 'eng-1', 'session-1', input)).rejects.toMatchObject({ statusCode: 403 });
    expect(executions()).toBe(0);
    // W13: the pre-invoke refusal releases the reservation slot and finalizes
    // the command, so the session is not stuck holding an unresolved command.
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ status: 'failed', activeSessionId: null });
  });
  it('retains the actual outcome when authorization expires in flight', async () => {
    let checks = 0;
    const { service, executions } = await setup('valid', true, async () => {
      if (++checks > 2) throw new ProjectApiError(403, 'Grant expired');
    });
    await expect(service.dispatchCommand('local', 'eng-1', 'session-1', input)).rejects.toMatchObject({ statusCode: 403 });
    expect(executions()).toBe(1);
    expect(await service.history('local', 'eng-1')).toMatchObject([{ status: 'succeeded', stdout: 'native-output' }]);
  });
  it('reconciles an already invoked command without pretending revocation cancelled it', async () => {
    let revoked = false;
    const { service } = await setup('fail', true, async () => {
      if (revoked) throw new ProjectApiError(403, 'Grant revoked');
    });
    const pending = await service.dispatchCommand('local', 'eng-1', 'session-1', input);
    revoked = true;
    // W13: reconcile is a read path — the revocation neither cancels nor hides
    // the already-recorded outcome; new dispatches stay refused.
    await expect(service.dispatchCommand('local', 'eng-1', 'session-1', { ...input, requestId: 'request-999' })).rejects.toMatchObject({ statusCode: 403 });
    expect((await service.reconcile('local', 'eng-1', pending.id)).status).toBe('succeeded');
    expect(await service.history('local', 'eng-1')).toMatchObject([{ status: 'succeeded' }]);
  });
  it('passes the executable path to the grant gate for prefix enforcement', async () => {
    const { service, executions } = await setup('valid', true, async (_eng, _session, _actor, path) => {
      if (path !== '/usr/bin/printf') throw new ProjectApiError(403, 'Prefix mismatch');
    });
    expect((await service.dispatchCommand('local', 'eng-1', 'session-1', input)).status).toBe('succeeded');
    expect(executions()).toBe(1);
  });
  it('lists only sessions in the authorized engagement namespace', async () => {
    const {service} = await setup(); expect((await service.sessions('local','eng-1')).sessions).toHaveLength(1); expect((await service.sessions('local','eng-2')).sessions).toEqual([]);
  });
  it('rejects foreign engagement ownership before command dispatch', async () => {
    const {service,executions} = await setup(); await expect(service.dispatchCommand('local','eng-2','session-1',input)).rejects.toMatchObject({ statusCode: 404 }); expect(executions()).toBe(0);
  });
  it('rejects unconfirmed authorization', async () => { const {service} = await setup('valid',false); await expect(service.sessions('local','eng-1')).rejects.toMatchObject({ statusCode: 403 }); });
  it('preserves explicit argv and retries the same request without redispatch', async () => {
    const {service,executions} = await setup(); const first=await service.dispatchCommand('local','eng-1','session-1',input);
    const retry=await service.dispatchCommand('local','eng-1','session-1',input); expect(retry.id).toBe(first.id); expect(first).toMatchObject({stdout:'native-output',exitCode:0,status:'succeeded',args:['native-output']}); expect(executions()).toBe(1);
  });
  it('rejects changed input for an existing request identity', async () => { const {service}=await setup(); await service.dispatchCommand('local','eng-1','session-1',input); await expect(service.dispatchCommand('local','eng-1','session-1',{...input,args:['different']})).rejects.toMatchObject({statusCode:409}); });
  it('rejects disconnected sessions before reservation', async () => { const {service,db}=await setup('dead'); await expect(service.dispatchCommand('local','eng-1','session-1',input)).rejects.toMatchObject({statusCode:409}); expect(db.rows).toHaveLength(0); });
  it.each(['fail','oversized'] as const)('holds %s command outcomes for explicit reconciliation', async mode => {
    const {service}=await setup(mode); const result=await service.dispatchCommand('local','eng-1','session-1',input); expect(result.status).toBe('uncertain'); expect(result.stdout).toBe('');
    expect((await service.reconcile('local','eng-1',result.id)).status).toBe('succeeded');
  });
  it('prevents foreign command history reconciliation', async () => { const {service}=await setup(); const result=await service.dispatchCommand('local','eng-1','session-1',input); await expect(service.reconcile('local','eng-2',result.id)).rejects.toMatchObject({statusCode:404}); });
  it('rejects implicit shell strings and unexpected request fields', async () => { const {service}=await setup(); await expect(service.dispatchCommand('local','eng-1','session-1',{command:'whoami'})).rejects.toMatchObject({statusCode:400}); await expect(service.dispatchCommand('local','eng-1','session-1',{...input,endpoint:'other'})).rejects.toMatchObject({statusCode:400}); });
  it('validates paired bridge configuration without exposing its secret', () => { expect(() => loadServerEnv({SLIVER_BRIDGE_TOKEN:'private-token'.repeat(4)})).toThrow(/SLIVER_BRIDGE_URL/); expect(() => loadServerEnv({SLIVER_BRIDGE_URL:'https://operator:password@bridge.test',SLIVER_BRIDGE_TOKEN:'a'.repeat(64)})).toThrow(/SLIVER_BRIDGE_URL/); });
});
