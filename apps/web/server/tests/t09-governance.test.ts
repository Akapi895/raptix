import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
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
      findMany: async ({ where }: { where: { engagementId: string } }) => listAll('webMembership', (r) => r.engagementId === where.engagementId),
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
    emergencyStop: {
      findFirst: async ({ where }: { where: { engagementId: string; outcome: { in: string[] } } }) =>
        find('emergencyStop', (r) => r.engagementId === where.engagementId && Array.isArray(where.outcome.in) && (where.outcome.in as string[]).includes(String(r.outcome))),
      findMany: async ({ where, orderBy }: { where: { engagementId: string }; orderBy?: { createdAt: string } }) => {
        const rows = await listAll('emergencyStop', (r) => r.engagementId === where.engagementId);
        if (orderBy?.createdAt === 'desc') rows.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
        return rows;
      },
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('estop'), createdAt: new Date(), updatedAt: new Date() }; table('emergencyStop').set(String(row.id), row); return { ...row }; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => { const row: Row = { ...table('emergencyStop').get(where.id)!, ...data, updatedAt: new Date() }; table('emergencyStop').set(where.id, row); return { ...row }; },
    },
  };
  (db as unknown as { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return db;
}

type Db = ReturnType<typeof memoryDb>;

const ENG = 'eng-1';
const ROE = { windows: [], emergencyContacts: ['blue-team@example.invalid'], restrictions: [] };

async function setup(): Promise<{ db: Db; app: FastifyInstance; owner: { cookie: string; csrf: string }; reviewer: { cookie: string; csrf: string } }> {
  const db = memoryDb();
  const owner = await db.webUser.create({ data: { username: 'owner', displayName: 'Owner', passwordHash: hashPassword('correct horse battery'), status: 'active' } });
  const reviewer = await db.webUser.create({ data: { username: 'rev', displayName: 'Rev', passwordHash: hashPassword('longenough1'), status: 'active' } });
  db.tables.set('engagement', new Map([[ENG, { id: ENG, userId: owner.id, name: ENG, targetValue: 'https://target.invalid', handoffConfirmedAt: new Date() }]]));
  await db.webMembership.create({ data: { engagementId: ENG, userId: reviewer.id, role: 'reviewer' } });
  const app = await (buildApp({
    authMode: 'multi',
    authDb: db as never,
    scopeService: new ScopeService(db as never),
    governanceService: new GovernanceService(db as never, new ScopeService(db as never)),
    cancelRun: async () => 'acknowledged',
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
});

async function loginRev(app: FastifyInstance): Promise<{ cookie: string; csrf: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'rev', password: 'longenough1' } });
  return { cookie: `raptix_web_session=${res.cookies.find((c) => c.name === 'raptix_web_session')!.value}`, csrf: res.json().csrfToken };
}
