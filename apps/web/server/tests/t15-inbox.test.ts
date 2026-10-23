import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/multi-user.js';
import { InboxService, createNotice } from '../src/services/inbox-service.js';
import { ProjectApiError } from '../src/services/projects-service.js';

/**
 * Ticket 15 acceptance: readiness consumes the governance preflight (no
 * re-decision), completion/activity are observed counts only, the task inbox
 * aggregates only authorized engagements, and notices persist per-actor
 * read/dismiss state with foreign notices 404ing.
 */

interface Row { [key: string]: unknown }

function matches(row: Row, where: Row): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (value !== null && typeof value === 'object') {
      if ('in' in (value as object) && Array.isArray((value as { in: unknown[] }).in)) {
        if (!(value as { in: unknown[] }).in.includes(row[key])) return false;
        continue;
      }
      return false;
    }
    if (row[key] !== value) return false;
  }
  return true;
}

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
  const selectMany = async (name: string, pred: (row: Row) => boolean): Promise<Row[]> => [...table(name).values()].filter(pred).map((r) => ({ ...r }));
  const listMany = async (name: string, args: { where?: Row; orderBy?: { createdAt?: string }; take?: number }): Promise<Row[]> => {
    const rows = [...table(name).values()].filter((r) => (args.where === undefined ? true : matches(r, args.where)));
    if (args.orderBy?.createdAt === 'desc') rows.sort((a, b) => ((b.createdAt as Date).getTime() - (a.createdAt as Date).getTime()));
    return rows.slice(0, args.take ?? rows.length).map((r) => ({ ...r }));
  };
  const listModel = (name: string) => ({
    findMany: async (args: { where?: Row; orderBy?: { createdAt?: string }; take?: number }) => listMany(name, args),
    count: async (args: { where?: Row }) => (await listMany(name, { where: args.where })).length,
  });
  const db = {
    tables,
    engagement: {
      findFirst: async ({ where }: { where: Row }) => find('engagement', (r) => matches(r, where)),
      findMany: async ({ where, select }: { where: Row; select?: unknown }) => {
        if (where.id !== undefined && typeof where.id === 'object') {
          const ids = (where.id as { in: string[] }).in;
          return (await selectMany('engagement', (r) => ids.includes(String(r.id)))).map((r) => select !== undefined ? { id: r.id, name: r.name } : r);
        }
        return (await selectMany('engagement', (r) => matches(r, where))).map((r) => select !== undefined ? { id: r.id, name: r.name } : r);
      },
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
      findFirst: async ({ where }: { where: Row }) => find('webMembership', (r) => matches(r, where)),
      findMany: async ({ where }: { where?: Row } = {}) => listMany('webMembership', { where }),
    },
    webAuditEntry: {
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('a'), createdAt: new Date() }; table('webAuditEntry').set(String(row.id), row); return { ...row }; },
      findMany: async (args: { where?: Row; orderBy?: { createdAt?: string }; take?: number }) => listMany('webAuditEntry', args),
    },
    webNotice: {
      findFirst: async ({ where }: { where: Row }) => find('webNotice', (r) => matches(r, where)),
      findMany: async (args: { where?: Row; orderBy?: { createdAt?: string }; take?: number }) => listMany('webNotice', args),
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('n'), readAt: null, dismissedAt: null, createdAt: new Date() }; table('webNotice').set(String(row.id), row); return { ...row }; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => { const row: Row = { ...table('webNotice').get(where.id)!, ...data }; table('webNotice').set(where.id, row); return { ...row }; },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const [id, row] of table('webNotice')) if (matches(row, where)) { table('webNotice').set(id, { ...row, ...data }); count += 1; }
        return { count };
      },
    },
    findingRecord: listModel('findingRecord'),
    reportRecord: listModel('reportRecord'),
    emergencyStop: listModel('emergencyStop'),
    scopeRevision: listModel('scopeRevision'),
    businessPlan: listModel('businessPlan'),
    c2Grant: listModel('c2Grant'),
    c2Command: listModel('c2Command'),
    operationBinding: listModel('operationBinding'),
  };
  (db as unknown as { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return db;
}

type Db = ReturnType<typeof memoryDb>;

const ENG = 'eng-1';

const at = (minutesAgo: number): Date => new Date(Date.now() - minutesAgo * 60_000);

function seed(db: Db, owner: Row, reviewer: Row): void {
  db.tables.set('engagement', new Map([
    [ENG, { id: ENG, userId: owner.id, name: ENG, targetValue: 'https://t.invalid' }],
    ['eng-2', { id: 'eng-2', userId: reviewer.id, name: 'eng-2', targetValue: 'https://other.invalid' }],
    ['eng-3', { id: 'eng-3', userId: 'u-stranger', name: 'eng-3', targetValue: 'https://secret.invalid' }],
  ]));
  db.tables.set('webMembership', new Map([
    ['m-1', { id: 'm-1', engagementId: 'eng-2', userId: owner.id, role: 'reviewer' }],
  ]));
}

async function setup(db: Db, inbox: InboxService): Promise<{ app: FastifyInstance; owner: { cookie: string; csrf: string }; reviewer: { cookie: string; csrf: string } }> {
  const owner = await db.webUser.create({ data: { username: 'owner', displayName: 'Owner', passwordHash: hashPassword('correct horse battery'), status: 'active' } });
  const reviewer = await db.webUser.create({ data: { username: 'rev', displayName: 'Rev', passwordHash: hashPassword('longenough1'), status: 'active' } });
  seed(db, owner, reviewer);
  const app = await (buildApp({
    logger: { level: 'error' },
    authMode: 'multi',
    authDb: db as never,
    inboxService: inbox,
  }) as unknown as Promise<FastifyInstance>);
  const login = async (username: string, password: string): Promise<{ cookie: string; csrf: string }> => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    expect(res.statusCode).toBe(200);
    return { cookie: `raptix_web_session=${res.cookies.find((c) => c.name === 'raptix_web_session')!.value}`, csrf: res.json().csrfToken };
  };
  return { app, owner: await login('owner', 'correct horse battery'), reviewer: await login('rev', 'longenough1') };
}

const preflightStub = (ok: boolean, failed: { id: string; detail: string | null }[]): never =>
  ({ preflight: async () => ({ engagementId: ENG, ok, checks: failed.map((f) => ({ ...f, state: 'fail' })), source: 'db' }) }) as never;

describe('ticket 15 command center, tasks and notices', () => {
  it('consumes the governance preflight for readiness and reports observed completion counts', async () => {
    const db = memoryDb();
    const inbox = new InboxService(db as never, preflightStub(false, [{ id: 'roe', detail: 'No approved scope revision.' }]));
    const { app, owner } = await setup(db, inbox);
    db.tables.set('findingRecord', new Map([['f1', { id: 'f1', engagementId: ENG, status: 'confirmed', createdAt: at(9) }]]));
    db.tables.set('emergencyStop', new Map([['s1', { id: 's1', engagementId: ENG, outcome: 'requested', createdAt: at(4) }]]));
    await db.webAuditEntry.create({ data: { engagementId: ENG, actorId: 'u-1', action: 'scope.revision_approved', targetType: 'scope_revision', targetId: 'r1', reason: 'ok', createdAt: at(2) } });
    const res = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/overview`, headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(200);
    const view = res.json();
    expect(view.readiness).toEqual({ state: 'available', ok: false, failed: [{ id: 'roe', detail: 'No approved scope revision.' }], reason: null });
    expect(view.completion).toEqual({ findingsConfirmed: 1, reportsDelivered: 0, activeStops: 1 });
    expect(view.activity).toHaveLength(1);
    expect(view.activity[0]).toMatchObject({ action: 'scope.revision_approved', actorId: 'u-1' });
    expect(view.source).toBe('db');
    const foreign = await app.inject({ method: 'GET', url: '/api/engagements/eng-3/overview', headers: { cookie: owner.cookie } });
    expect(foreign.statusCode).toBe(404);
  });

  it('renders readiness as explicitly unavailable without a governance service or for viewers', async () => {
    const db = memoryDb();
    const inbox = new InboxService(db as never, null);
    const { app, owner } = await setup(db, inbox);
    const res = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/overview`, headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().readiness).toMatchObject({ state: 'unavailable', ok: null });
    // A non-operator member gets the preflight refusal surfaced, not a fake pass.
    const refusing = { preflight: async () => { throw new ProjectApiError(403, 'This action requires the operator role; the persisted membership grants viewer.'); } } as never;
    const viewer = new InboxService(db as never, refusing);
    const app2 = await (buildApp({ logger: { level: 'error' }, authMode: 'multi', authDb: db as never, inboxService: viewer }) as unknown as Promise<FastifyInstance>);
    const login = await app2.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'rev', password: 'longenough1' } });
    const rev = { cookie: `raptix_web_session=${login.cookies.find((c) => c.name === 'raptix_web_session')!.value}` };
    db.tables.set('webMembership', new Map([['m-1', { id: 'm-1', engagementId: ENG, userId: 'u-2', role: 'viewer' }]]));
    const res2 = await app2.inject({ method: 'GET', url: `/api/engagements/${ENG}/overview`, headers: { cookie: rev.cookie } });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().readiness.state).toBe('unavailable');
    expect(String(res2.json().readiness.reason)).toMatch(/role/i);
  });

  it('aggregates tasks only from authorized engagements with distinct kinds and deep links', async () => {
    const db = memoryDb();
    const inbox = new InboxService(db as never, preflightStub(true, []));
    const { app, owner } = await setup(db, inbox);
    db.tables.set('scopeRevision', new Map([['r1', { id: 'r1', engagementId: ENG, status: 'pending', version: 3, requestedBy: 'u-1', createdAt: at(30) }]]));
    db.tables.set('c2Grant', new Map([['g1', { id: 'g1', engagementId: 'eng-2', status: 'requested', sessionId: 'sess-9', actorId: 'u-2', createdAt: at(20) }]]));
    db.tables.set('businessPlan', new Map([
      ['p0', { id: 'p0', engagementId: ENG, status: 'proposed', version: 2, body: { objective: 'Phase 1 objective' }, requestedBy: 'u-1', createdAt: at(15) }],
      ['p1', { id: 'p1', engagementId: 'eng-3', status: 'proposed', version: 1, body: { objective: 'Other' }, requestedBy: 'u-9', createdAt: at(10) }],
    ]));
    const res = await app.inject({ method: 'GET', url: '/api/tasks', headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(200);
    const view = res.json();
    const kinds = view.tasks.map((t: { kind: string }) => t.kind);
    expect(kinds).toContain('scope-revision');
    expect(kinds).toContain('c2-grant');
    expect(kinds).toContain('business-plan');
    // eng-3 is not owned and has no membership for the owner: excluded.
    expect(view.tasks.filter((t: { kind: string }) => t.kind === 'business-plan')).toHaveLength(1);
    const grant = view.tasks.find((t: { refId: string }) => t.refId === 'g1');
    expect(grant).toMatchObject({ kind: 'c2-grant', engagementId: 'eng-2', engagementName: 'eng-2', awaitingActor: false, href: '#/project/eng-2?tab=c2' });
    const revision = view.tasks.find((t: { refId: string }) => t.refId === 'r1');
    expect(revision).toMatchObject({ awaitingActor: true, href: '#/project/eng-1?tab=scope' });
    const planTask = view.tasks.find((t: { refId: string }) => t.refId === 'p0');
    expect(planTask).toMatchObject({ kind: 'business-plan', href: '#/project/eng-1?tab=governance', title: expect.stringContaining('Phase 1 objective') });
    expect(view.source).toBe('db');
  });

  it('persists per-actor notice read/dismiss state; foreign notices 404; best-effort creation never breaks decisions', async () => {
    const db = memoryDb();
    const inbox = new InboxService(db as never, preflightStub(true, []));
    const { app, owner, reviewer } = await setup(db, inbox);
    await createNotice(db as never, { engagementId: ENG, actorId: 'u-1', kind: 'scope.revision_decided', title: 'Scope revision v3 was approved', detail: { revisionId: 'r1' } });
    await createNotice(db as never, { engagementId: 'eng-2', actorId: 'u-2', kind: 'c2.grant_decided', title: 'C2 grant decided' });
    // Best-effort: a db without the webNotice table must not throw.
    await createNotice({} as never, { engagementId: ENG, actorId: 'u-1', kind: 'x', title: 'y' });
    const list = await app.inject({ method: 'GET', url: '/api/notices', headers: { cookie: owner.cookie } });
    expect(list.statusCode).toBe(200);
    const view = list.json();
    expect(view.notices).toHaveLength(1);
    expect(view.unread).toBe(1);
    const noticeId = view.notices[0].id;
    const foreign = await app.inject({ method: 'POST', url: `/api/notices/n-999/read`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf } });
    expect(foreign.statusCode).toBe(404);
    const others = await app.inject({ method: 'GET', url: '/api/notices', headers: { cookie: reviewer.cookie } });
    expect(others.json().notices).toHaveLength(1);
    expect(others.json().notices[0].kind).toBe('c2.grant_decided');
    const read = await app.inject({ method: 'POST', url: `/api/notices/${noticeId}/read`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf } });
    expect(read.statusCode).toBe(200);
    expect(read.json().readAt).not.toBeNull();
    const afterRead = await app.inject({ method: 'GET', url: '/api/notices', headers: { cookie: owner.cookie } });
    expect(afterRead.json().unread).toBe(0);
    const dismiss = await app.inject({ method: 'POST', url: `/api/notices/${noticeId}/dismiss`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf } });
    expect(dismiss.statusCode).toBe(200);
    expect(dismiss.json().dismissedAt).not.toBeNull();
    const afterDismiss = await app.inject({ method: 'GET', url: '/api/notices', headers: { cookie: owner.cookie } });
    expect(afterDismiss.json().notices).toHaveLength(0);
    await createNotice(db as never, { engagementId: ENG, actorId: 'u-1', kind: 'plan.decided', title: 'Plan decided' });
    const readAll = await app.inject({ method: 'POST', url: '/api/notices/read-all', headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf } });
    expect(readAll.json().updated).toBe(1);
    const final = await app.inject({ method: 'GET', url: '/api/notices', headers: { cookie: owner.cookie } });
    expect(final.json().unread).toBe(0);
  });

  it('summarizes findings and durable C2 activity per authorized engagements only', async () => {
    const db = memoryDb();
    const inbox = new InboxService(db as never, preflightStub(true, []));
    const { app, owner } = await setup(db, inbox);
    db.tables.set('findingRecord', new Map([
      ['f1', { id: 'f1', engagementId: ENG, severity: 'high', status: 'confirmed', createdAt: at(9) }],
      ['f2', { id: 'f2', engagementId: ENG, severity: 'critical', status: 'review', createdAt: at(8) }],
      ['f3', { id: 'f3', engagementId: 'eng-2', severity: 'high', status: 'confirmed', createdAt: at(7) }],
      ['f4', { id: 'f4', engagementId: 'eng-3', severity: 'critical', status: 'draft', createdAt: at(6) }],
    ]));
    db.tables.set('c2Command', new Map([
      ['c1', { id: 'c1', engagementId: ENG, sessionId: 'sess-1', status: 'succeeded', createdAt: at(5) }],
      ['c2', { id: 'c2', engagementId: 'eng-3', sessionId: 'sess-x', status: 'failed', createdAt: at(4) }],
    ]));
    db.tables.set('c2Grant', new Map([['g1', { id: 'g1', engagementId: 'eng-2', status: 'requested', sessionId: 'sess-9', createdAt: at(3) }]]));

    const unauthorized = await app.inject({ method: 'GET', url: '/api/overview/findings' });
    expect(unauthorized.statusCode).toBe(401);

    // Owner owns eng-1 and holds a membership on eng-2; eng-3 must stay invisible.
    const findings = (await app.inject({ method: 'GET', url: '/api/overview/findings', headers: { cookie: owner.cookie } })).json();
    expect(findings).toMatchObject({ total: 3, engagementsWithFindings: 2, engagements: 2, truncated: false, source: 'db' });
    expect(findings.bySeverity).toEqual({ high: 2, critical: 1 });
    expect(findings.byStatus).toEqual({ confirmed: 2, review: 1 });
    // Every visible finding is unresolved; the newest visible one is f3 (seven minutes ago).
    expect(findings.unresolvedBySeverity).toEqual({ high: 2, critical: 1 });
    expect(new Date(findings.latestCreatedAt).getTime()).toBeGreaterThan(at(8).getTime());

    const c2 = (await app.inject({ method: 'GET', url: '/api/overview/c2', headers: { cookie: owner.cookie } })).json();
    expect(c2.commandsByStatus).toEqual({ creating: 0, succeeded: 1, failed: 0, uncertain: 0 });
    expect(c2.recentCommands).toHaveLength(1);
    expect(c2.recentCommands[0]).toMatchObject({ id: 'c1', engagementId: ENG, sessionId: 'sess-1', status: 'succeeded' });
    expect(c2.pendingGrants).toBe(1);
    expect(c2.source).toBe('db');
  });

  it('summarizes operation bindings of authorized engagements only, newest first, with names and threads', async () => {
    const db = memoryDb();
    const inbox = new InboxService(db as never, preflightStub(true, []));
    const { app, owner } = await setup(db, inbox);
    db.tables.set('operationBinding', new Map([
      ['b1', { id: 'b1', engagementId: ENG, planId: 'p1', threadId: 'thread-1', status: 'running', createdAt: at(1), updatedAt: at(1) }],
      ['b2', { id: 'b2', engagementId: ENG, planId: 'p2', threadId: null, status: 'bound', createdAt: at(2), updatedAt: at(2) }],
      ['b3', { id: 'b3', engagementId: 'eng-2', planId: 'p3', threadId: 'thread-3', status: 'stopped', createdAt: at(3), updatedAt: at(3) }],
      ['b4', { id: 'b4', engagementId: 'eng-3', planId: 'p4', threadId: 'thread-4', status: 'running', createdAt: at(4), updatedAt: at(4) }],
    ]));

    const unauthorized = await app.inject({ method: 'GET', url: '/api/overview/operations' });
    expect(unauthorized.statusCode).toBe(401);

    // eng-3 belongs to nobody the owner can see, so its running binding must not count.
    const view = (await app.inject({ method: 'GET', url: '/api/overview/operations', headers: { cookie: owner.cookie } })).json();
    expect(view.counts).toEqual({ bound: 1, running: 1, stopped: 1, completed: 0 });
    expect(view.recent.map((item: { id: string }) => item.id)).toEqual(['b1', 'b2', 'b3']);
    expect(view.recent[0]).toMatchObject({ id: 'b1', engagementId: ENG, threadId: 'thread-1', status: 'running' });
    expect(view.recent[1].threadId).toBeNull();
    expect(view.engagements).toBe(2);
    expect(view.truncated).toBe(false);
    expect(view.source).toBe('db');
  });
});
