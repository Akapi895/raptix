import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/multi-user.js';
import { ReportsService } from '../src/services/reports-service.js';

/**
 * Ticket 11 acceptance: draft/save/conflict, independent version-pinned
 * review with mandatory comments, delivery gated on approval, replay-safe
 * deliveries via request ids and cross-engagement 404s.
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
    reportRecord: {
      findFirst: async ({ where }: { where: { id?: string; engagementId: string } }) =>
        find('reportRecord', (r) => r.engagementId === where.engagementId && (where.id === undefined || r.id === where.id)),
      findMany: async ({ where, orderBy }: { where: { engagementId: string }; orderBy?: { createdAt: string } }) => {
        const rows = [...table('reportRecord').values()].filter((r) => r.engagementId === where.engagementId).map((r) => ({ ...r }));
        if (orderBy?.createdAt === 'desc') rows.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
        return rows;
      },
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('r'), reviewedBy: null, reviewedAt: null, reviewComment: null, approvedVersion: null, createdAt: new Date(), updatedAt: new Date() }; table('reportRecord').set(String(row.id), row); return { ...row }; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const prev = table('reportRecord').get(where.id)!;
        const increment = typeof data.version === 'object' && data.version !== null && 'increment' in (data.version as Record<string, unknown>) ? Number((data.version as { increment: number }).increment) : 0;
        const row: Row = { ...prev, ...data, version: Number(prev.version) + increment, updatedAt: new Date() };
        table('reportRecord').set(where.id, row);
        return { ...row };
      },
    },
    reportDelivery: {
      findFirst: async ({ where }: { where: { reportId: string; requestId: string } }) =>
        find('reportDelivery', (r) => r.reportId === where.reportId && r.requestId === where.requestId),
      findMany: async ({ where, orderBy }: { where: { reportId: string }; orderBy?: { createdAt: string } }) => {
        const rows = [...table('reportDelivery').values()].filter((r) => r.reportId === where.reportId).map((r) => ({ ...r }));
        if (orderBy?.createdAt === 'desc') rows.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
        return rows;
      },
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('d'), createdAt: new Date() }; table('reportDelivery').set(String(row.id), row); return { ...row }; },
    },
  };
  (db as unknown as { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return db;
}

type Db = ReturnType<typeof memoryDb>;

const ENG = 'eng-1';

async function setup(): Promise<{ db: Db; app: FastifyInstance; author: { cookie: string; csrf: string }; reviewer: { cookie: string; csrf: string } }> {
  const db = memoryDb();
  const author = await db.webUser.create({ data: { username: 'author', displayName: 'Author', passwordHash: hashPassword('correct horse battery'), status: 'active' } });
  const reviewer = await db.webUser.create({ data: { username: 'rev', displayName: 'Rev', passwordHash: hashPassword('longenough1'), status: 'active' } });
  db.tables.set('engagement', new Map([[ENG, { id: ENG, userId: author.id, name: ENG, targetValue: 'https://t.invalid' }]]));
  await db.webMembership.create({ data: { engagementId: ENG, userId: reviewer.id, role: 'reviewer' } });
  const app = await (buildApp({
    logger: { level: 'error' },
    authMode: 'multi',
    authDb: db as never,
    reportsService: new ReportsService(db as never, async () => ({ ok: true, format: 'markdown' })),
  }) as unknown as Promise<FastifyInstance>);
  const login = async (username: string, password: string): Promise<{ cookie: string; csrf: string }> => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    expect(res.statusCode).toBe(200);
    return { cookie: `raptix_web_session=${res.cookies.find((c) => c.name === 'raptix_web_session')!.value}`, csrf: res.json().csrfToken };
  };
  return { db, app, author: await login('author', 'correct horse battery'), reviewer: await login('rev', 'longenough1') };
}

describe('ticket 11 report lifecycle and delivery', () => {
  it('creates a draft, refuses stale edits with a conflict and preserves the stored body', async () => {
    const { app, author } = await setup();
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { title: 'Q3 staging report', summary: 'Draft summary' } });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;
    const saved = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/report-records/${id}`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { expectedVersion: 1, summary: 'Saved summary' } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().version).toBe(2);
    const stale = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/report-records/${id}`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { expectedVersion: 1, summary: 'lost edit' } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.message).toContain('preserved');
  });

  it('enforces independent review with a mandatory comment and pins the version', async () => {
    const { app, author, reviewer } = await setup();
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { title: 'Reviewed report' } });
    const id = created.json().id;
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/review`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { action: 'submit' } });
    const self = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/review`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { decision: 'approved', comment: 'ship it' } });
    expect(self.statusCode).toBe(403);
    expect(self.json().error.message).toContain('independent actor');
    const noComment = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/review`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'approved', comment: '   ' } });
    expect(noComment.statusCode).toBe(400);
    const approved = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/review`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'approved', comment: 'Verified against findings.' } });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe('approved');
    expect(approved.json().approvedVersion).toBe(approved.json().version);
    // Post-approval edits are refused (re-review required for changes).
    const edit = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/report-records/${id}`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { expectedVersion: 1, summary: 'sneaky edit' } });
    expect(edit.statusCode).toBe(409);
    expect(edit.json().error.message).toContain('pinned review');
  });

  it('gates delivery on approval, records truthful outcomes and replays the same request id without duplicates', async () => {
    const { app, author, reviewer } = await setup();
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { title: 'Delivery report' } });
    const id = created.json().id;
    const early = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/deliveries`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { kind: 'delivery', format: 'markdown', requestId: 'req-1' } });
        expect(early.statusCode).toBe(409);
    expect(early.json().error.message).toContain('not a reviewed deliverable');
    // export is allowed in draft, recorded honestly
    const exported = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/deliveries`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { kind: 'export', format: 'json', requestId: 'req-e1' } });
        expect(exported.statusCode).toBe(200);
    expect(exported.json().deliveries[0].status).toBe('completed');
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/review`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { action: 'submit' } });
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/review`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'approved', comment: 'ok' } });
    const delivered = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/deliveries`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { kind: 'delivery', format: 'markdown', requestId: 'req-1' } });
    expect(delivered.statusCode).toBe(200);
    expect(delivered.json().status).toBe('delivered');
    // replay with the same request id: no duplicate row, no double state change
    const replay = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/deliveries`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { kind: 'delivery', format: 'markdown', requestId: 'req-1' } });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().deliveries.filter((d: { requestId?: string }) => d.kind === 'delivery')).toHaveLength(1);
  });

  it('answers 404 for foreign reports and engagements', async () => {
    const { app, author } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/engagements/eng-other/report-records', headers: { cookie: author.cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/r-999/review`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { action: 'submit' } })).statusCode).toBe(404);
  });
});
