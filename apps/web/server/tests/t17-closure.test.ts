import { describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/multi-user.js';
import { ClosureService } from '../src/services/closure-service.js';
import { AuditService } from '../src/services/audit-service.js';
import { C2GrantsService } from '../src/services/c2-grants-service.js';
import { ScopeService } from '../src/services/scope-service.js';
import { FindingsWorkflowService } from '../src/services/findings-workflow-service.js';
import { ReportsService } from '../src/services/reports-service.js';
import { VaultService } from '../src/services/vault-service.js';

/**
 * Ticket 17 acceptance: the closure checklist reads authoritative state
 * (blocked checklists refuse the request with the failing detail), the
 * confirming transition enforces an independent actor and rechecks the
 * checklist inside the transaction, closed engagements refuse mutations and
 * execution writes at the service entrypoints, and closure state persists.
 */

interface Row { [key: string]: unknown }

function matches(row: Row, where: Row): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (value !== null && typeof value === 'object') {
      if ('in' in (value as object) && Array.isArray((value as { in: unknown[] }).in)) {
        if (!(value as { in: unknown[] }).in.includes(row[key])) return false;
        continue;
      }
      if ('not' in (value as object)) {
        const not = (value as { not: unknown }).not;
        if (not === null) { if (row[key] === null) return false; continue; }
        if (typeof not === 'object' && not !== null && 'in' in (not as object) && Array.isArray((not as { in: unknown[] }).in)) {
          if ((not as { in: unknown[] }).in.includes(row[key])) return false;
          continue;
        }
        if (row[key] === not) return false;
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
  const listMany = async (name: string, args: { where?: Row; orderBy?: { createdAt?: string }; take?: number }): Promise<Row[]> => {
    const rows = [...table(name).values()].filter((r) => (args.where === undefined ? true : matches(r, args.where)));
    if (args.orderBy?.createdAt === 'desc') rows.sort((a, b) => ((b.createdAt as Date).getTime() - (a.createdAt as Date).getTime()));
    return rows.slice(0, args.take ?? rows.length).map((r) => ({ ...r }));
  };
  const listModel = (name: string) => ({
    findFirst: async ({ where }: { where: Row }) => find(name, (r) => matches(r, where)),
    findMany: async (args: { where?: Row; orderBy?: { createdAt?: string }; take?: number }) => listMany(name, args),
    count: async (args: { where: Row }) => (await listMany(name, { where: args.where })).length,
    create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq(name), createdAt: new Date(), updatedAt: new Date() }; table(name).set(String(row.id), row); return { ...row }; },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => { const row: Row = { ...table(name).get(where.id)!, ...data, updatedAt: new Date() }; table(name).set(where.id, row); return { ...row }; },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const [id, row] of table(name)) if (matches(row, where)) { table(name).set(id, { ...row, ...data }); count += 1; }
      return { count };
    },
  });
  const db = {
    tables,
    engagement: {
      findFirst: async ({ where }: { where: Row }) => find('engagement', (r) => matches(r, where)),
      findMany: async ({ where }: { where?: Row } = {}) => listMany('engagement', { where }),
    },
    webUser: {
      findUnique: async ({ where }: { where: { id?: string; username?: string } }) =>
        find('webUser', (r) => (where.id !== undefined && r.id === where.id) || (where.username !== undefined && r.username === where.username)),
      create: async ({ data }: { data: Row }) => { const row: Row = { status: 'active', ...data, id: String(data.id ?? seq('u')) }; table('webUser').set(String(row.id), row); return { ...row }; },
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
    vaultAudit: {
      findMany: async (args: { where?: Row; orderBy?: { createdAt?: string }; take?: number }) => listMany('vaultAudit', args),
    },
    webNotice: {
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('n'), createdAt: new Date() }; table('webNotice').set(String(row.id), row); return { ...row }; },
    },
    engagementClosure: listModel('engagementClosure'),
    webRequestLedger: { count: async (args: { where: Row }) => (await listMany('webRequestLedger', { where: args.where })).length },
    emergencyStop: listModel('emergencyStop'),
    c2Grant: listModel('c2Grant'),
    findingRecord: listModel('findingRecord'),
    reportRecord: listModel('reportRecord'),
    scopeRevision: listModel('scopeRevision'),
    businessPlan: listModel('businessPlan'),
    libraryReviewProposal: listModel('libraryReviewProposal'),
    operationSchedule: listModel('operationSchedule'),
  };
  (db as unknown as { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return db;
}

type Db = ReturnType<typeof memoryDb>;

const ENG = 'eng-1';

function seed(db: Db, ownerId: string, reviewerId: string): void {
  db.tables.set('engagement', new Map([
    [ENG, { id: ENG, userId: ownerId, name: ENG, targetValue: 'https://t.invalid' }],
    ['eng-2', { id: 'eng-2', userId: 'u-stranger', name: 'eng-2', targetValue: 'https://other.invalid' }],
  ]));
  db.tables.set('webMembership', new Map([
    ['m-1', { id: 'm-1', engagementId: ENG, userId: reviewerId, role: 'reviewer' }],
  ]));
}

async function setup(db: Db, pendingApprovals?: (userId: string, engagementId: string) => Promise<number>): Promise<{ app: FastifyInstance; owner: { cookie: string; csrf: string }; reviewer: { cookie: string; csrf: string } }> {
  const owner = await db.webUser.create({ data: { username: 'owner', displayName: 'Owner', passwordHash: hashPassword('correct horse battery'), status: 'active' } });
  const reviewer = await db.webUser.create({ data: { username: 'rev', displayName: 'Rev', passwordHash: hashPassword('longenough1'), status: 'active' } });
  seed(db, String(owner.id), String(reviewer.id));
  const closure = new ClosureService(db as never, pendingApprovals, { sessions: async () => 0, runtime: async () => 0 });
  const app = await (buildApp({
    logger: { level: 'error' },
    authMode: 'multi',
    authDb: db as never,
    closureService: closure,
    // Real owning services so the post-close refusals exercise their actual entrypoints.
    c2Grants: new C2GrantsService(db as never),
    scopeService: new ScopeService(db as never),
    findingsWorkflow: new FindingsWorkflowService(db as never),
    reportsService: new ReportsService(db as never),
    vaultService: new VaultService(db as never, null),
    auditService: new AuditService(db as never),
  }) as unknown as Promise<FastifyInstance>);
  const login = async (username: string, password: string): Promise<{ cookie: string; csrf: string }> => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    expect(res.statusCode).toBe(200);
    return { cookie: `raptix_web_session=${res.cookies.find((c) => c.name === 'raptix_web_session')!.value}`, csrf: res.json().csrfToken };
  };
  return { app, owner: await login('owner', 'correct horse battery'), reviewer: await login('rev', 'longenough1') };
}

const requestClosure = (app: FastifyInstance, actor: { cookie: string; csrf: string }, reason = 'work completed'): Promise<LightMyRequestResponse> =>
  app.inject({ method: 'POST', url: `/api/engagements/${ENG}/closure/request`, headers: { cookie: actor.cookie, 'x-csrf-token': actor.csrf }, payload: { reason } });

const decideClosure = (app: FastifyInstance, actor: { cookie: string; csrf: string }, decision: string): Promise<LightMyRequestResponse> =>
  app.inject({ method: 'POST', url: `/api/engagements/${ENG}/closure/decision`, headers: { cookie: actor.cookie, 'x-csrf-token': actor.csrf }, payload: { decision } });

describe('ticket 17 engagement closure', () => {
  it('refuses the request while the authoritative checklist is blocked, naming the failing sources', async () => {
    const db = memoryDb();
    const { app, owner } = await setup(db, async () => 0);
    db.tables.set('c2Grant', new Map([['g1', { id: 'g1', engagementId: ENG, sessionId: 'sess-1', actorId: 'u-1', status: 'approved', expiresAt: new Date(Date.now() + 3_600_000) }]]));
    db.tables.set('findingRecord', new Map([['f1', { id: 'f1', engagementId: ENG, status: 'review' }]]));
    db.tables.set('reportRecord', new Map([['r1', { id: 'r1', engagementId: ENG, status: 'draft' }]]));
    db.tables.set('emergencyStop', new Map([['s1', { id: 's1', engagementId: ENG, outcome: 'requested' }]]));
    const res = await requestClosure(app, owner);
    expect(res.statusCode).toBe(409);
    const message = String((res.json() as { error: { message: string } }).error.message);
    // The refusal names the blocked authoritative sources; settled ones are absent.
    expect(message).toContain('estop (fail');
    expect(message).toContain('c2 (fail');
    expect(message).toContain('findings (fail');
    expect(message).toContain('reports (fail');
    expect(message).not.toContain('runtime (fail');
    expect(db.tables.get('engagementClosure')?.size ?? 0).toBe(0);

    // An unreadable approvals source is an explicit blocker, never a pass.
    const db2 = memoryDb();
    const failing = await setup(db2, async () => { throw new Error('approvals down'); });
    const res2 = await requestClosure(failing.app, failing.owner);
    expect(res2.statusCode).toBe(409);
    expect(String((res2.json() as { error: { message: string } }).error.message)).toContain('approvals (unavailable');
    // And without an approval service wired at all.
    const db3 = memoryDb();
    const none = await setup(db3, undefined);
    const res3 = await requestClosure(none.app, none.owner);
    expect(res3.statusCode).toBe(409);
    expect(String((res3.json() as { error: { message: string } }).error.message)).toContain('approvals (unavailable');
  });

  it('W06: pending library reviews, scheduled intents and a stopped latch block closure', async () => {
    const db = memoryDb();
    const { app, owner } = await setup(db, async () => 0);
    db.tables.set('libraryReviewProposal', new Map([['p1', { id: 'p1', engagementId: ENG, status: 'proposed' }]]));
    db.tables.set('operationSchedule', new Map([['sc1', { id: 'sc1', engagementId: ENG, status: 'scheduled' }]]));
    db.tables.set('emergencyStop', new Map([['s1', { id: 's1', engagementId: ENG, outcome: 'stopped' }]]));
    const res = await requestClosure(app, owner);
    expect(res.statusCode).toBe(409);
    const message = String((res.json() as { error: { message: string } }).error.message);
    expect(message).toContain('estop (fail');
    expect(message).toContain('library-reviews (fail');
    expect(message).toContain('scheduled-intents (fail');
    await app.close();
  });

  it('persists request -> independent confirm with an atomic recheck, and retains state across refresh', async () => {
    const db = memoryDb();
    const { app, owner, reviewer } = await setup(db, async () => 0);
    const requested = await requestClosure(app, owner);
    expect(requested.statusCode).toBe(200);
    expect((requested.json() as { status: string }).status).toBe('requested');
    expect((requested.json() as { checklist: { ok: boolean } }).checklist.ok).toBe(true);

    // A run appears after the request: the confirm-time recheck refuses it.
    db.tables.set('webRequestLedger', new Map([['q1', { id: 'q1', engagementId: ENG, activeThreadId: 't1', operation: 'create_run' }]]));
    const stale = await decideClosure(app, reviewer, 'confirmed');
    expect(stale.statusCode).toBe(409);
    expect(String((stale.json() as { error: { message: string } }).error.message)).toContain('no longer satisfied');
    db.tables.set('webRequestLedger', new Map());

    // The requester cannot confirm their own request.
    const self = await decideClosure(app, owner, 'confirmed');
    expect(self.statusCode).toBe(403);
    expect(String((self.json() as { error: { message: string } }).error.message)).toMatch(/independent/i);

    const confirmed = await decideClosure(app, reviewer, 'confirmed');
    expect(confirmed.statusCode).toBe(200);
    const view = confirmed.json() as { status: string; decidedBy: string; readOnly?: boolean };
    expect(view.status).toBe('closed');
    expect(view.decidedBy).not.toBeNull();

    // Refresh reads the authoritative closed state and the decision history.
    const again = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/closure`, headers: { cookie: owner.cookie } });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { closure: { status: string } | null }).closure?.status).toBe('closed');
    expect((again.json() as { readOnly: boolean }).readOnly).toBe(true);

    // The closed engagement refuses a second request.
    const second = await requestClosure(app, owner, 'again');
    expect(second.statusCode).toBe(409);
    const audits = await app.inject({ method: 'GET', url: `/api/audit?action=closure.`, headers: { cookie: owner.cookie } });
    const actions = (audits.json() as { entries: { action: string }[] }).entries.map((e) => e.action);
    expect(actions).toContain('closure.requested');
    expect(actions).toContain('closure.confirmed');
  });

  it('enforces closed read-only semantics at the mutation/execution entrypoints; cancel reopens the request cycle', async () => {
    const db = memoryDb();
    const { app, owner, reviewer } = await setup(db, async () => 0);
    await requestClosure(app, owner);
    // The requester cancels; a fresh request is then possible.
    const cancelled = await decideClosure(app, owner, 'cancelled');
    expect(cancelled.statusCode).toBe(200);
    expect((cancelled.json() as { status: string }).status).toBe('cancelled');
    const reRequested = await requestClosure(app, owner, 'still want to close');
    expect(reRequested.statusCode).toBe(200);

    // A reviewer rejects: the request is refused, the engagement stays open.
    const rejected = await decideClosure(app, reviewer, 'rejected');
    expect(rejected.statusCode).toBe(200);
    expect((rejected.json() as { status: string }).status).toBe('rejected');
    await requestClosure(app, owner, 'final');
    await decideClosure(app, reviewer, 'confirmed');

    // Post-close: a representative mutation from each owning surface refuses.
    const grant = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/c2/grants`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { sessionId: 's', reason: 'x', expiresAt: new Date(Date.now() + 60_000).toISOString() } });
    expect(grant.statusCode).toBe(409);
    expect(String((grant.json() as { error: { message: string } }).error.message)).toMatch(/closed and read-only/);
    const scope = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/scope/revisions`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { diff: { added: [], removed: [], rationale: 'x' }, roe: { windows: [], emergencyContacts: [], restrictions: [] } } });
    expect(scope.statusCode).toBe(409);
    const finding = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { title: 't', severity: 'low', detail: 'd' } });
    expect(finding.statusCode).toBe(409);
    const report = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/report-records`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { title: 't', summary: 's' } });
    expect(report.statusCode).toBe(409);
    const vault = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/vault/secrets`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { kind: 'k', label: 'l', plaintext: 'p' } });
    expect(vault.statusCode).toBe(409);
    // Reads keep working on the closed engagement.
    const closureRead = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/closure`, headers: { cookie: reviewer.cookie } });
    expect(closureRead.statusCode).toBe(200);
    expect((closureRead.json() as { readOnly: boolean }).readOnly).toBe(true);
  });
});
