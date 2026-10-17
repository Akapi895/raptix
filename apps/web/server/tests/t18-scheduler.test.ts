import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/multi-user.js';
import { ScopeService } from '../src/services/scope-service.js';
import { ScheduleService, type ScheduleDeps } from '../src/services/schedule-service.js';

/**
 * W11 acceptance: a schedule is a durable execution intent tied to an existing
 * engagement/thread/approved plan — never a second business-operation
 * authority. Exactly one worker claims a due intent; the due-time recheck
 * refuses or stays truthful (uncertain) when the dispatch acknowledgement is
 * lost; missed windows, stale CAS reschedules and restart recovery follow the
 * contract in ADR-0073.
 */

interface Row { [key: string]: unknown }

const ENG = 'eng-1';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000);
const EXECUTE_AT = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const ROE = { windows: [], emergencyContacts: ['blue-team@example.invalid'], restrictions: [] };

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
  const listAll = async (name: string, pred: (row: Row) => boolean): Promise<Row[]> => [...table(name).values()].filter(pred).map((r) => ({ ...r }));
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
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('m') }; table('webMembership').set(String(row.id), row); return { ...row }; },
    },
    webAuditEntry: {
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('a') }; table('webAuditEntry').set(String(row.id), row); return { ...row }; },
    },
    scopeRevision: {
      findFirst: async ({ where, orderBy }: { where: { engagementId: string; status?: string }; orderBy?: { version: string } }) => {
        let rows = [...table('scopeRevision').values()].filter((r) => r.engagementId === where.engagementId && (where.status === undefined || r.status === where.status));
        if (orderBy?.version === 'desc') rows = rows.sort((a, b) => Number(b.version) - Number(a.version));
        return rows[0] !== undefined ? { ...rows[0] } : null;
      },
    },
    businessPlan: {
      findFirst: async ({ where }: { where: { id?: string; engagementId: string } }) =>
        find('businessPlan', (r) => r.engagementId === where.engagementId && (where.id === undefined || r.id === where.id)),
    },
    engagementThread: {
      findFirst: async ({ where }: { where: { threadId: string; engagementId: string } }) =>
        find('engagementThread', (r) => r.threadId === where.threadId && r.engagementId === where.engagementId),
    },
    operationSchedule: {
      findFirst: async ({ where }: { where: { id?: string; requestId?: string; engagementId?: string } }) =>
        find('operationSchedule', (r) => (where.engagementId === undefined || r.engagementId === where.engagementId)
          && (where.id === undefined || r.id === where.id) && (where.requestId === undefined || r.requestId === where.requestId)),
      findMany: async ({ where }: { where: { engagementId?: string; status?: string; executeAt?: { lte?: Date; lt?: Date } } }) =>
        listAll('operationSchedule', (r) => (where.engagementId === undefined || r.engagementId === where.engagementId)
          && (where.status === undefined || r.status === where.status)
          && (where.executeAt === undefined || ((where.executeAt.lte === undefined || (r.executeAt as Date).getTime() <= where.executeAt.lte.getTime())
            && (where.executeAt.lt === undefined || (r.executeAt as Date).getTime() < where.executeAt.lt.getTime())))),
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('sched'), version: 1, claimedBy: null, claimedAt: null, dispatchedAt: null, runId: null, outcomeDetail: null, createdAt: new Date(), updatedAt: new Date() }; table('operationSchedule').set(String(row.id), row); return { ...row }; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const prev = table('operationSchedule').get(where.id)!;
        const version = typeof data.version === 'object' && data.version !== null && 'increment' in (data.version as Record<string, unknown>)
          ? Number(prev.version) + Number((data.version as { increment: number }).increment)
          : Number(prev.version);
        const row: Row = { ...prev, ...data, version, updatedAt: new Date() };
        table('operationSchedule').set(where.id, row);
        return { ...row };
      },
      updateMany: async ({ where, data }: { where: { id?: string; status: string; version?: number; executeAt?: { lte?: Date; lt?: Date } }; data: Row }) => {
        let count = 0;
        for (const [id, row] of table('operationSchedule')) {
          if ((where.id === undefined || row.id === where.id) && row.status === where.status
            && (where.version === undefined || Number(row.version) === where.version)
            && (where.executeAt === undefined || ((where.executeAt.lte === undefined || (row.executeAt as Date).getTime() <= where.executeAt.lte.getTime())
              && (where.executeAt.lt === undefined || (row.executeAt as Date).getTime() < where.executeAt.lt.getTime())))) {
            const version = typeof data.version === 'object' && data.version !== null && 'increment' in (data.version as Record<string, unknown>)
              ? Number(row.version) + Number((data.version as { increment: number }).increment)
              : Number(row.version);
            table('operationSchedule').set(id, { ...row, ...data, version, updatedAt: new Date() });
            count += 1;
          }
        }
        return { count };
      },
    },
  };
  (db as unknown as { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return db;
}

type Db = ReturnType<typeof memoryDb>;

interface Harness { db: Db; app: FastifyInstance; owner: { cookie: string; csrf: string }; gates: { authorizeError?: unknown; dispatchError?: unknown; dispatchCalls: number } }

async function setup(gates: Harness['gates']): Promise<Harness> {
  const db = memoryDb();
  const owner = await db.webUser.create({ data: { username: 'owner', displayName: 'Owner', passwordHash: hashPassword('correct horse battery'), status: 'active' } });
  db.tables.set('engagement', new Map([[ENG, { id: ENG, userId: owner.id, name: ENG, targetValue: 'https://target.invalid', handoffConfirmedAt: new Date() }]]));
  db.tables.set('engagementThread', new Map<string, Row>([
    ['th-ex', { threadId: 'th-ex', engagementId: ENG, kind: 'execution' }],
    ['th-plan', { threadId: 'th-plan', engagementId: ENG, kind: 'planning' }],
  ]));
  db.tables.set('scopeRevision', new Map<string, Row>([['rev-1', { id: 'rev-1', engagementId: ENG, version: 1, status: 'approved', roe: ROE }]]));
  db.tables.set('businessPlan', new Map<string, Row>([['plan-1', { id: 'plan-1', engagementId: ENG, version: 1, status: 'approved', expiresAt: FUTURE, roeVersion: 1, body: { objective: 'Scheduled validation', methods: ['web'] }, requestedBy: owner.id }]]));
  const deps: ScheduleDeps = {
    authorize: async () => { if (gates.authorizeError !== undefined) throw gates.authorizeError; },
    dispatch: async (_actorId, _engagementId, _threadId, _requestId) => { gates.dispatchCalls += 1; if (gates.dispatchError !== undefined) throw gates.dispatchError; const runId = `run-${gates.dispatchCalls}`; return runId; },
  };
  const app = await (buildApp({
    authMode: 'multi',
    authDb: db as never,
    scopeService: new ScopeService(db as never),
    scheduleService: new ScheduleService(db as never, deps),
  }) as unknown as Promise<FastifyInstance>);
  const login = async (username: string, password: string): Promise<{ cookie: string; csrf: string }> => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    expect(res.statusCode).toBe(200);
    return { cookie: `raptix_web_session=${res.cookies.find((c) => c.name === 'raptix_web_session')!.value}`, csrf: res.json().csrfToken };
  };
  return { db, app, owner: await login('owner', 'correct horse battery'), gates };
}

const payload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  planId: 'plan-1', threadId: 'th-ex', executeAt: EXECUTE_AT, timezone: 'Asia/Ho_Chi_Minh', reason: 'window maintenance', requestId: 'req-1', ...overrides,
});
const post = (app: FastifyInstance, owner: Harness['owner'], overrides: Record<string, unknown> = {}): Promise<{ statusCode: number; json(): Record<string, unknown> }> =>
  app.inject({ method: 'POST', url: `/api/engagements/${ENG}/schedules`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: payload(overrides) });

describe('W11 operation schedules (durable execution intents)', () => {
  it('persists a durable intent bound to an owned execution thread and approved plan; requestId is idempotent', async () => {
    const { app, owner } = await setup({ dispatchCalls: 0 });
    const first = await post(app, owner);
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe('scheduled');
    expect(first.json().version).toBe(1);
    const again = await post(app, owner);
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(first.json().id);
    await app.close();
  });

  it('refuses foreign threads, planning threads, unapproved plans, naive timestamps, unknown zones and past executeAt', async () => {
    const { app, owner } = await setup({ dispatchCalls: 0 });
    expect((await post(app, owner, { threadId: 'th-foreign', requestId: 'r-f' })).statusCode).toBe(404);
    expect((await post(app, owner, { threadId: 'th-plan', requestId: 'r-p' })).statusCode).toBe(400);
    expect((await post(app, owner, { planId: 'plan-missing', requestId: 'r-m' })).statusCode).toBe(404);
    expect((await post(app, owner, { executeAt: '2026-10-15T10:00:00', requestId: 'r-n' })).statusCode).toBe(400);
    expect((await post(app, owner, { timezone: 'Mars/Olympus', requestId: 'r-z' })).statusCode).toBe(400);
    expect((await post(app, owner, { executeAt: new Date(Date.now() - 60_000).toISOString(), requestId: 'r-x' })).statusCode).toBe(400);
    await app.close();
  });

  it('exactly one worker wins the claim; the winner dispatches once through the runtime gate', async () => {
    const { db, app, owner, gates } = await setup({ dispatchCalls: 0 });
    const created = await post(app, owner);
    const id = String(created.json().id);
    // The worker claims only due intents; the fresh one is not due yet.
    const service = new ScheduleService(db as never, {
      authorize: async () => {},
      dispatch: async () => { gates.dispatchCalls += 1; const runId = `run-${gates.dispatchCalls}`; return runId; },
    });
    expect((await service.claimDue('w1', Date.now())).claimed).toHaveLength(0);
    db.tables.get('operationSchedule')!.set(id, { ...db.tables.get('operationSchedule')!.get(id)!, executeAt: new Date(Date.now() - 1000) });
    const first = await service.claimDue('w1', Date.now());
    expect(first.claimed).toHaveLength(1);
    expect(first.claimed[0]!.claimedBy).toBe('w1');
    const second = await service.claimDue('w2', Date.now());
    expect(second.claimed).toHaveLength(0);
    await service.runClaimed(first.claimed[0]!);
    const row = db.tables.get('operationSchedule')!.get(id)!;
    expect(row.status).toBe('dispatched');
    expect(row.runId).toBe('run-1');
    expect(gates.dispatchCalls).toBe(1);
    await app.close();
  });

  it('refuses the dispatch when the execution gate refuses at due time', async () => {
    const { db, app, owner } = await setup({ dispatchCalls: 0, authorizeError: Object.assign(new Error('Bound plan approval expired'), { statusCode: 409 }) });
    const created = await post(app, owner);
    const id = String(created.json().id);
    db.tables.get('operationSchedule')!.set(id, { ...db.tables.get('operationSchedule')!.get(id)!, executeAt: new Date(Date.now() - 1000) });
    const service = new ScheduleService(db as never, { authorize: async () => { throw Object.assign(new Error('Bound plan approval expired'), { statusCode: 409 }); }, dispatch: async () => 'run-x' });
    const claimed = await service.claimDue('w1', Date.now());
    expect(claimed.claimed).toHaveLength(1);
    await service.runClaimed(claimed.claimed[0]!);
    const row = db.tables.get('operationSchedule')!.get(id)!;
    expect(row.status).toBe('refused');
    expect(String(row.outcomeDetail)).toContain('expired');
    await app.close();
  });

  it('cannot claim a due selection that a concurrent reschedule moved into the future', async () => {
    const { db, app, owner } = await setup({ dispatchCalls: 0 });
    const created = await post(app, owner);
    const id = String(created.json().id);
    db.tables.get('operationSchedule')!.set(id, { ...db.tables.get('operationSchedule')!.get(id)!, executeAt: new Date(Date.now() - 1000) });
    // A reschedule commits between this worker's due read and its claim update.
    const proxied = new Proxy(db as object, {
      get(target, prop) {
        if (prop !== 'operationSchedule') return Reflect.get(target, prop);
        const model = (target as { operationSchedule: Record<string, unknown> }).operationSchedule;
        return new Proxy(model, {
          get(delegate, key) {
            if (key !== 'findMany') return Reflect.get(delegate, key);
            return async (args: unknown) => {
              const rows = await (delegate as { findMany: (a: unknown) => Promise<unknown[]> }).findMany(args);
              const row = db.tables.get('operationSchedule')!.get(id)!;
              db.tables.get('operationSchedule')!.set(id, { ...row, executeAt: new Date(Date.now() + 3_600_000), version: Number(row.version) + 1 });
              return rows;
            };
          },
        });
      },
    });
    const service = new ScheduleService(proxied as never, { authorize: async () => {}, dispatch: async () => 'run-z' });
    const result = await service.claimDue('w1', Date.now());
    const row = db.tables.get('operationSchedule')!.get(id)!;
    expect(result.claimed).toHaveLength(0);
    expect(row.status).toBe('scheduled');
    await app.close();
  });

  it('stays uncertain when the dispatch acknowledgement is lost', async () => {
    const { db, app, owner } = await setup({ dispatchCalls: 0, dispatchError: new Error('provider timeout') });
    const created = await post(app, owner);
    const id = String(created.json().id);
    db.tables.get('operationSchedule')!.set(id, { ...db.tables.get('operationSchedule')!.get(id)!, executeAt: new Date(Date.now() - 1000) });
    const service = new ScheduleService(db as never, { authorize: async () => {}, dispatch: async () => { throw new Error('provider timeout'); } });
    const claimed = await service.claimDue('w1', Date.now());
    await service.runClaimed(claimed.claimed[0]!);
    const row = db.tables.get('operationSchedule')!.get(id)!;
    expect(row.status).toBe('uncertain');
    expect(String(row.outcomeDetail)).toContain('timeout');
    await app.close();
  });

  it('marks stale scheduled intents missed instead of dispatching them late', async () => {
    const { db, app, owner, gates } = await setup({ dispatchCalls: 0 });
    const created = await post(app, owner);
    // Rewind past the claim grace window: the intent was never claimed in time.
    db.tables.get('operationSchedule')!.set(String(created.json().id), { ...db.tables.get('operationSchedule')!.get(String(created.json().id))!, executeAt: new Date(Date.now() - 10 * 60 * 1000) });
    const service = new ScheduleService(db as never, { authorize: async () => {}, dispatch: async () => 'run-y' });
    const result = await service.claimDue('w1', Date.now());
    expect(result.claimed).toHaveLength(0);
    expect(result.missed).toBe(1);
    const row = db.tables.get('operationSchedule')!.get(String(created.json().id))!;
    expect(row.status).toBe('missed');
    expect(gates.dispatchCalls).toBe(0);
    await app.close();
  });

  it('reschedules with a version CAS and refuses double cancels', async () => {
    const { app, owner } = await setup({ dispatchCalls: 0 });
    const created = await post(app, owner);
    const id = String(created.json().id);
    const later = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const moved = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/schedules/${id}/reschedule`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { executeAt: later, timezone: 'UTC', expectedVersion: 1 } });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().version).toBe(2);
    const stale = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/schedules/${id}/reschedule`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { executeAt: later, timezone: 'UTC', expectedVersion: 1 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.message).toContain('changed');
    const staleCancel = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/schedules/${id}/cancel`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { expectedVersion: 1 } });
    expect(staleCancel.statusCode).toBe(409);
    expect(staleCancel.json().error.message).toContain('changed');
    const cancel = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/schedules/${id}/cancel`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { expectedVersion: 2 } });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe('canceled');
    const again = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/schedules/${id}/cancel`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { expectedVersion: 3 } });
    expect(again.statusCode).toBe(409);
    await app.close();
  });

  it('restart recovery marks stale claims uncertain and leaves fresh claims alone', async () => {
    const { db, app, owner } = await setup({ dispatchCalls: 0 });
    const a = await post(app, owner, { requestId: 'req-a' });
    const b = await post(app, owner, { requestId: 'req-b' });
    const service = new ScheduleService(db as never, { authorize: async () => {}, dispatch: async () => null });
    for (const id of [String(a.json().id), String(b.json().id)]) {
      db.tables.get('operationSchedule')!.set(id, { ...db.tables.get('operationSchedule')!.get(id)!, executeAt: new Date(Date.now() - 1000) });
    }
    const claimed = await service.claimDue('w1', Date.now());
    expect(claimed.claimed).toHaveLength(2);
    db.tables.get('operationSchedule')!.set(String(a.json().id), { ...db.tables.get('operationSchedule')!.get(String(a.json().id))!, claimedAt: new Date(Date.now() - 10 * 60 * 1000) });
    const recovered = await service.recoverStaleClaims(5 * 60 * 1000, Date.now());
    expect(recovered).toBe(1);
    const rows = [...db.tables.get('operationSchedule')!.values()];
    expect(rows.find((r) => r.id === String(a.json().id))!.status).toBe('uncertain');
    expect(rows.find((r) => r.id === String(b.json().id))!.status).toBe('claimed');
    await app.close();
  });
});
