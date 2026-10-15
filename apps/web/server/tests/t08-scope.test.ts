import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/multi-user.js';
import { ScopeService } from '../src/services/scope-service.js';
import { MembersService } from '../src/services/members-service.js';

/**
 * Ticket 08 acceptance: revision submit/decide with independent review,
 * pending-until-approved asset access, version/conflict semantics and the
 * submitted-revision invalidation contract (the previously approved revision
 * is superseded at submission time).
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
      findMany: async ({ where }: { where: { engagementId: string } }) => [...table('webMembership').values()].filter((r) => r.engagementId === where.engagementId).map((r) => ({ ...r })),
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
        return rows[0] !== undefined ? { ...rows[0] } : null;
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
          if (row.engagementId === where.engagementId && row.status === where.status) {
            table('scopeRevision').set(id, { ...row, ...data });
            count += 1;
          }
        }
        return { count };
      },
    },
    webAsset: {
      findFirst: async ({ where }: { where: { id?: string; engagementId: string; identifier?: string } }) =>
        find('webAsset', (r) => r.engagementId === where.engagementId && (where.id === undefined || r.id === where.id) && (where.identifier === undefined || r.identifier === where.identifier)),
      findMany: async ({ where }: { where: { engagementId: string } }) => [...table('webAsset').values()].filter((r) => r.engagementId === where.engagementId).map((r) => ({ ...r })),
      create: async ({ data }: { data: Row }) => { const row: Row = { version: 1, observed: false, updatedBy: null, classification: 'pending', kind: 'host', ...data, id: seq('asset'), updatedAt: new Date() }; table('webAsset').set(String(row.id), row); return { ...row }; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const prev = table('webAsset').get(where.id)!;
        const version = typeof data.version === 'object' && data.version !== null && 'increment' in (data.version as Record<string, unknown>)
          ? Number(prev.version) + Number((data.version as { increment: number }).increment)
          : Number(prev.version);
        const row: Row = { ...prev, ...data, version, updatedAt: new Date() };
        delete (row as Record<string, unknown>).version;
        row.version = version;
        table('webAsset').set(where.id, row);
        return { ...row };
      },
      updateMany: async ({ where, data }: { where: { engagementId: string; identifier: string; classification: string }; data: Row }) => {
        let count = 0;
        for (const [id, row] of table('webAsset')) {
          if (row.engagementId === where.engagementId && row.identifier === where.identifier && row.classification === where.classification) {
            table('webAsset').set(id, { ...row, ...data });
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

const ENG = 'eng-1';

async function setup(): Promise<{ db: Db; app: FastifyInstance; owner: { cookie: string; csrf: string }; reviewer: { cookie: string; csrf: string } }> {
  const db = memoryDb();
  const owner = await db.webUser.create({ data: { username: 'owner', displayName: 'Owner', passwordHash: hashPassword('correct horse battery'), status: 'active' } });
  const reviewer = await db.webUser.create({ data: { username: 'rev', displayName: 'Rev', passwordHash: hashPassword('longenough1'), status: 'active' } });
  db.tables.set('engagement', new Map([[ENG, { id: ENG, userId: owner.id, name: ENG, targetValue: 'https://target.invalid' }]]));
  await db.webMembership.create({ data: { engagementId: ENG, userId: reviewer.id, role: 'reviewer' } });
  const app = await (buildApp({ authMode: 'multi', authDb: db as never, membersService: new MembersService(db as never, true), scopeService: new ScopeService(db as never) }) as unknown as Promise<FastifyInstance>);
  const login = async (username: string, password: string): Promise<{ cookie: string; csrf: string }> => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  if (res.statusCode !== 200) console.error('LOGIN-FAIL', username, res.statusCode, res.body);
    expect(res.statusCode).toBe(200);
    return { cookie: `raptix_web_session=${res.cookies.find((c) => c.name === 'raptix_web_session')!.value}`, csrf: res.json().csrfToken };
  };
  return { db, app, owner: await login('owner', 'correct horse battery'), reviewer: await login('rev', 'longenough1') };
}

const ROE = { windows: [{ start: '2026-10-15T00:00:00Z', end: '2026-10-16T00:00:00Z', tz: 'UTC' }], emergencyContacts: ['blue-team@example.invalid'], restrictions: [] };
const DIFF = { added: ['10.0.0.5'], removed: [], rationale: 'customer asked to include the staging host' };

describe('ticket 08 scope governance', () => {
  it('submits a pending revision with a persisted version and supersedes the previous approval at submission', async () => {
    const { app, owner, reviewer } = await setup();
    const first = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/scope/revisions`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { diff: DIFF, roe: ROE } });
    expect(first.statusCode).toBe(200);
    expect(first.json().version).toBe(1);
    expect(first.json().status).toBe('pending');

    const approved = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/scope/revisions/${first.json().id}/decision`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'approved', comment: 'ok' } });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe('approved');

    const second = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/scope/revisions`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { diff: { added: ['10.0.0.9'], removed: [], rationale: 'extend' }, roe: ROE } });
    expect(second.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/scope/revisions`, headers: { cookie: owner.cookie } });
    const versions = Object.fromEntries(list.json().revisions.map((r: { version: number; status: string }) => [r.version, r.status]));
    expect(versions[1]).toBe('superseded');
    expect(versions[2]).toBe('pending');
    expect(list.json().latestApprovedVersion).toBeNull();
  });

  it('refuses self-review and requires the reviewer role for decisions', async () => {
    const { app, owner } = await setup();
    const revision = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/scope/revisions`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { diff: DIFF, roe: ROE } });
    const id = revision.json().id;
    const self = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/scope/revisions/${id}/decision`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { decision: 'approved' } });
    expect(self.statusCode).toBe(403);
    expect(self.json().error.message).toContain('independent actor');
    const bad = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/scope/revisions/${id}/decision`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { decision: 'maybe' } });
    expect(bad.statusCode).toBe(400);
  });

  it('keeps imported assets pending and requires the approved governance path to make them in scope', async () => {
    const { app, owner, reviewer } = await setup();
    const imported = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/assets/inventory/import`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { identifiers: ['10.0.0.5', '10.0.0.6'], kind: 'ip_range' } });
    expect(imported.json()).toEqual({ imported: 2, skipped: 0 });

    const list = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/assets/inventory`, headers: { cookie: owner.cookie } });
    expect(list.json().assets.every((a: { classification: string }) => a.classification === 'pending')).toBe(true);

    const asset = list.json().assets[0];
    const early = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/assets/inventory/${asset.id}`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { classification: 'in_scope' } });
    expect(early.statusCode).toBe(409);
    expect(early.json().error.message).toContain('approved scope revision');

    // approve a revision that adds 10.0.0.5, then classification succeeds
    const revision = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/scope/revisions`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { diff: DIFF, roe: ROE } });
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/scope/revisions/${revision.json().id}/decision`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'approved' } });
    const ok = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/assets/inventory/${asset.id}`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { classification: 'in_scope' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().classification).toBe('in_scope');
    const uncovered = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/assets/inventory/${list.json().assets[1].id}`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { classification: 'in_scope' } });
    expect(uncovered.statusCode).toBe(409);
    // out-of-scope narrowing is always allowed
    const out = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/assets/inventory/${list.json().assets[1].id}`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { classification: 'out_of_scope' } });
    expect(out.statusCode).toBe(200);
  });

  it('answers 404 for foreign engagements and rejects malformed ROE windows', async () => {
    const { app, owner } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/engagements/eng-other/scope/revisions', headers: { cookie: owner.cookie } })).statusCode).toBe(404);
    const badWindow = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/scope/revisions`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { diff: DIFF, roe: { windows: [{ start: '2026-10-15T10:00:00Z', end: '2026-10-15T09:00:00Z', tz: 'UTC' }], emergencyContacts: [], restrictions: [] } } });
    expect(badWindow.statusCode).toBe(400);
    const noDiff = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/scope/revisions`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { diff: { added: [], removed: [], rationale: 'x' }, roe: ROE } });
    expect(noDiff.statusCode).toBe(400);
  });
});
