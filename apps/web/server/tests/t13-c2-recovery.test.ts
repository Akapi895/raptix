import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/multi-user.js';
import { C2GrantsService } from '../src/services/c2-grants-service.js';
import { C2Service } from '../src/services/c2-service.js';
import { CampaignService } from '../src/services/campaign-service.js';
import { ProjectApiError } from '../src/services/projects-service.js';

/**
 * W13: C2 intent stability and recovery. History and reconcile are read
 * paths over the durable ledger — they work without a mounted provider and
 * an authorization revocation cannot hide an outcome that already happened.
 * Reconcile never dispatches new work; the three grant rechecks stay on the
 * dispatch path only.
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
    engagementClosure: { findFirst: async () => null },
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
      findMany: async ({ where }: { where: { engagementId: string } }) => [...table('c2Grant').values()].filter((r) => r.engagementId === where.engagementId).map((r) => ({ ...r })),
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

function seedCommand(db: Db, overrides: Row): Row {
  const id = String(overrides.id ?? `cmd-${tbl(db, 'c2Command').size + 1}`);
  const row: Row = { id, engagementId: ENG, sessionId: SESSION, requestId: `req-${id.slice(-8)}`, path: '/bin/whoami', args: [], status: 'creating', exitCode: null, pid: null, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false, payloadHash: 'h', activeSessionId: SESSION, createdAt: new Date(), ...overrides };
  tbl(db, 'c2Command').set(String(row.id), row);
  return row;
}

const terminalOutcome = { state: 'succeeded', outcome: { status: 0, pid: 4242, stdout: { text: 'done', truncated: false }, stderr: { text: '', truncated: false } } };

function providerFor(ops: { get: number; execute: number }): never {
  return {
    call: async ({ op }: { op: string }) => {
      if (op === 'sessions.get') return { session: { id: SESSION, name: SESSION, hostname: 'host-1', username: 'svc', os: 'windows', arch: 'x64', transport: 'mtls', remoteAddress: '10.0.0.8:49152', activeC2: 'mtls', version: '1.5.42', pid: 4100, listenerPort: 8888, lastCheckin: Math.floor(Date.now() / 1000), isDead: false } } as Record<string, unknown>;
      if (op === 'commands.get') { ops.get += 1; return terminalOutcome as Record<string, unknown>; }
      if (op === 'sessions.execute') { ops.execute += 1; return terminalOutcome as Record<string, unknown>; }
      throw new Error(`unexpected op ${op}`);
    },
  } as never;
}

async function setup(db: Db, provider: never, liveScopeGate?: (engagementId: string) => Promise<void>): Promise<{ app: FastifyInstance; owner: { cookie: string; csrf: string } }> {
  const owner = await db.webUser.create({ data: { username: 'owner', displayName: 'Owner', passwordHash: hashPassword('correct horse battery'), status: 'active' } });
  db.tables.set('engagement', new Map([[ENG, { id: ENG, userId: owner.id, name: ENG, targetValue: 'https://t.invalid', authorizationConfirmed: true }]]));
  const grants = new C2GrantsService(db as never, undefined, liveScopeGate);
  const app = await (buildApp({
    logger: { level: 'error' },
    authMode: 'multi',
    authDb: db as never,
    c2Service: new C2Service(db as never, provider, grants.assertCommandAuthorized.bind(grants)),
    campaignsService: new CampaignService(db as never, undefined, undefined),
    c2Grants: grants,
  }) as unknown as Promise<FastifyInstance>);
  const login = async (): Promise<{ cookie: string; csrf: string }> => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'owner', password: 'correct horse battery' } });
    expect(res.statusCode).toBe(200);
    return { cookie: `raptix_web_session=${res.cookies.find((c) => c.name === 'raptix_web_session')!.value}`, csrf: res.json().csrfToken };
  };
  return { app, owner: await login() };
}

describe('W13 C2 recovery and audit read policy', () => {
  it('history reads the durable ledger without a mounted provider', async () => {
    const db = memoryDb();
    seedCommand(db, { id: 'cmd-1', createdAt: new Date(Date.now() - 60_000) });
    seedCommand(db, { id: 'cmd-2', createdAt: new Date(Date.now()) });
    const { app, owner } = await setup(db, providerFor({ get: 0, execute: 0 }));
    const res = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/c2/commands`, headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(['cmd-2', 'cmd-1']);
  });

  it('reconcile never dispatches: terminal outcomes survive revocation and non-terminal polls only read', async () => {
    const db = memoryDb();
    const ops = { get: 0, execute: 0 };
    const refusal = new ProjectApiError(403, 'Outside the approved ROE time windows.');
    const { app, owner } = await setup(db, providerFor(ops), async () => { throw refusal; });
    seedCommand(db, { id: 'cmd-done', status: 'succeeded', exitCode: 0, pid: 4242, stdout: 'done', activeSessionId: null });
    seedCommand(db, { id: 'cmd-flight', status: 'uncertain', activeSessionId: SESSION });
    // Terminal: the outcome already happened — the gate refusal must not hide it.
    const done = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/c2/commands/cmd-done/reconcile`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf } });
    expect(done.statusCode).toBe(200);
    expect(done.json().status).toBe('succeeded');
    expect(done.json().stdout).toBe('done');
    // Non-terminal: reconcile polls the provider for the outcome; no new work.
    const flight = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/c2/commands/cmd-flight/reconcile`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf } });
    expect(flight.statusCode).toBe(200);
    expect(flight.json().status).toBe('succeeded');
    expect(tbl(db, 'c2Command').get('cmd-flight')!.status).toBe('succeeded');
    expect(ops.get).toBe(1);
    expect(ops.execute).toBe(0);
  });

  it('dispatch keeps all three grant rechecks after revocation; the executed event stays in the ledger', async () => {
    const db = memoryDb();
    const ops = { get: 0, execute: 0 };
    const { app, owner } = await setup(db, providerFor(ops));
    const requested = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/c2/grants`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { sessionId: SESSION, reason: 'recon', expiresAt: new Date(Date.now() + 60_000).toISOString() } });
    const grantId = String(requested.json().id);
    tbl(db, 'c2Grant').set(grantId, { ...tbl(db, 'c2Grant').get(grantId)!, status: 'approved' });
    const ok = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/c2/sessions/${SESSION}/commands`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { requestId: 'req-w13-a1', path: '/bin/whoami', args: [] } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('succeeded');
    expect(ops.execute).toBe(1);
    tbl(db, 'c2Grant').set(grantId, { ...tbl(db, 'c2Grant').get(grantId)!, status: 'revoked' });
    const denied = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/c2/sessions/${SESSION}/commands`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { requestId: 'req-w13-a2', path: '/bin/whoami', args: [] } });
    expect(denied.statusCode).toBe(403);
    expect(ops.execute).toBe(1);
    const history = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/c2/commands`, headers: { cookie: owner.cookie } });
    expect((history.json() as { id: string }[]).length).toBe(1);
  });
});
