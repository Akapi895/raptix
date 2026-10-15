import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/multi-user.js';
import { ScopeService } from '../src/services/scope-service.js';
import { GovernanceService } from '../src/services/governance-service.js';

/**
 * Ticket 09 acceptance: plan draft/propose/approve with four-eyes + absolute
 * 24h deadline, scope-pin invalidation, preflight refusals and truthful
 * emergency-stop outcomes. Deadline -1/0/+1 covered via injectable now.
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
  const listAll = async (name: string, pred: (row: Row) => boolean): Promise<Row[]> => [...table(name).values()].filter(pred).map((r) => ({ ...r }));
  const db = {
    tables,
    engagementClosure: { findFirst: async () => null },
    engagement: {
      findFirst: async ({ where }: { where: { id: string; userId?: string } }) =>
        find('engagement', (r) => r.id === where.id && (where.userId === undefined || r.userId === where.userId)),
      findMany: async ({ where }: { where: { userId?: string } }) =>
        listAll('engagement', (r) => where.userId === undefined || r.userId === where.userId),
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
      findMany: async ({ where }: { where: { engagementId?: string; userId?: string; role?: { in: string[] } } }) =>
        listAll('webMembership', (r) => (where.engagementId === undefined || r.engagementId === where.engagementId)
          && (where.userId === undefined || r.userId === where.userId)
          && (where.role === undefined || Array.isArray(where.role.in!) && where.role.in!.includes(String(r.role)))),
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('m') }; table('webMembership').set(String(row.id), row); return { ...row }; },
      delete: async ({ where }: { where: { id: string } }) => { table('webMembership').delete(where.id); return {}; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => { const row: Row = { ...table('webMembership').get(where.id)!, ...data }; table('webMembership').set(where.id, row); return { ...row }; },
    },
    webAuditEntry: {
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('a') }; table('webAuditEntry').set(String(row.id), row); return { ...row }; },
    },
    scopeRevision: {
      findFirst: async ({ where, orderBy }: { where: { id?: string; engagementId: string; status?: string }; orderBy?: { version: string } }) => {
        let rows = [...table('scopeRevision').values()].filter((r) => r.engagementId === where.engagementId && (where.status === undefined || r.status === where.status) && (where.id === undefined || r.id === where.id));
        if (orderBy?.version === 'desc') rows = rows.sort((a, b) => Number(b.version) - Number(a.version));
        return rows[0] !== undefined ? { ...rows[0], createdAt: new Date(), updatedAt: new Date(), decidedBy: null, decidedAt: null, decisionComment: null } : null;
      },
      findMany: async ({ where, orderBy }: { where: { engagementId: string }; orderBy?: { version: string } }) => {
        let rows = [...table('scopeRevision').values()].filter((r) => r.engagementId === where.engagementId);
        if (orderBy?.version === 'desc') rows = rows.sort((a, b) => Number(b.version) - Number(a.version));
        return rows.map((r) => ({ ...r }));
      },
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('rev'), decidedBy: null, decidedAt: null, decisionComment: null, createdAt: new Date(), updatedAt: new Date() }; table('scopeRevision').set(String(row.id), row); return { ...row }; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => { const row: Row = { ...table('scopeRevision').get(where.id)!, ...data }; table('scopeRevision').set(where.id, row); return { ...row }; },
      updateMany: async ({ where, data }: { where: { engagementId: string; status: string }; data: Row }) => {
        let count = 0;
        for (const [id, row] of table('scopeRevision')) {
          if (row.engagementId === where.engagementId && row.status === where.status) { table('scopeRevision').set(id, { ...row, ...data }); count += 1; }
        }
        return { count };
      },
    },
    webAsset: {
      findFirst: async ({ where }: { where: { id?: string; engagementId: string; identifier?: string } }) =>
        find('webAsset', (r) => r.engagementId === where.engagementId && (where.id === undefined || r.id === where.id) && (where.identifier === undefined || r.identifier === where.identifier)),
      findMany: async ({ where }: { where: { engagementId: string } }) => listAll('webAsset', (r) => r.engagementId === where.engagementId),
      create: async ({ data }: { data: Row }) => { const row: Row = { version: 1, observed: false, updatedBy: null, classification: 'pending', kind: 'host', ...data, id: seq('asset'), createdAt: new Date(), updatedAt: new Date() }; table('webAsset').set(String(row.id), row); return { ...row }; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const prev = table('webAsset').get(where.id)!;
        const increment = typeof data.version === 'object' && data.version !== null && 'increment' in (data.version as Record<string, unknown>) ? Number((data.version as { increment: number }).increment) : 0;
        const row: Row = { ...prev, ...data, version: Number(prev.version) + increment, updatedAt: new Date() };
        table('webAsset').set(where.id, row);
        return { ...row };
      },
      updateMany: async ({ where, data }: { where: { engagementId: string; identifier: string; classification: string }; data: Row }) => {
        let count = 0;
        for (const [id, row] of table('webAsset')) {
          if (row.engagementId === where.engagementId && row.identifier === where.identifier && row.classification === where.classification) { table('webAsset').set(id, { ...row, ...data }); count += 1; }
        }
        return { count };
      },
      count: async ({ where }: { where: { engagementId: string; classification: string } }) => listAll('webAsset', (r) => r.engagementId === where.engagementId && r.classification === where.classification).then((rows) => rows.length),
    },
    businessPlan: {
      findFirst: async ({ where }: { where: { id?: string; engagementId: string } }) =>
        find('businessPlan', (r) => r.engagementId === where.engagementId && (where.id === undefined || r.id === where.id)),
      findMany: async ({ where, orderBy }: { where: { engagementId: string }; orderBy?: { version: string } }) => {
        let rows = [...table('businessPlan').values()].filter((r) => r.engagementId === where.engagementId);
        if (orderBy?.version === 'desc') rows = rows.sort((a, b) => Number(b.version) - Number(a.version));
        return rows.map((r) => ({ ...r }));
      },
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('plan'), decidedBy: null, decidedAt: null, decisionComment: null, expiresAt: null, roeVersion: null, createdAt: new Date(), updatedAt: new Date() }; table('businessPlan').set(String(row.id), row); return { ...row }; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => { const row: Row = { ...table('businessPlan').get(where.id)!, ...data }; table('businessPlan').set(where.id, row); return { ...row }; },
      updateMany: async ({ where, data }: { where: { engagementId: string; status: string }; data: Row }) => {
        let count = 0;
        for (const [id, row] of table('businessPlan')) {
          if (row.engagementId === where.engagementId && row.status === where.status) { table('businessPlan').set(id, { ...row, ...data }); count += 1; }
        }
        return { count };
      },
    },
    operationBinding: {
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('binding'), status: data.status ?? 'bound', concurrencyVersion: 1, createdAt: new Date(), updatedAt: new Date() }; table('operationBinding').set(String(row.id), row); return { ...row }; },
      findMany: async ({ where }: { where: { engagementId: string } }) => listAll('operationBinding', (r) => r.engagementId === where.engagementId),
    },
    engagementThread: {
      findFirst: async ({ where }: { where: { threadId: string; engagementId: string } }) =>
        find('engagementThread', (r) => r.threadId === where.threadId && r.engagementId === where.engagementId),
    },
    emergencyStop: {
      findFirst: async ({ where }: { where: { id?: string; engagementId: string; outcome?: { in: string[] } } }) =>
        find('emergencyStop', (r) => r.engagementId === where.engagementId && (where.id === undefined || r.id === where.id)
          && (where.outcome === undefined || Array.isArray(where.outcome.in!) && where.outcome.in!.includes(String(r.outcome)))),
      findMany: async ({ where, orderBy }: { where: { engagementId: string }; orderBy?: { createdAt: string } }) => {
        const rows = await listAll('emergencyStop', (r) => r.engagementId === where.engagementId);
        if (orderBy?.createdAt === 'desc') rows.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
        return rows;
      },
      create: async ({ data }: { data: Row }) => { const row: Row = { concurrencyVersion: 1, ...data, id: seq('estop'), createdAt: new Date(), updatedAt: new Date() }; table('emergencyStop').set(String(row.id), row); return { ...row }; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => { const row: Row = { ...table('emergencyStop').get(where.id)!, ...data, updatedAt: new Date() }; table('emergencyStop').set(where.id, row); return { ...row }; },
      updateMany: async ({ where, data }: { where: { id: string; concurrencyVersion: number }; data: Row }) => {
        const row = table('emergencyStop').get(where.id);
        if (row === undefined || Number(row.concurrencyVersion) !== where.concurrencyVersion) return { count: 0 };
        const increment = typeof data.concurrencyVersion === 'object' && data.concurrencyVersion !== null && 'increment' in (data.concurrencyVersion as Record<string, unknown>) ? Number((data.concurrencyVersion as { increment: number }).increment) : 0;
        table('emergencyStop').set(where.id, { ...row, ...data, concurrencyVersion: Number(row.concurrencyVersion) + increment, updatedAt: new Date() });
        return { count: 1 };
      },
    },
  };
  (db as unknown as { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  // W05: the emergency latch transaction probes the key-1 advisory fence via
  // $queryRaw; the in-memory store has no concurrency, so the lock is free.
  (db as unknown as { $queryRaw: unknown }).$queryRaw = async () => [{ locked: true }];
  return db;
}

type Db = ReturnType<typeof memoryDb>;

const ENG = 'eng-1';
const ROE = { windows: [], emergencyContacts: ['blue-team@example.invalid'], restrictions: [] };

async function setup(opts: {
  cancelRun?: (threadId: string, runId: string | null, actorId: string, engagementId: string) => Promise<string>;
  hasActiveRuns?: (actorId: string, engagementId: string) => Promise<boolean>;
} = {}): Promise<{ db: Db; app: FastifyInstance; owner: { cookie: string; csrf: string }; reviewer: { cookie: string; csrf: string } }> {
  const db = memoryDb();
  const owner = await db.webUser.create({ data: { username: 'owner', displayName: 'Owner', passwordHash: hashPassword('correct horse battery'), status: 'active' } });
  const reviewer = await db.webUser.create({ data: { username: 'rev', displayName: 'Rev', passwordHash: hashPassword('longenough1'), status: 'active' } });
  db.tables.set('engagement', new Map([[ENG, { id: ENG, userId: owner.id, name: ENG, targetValue: 'https://target.invalid', handoffConfirmedAt: new Date() }]]));
  const threads = new Map<string, Row>();
  for (const threadId of ['th-1', 'th-2', 'th-3', 'th-4', 'th-9']) threads.set(threadId, { threadId, engagementId: ENG, kind: 'execution' });
  db.tables.set('engagementThread', threads);
  await db.webMembership.create({ data: { engagementId: ENG, userId: reviewer.id, role: 'reviewer' } });
  const app = await (buildApp({
    authMode: 'multi',
    authDb: db as never,
    scopeService: new ScopeService(db as never),
    governanceService: new GovernanceService(db as never, new ScopeService(db as never)),
    cancelRun: opts.cancelRun ?? (async () => 'acknowledged'),
    hasActiveRuns: opts.hasActiveRuns,
  }) as unknown as Promise<FastifyInstance>);
  const login = async (username: string, password: string): Promise<{ cookie: string; csrf: string }> => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    expect(res.statusCode).toBe(200);
    return { cookie: `raptix_web_session=${res.cookies.find((c) => c.name === 'raptix_web_session')!.value}`, csrf: res.json().csrfToken };
  };
  return { db, app, owner: await login('owner', 'correct horse battery'), reviewer: await login('rev', 'longenough1') };
}

async function approveScope(app: FastifyInstance, owner: { cookie: string; csrf: string }, reviewer: { cookie: string; csrf: string }): Promise<void> {
  const revision = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/scope/revisions`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { diff: { added: ['10.0.0.5'], removed: [], rationale: 'initial scope' }, roe: ROE } });
  expect(revision.statusCode).toBe(200);
  const decided = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/scope/revisions/${revision.json().id}/decision`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'approved' } });
  expect(decided.statusCode).toBe(200);
}

async function approvedPlan(app: FastifyInstance, owner: { cookie: string; csrf: string }, reviewer: { cookie: string; csrf: string }): Promise<string> {
  const draft = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/plans`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { objective: 'Validate the staging login flow', methods: ['web'] } });
  expect(draft.statusCode).toBe(200);
  const proposed = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/plans/${draft.json().id}/propose`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf } });
  expect(proposed.statusCode).toBe(200);
  const decided = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/plans/${draft.json().id}/decision`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'approved' } });
  expect(decided.statusCode).toBe(200);
  return draft.json().id as string;
}

describe('ticket 09 governed plans and operation controls', () => {
  it('rechecks a bound approval at dispatch after its absolute deadline', async () => {
    const { db, app, owner, reviewer } = await setup();
    await approveScope(app, owner, reviewer);
    const planId = await approvedPlan(app, owner, reviewer);
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/bindings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { planId, threadId: 'th-1' } });
    const governance = new GovernanceService(db as never, new ScopeService(db as never));
    const actorId = String(db.tables.get('engagement')!.get(ENG)!.userId);
    const plan = db.tables.get('businessPlan')!.get(planId)!;
    db.tables.get('businessPlan')!.set(planId, { ...plan, expiresAt: new Date(Date.now() - 1) });
    await expect(governance.assertExecutionAuthorized(actorId, ENG, 'th-1')).rejects.toThrow(/expired/);
    await app.close();
  });
  it('runs the four-eyes plan lifecycle: draft -> propose (pins scope) -> independent approve with 24h deadline', async () => {
    const { app, owner, reviewer } = await setup();
    await approveScope(app, owner, reviewer);
    const planId = await approvedPlan(app, owner, reviewer);
    const list = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/plans`, headers: { cookie: owner.cookie } });
    const plan = list.json().plans.find((p: { id: string }) => p.id === planId);
    expect(plan.status).toBe('approved');
    expect(plan.roeVersion).toBe(1);
    const expires = Date.parse(plan.expiresAt);
    expect(expires - Date.parse(plan.decidedAt)).toBe(24 * 60 * 60 * 1000);
    // self-approve refused
    const draft2 = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/plans`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { objective: 'Second', methods: [] } });
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/plans/${draft2.json().id}/propose`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf } });
    const self = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/plans/${draft2.json().id}/decision`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { decision: 'approved' } });
    expect(self.statusCode).toBe(403);
    expect(self.json().error.message).toContain('independent actor');
  });

  it('binds an approved plan after preflight passes, and refuses an expired approval (-1s)', async () => {
    const { db, app, owner, reviewer } = await setup();
    await approveScope(app, owner, reviewer);
    const planId = await approvedPlan(app, owner, reviewer);
    const bound = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/bindings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { planId, threadId: 'th-1' } });
    expect(bound.statusCode).toBe(200);
    expect(bound.json().status).toBe('bound');
    // Expire the approval by one second, then refuse the next bind.
    const row = db.tables.get('businessPlan')!.get(planId)!;
    db.tables.get('businessPlan')!.set(planId, { ...row, expiresAt: new Date(Date.now() - 1) });
    const expired = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/bindings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { planId, threadId: 'th-2' } });
    expect(expired.statusCode).toBe(409);
    expect(expired.json().error.message).toContain('expired');
  });

  it('invalidates the scope pin: a superseded ROE version refuses the bind until re-review', async () => {
    const { app, owner, reviewer } = await setup();
    await approveScope(app, owner, reviewer);
    const planId = await approvedPlan(app, owner, reviewer);
    // New revision submitted -> approval v1 is superseded -> bind must refuse.
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/scope/revisions`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { diff: { added: ['10.0.0.9'], removed: [], rationale: 'extend' }, roe: ROE } });
    const refused = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/bindings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { planId, threadId: 'th-3' } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toMatch(/re-review required|Preflight refuses/);
    // Approve the new revision, then re-review the plan (new version) and bind.
    const revisions = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/scope/revisions`, headers: { cookie: owner.cookie } });
    const pending = revisions.json().revisions.find((r: { status: string }) => r.status === 'pending');
    const decided = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/scope/revisions/${pending.id}/decision`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'approved' } });
    expect(decided.statusCode).toBe(200);
    const draft = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/plans`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { objective: 'Re-reviewed', methods: [] } });
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/plans/${draft.json().id}/propose`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf } });
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/plans/${draft.json().id}/decision`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'approved' } });
    const ok = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/bindings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { planId: draft.json().id, threadId: 'th-4' } });
    expect(ok.statusCode).toBe(200);
  });

  it('records truthful emergency-stop outcomes and refuses work while a stop is active', async () => {
    const { app, owner, reviewer } = await setup();
    await approveScope(app, owner, reviewer);
    const planId = await approvedPlan(app, owner, reviewer);
    const estop = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/estops`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { scope: 'project', reason: 'Blue team request', threadId: 'th-1' } });
    expect(estop.statusCode).toBe(200);
    expect(estop.json().outcome).toBe('acknowledged');
    const refusedBind = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/bindings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { planId, threadId: 'th-1' } });
    expect(refusedBind.statusCode).toBe(409);
    expect(refusedBind.json().error.message).toContain('emergency stop');
    // A bind with a different thread is also refused while a project-scope stop is open.
    const refusedOther = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/bindings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { planId, threadId: 'th-9' } });
    expect(refusedOther.statusCode).toBe(409);
    const list = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/estops`, headers: { cookie: reviewer.cookie } });
    expect(list.json().stops[0].outcome).toBe('acknowledged');
  });

  it('preflight fails honestly while no approved ROE exists and passes after governance', async () => {
    const { app, owner } = await setup();
    const before = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/preflight`, headers: { cookie: owner.cookie } });
    expect(before.statusCode).toBe(200);
    expect(before.json().ok).toBe(false);
    expect(before.json().checks.find((c: { id: string }) => c.id === 'roe').state).toBe('fail');
    const { reviewer } = { reviewer: await loginRev(app) };
    await approveScope(app, owner, reviewer);
    const after = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/preflight`, headers: { cookie: owner.cookie } });
    expect(after.json().checks.find((c: { id: string }) => c.id === 'roe').state).toBe('pass');
  });

  it('W10: refuses a foreign operation thread before any stop latch or cancel is recorded', async () => {
    const { db, app, owner } = await setup();
    let cancels = 0;
    await app.close();
    const spied = await (buildApp({
      authMode: 'multi',
      authDb: db as never,
      scopeService: new ScopeService(db as never),
      governanceService: new GovernanceService(db as never, new ScopeService(db as never)),
      cancelRun: async () => { cancels += 1; return 'stopped'; },
    }) as unknown as Promise<FastifyInstance>);
    let foreign;
    try {
      foreign = await spied.inject({ method: 'POST', url: `/api/engagements/${ENG}/estops`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { scope: 'operation', reason: 'not our thread', threadId: 'th-foreign' } });
    } finally {
      await spied.close();
    }
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.message).toContain('Thread not found');
    expect([...(db.tables.get('emergencyStop')?.values() ?? [])]).toHaveLength(0);
    expect(cancels).toBe(0);
  });

  it('W10: a runtime-confirmed stop also blocks preflight until explicit resolution (unified stop sets)', async () => {
    const { db, app, owner, reviewer } = await setup();
    await approveScope(app, owner, reviewer);
    const spied = await (buildApp({
      authMode: 'multi',
      authDb: db as never,
      scopeService: new ScopeService(db as never),
      governanceService: new GovernanceService(db as never, new ScopeService(db as never)),
      cancelRun: async () => 'stopped',
    }) as unknown as Promise<FastifyInstance>);
    try {
      const stopped = await spied.inject({ method: 'POST', url: `/api/engagements/${ENG}/estops`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { scope: 'project', reason: 'Blue team request' } });
      expect(stopped.json().outcome).toBe('stopped');
      const before = await spied.inject({ method: 'GET', url: `/api/engagements/${ENG}/preflight?threadId=th-1`, headers: { cookie: owner.cookie } });
      expect(before.json().checks.find((c: { id: string }) => c.id === 'estop').state).toBe('fail');
    } finally {
      await spied.close();
    }
    await app.close();
  });

  it('W10: an explicitly resolved emergency stop unblocks work start without auto-resuming anything', async () => {
    const { app, owner, reviewer } = await setup();
    await approveScope(app, owner, reviewer);
    const planId = await approvedPlan(app, owner, reviewer);
    const stopped = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/estops`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { scope: 'project', reason: 'Blue team request' } });
    expect(stopped.json().outcome).toBe('acknowledged');
    const stopId = stopped.json().id as string;
    const refusedBind = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/bindings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { planId, threadId: 'th-1' } });
    expect(refusedBind.statusCode).toBe(409);
    const noReason = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/estops/${stopId}/resolve`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: {} });
    expect(noReason.statusCode).toBe(400);
    const resolved = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/estops/${stopId}/resolve`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { reason: 'infrastructure all-clear', concurrencyVersion: 1 } });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().outcome).toBe('resolved');
    const again = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/estops/${stopId}/resolve`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { reason: 'already done', concurrencyVersion: 2 } });
    expect(again.statusCode).toBe(409);
    const rebound = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/bindings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { planId, threadId: 'th-1' } });
    expect(rebound.statusCode).toBe(200);
    await app.close();
  });

  it('W10/ADR-0074: a workspace stop latches every owned engagement with active work and leaves the rest untouched', async () => {
    const cancelled: string[] = [];
    const { db, app, owner } = await setup({
      cancelRun: async (_threadId, _runId, _actorId, engagementId) => { cancelled.push(engagementId); return engagementId === ENG ? 'stopped' : 'acknowledged'; },
      hasActiveRuns: async (_actorId, engagementId) => engagementId === 'eng-2',
    });
    const ownerId = String(db.tables.get('engagement')!.get(ENG)!.userId);
    // eng-2: operator membership with active work; eng-3: reviewer-only;
    // eng-4: operator membership but no active work observed.
    db.tables.get('engagement')!.set('eng-2', { id: 'eng-2', userId: 'someone-else', name: 'eng-2', targetValue: 'https://two.invalid' });
    db.tables.get('engagement')!.set('eng-3', { id: 'eng-3', userId: 'someone-else', name: 'eng-3', targetValue: 'https://three.invalid' });
    db.tables.get('engagement')!.set('eng-4', { id: 'eng-4', userId: 'someone-else', name: 'eng-4', targetValue: 'https://four.invalid' });
    await db.webMembership.create({ data: { engagementId: 'eng-2', userId: ownerId, role: 'operator' } });
    await db.webMembership.create({ data: { engagementId: 'eng-3', userId: ownerId, role: 'reviewer' } });
    await db.webMembership.create({ data: { engagementId: 'eng-4', userId: ownerId, role: 'operator' } });
    const stop = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/estops`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { scope: 'workspace', reason: 'major incident across the portfolio' } });
    expect(stop.statusCode).toBe(200);
    const body = stop.json();
    expect(body).toMatchObject({ engagementId: ENG, scope: 'workspace', outcome: 'stopped', reason: 'major incident across the portfolio' });
    expect(body.related).toHaveLength(1);
    expect(body.related[0]).toMatchObject({ engagementId: 'eng-2', scope: 'workspace', outcome: 'acknowledged', reason: 'major incident across the portfolio' });
    expect(cancelled).toEqual([ENG, 'eng-2']);
    const stopsIn = (id: string) => [...(db.tables.get('emergencyStop')?.values() ?? [])].filter((r) => r.engagementId === id);
    expect(stopsIn(ENG)).toHaveLength(1);
    expect(stopsIn('eng-2')).toHaveLength(1);
    expect(stopsIn('eng-3')).toHaveLength(0);
    expect(stopsIn('eng-4')).toHaveLength(0);
    // Each latch blocks only its own engagement until it is resolved there.
    const governance = new GovernanceService(db as never, new ScopeService(db as never));
    await expect(governance.assertNoActiveStop('eng-2', null)).rejects.toThrow(/emergency stop/);
    await expect(governance.assertNoActiveStop('eng-4', null)).resolves.toBeUndefined();
    await app.close();
  });

  it('W10: resolution is guarded by an optimistic concurrency version', async () => {
    const { app, owner } = await setup();
    const stopped = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/estops`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { scope: 'project', reason: 'Blue team request', threadId: 'th-1' } });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json().concurrencyVersion).toBe(1);
    const stopId = stopped.json().id as string;
    const resolve = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/api/engagements/${ENG}/estops/${stopId}/resolve`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload });
    const missing = await resolve({ reason: 'all-clear' });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.message).toContain('concurrencyVersion');
    const stale = await resolve({ reason: 'all-clear', concurrencyVersion: 7 });
    expect(stale.statusCode).toBe(409);
    const resolved = await resolve({ reason: 'all-clear', concurrencyVersion: 1 });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().outcome).toBe('resolved');
    expect(resolved.json().concurrencyVersion).toBe(2);
    const racing = await resolve({ reason: 'racing edit', concurrencyVersion: 1 });
    expect(racing.statusCode).toBe(409);
    await app.close();
  });

  it('W08: reports the target check truthfully for zero inventoried targets', async () => {
    const { db, app, owner } = await setup();
    const first = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/preflight`, headers: { cookie: owner.cookie } });
    const targets = first.json().checks.find((c: { id: string }) => c.id === 'targets');
    expect(targets.state).toBe('pass');
    expect(targets.detail).toContain('root target');
    expect(targets.detail).not.toContain('0 inventoried target(s) in scope');
    const row = db.tables.get('engagement')!.get(ENG)!;
    db.tables.get('engagement')!.set(ENG, { ...row, targetValue: null });
    const second = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/preflight`, headers: { cookie: owner.cookie } });
    expect(second.json().checks.find((c: { id: string }) => c.id === 'targets').state).toBe('fail');
    await app.close();
  });

  it('W08: readiness receives explicit actor/engagement/thread input and its unavailable state reaches the bind refusal', async () => {
    const { db, app, owner, reviewer } = await setup();
    await approveScope(app, owner, reviewer);
    await app.close();
    const actorId = String(db.tables.get('engagement')!.get(ENG)!.userId);
    const seen: unknown[] = [];
    const governance = new GovernanceService(db as never, new ScopeService(db as never), {
      readiness: async (input) => { seen.push(input); return [{ id: 'runtime', state: 'unavailable', detail: 'The runtime is unreachable.' }]; },
    });
    const pre = await governance.preflight(actorId, ENG, 'th-1');
    expect(pre.ok).toBe(false);
    expect(pre.checks.find((c) => c.id === 'runtime')).toMatchObject({ state: 'unavailable' });
    expect(seen).toEqual([{ actorId, engagementId: ENG, threadId: 'th-1' }]);
    await expect(governance.bindPlan(actorId, ENG, 'plan-any', 'th-1')).rejects.toThrow(/runtime/);
  });

  it('W08: bind refuses an approved plan whose approval carries no expiry deadline', async () => {
    const { db, app, owner, reviewer } = await setup();
    await approveScope(app, owner, reviewer);
    const planId = await approvedPlan(app, owner, reviewer);
    const row = db.tables.get('businessPlan')!.get(planId)!;
    db.tables.get('businessPlan')!.set(planId, { ...row, expiresAt: null });
    const bound = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/bindings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { planId, threadId: 'th-1' } });
    expect(bound.statusCode).toBe(409);
    expect(bound.json().error.message).toContain('deadline');
    await app.close();
  });

  it('W09: rejecting a revised plan preserves the currently approved version and its binding', async () => {
    const { app, owner, reviewer } = await setup();
    await approveScope(app, owner, reviewer);
    const v1 = await approvedPlan(app, owner, reviewer);
    const revised = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/plans/${v1}/revisions`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { objective: 'Revised objective', methods: ['web', 'internal'] } });
    expect(revised.statusCode).toBe(200);
    const v2 = String(revised.json().id);
    const proposed = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/plans/${v2}/propose`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf } });
    expect(proposed.statusCode).toBe(200);
    const rejected = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/plans/${v2}/decision`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'rejected' } });
    expect(rejected.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/plans`, headers: { cookie: owner.cookie } });
    const old = list.json().plans.find((p: { id: string }) => p.id === v1);
    expect(old.status).toBe('approved');
    expect(old.expiresAt).not.toBeNull();
    const bound = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/bindings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { planId: v1, threadId: 'th-1' } });
    expect(bound.statusCode).toBe(200);
    await app.close();
  });

  it('W09: a plan decision enforces the reviewed version and refuses a second decision', async () => {
    const { app, owner, reviewer } = await setup();
    await approveScope(app, owner, reviewer);
    const draft = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/plans`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { objective: 'CAS objective', methods: [] } });
    const planId = String(draft.json().id);
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/plans/${planId}/propose`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf } });
    const stale = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/plans/${planId}/decision`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'approved', expectedVersion: 99 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.message).toContain('re-read');
    const decided = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/plans/${planId}/decision`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'approved', expectedVersion: 1 } });
    expect(decided.statusCode).toBe(200);
    const again = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/plans/${planId}/decision`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'rejected', expectedVersion: 1 } });
    expect(again.statusCode).toBe(409);
    await app.close();
  });
});

async function loginRev(app: FastifyInstance): Promise<{ cookie: string; csrf: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'rev', password: 'longenough1' } });
  return { cookie: `raptix_web_session=${res.cookies.find((c) => c.name === 'raptix_web_session')!.value}`, csrf: res.json().csrfToken };
}
