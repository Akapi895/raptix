import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/multi-user.js';
import { MembersService } from '../src/services/members-service.js';
import { DocumentDraftService } from '../src/services/document-draft-service.js';

/**
 * O06 acceptance (ADR-0083): the document editor reads source + server draft,
 * saves and discards drafts with the digest precondition, and publishes
 * schema-valid bodies atomically. ROE publishing is refused; role gates and
 * engagement scoping follow the membership policy.
 */

interface Row { [key: string]: unknown }

const ENG = 'eng-1';
const SLUG = 'test-project';
const CONOPS = JSON.stringify({ engagement_name: 'Test', executive_summary: 'Authorized test' });
const CONOPS_BAD = JSON.stringify({ engagement_name: 'Test', executive_summary: 42 });

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
  const draftKey = (where: { engagementId: string; name: string }): string => `${where.engagementId}\u0000${where.name}`;
  const db = {
    tables,
    engagementClosure: { findFirst: async () => null },
    engagement: {
      findFirst: async ({ where }: { where: { id: string } }) => find('engagement', (r) => r.id === where.id),
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
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('m') }; table('webMembership').set(String(row.id), row); return { ...row }; },
    },
    webAuditEntry: {
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('a') }; table('webAuditEntry').set(String(row.id), row); return { ...row }; },
    },
    planDocumentDraft: {
      findUnique: async ({ where }: { where: { engagementId_name: { engagementId: string; name: string } } }) => {
        for (const row of table('planDocumentDraft').values()) {
          if (row.engagementId === where.engagementId_name.engagementId && row.name === where.engagementId_name.name) return { ...row };
        }
        return null;
      },
      upsert: async ({ where, create, update }: { where: { engagementId_name: { engagementId: string; name: string } }; create: Row; update: Row }) => {
        const key = draftKey(where.engagementId_name);
        const existing = table('planDocumentDraft').get(key);
        if (existing === undefined) {
          const row: Row = { ...create, id: seq('d'), createdAt: new Date(), updatedAt: new Date() };
          table('planDocumentDraft').set(key, row);
          return { ...row };
        }
        const row: Row = { ...existing, ...update, updatedAt: new Date() };
        table('planDocumentDraft').set(key, row);
        return { ...row };
      },
      delete: async ({ where }: { where: { engagementId_name: { engagementId: string; name: string } } }) => { table('planDocumentDraft').delete(draftKey(where.engagementId_name)); return {}; },
      deleteMany: async ({ where }: { where: { engagementId: string; name: string } }) => {
        const key = draftKey(where);
        const had = table('planDocumentDraft').has(key);
        table('planDocumentDraft').delete(key);
        return { count: had ? 1 : 0 };
      },
    },
  };
  (db as unknown as { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return db;
}

type Db = ReturnType<typeof memoryDb>;

let root: string;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

async function setup(): Promise<{ db: Db; app: FastifyInstance; plan: string; owner: { cookie: string; csrf: string }; operator: { cookie: string; csrf: string }; viewer: { cookie: string; csrf: string } }> {
  root = await mkdtemp(path.join(tmpdir(), 'raptix-o06-'));
  const plan = path.join(root, SLUG, 'plan');
  await mkdir(plan, { recursive: true });
  const db = memoryDb();
  const owner = await db.webUser.create({ data: { username: 'owner', displayName: 'Owner', passwordHash: hashPassword('correct horse battery'), status: 'active' } });
  const operator = await db.webUser.create({ data: { username: 'operator', displayName: 'Op', passwordHash: hashPassword('longenough1'), status: 'active' } });
  const viewer = await db.webUser.create({ data: { username: 'viewer', displayName: 'View', passwordHash: hashPassword('longenough2'), status: 'active' } });
  db.tables.set('engagement', new Map([[ENG, { id: ENG, userId: owner.id, name: ENG, workspaceSlug: SLUG, targetValue: 'https://target.invalid' }]]));
  await db.webMembership.create({ data: { engagementId: ENG, userId: operator.id, role: 'operator' } });
  await db.webMembership.create({ data: { engagementId: ENG, userId: viewer.id, role: 'viewer' } });
  const app = await (buildApp({
    authMode: 'multi',
    authDb: db as never,
    membersService: new MembersService(db as never, true),
    documentDrafts: new DocumentDraftService(db as never, root),
  }) as unknown as Promise<FastifyInstance>);
  const login = async (username: string, password: string): Promise<{ cookie: string; csrf: string }> => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    expect(res.statusCode).toBe(200);
    return { cookie: `raptix_web_session=${res.cookies.find((c) => c.name === 'raptix_web_session')!.value}`, csrf: res.json().csrfToken };
  };
  return { db, app, plan, owner: await login('owner', 'correct horse battery'), operator: await login('operator', 'longenough1'), viewer: await login('viewer', 'longenough2') };
}

const write = (plan: string, name: string, body: string): Promise<void> => writeFile(path.join(plan, `${name}.json`), body, 'utf8');

describe('O06 document drafts', () => {
  it('serves source with digest, projection and no unknown keys; missing stays digest-null', async () => {
    const { app, plan, owner } = await setup();
    try {
      const missing = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/documents/conops`, headers: { cookie: owner.cookie } });
      expect(missing.statusCode).toBe(200);
      expect(missing.headers['cache-control']).toBe('no-store');
      expect(missing.json()).toMatchObject({ name: 'conops', state: 'missing', digest: null, source: null, readable: null, draft: null });

      await write(plan, 'conops', CONOPS);
      const ready = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/documents/conops`, headers: { cookie: owner.cookie } });
      const view = ready.json();
      expect(view.state).toBe('ready');
      expect(view.source).toBe(CONOPS);
      expect(view.readable).toEqual({ engagement_name: 'Test', executive_summary: 'Authorized test', attack_narrative: '', methodology: 'PTES + MITRE ATT&CK framework', success_criteria: [], threat_actors: [] });
      expect(view.digest).toHaveLength(64);
      expect(view.updatedAt).toBeTruthy();
    } finally { await app.close(); }
  });

  it('saves and discards drafts server-side; stale or vanished base digests answer 409', async () => {
    const { app, plan, owner, db } = await setup();
    try {
      const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
      await write(plan, 'conops', CONOPS);
      const digest = (await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/documents/conops`, headers: { cookie: owner.cookie } })).json().digest as string;

      const stale = await app.inject({ method: 'PUT', url: `/api/engagements/${ENG}/documents/conops/draft`, headers, payload: { body: CONOPS, baseDigest: '0'.repeat(64) } });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.message).toContain('changed after this draft was loaded');

      const saved = await app.inject({ method: 'PUT', url: `/api/engagements/${ENG}/documents/conops/draft`, headers, payload: { body: CONOPS, baseDigest: digest } });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().draft).toMatchObject({ body: CONOPS, baseDigest: digest, updatedBy: expect.any(String) });

      await rm(path.join(plan, 'conops.json'));
      const vanished = await app.inject({ method: 'PUT', url: `/api/engagements/${ENG}/documents/conops/draft`, headers, payload: { body: CONOPS, baseDigest: digest } });
      expect(vanished.statusCode).toBe(409);
      expect(vanished.json().error.message).toContain('deleted after this draft was loaded');

      const discarded = await app.inject({ method: 'DELETE', url: `/api/engagements/${ENG}/documents/conops/draft`, headers });
      expect(discarded.json()).toEqual({ discarded: true });
      expect([...db.tables.get('planDocumentDraft')!.values()]).toHaveLength(0);
      const again = await app.inject({ method: 'DELETE', url: `/api/engagements/${ENG}/documents/conops/draft`, headers });
      expect(again.json()).toEqual({ discarded: false });
    } finally { await app.close(); }
  });

  it('refuses schema-invalid draft bodies without persisting them', async () => {
    const { app, owner, db } = await setup();
    try {
      const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
      const bad = await app.inject({ method: 'PUT', url: `/api/engagements/${ENG}/documents/conops/draft`, headers, payload: { body: CONOPS_BAD, baseDigest: null } });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.message).toContain('conops schema');
      expect([...(db.tables.get('planDocumentDraft') ?? new Map()).values()]).toHaveLength(0);
      const junk = await app.inject({ method: 'PUT', url: `/api/engagements/${ENG}/documents/conops/draft`, headers, payload: { body: '{', baseDigest: null } });
      expect(junk.statusCode).toBe(400);
      const huge = await app.inject({ method: 'PUT', url: `/api/engagements/${ENG}/documents/conops/draft`, headers, payload: { body: 'x'.repeat(1024 * 1024 + 1), baseDigest: null } });
      expect([400, 413]).toContain(huge.statusCode);
    } finally { await app.close(); }
  });

  it('publishes atomically, deletes the draft and refuses ROE', async () => {
    const { app, plan, owner, db } = await setup();
    try {
      const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
      const roe = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/documents/roe/publish`, headers, payload: { body: CONOPS, baseDigest: null } });
      expect(roe.statusCode).toBe(409);
      expect(roe.json().error.message).toContain('Scope & ROE revision workflow');

      const invalid = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/documents/conops/publish`, headers, payload: { body: CONOPS_BAD, baseDigest: null } });
      expect(invalid.statusCode).toBe(400);

      await write(plan, 'conops', CONOPS);
      const digest = (await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/documents/conops`, headers: { cookie: owner.cookie } })).json().digest as string;
      const drift = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/documents/conops/publish`, headers, payload: { body: CONOPS, baseDigest: '0'.repeat(64) } });
      expect(drift.statusCode).toBe(409);

      const saved = await app.inject({ method: 'PUT', url: `/api/engagements/${ENG}/documents/conops/draft`, headers, payload: { body: CONOPS, baseDigest: digest } });
      expect(saved.statusCode).toBe(200);
      const published = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/documents/conops/publish`, headers, payload: { body: CONOPS, baseDigest: digest } });
      expect(published.statusCode).toBe(200);
      expect(published.json()).toMatchObject({ name: 'conops', digest: expect.any(String) });
      expect(await readFile(path.join(plan, 'conops.json'), 'utf8')).toBe(CONOPS);
      expect([...db.tables.get('planDocumentDraft')!.values()]).toHaveLength(0);
      const leftovers = (await import('node:fs/promises')).readdir(plan);
      expect((await leftovers).every((f) => !f.endsWith('.tmp'))).toBe(true);
    } finally { await app.close(); }
  });

  it('gates reads to members and writes to operator+, scoped per engagement', async () => {
    const { app, owner, operator, viewer } = await setup();
    try {
      expect((await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/documents/conops`, headers: { cookie: viewer.cookie } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: `/api/engagements/eng-other/documents/conops`, headers: { cookie: owner.cookie } })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/documents/not-a-doc`, headers: { cookie: owner.cookie } })).statusCode).toBe(404);
      const writeHeaders = { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf };
      expect((await app.inject({ method: 'PUT', url: `/api/engagements/${ENG}/documents/conops/draft`, headers: writeHeaders, payload: { body: CONOPS, baseDigest: null } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/documents/conops/publish`, headers: writeHeaders, payload: { body: CONOPS, baseDigest: null } })).statusCode).toBe(403);
      const opWrite = { cookie: operator.cookie, 'x-csrf-token': operator.csrf };
      expect((await app.inject({ method: 'PUT', url: `/api/engagements/${ENG}/documents/conops/draft`, headers: opWrite, payload: { body: CONOPS, baseDigest: null } })).statusCode).toBe(200);
    } finally { await app.close(); }
  });

  it('records audit entries for draft saves and publishes', async () => {
    const { app, owner, db } = await setup();
    try {
      const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
      await app.inject({ method: 'PUT', url: `/api/engagements/${ENG}/documents/conops/draft`, headers, payload: { body: CONOPS, baseDigest: null } });
      await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/documents/conops/publish`, headers, payload: { body: CONOPS, baseDigest: null } });
      const actions = [...db.tables.get('webAuditEntry')!.values()].map((r) => r.action);
      expect(actions).toContain('document.draft_saved');
      expect(actions).toContain('document.published');
    } finally { await app.close(); }
  });
});
