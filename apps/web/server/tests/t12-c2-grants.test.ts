import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/multi-user.js';
import { C2GrantsService } from '../src/services/c2-grants-service.js';
import { C2Service } from '../src/services/c2-service.js';
import { CampaignService } from '../src/services/campaign-service.js';

/**
 * Ticket 12 acceptance: request/review grant workflow persists actor, session,
 * reason and absolute deadline with independent review; every command
 * authorizes against a live approved grant; input locks at expiry (no grace);
 * server-owned sweep runs without a mounted console; request-id replay cannot
 * dispatch duplicates.
 */

interface Row { [key: string]: unknown }

function memoryDb() {
  const tables = new Map<string, Map<string, Row>>();
  const table = (name: string): Map<string, Row> => {
    let t = tables.get(name);
    if (t === undefined) { t = new Map(); tables.set(name, t); }
    return t;
  };
  const counters = new Map<string, number>();
  const seq = (name: string): string => {
    const n = (counters.get(name) ?? 0) + 1;
    counters.set(name, n);
    return `${name}-${n}`;
  };
  const find = async (name: string, pred: (row: Row) => boolean): Promise<Row | null> => {
    for (const row of table(name).values()) if (pred(row)) return { ...row };
    return null;
  };
  const eq = (row: Row, where: Row, key: string): boolean => where[key] === undefined || row[key] === where[key];
  const grantMatch = (row: Row, where: Row): boolean =>
    ['id', 'engagementId', 'sessionId', 'actorId', 'status'].every((k) => eq(row, where, k)) &&
    (where.expiresAt === undefined || (typeof where.expiresAt === 'object' && where.expiresAt !== null && 'lte' in (where.expiresAt as Record<string, unknown>) && (row.expiresAt as Date).getTime() <= (where.expiresAt as { lte: Date }).lte.getTime()));
  const commandMatch = (row: Row, where: Row): boolean =>
    ['id', 'engagementId', 'sessionId', 'requestId'].every((k) => eq(row, where, k)) &&
    (where.status === undefined || !(typeof where.status === 'object' && where.status !== null && 'in' in (where.status as Record<string, unknown>) && !(where.status as { in: string[] }).in.includes(String(row.status))));
  const db = {
    tables,
    engagement: {
      findFirst: async ({ where }: { where: { id: string; userId?: string } }) =>
        find('engagement', (r) => r.id === where.id && (where.userId === undefined || r.userId === where.userId)),
    },
    webUser: {
      findUnique: async ({ where }: { where: { id?: string; username?: string } }) =>
        find('webUser', (r) => (where.id !== undefined && r.id === where.id) || (where.username !== undefined && r.username === where.username)),
      create: async ({ data }: { data: { [key: string]: unknown } }) => { const row: Row = { status: 'active', ...data, id: String(data.id ?? seq('u')) }; table('webUser').set(String(row.id), row); return { ...row }; },
    },
    webSession: {
      findUnique: async ({ where }: { where: { id: string } }) => find('webSession', (r) => r.id === where.id),
      create: async ({ data }: { data: Row }) => { table('webSession').set(String(data.id), { ...data }); return { ...data }; },
      deleteMany: async () => ({ count: 1 }),
    },
    webMembership: {
      findFirst: async ({ where }: { where: { engagementId: string; userId: string } }) => find('webMembership', (r) => r.engagementId === where.engagementId && r.userId === where.userId),
      findMany: async () => [...table('webMembership').values()].map((r) => ({ ...r })),
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('m') }; table('webMembership').set(String(row.id), row); return { ...row }; },
      delete: async ({ where }: { where: { id: string } }) => { table('webMembership').delete(where.id); return {}; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => { const row: Row = { ...table('webMembership').get(where.id)!, ...data }; table('webMembership').set(where.id, row); return { ...row }; },
    },
    webAuditEntry: {
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('a') }; table('webAuditEntry').set(String(row.id), row); return { ...row }; },
    },
    c2Grant: {
      findFirst: async ({ where }: { where: Row }) => find('c2Grant', (r) => grantMatch(r, where)),
      findMany: async ({ where, orderBy }: { where: { engagementId: string }; orderBy?: { createdAt: string } }) => {
        const rows = [...table('c2Grant').values()].filter((r) => r.engagementId === where.engagementId).map((r) => ({ ...r }));
        if (orderBy?.createdAt === 'desc') rows.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
        return rows;
      },
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('g'), reviewerId: null, createdAt: new Date() }; table('c2Grant').set(String(row.id), row); return { ...row }; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => { const row: Row = { ...table('c2Grant').get(where.id)!, ...data }; table('c2Grant').set(where.id, row); return { ...row }; },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const [id, row] of table('c2Grant')) if (grantMatch(row, where)) { table('c2Grant').set(id, { ...row, ...data }); count += 1; }
        return { count };
      },
    },
    c2Command: {
      findUnique: async ({ where }: { where: { id?: string; engagementId_requestId?: { engagementId: string; requestId: string } } }) => {
        if (where.engagementId_requestId) {
          const { engagementId, requestId } = where.engagementId_requestId;
          return find('c2Command', (r) => r.engagementId === engagementId && r.requestId === requestId);
        }
        return find('c2Command', (r) => r.id === where.id);
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = await find('c2Command', (r) => r.id === where.id);
        if (row === null) throw new Error('record not found');
        return row;
      },
      findFirst: async ({ where }: { where: Row }) => find('c2Command', (r) => commandMatch(r, where)),
      findMany: async ({ where, orderBy }: { where: { engagementId: string }; orderBy?: { createdAt: string } }) => {
        const rows = [...table('c2Command').values()].filter((r) => r.engagementId === where.engagementId).map((r) => ({ ...r }));
        if (orderBy?.createdAt === 'desc') rows.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
        return rows;
      },
      create: async ({ data }: { data: Row }) => {
        const row: Row = { ...data, id: seq('c'), status: 'creating', exitCode: null, pid: null, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false, createdAt: new Date() };
        table('c2Command').set(String(row.id), row); return { ...row };
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const [id, row] of table('c2Command')) if (commandMatch(row, where)) { table('c2Command').set(id, { ...row, ...data }); count += 1; }
        return { count };
      },
    },
  };
  (db as unknown as { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return db;
}

type Db = ReturnType<typeof memoryDb>;

const ENG = 'eng-1';
const SESSION = 'sess-1';

/** Lazy tables only materialize on first write; seed paths need the handle. */
function tbl(db: Db, name: string): Map<string, Row> {
  let t = db.tables.get(name);
  if (t === undefined) { t = new Map(); db.tables.set(name, t); }
  return t;
}

function fakeProvider(executeCalls: { count: number }): never {
  const session = { id: SESSION, name: SESSION, hostname: 'host-1', username: 'svc', os: 'windows', arch: 'x64', transport: 'mtls', remoteAddress: '10.0.0.8:49152', activeC2: 'mtls', version: '1.5.42', pid: 4100, listenerPort: 8888, lastCheckin: Math.floor(Date.now() / 1000), isDead: false };
  return {
    call: async ({ op }: { op: string }) => {
      if (op === 'sessions.get') return { session } as Record<string, unknown>;
      if (op === 'sessions.execute') {
        executeCalls.count += 1;
        return { state: 'succeeded', outcome: { status: 0, pid: 4242, stdout: { text: 'done', truncated: false }, stderr: { text: '', truncated: false } } } as Record<string, unknown>;
      }
      throw new Error(`unexpected op ${op}`);
    },
  } as never;
}

async function setup(executeCalls: { count: number }): Promise<{ db: Db; app: FastifyInstance; owner: { cookie: string; csrf: string }; reviewer: { cookie: string; csrf: string }; operator: { cookie: string; csrf: string }; viewer: { cookie: string; csrf: string }; grants: C2GrantsService }> {
  const db = memoryDb();
  const owner = await db.webUser.create({ data: { username: 'owner', displayName: 'Owner', passwordHash: hashPassword('correct horse battery'), status: 'active' } });
  const reviewer = await db.webUser.create({ data: { username: 'rev', displayName: 'Rev', passwordHash: hashPassword('longenough1'), status: 'active' } });
  const operator = await db.webUser.create({ data: { username: 'op', displayName: 'Op', passwordHash: hashPassword('longenough2'), status: 'active' } });
  const viewer = await db.webUser.create({ data: { username: 'view', displayName: 'View', passwordHash: hashPassword('longenough3'), status: 'active' } });
  db.tables.set('engagement', new Map([[ENG, { id: ENG, userId: owner.id, name: ENG, targetValue: 'https://t.invalid', authorizationConfirmed: true }]]));
  await db.webMembership.create({ data: { engagementId: ENG, userId: reviewer.id, role: 'reviewer' } });
  await db.webMembership.create({ data: { engagementId: ENG, userId: operator.id, role: 'operator' } });
  await db.webMembership.create({ data: { engagementId: ENG, userId: viewer.id, role: 'viewer' } });
  const grants = new C2GrantsService(db as never);
  const app = await (buildApp({
    logger: { level: 'error' },
    authMode: 'multi',
    authDb: db as never,
    c2Service: new C2Service(db as never, fakeProvider(executeCalls), grants.assertCommandAuthorized.bind(grants)),
    campaignsService: new CampaignService(db as never, undefined, undefined),
    c2Grants: grants,
  }) as unknown as Promise<FastifyInstance>);
  const login = async (username: string, password: string): Promise<{ cookie: string; csrf: string }> => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    expect(res.statusCode).toBe(200);
    return { cookie: `raptix_web_session=${res.cookies.find((c) => c.name === 'raptix_web_session')!.value}`, csrf: res.json().csrfToken };
  };
  return { db, app, owner: await login('owner', 'correct horse battery'), reviewer: await login('rev', 'longenough1'), operator: await login('op', 'longenough2'), viewer: await login('view', 'longenough3'), grants };
}

const future = (ms: number): string => new Date(Date.now() + ms).toISOString();
const dispatch = (app: FastifyInstance, actor: { cookie: string; csrf: string }, sessionId: string) =>
  app.inject({ method: 'POST', url: `/api/engagements/${ENG}/c2/sessions/${sessionId}/commands`, headers: { cookie: actor.cookie, 'x-csrf-token': actor.csrf }, payload: { requestId: 'req-0001-aa', path: '/bin/whoami', args: [] } });

describe('ticket 12 c2 grants and authorized dispatch', () => {
  it('persists actor, session, reason and deadline; enforces roles and independent review', async () => {
    const { app, reviewer, operator, viewer } = await setup({ count: 0 });
    const denied = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/c2/grants`, headers: { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf }, payload: { sessionId: SESSION, reason: 'r', expiresAt: future(60_000) } });
    expect(denied.statusCode).toBe(403);
    const requested = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/c2/grants`, headers: { cookie: operator.cookie, 'x-csrf-token': operator.csrf }, payload: { sessionId: SESSION, reason: 'whoami on web-1', expiresAt: future(60_000) } });
    expect(requested.statusCode).toBe(200);
    const grant = requested.json();
    expect(grant.status).toBe('requested');
    expect(grant.actorId).toBeTruthy();
    expect(grant.sessionId).toBe(SESSION);
    expect(grant.reason).toBe('whoami on web-1');
    expect(Date.parse(grant.expiresAt)).toBeGreaterThan(Date.now());
    const duplicate = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/c2/grants`, headers: { cookie: operator.cookie, 'x-csrf-token': operator.csrf }, payload: { sessionId: SESSION, reason: 'another', expiresAt: future(60_000) } });
    expect(duplicate.statusCode).toBe(409);
    const self = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/c2/grants/${grant.id}/decision`, headers: { cookie: operator.cookie, 'x-csrf-token': operator.csrf }, payload: { decision: 'approved' } });
    expect(self.statusCode).toBe(403);
    const revokePending = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/c2/grants/${grant.id}/decision`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'revoked' } });
    expect(revokePending.statusCode).toBe(409);
    const approved = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/c2/grants/${grant.id}/decision`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'approved' } });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe('approved');
    expect(approved.json().reviewerId).toBeTruthy();
    const revoked = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/c2/grants/${grant.id}/decision`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'revoked' } });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().status).toBe('revoked');
  });

  it('gates dispatch on a live approved grant, locks input at expiry and replays request ids', async () => {
    const executeCalls = { count: 0 };
    const { db, app, owner, reviewer } = await setup(executeCalls);
    const blocked = await dispatch(app, owner, SESSION);
    expect(blocked.statusCode).toBe(403);
    expect(String(blocked.json().error.message ?? '')).toMatch(/grant/i);
    const requested = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/c2/grants`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { sessionId: SESSION, reason: 'recon', expiresAt: future(60_000) } });
    const grantId = requested.json().id as string;
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/c2/grants/${grantId}/decision`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'approved' } });
    const ok = await dispatch(app, owner, SESSION);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('succeeded');
    expect(executeCalls.count).toBe(1);
    const replay = await dispatch(app, owner, SESSION);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(ok.json().id);
    expect(executeCalls.count).toBe(1);
    // -1ms past the deadline: refused, no grace. The sweep marks it expired
    // before the gate reads, so the account has no live approved grant left.
    tbl(db, 'c2Grant').set(grantId, { ...tbl(db, 'c2Grant').get(grantId)!, status: 'approved', expiresAt: new Date(Date.now() - 1) });
    const late = await dispatch(app, owner, SESSION);
    expect(late.statusCode).toBe(403);
    expect(String(late.json().error.message ?? '')).toMatch(/grant/i);
    expect(tbl(db, 'c2Grant').get(grantId)!.status).toBe('expired');
  });

  it('sweeps expired grants on read without a mounted console and answers 404 for foreign engagements', async () => {
    const { db, app, reviewer } = await setup({ count: 0 });
    tbl(db, 'c2Grant').set('g-seed', { id: 'g-seed', engagementId: ENG, sessionId: SESSION, actorId: 'u-1', reviewerId: null, status: 'approved', reason: 'seed', commandPrefix: null, expiresAt: new Date(Date.now() - 5_000), createdAt: new Date() });
    const list = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/c2/grants`, headers: { cookie: reviewer.cookie } });
    expect(list.statusCode).toBe(200);
    const row = list.json().grants.find((g: { id: string }) => g.id === 'g-seed');
    expect(row.status).toBe('expired');
    expect(tbl(db, 'c2Grant').get('g-seed')!.status).toBe('expired');
    const foreign = await app.inject({ method: 'GET', url: '/api/engagements/eng-other/c2/grants', headers: { cookie: reviewer.cookie } });
    expect(foreign.statusCode).toBe(404);
    const foreignDecision = await app.inject({ method: 'POST', url: `/api/engagements/eng-other/c2/grants/g-seed/decision`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'approved' } });
    expect(foreignDecision.statusCode).toBe(404);
  });
});
