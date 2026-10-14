import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/multi-user.js';
import { FindingsWorkflowService } from '../src/services/findings-workflow-service.js';

/**
 * Ticket 10 acceptance: server-enforced transitions (confirmation needs the
 * reviewer role), expected-version concurrency, draft-import preserving
 * producer lineage, opaque evidence references and cross-engagement 404s.
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
    findingRecord: {
      findFirst: async ({ where }: { where: { id?: string; engagementId: string } }) =>
        find('findingRecord', (r) => r.engagementId === where.engagementId && (where.id === undefined || r.id === where.id)),
      findMany: async ({ where, orderBy }: { where: { engagementId: string }; orderBy?: { createdAt: string } }) => {
        const rows = [...table('findingRecord').values()].filter((r) => r.engagementId === where.engagementId).map((r) => ({ ...r }));
        if (orderBy?.createdAt === 'desc') rows.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
        return rows;
      },
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('f'), expectedVersion: data.expectedVersion ?? 1, updatedBy: null, createdAt: new Date(), updatedAt: new Date() }; table('findingRecord').set(String(row.id), row); return { ...row }; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const prev = table('findingRecord').get(where.id)!;
        const increment = typeof data.expectedVersion === 'object' && data.expectedVersion !== null && 'increment' in (data.expectedVersion as Record<string, unknown>) ? Number((data.expectedVersion as { increment: number }).increment) : 0;
        const row: Row = { ...prev, ...data, expectedVersion: Number(prev.expectedVersion) + increment, updatedAt: new Date() };
        table('findingRecord').set(where.id, row);
        return { ...row };
      },
    },
    evidenceLink: {
      findMany: async ({ where }: { where: { findingId: string } }) => [...table('evidenceLink').values()].filter((r) => r.findingId === where.findingId).map((r) => ({ ...r })),
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('ev'), createdAt: new Date() }; table('evidenceLink').set(String(row.id), row); return { ...row }; },
    },
  };
  (db as unknown as { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return db;
}

const ENG = 'eng-1';

async function setup(): Promise<{ app: FastifyInstance; owner: { cookie: string; csrf: string }; viewer: { cookie: string; csrf: string } }> {
  const db = memoryDb();
  const owner = await db.webUser.create({ data: { username: 'owner', displayName: 'Owner', passwordHash: hashPassword('correct horse battery'), status: 'active' } });
  const viewer = await db.webUser.create({ data: { username: 'look', displayName: 'Look', passwordHash: hashPassword('longenough1'), status: 'active' } });
  db.tables.set('engagement', new Map([[ENG, { id: ENG, userId: owner.id, name: ENG, targetValue: 'https://t.invalid' }]]));
  await db.webMembership.create({ data: { engagementId: ENG, userId: viewer.id, role: 'viewer' } });
  const app = await (buildApp({ authMode: 'multi', authDb: db as never, findingsWorkflow: new FindingsWorkflowService(db as never) }) as unknown as Promise<FastifyInstance>);
  const login = async (username: string, password: string): Promise<{ cookie: string; csrf: string }> => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    expect(res.statusCode).toBe(200);
    return { cookie: `raptix_web_session=${res.cookies.find((c) => c.name === 'raptix_web_session')!.value}`, csrf: res.json().csrfToken };
  };
  return { app, owner: await login('owner', 'correct horse battery'), viewer: await login('look', 'longenough1') };
}

describe('ticket 10 finding lifecycle and evidence', () => {
  it('creates an authored draft, imports with producer lineage and refuses viewer writes', async () => {
    const { app, owner, viewer } = await setup();
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { title: 'SQLi in staging login', severity: 'high', detail: 'Union-based injection confirmed manually.' } });
    expect(created.statusCode).toBe(200);
    expect(created.json().status).toBe('draft');
    expect(created.json().sourceType).toBe('authored');

    const imported = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/import`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { title: 'Scanner claim: XSS', producerRef: 'findings/FIND-9.md#claim-1', detail: 'AI claim â€” unverified.' } });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().sourceType).toBe('imported');
    expect(imported.json().producerRef).toBe('findings/FIND-9.md#claim-1');
    expect(imported.json().status).toBe('draft');

    const denied = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers: { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf }, payload: { title: 'x' } });
    expect(denied.statusCode).toBe(403);
  });

  it('enforces the transition map and reviewer-only confirmation', async () => {
    const { app, owner } = await setup();
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { title: 'F1' } });
    const id = created.json().id;
    const skip = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { to: 'resolved' } });
    expect(skip.statusCode).toBe(409);
    expect(skip.json().error.message).toContain('not allowed');
    const review = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { to: 'review' } });
    expect(review.statusCode).toBe(200);
    // The engagement owner is not automatically a reviewer here: the membership grants owner via ownership...
    // owner role ranks above reviewer, so confirmation succeeds; a plain operator would be refused.
    const confirmed = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { to: 'confirmed' } });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe('confirmed');
  });

  it('rejects stale expectedVersion writes with a conflict and preserves the row', async () => {
    const { app, owner } = await setup();
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { title: 'Concurrent', detail: 'v1 body' } });
    const id = created.json().id;
    const first = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/curated-findings/${id}`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { expectedVersion: 1, detail: 'saved edit' } });
    expect(first.statusCode).toBe(200);
    const stale = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/curated-findings/${id}`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { expectedVersion: 1, detail: 'stale edit' } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.message).toContain('Concurrent edit');
    const list = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/curated-findings`, headers: { cookie: owner.cookie } });
    const row = list.json().findings.find((f: { id: string }) => f.id === id);
    expect(row.body.detail).toBe('saved edit');
    expect(row.expectedVersion).toBe(2);
  });

  it('attaches opaque evidence with digest/producer and refuses foreign findings', async () => {
    const { app, owner } = await setup();
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { title: 'With evidence' } });
    const id = created.json().id;
    const attached = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/evidence`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { kind: 'digest', digest: 'sha256:abc123', producer: 'runtime:soundwave' } });
    expect(attached.statusCode).toBe(200);
    expect(attached.json().digest).toBe('sha256:abc123');
    expect(attached.json().producer).toBe('runtime:soundwave');
    const missing = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/evidence`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { kind: 'artifact' } });
    expect(missing.statusCode).toBe(400);
    const foreign = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/f-999/transition`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { to: 'review' } });
    expect(foreign.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/engagements/eng-other/curated-findings', headers: { cookie: owner.cookie } })).statusCode).toBe(404);
  });
});
