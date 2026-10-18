import { describe, expect, it } from 'vitest';
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
      findUnique: async ({ where }: { where: { engagementId_userId: { engagementId: string; userId: string } } }) => find('webMembership', (r) => r.engagementId === where.engagementId_userId.engagementId && r.userId === where.engagementId_userId.userId),
      findFirst: async ({ where }: { where: { engagementId: string; userId: string } }) => find('webMembership', (r) => r.engagementId === where.engagementId && r.userId === where.userId),
      findMany: async () => [...table('webMembership').values()].map((r) => ({ ...r })),
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('m') }; table('webMembership').set(String(row.id), row); return { ...row }; },
      delete: async ({ where }: { where: { id: string } }) => { table('webMembership').delete(where.id); return {}; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => { const row: Row = { ...table('webMembership').get(where.id)!, ...data }; table('webMembership').set(where.id, row); return { ...row }; },
    },
    webAuditEntry: {
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('a') }; table('webAuditEntry').set(String(row.id), row); return { ...row }; },
    },
    // P06/P07 models: these lifecycle cases pin no snapshots, templates or acknowledgements.
    reportTemplate: {
      findMany: async () => [],
      findFirst: async ({ where }: { where: { id?: string; engagementId: string; name?: string } }) => {
        if (where.id === 'TPL-1' && where.engagementId === ENG) return { id: 'TPL-1', engagementId: ENG, name: 'Pentest', version: 1, sections: [], createdBy: 'author', createdAt: new Date() };
        const rows = [...table('reportTemplate').values()].filter((r) => r.engagementId === where.engagementId && (where.id === undefined || r.id === where.id) && (where.name === undefined || r.name === where.name));
        return rows.sort((a, b) => Number(b.version) - Number(a.version))[0] ?? null;
      },
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('tpl'), createdAt: new Date() }; table('reportTemplate').set(String(row.id), row); return { ...row }; },
    },
    reportFindingSnapshot: {
      findMany: async ({ where }: { where: { reportId: string } }) => [...table('reportFindingSnapshot').values()].filter((r) => r.reportId === where.reportId).map((r) => ({ ...r })),
      deleteMany: async ({ where }: { where: { reportId: string } }) => { for (const [key, r] of table('reportFindingSnapshot')) if (r.reportId === where.reportId) table('reportFindingSnapshot').delete(key); return { count: 0 }; },
      createMany: async ({ data }: { data: Row[] }) => { for (const row of data) { const id = seq('s'); table('reportFindingSnapshot').set(id, { ...row, id }); } return { count: data.length }; },
    },
    findingRecord: {
      findMany: async ({ where }: { where: { engagementId: string; id: { in: string[] } } }) => [...table('findingRecord').values()].filter((r) => r.engagementId === where.engagementId && where.id.in.includes(String(r.id))).map((r) => ({ ...r })),
    },
    evidenceLink: { findMany: async () => [] },
    reportRecord: {
      findFirstOrThrow: async ({ where }: { where: { id: string } }) => ({ ...table('reportRecord').get(where.id)! }),
      updateMany: async ({ where, data }: { where: { id: string; version: number; status: { in: string[] } }; data: Row }) => {
        const prev = table('reportRecord').get(where.id);
        if (prev === undefined || Number(prev.version) !== where.version || !where.status.in.includes(String(prev.status))) return { count: 0 };
        const increment = typeof data.version === 'object' && data.version !== null && 'increment' in (data.version as Record<string, unknown>) ? Number((data.version as { increment: number }).increment) : 0;
        table('reportRecord').set(where.id, { ...prev, ...data, version: Number(prev.version) + increment, updatedAt: new Date() });
        return { count: 1 };
      },
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

async function setup(): Promise<{ db: Db; app: FastifyInstance; author: { cookie: string; csrf: string }; reviewer: { cookie: string; csrf: string }; reviewerId: string }> {
  const db = memoryDb();
  const author = await db.webUser.create({ data: { username: 'author', displayName: 'Author', passwordHash: hashPassword('correct horse battery'), status: 'active' } });
  const reviewer = await db.webUser.create({ data: { username: 'rev', displayName: 'Rev', passwordHash: hashPassword('longenough1'), status: 'active' } });
  db.tables.set('engagement', new Map([[ENG, { id: ENG, userId: author.id, name: ENG, targetValue: 'https://t.invalid' }]]));
  await db.webMembership.create({ data: { engagementId: ENG, userId: reviewer.id, role: 'reviewer' } });
  db.tables.set('findingRecord', new Map([['F-1', { id: 'F-1', engagementId: ENG, title: 'Admin panel exposed', severity: 'high', status: 'confirmed', body: { detail: 'Reachable.' }, expectedVersion: 1, sourceType: 'authored', createdBy: author.id }]]));
  const app = await (buildApp({
    logger: { level: 'error' },
    authMode: 'multi',
    authDb: db as never,
    reportsService: new ReportsService(db as never),
  }) as unknown as Promise<FastifyInstance>);
  const login = async (username: string, password: string): Promise<{ cookie: string; csrf: string }> => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    expect(res.statusCode).toBe(200);
    return { cookie: `raptix_web_session=${res.cookies.find((c) => c.name === 'raptix_web_session')!.value}`, csrf: res.json().csrfToken };
  };
  return { db, app, author: await login('author', 'correct horse battery'), reviewer: await login('rev', 'longenough1'), reviewerId: String(reviewer.id) };
}

/** Puts a draft into the readiness state that submission now requires: template, period, named reviewer and one confirmed finding. */
async function makeReady(app: FastifyInstance, author: { cookie: string; csrf: string }, reviewerId: string, id: string): Promise<number> {
  const headers = { cookie: author.cookie, 'x-csrf-token': author.csrf };
  const setupRes = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/report-records/${id}/setup`, headers, payload: { expectedVersion: 1, templateId: 'TPL-1', periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-10-31T00:00:00.000Z', reviewerId } });
  expect(setupRes.statusCode).toBe(200);
  const pinned = await app.inject({ method: 'PUT', url: `/api/engagements/${ENG}/report-records/${id}/findings`, headers, payload: { expectedVersion: setupRes.json().version, findingIds: ['F-1'] } });
  expect(pinned.statusCode).toBe(200);
  expect(pinned.json().readiness.ready).toBe(true);
  return pinned.json().version;
}

describe('ticket 11 report lifecycle and delivery', () => {
  it('exports the exact report content with a capture digest instead of an engagement export', async () => {
    const { app, author } = await setup();
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { title: 'Exact reviewed content', summary: 'Only this report summary' } });
    const exported = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/report-records/${created.json().id}/export?format=markdown`, headers: { cookie: author.cookie } });
    expect(exported.statusCode).toBe(200);
    expect(exported.json().content).toContain('Only this report summary');
    expect(exported.json().digest).toMatch(/^[a-f0-9]{64}$/);
    await app.close();
  });
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

  it('seeds the template sections into an empty draft once and never overwrites them on a later template change', async () => {
    const { app, author } = await setup();
    const headers = { cookie: author.cookie, 'x-csrf-token': author.csrf };
    const first = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-templates`, headers, payload: { name: 'Seeded template', sections: [{ title: 'Findings', required: true }, { title: 'Conclusion', required: true }] } });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-templates`, headers, payload: { name: 'Other template', sections: [{ title: 'Appendix', required: false }] } });
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records`, headers, payload: { title: 'Seeded report' } });
    const id = created.json().id;
    const seeded = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/report-records/${id}/setup`, headers, payload: { expectedVersion: 1, templateId: first.json().id } });
    expect(seeded.statusCode).toBe(200);
    expect(seeded.json().body.sections).toEqual([{ title: 'Findings', content: '' }, { title: 'Conclusion', content: '' }]);
    const written = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/report-records/${id}`, headers, payload: { expectedVersion: seeded.json().version, sections: [{ title: 'Findings', content: 'Written by the author.' }, { title: 'Conclusion', content: '' }] } });
    expect(written.statusCode).toBe(200);
    const changed = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/report-records/${id}/setup`, headers, payload: { expectedVersion: written.json().version, templateId: second.json().id } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().body.sections).toEqual([{ title: 'Findings', content: 'Written by the author.' }, { title: 'Conclusion', content: '' }]);
  });

  it('enforces independent review with a mandatory comment and pins the version', async () => {
    const { app, author, reviewer, reviewerId } = await setup();
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { title: 'Reviewed report' } });
    const id = created.json().id;
    const v = await makeReady(app, author, reviewerId, id);
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/review`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { action: 'submit' } });
    const self = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/review`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { decision: 'approved', comment: 'ship it' } });
    expect(self.statusCode).toBe(403);
    expect(self.json().error.message).toContain('independent actor');
    const noComment = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/review`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'approved', comment: '   ' } });
    expect(noComment.statusCode).toBe(400);
    const approved = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/review`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'approved', comment: 'Verified against findings.', expectedVersion: v } });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe('approved');
    expect(approved.json().approvedVersion).toBe(approved.json().version);
    // Post-approval edits are refused (re-review required for changes).
    const edit = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/report-records/${id}`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { expectedVersion: v, summary: 'sneaky edit' } });
    expect(edit.statusCode).toBe(409);
    expect(edit.json().error.message).toContain('pinned review');
  });

  it('gates delivery on approval, records truthful outcomes and replays the same request id without duplicates', async () => {
    const { app, author, reviewer, reviewerId } = await setup();
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { title: 'Delivery report' } });
    const id = created.json().id;
    const v = await makeReady(app, author, reviewerId, id);
    const early = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/deliveries`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { kind: 'delivery', format: 'markdown', requestId: 'req-1' } });
        expect(early.statusCode).toBe(409);
    expect(early.json().error.message).toContain('not a reviewed deliverable');
    // export is allowed in draft, recorded honestly
    const exported = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/deliveries`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { kind: 'export', format: 'json', requestId: 'req-e1' } });
        expect(exported.statusCode).toBe(200);
    expect(exported.json().deliveries[0].status).toBe('completed');
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/review`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { action: 'submit' } });
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/review`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'approved', comment: 'ok', expectedVersion: v } });
    const missingReceipt = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/deliveries`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { kind: 'delivery', format: 'markdown', requestId: 'req-1' } });
    expect(missingReceipt.statusCode).toBe(400);
    const delivered = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/deliveries`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { kind: 'delivery', format: 'markdown', requestId: 'req-1', expectedVersion: v, recipient: 'local client', receipt: 'Signed receipt TEST-1' } });
    expect(delivered.statusCode).toBe(200);
    expect(delivered.json().status).toBe('delivered');
    // replay with the same request id AND the same payload: no duplicate row, no double state change
    const replay = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/deliveries`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { kind: 'delivery', format: 'markdown', requestId: 'req-1', expectedVersion: v, recipient: 'local client', receipt: 'Signed receipt TEST-1' } });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().deliveries.filter((d: { requestId?: string; kind?: string }) => d.kind === 'delivery')).toHaveLength(1);
  });

  it('W20: a request id replayed with a different payload is a conflict, and a revision starts fresh review', async () => {
    const { app, author, reviewer, reviewerId } = await setup();
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { title: 'Revise me' } });
    const id = created.json().id;
    const v = await makeReady(app, author, reviewerId, id);
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/review`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { action: 'submit' } });
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/review`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { decision: 'approved', comment: 'ok', expectedVersion: v } });
    const first = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/deliveries`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { kind: 'delivery', format: 'markdown', requestId: 'req-d1', expectedVersion: v, recipient: 'client', receipt: 'R-1' } });
    expect(first.statusCode).toBe(200);
    // Same request id, different payload: the recorded outcome must not mask the mismatch.
    const mismatch = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/deliveries`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { kind: 'delivery', format: 'markdown', requestId: 'req-d1', expectedVersion: v, recipient: 'client', receipt: 'R-FORGED' } });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error.message).toMatch(/different payload/i);

    // A delivered report cannot be edited in place, but a revision can start a fresh review.
    const edited = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/report-records/${id}`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { expectedVersion: v, summary: 'sneak' } });
    expect(edited.statusCode).toBe(409);
    const revision = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/${id}/revision`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { expectedVersion: v } });
    expect(revision.statusCode).toBe(200);
    expect(revision.json().id).not.toBe(id);
    expect(revision.json().status).toBe('draft');
    expect(revision.json().version).toBe(1);
    // The reviewed snapshot stays immutable; only the fresh revision re-enters review.
    const original = (await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/report-records`, headers: { cookie: author.cookie } })).json();
    const oldRow = original.reports.find((r: { id: string }) => r.id === id);
    expect(oldRow.status).toBe('delivered');
    expect(oldRow.approvedVersion).toBe(v);
  });

  it('answers 404 for foreign reports and engagements', async () => {
    const { app, author } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/engagements/eng-other/report-records', headers: { cookie: author.cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records/r-999/review`, headers: { cookie: author.cookie, 'x-csrf-token': author.csrf }, payload: { action: 'submit' } })).statusCode).toBe(404);
  });
});
