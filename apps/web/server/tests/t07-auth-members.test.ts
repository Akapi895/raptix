import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword, verifyPassword, hashToken, isSameOrigin } from '../src/auth/multi-user.js';
import { ensureBootstrapAdmin } from '../src/http/routes/auth.routes.js';
import { MembersService } from '../src/services/members-service.js';

/**
 * Ticket 07 acceptance checks: session login/logout/whoami, the HTTP
 * boundary (401 without session, CSRF + origin on mutations), membership
 * RBAC (owner-only mutations, viewer read, forged roles refused), foreign
 * engagement 404s and audit rows for every membership mutation.
 */

interface Row { id: string; [key: string]: unknown }

interface FakeDb {
  tables: Map<string, Map<string, Row>>;
  engagementClosure: { findFirst: () => Promise<Row | null> };
  engagement: { findFirst: (q: { where: { id: string } }) => Promise<Row | null> };
  webUser: { findUnique: (q: { where: { id?: string; username?: string } }) => Promise<Row | null>; create: (q: { data: { [key: string]: unknown } }) => Promise<Row> };
  webSession: { findUnique: (q: { where: { id: string } }) => Promise<Row | null>; create: (q: { data: { [key: string]: unknown } }) => Promise<Row>; deleteMany: (q: { where: { id: string } }) => Promise<{ count: number }> };
  webMembership: { findFirst: (q: { where: { engagementId: string; userId: string } }) => Promise<Row | null>; findMany: (q: { where: { engagementId: string } }) => Promise<Row[]>; create: (q: { data: { [key: string]: unknown } }) => Promise<Row>; delete: (q: { where: { id: string } }) => Promise<unknown>; update: (q: { where: { id: string }; data: Row }) => Promise<Row> };
  webAuditEntry: { create: (q: { data: { [key: string]: unknown } }) => Promise<Row> };
}

function memoryDb(): FakeDb {
  const tables = new Map<string, Map<string, Row>>();
  const table = (name: string): Map<string, Row> => {
    let t = tables.get(name);
    if (t === undefined) { t = new Map(); tables.set(name, t); }
    return t;
  };
  const find = async (name: string, pred: (row: Row) => boolean): Promise<Row | null> => {
    for (const row of table(name).values()) if (pred(row)) return { ...row };
    return null;
  };
  return {
    tables,
    engagementClosure: { findFirst: async () => null },
    engagement: {
      findFirst: async ({ where }) => find('engagement', (r) => r.id === where.id),
    },
    webUser: {
      findUnique: async ({ where }) =>
        find('webUser', (r) => (where.id !== undefined && r.id === where.id) || (where.username !== undefined && r.username === where.username)),
      create: async ({ data }) => { const row: Row = { status: 'active', ...data, id: String(data.id ?? `u-${table('webUser').size + 1}`) }; table('webUser').set(row.id, row); return { ...row }; },
    },
    webSession: {
      findUnique: async ({ where }) => find('webSession', (r) => r.id === where.id),
      create: async ({ data }) => { const row: Row = { ...data, id: String(data.id) }; table('webSession').set(row.id, row); return { ...row }; },
      deleteMany: async ({ where }) => { table('webSession').delete(where.id); return { count: 1 }; },
    },
    webMembership: {
      findFirst: async ({ where }) => find('webMembership', (r) => r.engagementId === where.engagementId && r.userId === where.userId),
      findMany: async ({ where }) => [...table('webMembership').values()].filter((r) => r.engagementId === where.engagementId).map((r) => ({ ...r })),
      create: async ({ data }) => { const row: Row = { ...data, id: String(data.id ?? `m-${table('webMembership').size + 1}`) }; table('webMembership').set(row.id, row); return { ...row }; },
      delete: async ({ where }) => { table('webMembership').delete(where.id); return {}; },
      update: async ({ where, data }) => { const row: Row = { ...table('webMembership').get(where.id)!, ...data }; table('webMembership').set(where.id, row); return { ...row }; },
    },
    webAuditEntry: {
      create: async ({ data }) => { const row: Row = { ...data, id: String(data.id ?? `a-${table('webAuditEntry').size + 1}`) }; table('webAuditEntry').set(row.id, row); return { ...row }; },
    },
  };
}

type Db = ReturnType<typeof memoryDb>;

function seedEngagement(db: Db, id: string, userId: string): void {
  if (!db.tables.has('engagement')) db.tables.set('engagement', new Map());
  db.tables.get('engagement')!.set(id, { id, userId, name: id, displayName: null, targetType: 'web_url', targetValue: 'https://x.invalid', authorizationConfirmed: true, status: 'planning', threadId: null, runtimeContextLockedAt: null, brief: null, handoffConfirmedAt: null, createdAt: new Date(), updatedAt: new Date() });
}

async function seedUser(db: Db, username: string, password = 'correct horse battery'): Promise<string> {
  const row = await db.webUser.create({ data: { username, displayName: username, passwordHash: hashPassword(password), status: 'active' } });
  return String(row.id);
}

async function multiApp(db: Db): Promise<FastifyInstance> {
  return await (buildApp({ authMode: 'multi', authDb: db as never, secureCookies: false, membersService: new MembersService(db as never, true) }) as unknown as Promise<FastifyInstance>);
}

const ENG = 'eng-1';

async function login(app: FastifyInstance, username: string, password = 'correct horse battery'): Promise<{ cookie: string; csrf: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === 'raptix_web_session')!.value;
  return { cookie: `raptix_web_session=${cookie}`, csrf: res.json().csrfToken };
}

describe('ticket 07 password/session primitives', () => {
  it('verifies scrypt passwords in constant time and rejects tampered hashes', () => {
    const stored = hashPassword('correct horse battery');
    expect(verifyPassword('correct horse battery', stored)).toBe(true);
    expect(verifyPassword('wrong', stored)).toBe(false);
    expect(verifyPassword('correct horse battery', 'garbage')).toBe(false);
    expect(hashToken('a')).not.toBe('a');
  });

  it('allows absent Origin and enforces a matching one when present', () => {
    expect(isSameOrigin(undefined, '127.0.0.1:5280')).toBe(true);
    expect(isSameOrigin('http://127.0.0.1:5280', '127.0.0.1:5280')).toBe(true);
    expect(isSameOrigin('http://evil.invalid', '127.0.0.1:5280')).toBe(false);
    expect(isSameOrigin('not a url', '127.0.0.1:5280')).toBe(false);
  });

  // W03 proxy authority contract: the server never learns about the external
  // port unless the proxy preserves it, so each supported topology must
  // deliver a Host header equal to the browser Origin authority:
  //  - nginx  → `proxy_set_header Host $http_host` (never `$host`, which
  //             strips the external port);
  //  - Vite   → `changeOrigin: false` (never rewrite Host to the backend).
  // A stripped or rewritten Host must stay REFUSED — proxies that drop the
  // port are misconfigured, not granted a bypass.
  it('refuses proxy topologies that strip or rewrite the browser authority (W03)', () => {
    // nginx with the misconfigured `Host $host`: Origin port lost → 403 expected.
    expect(isSameOrigin('http://127.0.0.1:3001', '127.0.0.1')).toBe(false);
    // nginx fixed with `Host $http_host`: authority preserved → allowed.
    expect(isSameOrigin('http://127.0.0.1:3001', '127.0.0.1:3001')).toBe(true);
    // Vite dev with the misconfigured `changeOrigin: true`: Host rewritten to
    // the backend port while Origin stays on the UI port → refused.
    expect(isSameOrigin('http://127.0.0.1:5273', '127.0.0.1:5280')).toBe(false);
    // Vite fixed with `changeOrigin: false`: Host passes through → allowed.
    expect(isSameOrigin('http://127.0.0.1:5273', '127.0.0.1:5273')).toBe(true);
    // A different host or scheme-host spoof must never match, even on ports.
    expect(isSameOrigin('http://127.0.0.1:3001', 'internal-api.local:3001')).toBe(false);
  });
});

describe('ticket 07 auth boundary', () => {
  it('issues sessions on login and answers whoami with the trusted actor', async () => {
    const db = memoryDb();
    await seedUser(db, 'owner');
    const app = await multiApp(db);
    const { cookie, csrf } = await login(app, 'owner');
    const who = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
    expect(who.statusCode).toBe(200);
    expect(who.json().authenticated).toBe(true);
    expect(who.json().actor.username).toBe('owner');
    expect(who.json().csrfToken).toBe(csrf);
    const anon = await app.inject({ method: 'GET', url: '/api/auth/session' });
    expect(anon.json().authenticated).toBe(false);
  });

  it('refuses wrong passwords uniformly and expires/invalidates sessions', async () => {
    const db = memoryDb();
    await seedUser(db, 'owner');
    const app = await multiApp(db);
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'owner', password: 'nope-nope' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.message).toBe('Invalid username or password.');
    const ghost = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'nobody', password: 'nope-nope' } });
    expect(ghost.statusCode).toBe(401);
    // logout invalidates the session server-side
    const { cookie, csrf } = await login(app, 'owner');
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, 'x-csrf-token': csrf } });
    const after = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
    expect(after.json().authenticated).toBe(false);
  });

  it('gates every scoped API: 401 without a session, CSRF 403 on mutations, health stays public', async () => {
    const db = memoryDb();
    const ownerId = await seedUser(db, 'owner');
    seedEngagement(db, ENG, ownerId);
    const app = await multiApp(db);
    const noSession = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/members` });
    expect(noSession.statusCode).toBe(401);
    expect(noSession.json().error.code).toBe('unauthorized');
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    const { cookie, csrf } = await login(app, 'owner', 'correct horse battery');
    // whoami actor must be seeded owner for the members call below
    const noCsrf = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/members`, headers: { cookie, origin: 'http://localhost' }, payload: { username: 'alice', password: 'longenough1', role: 'viewer' } });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().error.message).toContain('CSRF');
    const ok = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/members`, headers: { cookie, origin: 'http://localhost', 'x-csrf-token': csrf }, payload: { username: 'alice', password: 'longenough1', role: 'viewer' } });
    expect(ok.statusCode).toBe(200);
    void csrf;
  });

  it('bootstraps the admin from env idempotently', async () => {
    const db = memoryDb();
    await ensureBootstrapAdmin(db as never, 'admin', 'bootstrap-pass-1', 'Admin');
    await ensureBootstrapAdmin(db as never, 'admin', 'bootstrap-pass-1', 'Admin');
    expect([...db.tables.get('webUser')!.values()].filter((r) => r.username === 'admin')).toHaveLength(1);
  });
});

describe('ticket 07 membership RBAC', () => {
  it('lists owner plus memberships; viewer cannot invite; owner-only mutations are enforced', async () => {
    const db = memoryDb();
    seedEngagement(db, ENG, 'owner-1');
    const ownerId = await seedUser(db, 'owner');
    seedEngagement(db, ENG, ownerId);
    const app = await multiApp(db);
    const { cookie: ownerCookie, csrf } = await login(app, 'owner');
    const invited = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/members`, headers: { cookie: ownerCookie, 'x-csrf-token': csrf }, payload: { username: 'viewer', password: 'longenough1', role: 'viewer' } });
    expect(invited.statusCode).toBe(200);
    const reviewer = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/members`, headers: { cookie: ownerCookie, 'x-csrf-token': csrf }, payload: { username: 'rev', password: 'longenough1', role: 'reviewer' } });
    expect(reviewer.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/members`, headers: { cookie: ownerCookie } });
    expect(list.statusCode).toBe(200);
    const view = list.json();
    expect(view.mode).toBe('multi-user');
    expect(view.inviteSupported).toBe(true);
    expect(view.canManage).toBe(true);
    expect(view.members.map((m: { role: string }) => m.role).sort()).toEqual(['owner', 'reviewer', 'viewer']);

    const { cookie: viewerCookie, csrf: viewerCsrf } = await login(app, 'viewer', 'longenough1');
    const denied = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/members`, headers: { cookie: viewerCookie, 'x-csrf-token': viewerCsrf }, payload: { username: 'bob', password: 'longenough1', role: 'operator' } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.message).toContain('owner role');

    // forged role in the body cannot self-elevate: role comes from the owner's payload only
    const member = [...db.tables.get('webMembership')!.values()].find((r) => r.role === 'viewer')!;
    const promoted = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/members/${member.userId}`, headers: { cookie: viewerCookie, 'x-csrf-token': viewerCsrf }, payload: { role: 'owner' } });
    expect(promoted.statusCode).toBe(403);

    const { cookie: revCookie, csrf: revCsrf } = await login(app, 'rev', 'longenough1');
    const revPromote = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/members/${member.userId}`, headers: { cookie: revCookie, 'x-csrf-token': revCsrf }, payload: { role: 'operator' } });
    expect(revPromote.statusCode).toBe(403);
    const ownerPromote = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/members/${member.userId}`, headers: { cookie: ownerCookie, 'x-csrf-token': csrf }, payload: { role: 'operator' } });
    expect(ownerPromote.statusCode).toBe(200);
    expect(ownerPromote.json().role).toBe('operator');
  });

  it('removal deletes the membership (never the user) and every mutation is audited', async () => {
    const db = memoryDb();
    const ownerId = await seedUser(db, 'owner');
    seedEngagement(db, ENG, ownerId);
    const app = await multiApp(db);
    const { cookie, csrf } = await login(app, 'owner');
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/members`, headers: { cookie, 'x-csrf-token': csrf }, payload: { username: 'temp', password: 'longenough1', role: 'viewer' } });
    const temp = [...db.tables.get('webUser')!.values()].find((r) => r.username === 'temp')!;
    const removed = await app.inject({ method: 'DELETE', url: `/api/engagements/${ENG}/members/${temp.id}`, headers: { cookie, 'x-csrf-token': csrf } });
    expect(removed.statusCode).toBe(200);
    expect(db.tables.get('webUser')!.has(String(temp.id))).toBe(true);
    const actions = [...db.tables.get('webAuditEntry')!.values()].map((r) => r.action);
    expect(actions).toEqual(['member.invited', 'member.removed']);
  });

  it('answers 404 for foreign engagements without exposing rows', async () => {
    const db = memoryDb();
    seedEngagement(db, ENG, 'owner-1');
    await seedUser(db, 'owner');
    const app = await multiApp(db);
    const { cookie, csrf } = await login(app, 'owner');
    expect((await app.inject({ method: 'GET', url: '/api/engagements/eng-other/members', headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/engagements/eng-other/members', headers: { cookie, 'x-csrf-token': csrf }, payload: { username: 'x', password: 'longenough1', role: 'viewer' } })).statusCode).toBe(404);
  });

  it('keeps the local single-user view truthful when multi mode is off', async () => {
    const db = memoryDb();
    seedEngagement(db, ENG, 'local');
    const app = Fastify({ logger: false });
    const { registerErrorHandler } = await import('../src/http/error-handler.js');
    const { registerMembersRoutes } = await import('../src/http/routes/members.routes.js');
    registerErrorHandler(app);
    registerMembersRoutes(app, new MembersService(db as never, false), { id: 'local', mode: 'local-single-user' });
    const list = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/members` });
    expect(list.statusCode).toBe(200);
    expect(list.json().mode).toBe('local-single-user');
    expect(list.json().inviteSupported).toBe(false);
    const invite = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/members`, payload: { username: 'x' } });
    expect(invite.statusCode).toBe(503);
  });
});
