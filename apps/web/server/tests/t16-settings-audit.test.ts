import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/multi-user.js';
import { WorkspaceSettingsService } from '../src/services/workspace-settings-service.js';
import { AuditService } from '../src/services/audit-service.js';
import { C2GrantsService } from '../src/services/c2-grants-service.js';

/**
 * Ticket 16 acceptance: workspace settings are versioned, owner-authorized
 * and audited; the C2 policy key propagates to its actual consumer; the
 * audit view projects real records with truthful attribution (vault rows
 * carry no fabricated actor) and never leaks foreign engagements.
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
  const listMany = async (name: string, args: { where?: Row; orderBy?: { createdAt?: string }; take?: number }): Promise<Row[]> => {
    const rows = [...table(name).values()].filter((r) => (args.where === undefined ? true : matches(r, args.where)));
    if (args.orderBy?.createdAt === 'desc') rows.sort((a, b) => ((b.createdAt as Date).getTime() - (a.createdAt as Date).getTime()));
    return rows.slice(0, args.take ?? rows.length).map((r) => ({ ...r }));
  };
  const db = {
    tables,
    engagementClosure: { findFirst: async () => null },
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
    workspaceSetting: {
      findFirst: async ({ where }: { where: Row }) => find('workspaceSetting', (r) => matches(r, where)),
      findMany: async () => [...table('workspaceSetting').values()].map((r) => ({ ...r })),
      create: async ({ data }: { data: Row }) => { const row: Row = { updatedAt: new Date(), ...data, id: seq('ws') }; table('workspaceSetting').set(String(row.key), row); return { ...row }; },
      update: async ({ where, data }: { where: { key: string }; data: Row }) => {
        const row: Row = { ...table('workspaceSetting').get(where.key)!, ...data, updatedAt: new Date() };
        table('workspaceSetting').set(where.key, row);
        return { ...row };
      },
    },
    vaultAudit: {
      findMany: async (args: { where?: Row; orderBy?: { createdAt?: string }; take?: number }) => listMany('vaultAudit', args),
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('va'), createdAt: new Date() }; table('vaultAudit').set(String(row.id), row); return { ...row }; },
    },
    c2Grant: {
      findFirst: async ({ where }: { where: Row }) => find('c2Grant', (r) => matches(r, where)),
      findMany: async (args: { where?: Row; orderBy?: { createdAt?: string }; take?: number }) => listMany('c2Grant', args),
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('g'), createdAt: new Date() }; table('c2Grant').set(String(row.id), row); return { ...row }; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => { const row: Row = { ...table('c2Grant').get(where.id)!, ...data }; table('c2Grant').set(where.id, row); return { ...row }; },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const [id, row] of table('c2Grant')) if (matches(row, where)) { table('c2Grant').set(id, { ...row, ...data }); count += 1; }
        return { count };
      },
    },
  };
  return db;
}

type Db = ReturnType<typeof memoryDb>;

const ENG = 'eng-1';

function seed(db: Db, ownerId: string, reviewerId: string): void {
  db.tables.set('engagement', new Map([
    [ENG, { id: ENG, userId: ownerId, name: ENG, targetValue: 'https://t.invalid' }],
    ['eng-2', { id: 'eng-2', userId: 'u-stranger', name: 'eng-2', targetValue: 'https://other.invalid' }],
    ['eng-3', { id: 'eng-3', userId: 'u-stranger', name: 'eng-3', targetValue: 'https://secret.invalid' }],
  ]));
  db.tables.set('webMembership', new Map([
    ['m-1', { id: 'm-1', engagementId: 'eng-2', userId: ownerId, role: 'reviewer' }],
    ['m-2', { id: 'm-2', engagementId: ENG, userId: reviewerId, role: 'reviewer' }],
  ]));
}

interface Services { workspace: WorkspaceSettingsService; audit: AuditService; grants: C2GrantsService }

async function setup(db: Db): Promise<{ app: FastifyInstance; owner: { cookie: string; csrf: string }; reviewer: { cookie: string; csrf: string }; services: Services }> {
  const owner = await db.webUser.create({ data: { username: 'owner', displayName: 'Owner', passwordHash: hashPassword('correct horse battery'), status: 'active' } });
  const reviewer = await db.webUser.create({ data: { username: 'rev', displayName: 'Rev', passwordHash: hashPassword('longenough1'), status: 'active' } });
  seed(db, String(owner.id), String(reviewer.id));
  const workspace = new WorkspaceSettingsService(db as never, true);
  const audit = new AuditService(db as never);
  const grants = new C2GrantsService(db as never, () => workspace.maxGrantHours());
  const app = await (buildApp({
    logger: { level: 'error' },
    authMode: 'multi',
    authDb: db as never,
    workspaceSettings: workspace,
    auditService: audit,
    c2Grants: grants,
  }) as unknown as Promise<FastifyInstance>);
  const login = async (username: string, password: string): Promise<{ cookie: string; csrf: string }> => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    expect(res.statusCode).toBe(200);
    return { cookie: `raptix_web_session=${res.cookies.find((c) => c.name === 'raptix_web_session')!.value}`, csrf: res.json().csrfToken };
  };
  return { app, owner: await login('owner', 'correct horse battery'), reviewer: await login('rev', 'longenough1'), services: { workspace, audit, grants } };
}

describe('ticket 16 workspace settings, audit and C2 policy propagation', () => {
  it('refuses grant requests while the policy store cannot be read', async () => {
    const db = memoryDb();
    const { app, owner } = await setup(db);
    db.workspaceSetting.findFirst = async () => { throw new Error('policy store unavailable'); };
    const response = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/c2/grants`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { sessionId: 's', reason: 'test', expiresAt: new Date(Date.now() + 7200000).toISOString() } });
    expect(response.statusCode).toBe(503);
    await app.close();
  });
  it('W14: a readable but oversized persisted policy lowers to the enforced ceiling instead of 503', async () => {
    const db = memoryDb();
    const { app, owner } = await setup(db);
    db.tables.set('workspaceSetting', new Map([['policy.c2_grant_max_hours', { id: 'ws-1', key: 'policy.c2_grant_max_hours', value: 720, version: 2 }]]));
    const list = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/c2/grants`, headers: { cookie: owner.cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().maxGrantHours).toBe(24);
    await app.close();
  });
  it('persists versioned workspace settings with owner authorization, conflicts and audit', async () => {
    const db = memoryDb();
    const { app, owner, reviewer } = await setup(db);
    const list = await app.inject({ method: 'GET', url: '/api/workspace/settings', headers: { cookie: owner.cookie } });
    expect(list.statusCode).toBe(200);
    const initial = list.json();
    expect(initial.source).toBe('db');
    const policy = initial.settings.find((s: { key: string }) => s.key === 'policy.c2_grant_max_hours');
    expect(policy).toMatchObject({ value: 24, version: 1, consumer: 'c2-grants', updatedBy: null, updatedAt: null });
    const retention = initial.settings.find((s: { key: string }) => s.key === 'retention.audit_retention_days');
    expect(retention.consumer).toBeNull();
    expect(String(retention.enforcement)).toMatch(/no scheduled retention enforcement/i);

    const put = await app.inject({
      method: 'PUT', url: '/api/workspace/settings/policy.c2_grant_max_hours',
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      payload: { value: 2, expectedVersion: 1, reason: 'shorter grant windows for this deployment' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ key: 'policy.c2_grant_max_hours', value: 2, version: 2, updatedBy: owner.csrf ? put.json().updatedBy : null });
    expect(put.json().updatedBy).not.toBeNull();

    const conflict = await app.inject({
      method: 'PUT', url: '/api/workspace/settings/policy.c2_grant_max_hours',
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      payload: { value: 5, expectedVersion: 1, reason: 'stale write' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(String(conflict.json().error.message)).toMatch(/version 2/);
    const afterConflict = await app.inject({ method: 'GET', url: '/api/workspace/settings', headers: { cookie: owner.cookie } });
    expect(afterConflict.json().settings.find((s: { key: string }) => s.key === 'policy.c2_grant_max_hours').value).toBe(2);

    // Reviewer-only membership is not a deployment operator: refused, state unchanged.
    const denied = await app.inject({
      method: 'PUT', url: '/api/workspace/settings/policy.c2_grant_max_hours',
      headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf },
      payload: { value: 9, expectedVersion: 2, reason: 'should not happen' },
    });
    expect(denied.statusCode).toBe(403);
    const unknown = await app.inject({
      method: 'PUT', url: '/api/workspace/settings/policy.nonexistent',
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      payload: { value: 2, expectedVersion: 1, reason: 'x' },
    });
    expect(unknown.statusCode).toBe(404);
    const invalid = await app.inject({
      method: 'PUT', url: '/api/workspace/settings/policy.c2_grant_max_hours',
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      payload: { value: 0, expectedVersion: 2, reason: 'x' },
    });
    expect(invalid.statusCode).toBe(400);
    const noReason = await app.inject({
      method: 'PUT', url: '/api/workspace/settings/retention.audit_retention_days',
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      payload: { value: 90, expectedVersion: 1 },
    });
    expect(noReason.statusCode).toBe(400);

    const auditView = await app.inject({ method: 'GET', url: '/api/audit?action=workspace.', headers: { cookie: owner.cookie } });
    expect(auditView.statusCode).toBe(200);
    const entries = auditView.json().entries as { action: string; engagementId: string | null; reason: string }[];
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0]).toMatchObject({ action: 'workspace.setting_updated', engagementId: null });
    expect(entries[0]!.reason).toContain('shorter grant windows');
  });

  it('keeps the C2 grant policy registry inside the enforced 1-24h window', async () => {
    const db = memoryDb();
    const { app, owner } = await setup(db);
    const put = async (value: number, expectedVersion: number): Promise<number> =>
      (await app.inject({
        method: 'PUT', url: '/api/workspace/settings/policy.c2_grant_max_hours',
        headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
        payload: { value, expectedVersion, reason: 'range check' },
      })).statusCode;
    // W14: the registry no longer advertises a 720h window the consumer would
    // fail closed on — the enforced policy range is 1..24 hours.
    expect(await put(720, 1)).toBe(400);
    expect(await put(25, 1)).toBe(400);
    expect(await put(24, 1)).toBe(200);
    expect(await put(1, 2)).toBe(200);
    expect(await put(0, 3)).toBe(400);
  });

  it('propagates the C2 grant policy to its consumer and survives re-reads', async () => {    const db = memoryDb();
    const { app, owner } = await setup(db);
    const put = await app.inject({
      method: 'PUT', url: '/api/workspace/settings/policy.c2_grant_max_hours',
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      payload: { value: 1, expectedVersion: 1, reason: 'one-hour grants' },
    });
    expect(put.statusCode).toBe(200);
    const grants = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/c2/grants`, headers: { cookie: owner.cookie } });
    expect(grants.statusCode).toBe(200);
    expect(grants.json().maxGrantHours).toBe(1);
    const tooLong = await app.inject({
      method: 'POST', url: `/api/engagements/${ENG}/c2/grants`,
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      payload: { sessionId: 'sess-1', reason: 'ops', expiresAt: new Date(Date.now() + 2 * 3_600_000).toISOString() },
    });
    expect(tooLong.statusCode).toBe(400);
    expect(String(tooLong.json().error.message)).toMatch(/1 hours.*policy\.c2_grant_max_hours/s);
    const ok = await app.inject({
      method: 'POST', url: `/api/engagements/${ENG}/c2/grants`,
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      payload: { sessionId: 'sess-1', reason: 'ops', expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() },
    });
    expect([200, 201]).toContain(ok.statusCode);
    expect(ok.json().status).toBe('requested');
  });

  it('projects the authoritative audit with truthful sources and no foreign leakage', async () => {
    const db = memoryDb();
    const { app, owner, reviewer } = await setup(db);
    const at = (minutesAgo: number): Date => new Date(Date.now() - minutesAgo * 60_000);
    db.tables.set('webAuditEntry', new Map([
      ['a-1', { id: 'a-1', engagementId: ENG, actorId: 'u-1', action: 'scope.revision_approved', targetType: 'scope_revision', targetId: 'r1', reason: 'ok', createdAt: at(5) }],
      ['a-2', { id: 'a-2', engagementId: 'eng-3', actorId: 'u-9', action: 'scope.revision_approved', targetType: 'scope_revision', targetId: 'r9', reason: 'foreign', createdAt: at(4) }],
      ['a-3', { id: 'a-3', engagementId: null, actorId: 'u-1', action: 'workspace.setting_updated', targetType: 'workspace_setting', targetId: 'policy.c2_grant_max_hours', reason: 'v1 -> v2', createdAt: at(3) }],
      ['a-4', { id: 'a-4', engagementId: ENG, actorId: 'u-1', action: 'scope.revision_submitted', targetType: 'scope_revision', targetId: 'r2', reason: 'v2', createdAt: at(6) }],
    ]));
    db.tables.set('vaultAudit', new Map([
      ['va-1', { id: 'va-1', engagementId: ENG, secretId: 'sec-1', action: 'revealed', createdAt: at(2) }],
    ]));

    const engagement = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/audit`, headers: { cookie: owner.cookie } });
    expect(engagement.statusCode).toBe(200);
    const engView = engagement.json();
    expect(engView.source).toBe('db');
    expect(engView.engagementId).toBe(ENG);
    const actions = (engView.entries as { action: string; source: string; actorId: string | null }[]).map((e) => `${e.action}:${e.source}`);
    expect(actions).toContain('scope.revision_approved:web');
    expect(actions).toContain('vault.secret_revealed:vault');
    expect(actions).not.toContain('workspace.setting_updated:web');
    const vaultRow = (engView.entries as { action: string; actorId: string | null }[]).find((e) => e.action === 'vault.secret_revealed');
    expect(vaultRow!.actorId).toBeNull();
    const foreign = await app.inject({ method: 'GET', url: '/api/engagements/eng-3/audit', headers: { cookie: owner.cookie } });
    expect(foreign.statusCode).toBe(404);

    const workspace = await app.inject({ method: 'GET', url: '/api/audit', headers: { cookie: owner.cookie } });
    expect(workspace.statusCode).toBe(200);
    const wsActions = (workspace.json().entries as { engagementId: string | null }[]).map((e) => e.engagementId);
    expect(wsActions).toContain(null);
    expect(wsActions).toContain(ENG);
    expect(wsActions).not.toContain('eng-3');
    // Membership reviewers read the engagements they belong to, never others.
    const reviewerView = await app.inject({ method: 'GET', url: '/api/audit?actor=' + encodeURIComponent('u-9'), headers: { cookie: reviewer.cookie } });
    expect(reviewerView.statusCode).toBe(200);
    expect(reviewerView.json().entries).toHaveLength(0);

    const search = await app.inject({ method: 'GET', url: '/api/audit?q=revision&limit=1', headers: { cookie: owner.cookie } });
    expect(search.json().entries).toHaveLength(1);
    expect(search.json().total).toBe(2);
    expect(search.json().truncated).toBe(true);
  });
});
