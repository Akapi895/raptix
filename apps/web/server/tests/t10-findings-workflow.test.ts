import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/multi-user.js';
import { FindingsWorkflowService } from '../src/services/findings-workflow-service.js';
import type { ArtifactsService } from '../src/services/artifacts-service.js';
import type { LibraryService } from '../src/services/library-service.js';
import { ProjectApiError } from '../src/services/projects-service.js';

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
  const appendRecords = (name: string) => ({
    findFirst: async ({ where }: { where: Row }) => {
      const rows = [...table(name).values()].filter((row) => Object.entries(where).every(([key, value]) => {
        if (key === 'findingVersion' && typeof value === 'object' && value !== null && 'lte' in value) return Number(row.findingVersion) <= Number((value as { lte: number }).lte);
        if (key === 'action' && typeof value === 'object' && value !== null && 'in' in value) return (value as { in: string[] }).in.includes(String(row[key]));
        return row[key] === value;
      }));
      rows.sort((left, right) => Number(right.findingVersion) - Number(left.findingVersion));
      return rows[0] ? { ...rows[0] } : null;
    },
    findMany: async ({ where, cursor, skip, take }: { where: Row; cursor?: { id: string }; skip?: number; take?: number }) => {
      let rows = [...table(name).values()].filter((row) => Object.entries(where).every(([key, value]) => {
        if (key === 'findingVersion' && typeof value === 'object' && value !== null && 'lte' in value) return Number(row.findingVersion) <= Number((value as { lte: number }).lte);
        return row[key] === value;
      }));
      rows.sort((left, right) => Number(right.findingVersion) - Number(left.findingVersion) || String(right.id).localeCompare(String(left.id)));
      if (cursor) {
        const index = rows.findIndex((row) => row.id === cursor.id);
        rows = index < 0 ? [] : rows.slice(index + (skip ?? 0));
      }
      return rows.slice(0, take).map((row) => ({ ...row }));
    },
    create: async ({ data }: { data: Row }) => {
      if (typeof data.requestId === 'string' && [...table(name).values()].some((row) => row.findingId === data.findingId && row.requestId === data.requestId)) throw Object.assign(new Error('Unique request.'), { code: 'P2002' });
      const row: Row = { ...data, id: seq(name), createdAt: data.createdAt ?? new Date() };
      table(name).set(String(row.id), row);
      return { ...row };
    },
  });
  const db = {
    tables,
    engagementClosure: { findFirst: async ({ where }: { where: { engagementId: string } }) => find('engagementClosure', (row) => row.engagementId === where.engagementId) },
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
    webAsset: {
      findFirst: async ({ where }: { where: Row }) => find('webAsset', (row) => Object.entries(where).every(([key, value]) => row[key] === value)),
      findMany: async ({ where }: { where: Row }) => [...table('webAsset').values()].filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)).map((row) => ({ ...row })),
    },
    engagementThread: {
      findFirst: async ({ where }: { where: Row }) => find('engagementThread', (row) => Object.entries(where).every(([key, value]) => row[key] === value)),
      findMany: async ({ where }: { where: Row }) => [...table('engagementThread').values()].filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)).map((row) => ({ ...row })),
    },
    operationBinding: {
      findFirst: async ({ where }: { where: Row }) => find('operationBinding', (row) => Object.entries(where).every(([key, value]) => row[key] === value)),
      findMany: async ({ where }: { where: Row }) => [...table('operationBinding').values()].filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)).map((row) => ({ ...row })),
    },
    webRequestLedger: {
      findFirst: async ({ where }: { where: Row }) => find('webRequestLedger', (row) => Object.entries(where).every(([key, value]) => row[key] === value)),
      findMany: async ({ where }: { where: Row }) => [...table('webRequestLedger').values()].filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)).map((row) => ({ ...row })),
    },
    findingRecord: {
      findFirst: async ({ where }: { where: { id?: string; engagementId: string; producerRef?: string } }) =>
        find('findingRecord', (r) => r.engagementId === where.engagementId && (where.id === undefined || r.id === where.id) && (where.producerRef === undefined || r.producerRef === where.producerRef)),
      findMany: async ({ where, orderBy }: { where: { engagementId: string }; orderBy?: { createdAt: string } }) => {
        const rows = [...table('findingRecord').values()].filter((r) => r.engagementId === where.engagementId).map((r) => ({ ...r }));
        if (orderBy?.createdAt === 'desc') rows.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
        return rows;
      },
      create: async ({ data }: { data: Row }) => {
        if (typeof data.producerRef === 'string' && [...table('findingRecord').values()].some((row) => row.engagementId === data.engagementId && row.producerRef === data.producerRef)) {
          throw Object.assign(new Error('Unique producer import.'), { code: 'P2002' });
        }
        const row: Row = { ...data, id: seq('f'), expectedVersion: data.expectedVersion ?? 1, updatedBy: null, createdAt: new Date(), updatedAt: new Date() };
        table('findingRecord').set(String(row.id), row);
        return { ...row };
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const prev = table('findingRecord').get(where.id)!;
        const increment = typeof data.expectedVersion === 'object' && data.expectedVersion !== null && 'increment' in (data.expectedVersion as Record<string, unknown>) ? Number((data.expectedVersion as { increment: number }).increment) : 0;
        const row: Row = { ...prev, ...data, expectedVersion: Number(prev.expectedVersion) + increment, updatedAt: new Date() };
        table('findingRecord').set(where.id, row);
        return { ...row };
      },
      updateMany: async ({ where, data }: { where: { id: string; engagementId: string; expectedVersion: number; status: string }; data: Row }) => {
        const prev = table('findingRecord').get(where.id);
        if (!prev || prev.engagementId !== where.engagementId || prev.expectedVersion !== where.expectedVersion || prev.status !== where.status) return { count: 0 };
        const increment = (data.expectedVersion as { increment: number }).increment;
        table('findingRecord').set(where.id, { ...prev, ...data, expectedVersion: Number(prev.expectedVersion) + increment, updatedAt: new Date() });
        return { count: 1 };
      },
    },
    findingComment: appendRecords('findingComment'),
    findingHistory: appendRecords('findingHistory'),
    findingRetest: appendRecords('findingRetest'),
    findingSuggestionDisposition: {
      findFirst: async ({ where }: { where: Row }) => find('findingSuggestionDisposition', (row) => Object.entries(where).every(([key, value]) => row[key] === value)),
      findMany: async ({ where }: { where: Row }) => [...table('findingSuggestionDisposition').values()].filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)).map((row) => ({ ...row })),
      create: async ({ data }: { data: Row }) => {
        if ([...table('findingSuggestionDisposition').values()].some((row) => row.engagementId === data.engagementId && row.actorId === data.actorId && row.producerRef === data.producerRef)) throw Object.assign(new Error('Unique disposition.'), { code: 'P2002' });
        const now = new Date();
        const row: Row = { ...data, id: seq('sd'), version: 1, createdAt: now, updatedAt: now };
        table('findingSuggestionDisposition').set(String(row.id), row);
        return { ...row };
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const row = await find('findingSuggestionDisposition', (candidate) => Object.entries(where).every(([key, value]) => candidate[key] === value));
        if (!row) return { count: 0 };
        const current = table('findingSuggestionDisposition').get(String(row.id))!;
        const increment = typeof data.version === 'object' && data.version !== null && 'increment' in data.version ? Number((data.version as { increment: number }).increment) : 0;
        table('findingSuggestionDisposition').set(String(row.id), { ...current, ...data, version: Number(current.version) + increment, updatedAt: new Date() });
        return { count: 1 };
      },
    },
    evidenceLink: {
      findFirst: async ({ where }: { where: { findingId: string; captureId?: string } }) => find('evidenceLink', (r) => r.findingId === where.findingId && (where.captureId === undefined || r.captureId === where.captureId)),
      findMany: async ({ where }: { where: { findingId: string } }) => [...table('evidenceLink').values()].filter((r) => r.findingId === where.findingId).map((r) => ({ ...r })),
      create: async ({ data }: { data: Row }) => { const row: Row = { ...data, id: seq('ev'), createdAt: new Date() }; table('evidenceLink').set(String(row.id), row); return { ...row }; },
    },
  };
  (db as unknown as { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return db;
}

const ENG = 'eng-1';

type FindingsArtifactPort = Pick<ArtifactsService, 'capture'> & Partial<Pick<ArtifactsService, 'captureById'>>;

async function setup(artifacts?: FindingsArtifactPort, library?: Pick<LibraryService, 'techniqueDetail'>): Promise<{ app: FastifyInstance; db: ReturnType<typeof memoryDb>; owner: { cookie: string; csrf: string }; viewer: { cookie: string; csrf: string }; reviewer: { cookie: string; csrf: string } }> {
  const db = memoryDb();
  const owner = await db.webUser.create({ data: { username: 'owner', displayName: 'Owner', passwordHash: hashPassword('correct horse battery'), status: 'active' } });
  const viewer = await db.webUser.create({ data: { username: 'look', displayName: 'Look', passwordHash: hashPassword('longenough1'), status: 'active' } });
  const reviewer = await db.webUser.create({ data: { username: 'rev', displayName: 'Rev', passwordHash: hashPassword('longenough2'), status: 'active' } });
  db.tables.set('engagement', new Map([[ENG, { id: ENG, userId: owner.id, name: ENG, targetValue: 'https://t.invalid' }]]));
  await db.webMembership.create({ data: { engagementId: ENG, userId: viewer.id, role: 'viewer' } });
  await db.webMembership.create({ data: { engagementId: ENG, userId: reviewer.id, role: 'reviewer' } });
  const app = await (buildApp({ authMode: 'multi', authDb: db as never, findingsWorkflow: new FindingsWorkflowService(db as never, artifacts, library) }) as unknown as Promise<FastifyInstance>);
  const login = async (username: string, password: string): Promise<{ cookie: string; csrf: string }> => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    expect(res.statusCode).toBe(200);
    return { cookie: `raptix_web_session=${res.cookies.find((c) => c.name === 'raptix_web_session')!.value}`, csrf: res.json().csrfToken };
  };
  return { app, db, owner: await login('owner', 'correct horse battery'), viewer: await login('look', 'longenough1'), reviewer: await login('rev', 'longenough2') };
}

describe('ticket 10 finding lifecycle and evidence', () => {
  it('creates an authored draft, imports with producer lineage and refuses viewer writes', async () => {
    const { app, owner, viewer } = await setup();
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { title: 'SQLi in staging login', severity: 'high', detail: 'Union-based injection confirmed manually.' } });
    expect(created.statusCode).toBe(200);
    expect(created.json().status).toBe('draft');
    expect(created.json().sourceType).toBe('authored');

    const imported = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/import`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { title: 'Scanner claim: XSS', producerRef: 'findings/FIND-9.md#claim-1', detail: 'AI claim — unverified.' } });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().sourceType).toBe('imported');
    expect(imported.json().producerRef).toBe('findings/FIND-9.md#claim-1');
    expect(imported.json().status).toBe('draft');

    const denied = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers: { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf }, payload: { title: 'x' } });
    expect(denied.statusCode).toBe(403);
  });

  it('enforces the transition map, version-pinned transitions and independent confirmation', async () => {
    const { app, owner, reviewer } = await setup();
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { title: 'F1' } });
    const id = created.json().id;
    const skip = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { to: 'resolved', expectedVersion: 1 } });
    expect(skip.statusCode).toBe(409);
    expect(skip.json().error.message).toContain('not allowed');
    const unversioned = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { to: 'review' } });
    expect(unversioned.statusCode).toBe(400);
    const stale = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { to: 'review', expectedVersion: 9 } });
    expect(stale.statusCode).toBe(409);
    const review = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { to: 'review', expectedVersion: 1 } });
    expect(review.statusCode).toBe(200);
    expect(review.json().expectedVersion).toBe(2);
    // W19: four-eyes � the author (here the engagement owner) cannot confirm their own finding.
    const selfConfirm = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { to: 'confirmed', expectedVersion: 2 } });
    expect(selfConfirm.statusCode).toBe(403);
    expect(selfConfirm.json().error.message).toMatch(/independent/i);
    const confirmed = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { to: 'confirmed', expectedVersion: 2 } });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe('confirmed');
  });

  it('P05: editing a confirmed finding invalidates confirmation and resolution requires classified retest evidence', async () => {
    const retained: FindingsArtifactPort = {
      capture: async () => ({ engagementId: ENG, path: 'findings/capture-cap-ret.bin', digest: 'd'.repeat(64), sizeBytes: 2, producer: 'web-user:owner' }),
      captureById: async (_actorId, _engagementId, captureId) => ({ captureId, classification: 'standard', engagementId: ENG, path: 'findings/capture-cap-ret.bin', digest: 'd'.repeat(64), sizeBytes: 2, producer: 'web-user:owner' }),
    };
    const { app, owner, reviewer } = await setup(retained);
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { title: 'F1', detail: 'v1' } });
    const id = created.json().id;
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { to: 'review', expectedVersion: 1 } });
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { to: 'confirmed', expectedVersion: 2 } });
    const edited = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/curated-findings/${id}`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { expectedVersion: 3, detail: 'edited after confirm' } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().status).toBe('review');
    expect(edited.json().expectedVersion).toBe(4);
    const listed = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/curated-findings`, headers: { cookie: owner.cookie } });
    expect(listed.json().findings.find((f: { id: string }) => f.id === id).status).toBe('review');
    // Push to resolved, then the terminal state refuses content edits.
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { to: 'confirmed', expectedVersion: 4 } });
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { to: 'remediation', expectedVersion: 5 } });
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { to: 'retest', expectedVersion: 6 } });
    const directResolve = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { to: 'resolved', expectedVersion: 7 } });
    expect(directResolve.statusCode).toBe(409);
    const missingEvidence = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/retests`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { result: 'Resolved', note: 'Fix verified.', expectedVersion: 7, requestId: 'resolve-1' } });
    expect(missingEvidence.statusCode).toBe(409);
    const resolved = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/retests`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { result: 'Resolved', note: 'Fix verified.', expectedVersion: 7, requestId: 'resolve-1', captureIds: ['cap-ret'] } });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().retests[0].evidenceRefs).toEqual(['cap-ret']);
    const refused = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/curated-findings/${id}`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { expectedVersion: 8, detail: 'too late' } });
    expect(refused.statusCode).toBe(409);
  });

  it('W19: import resolves the producer reference through the retained authority and flags unverified claims', async () => {
    const retained: Pick<ArtifactsService, 'capture'> = {
      capture: async (_actor: string, _engagement: string, path: string) => {
        if (path === 'findings/FIND-9.md') return { digest: 'a'.repeat(64), producer: 'runtime:scanner-1' } as never;
        throw new (await import('../src/services/projects-service.js')).ProjectApiError(404, 'Artifact not retained.');
      },
    };
    const { app, owner } = await setup(retained);
    const resolved = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/import`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { title: 'Scanner claim', producerRef: 'findings/FIND-9.md', detail: 'claim' } });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().producerRef).toBe('findings/FIND-9.md');
    expect(resolved.json().producerDigest).toBe('a'.repeat(64));
    expect(resolved.json().producerResolved).toBe(true);
    const unverified = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/import`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { title: 'Foreign claim', producerRef: 'findings/FOREIGN-77.md', detail: 'claim' } });
    expect(unverified.statusCode).toBe(200);
    expect(unverified.json().producerResolved).toBe(false);
  });

  it('replays an import for the same producer path and digest, but refuses changed bytes', async () => {
    let digest = 'a'.repeat(64);
    const retained: Pick<ArtifactsService, 'capture'> = {
      capture: async (_actor: string, _engagement: string, path: string) => {
        expect(path).toBe('findings/FIND-9.md');
        return { digest, producer: 'runtime:scanner-1' } as never;
      },
    };
    const { app, owner } = await setup(retained);
    const url = `/api/engagements/${ENG}/curated-findings/import`;
    const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
    const payload = { title: 'Scanner claim', producerRef: 'findings/FIND-9.md', detail: 'Claim from the source.' };
    const first = await app.inject({ method: 'POST', url, headers, payload });
    const replay = await app.inject({ method: 'POST', url, headers, payload });
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(first.json().id);
    expect(replay.json().producerDigest).toBe(digest);

    digest = 'b'.repeat(64);
    const changed = await app.inject({ method: 'POST', url, headers, payload });
    expect(changed.statusCode).toBe(409);
    const listed = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/curated-findings`, headers });
    expect(listed.json().findings.filter((finding: { producerRef: string | null }) => finding.producerRef === payload.producerRef)).toHaveLength(1);
    await app.close();
  });

  it('concurrent retries for one producer path return the single committed draft', async () => {
    const retained: Pick<ArtifactsService, 'capture'> = {
      capture: async () => ({ digest: 'c'.repeat(64), producer: 'runtime:scanner-1' }) as never,
    };
    const { app, owner } = await setup(retained);
    const request = () => app.inject({
      method: 'POST', url: `/api/engagements/${ENG}/curated-findings/import`,
      headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf },
      payload: { title: 'Scanner claim', producerRef: 'findings/FIND-10.md', detail: 'Claim.' },
    });
    const [first, retry] = await Promise.all([request(), request()]);
    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().id).toBe(first.json().id);
    const list = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/curated-findings`, headers: { cookie: owner.cookie } });
    expect(list.json().findings.filter((finding: { producerRef: string | null }) => finding.producerRef === 'findings/FIND-10.md')).toHaveLength(1);
    await app.close();
  });

  it('rejects stale expectedVersion writes with a conflict and preserves the row', async () => {
    const { app, owner } = await setup();
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { title: 'Concurrent', detail: 'v1 body' } });
    const id = created.json().id;
    const first = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/curated-findings/${id}`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { expectedVersion: 1, detail: 'saved edit', impact: 'Account takeover.', recommendation: 'Require MFA.', severityRationale: 'Privileged account exposed.', scopeNote: 'Applies to staging only.' } });
    expect(first.statusCode).toBe(200);
    const stale = await app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/curated-findings/${id}`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { expectedVersion: 1, detail: 'stale edit' } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.message).toContain('Concurrent edit');
    const list = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/curated-findings`, headers: { cookie: owner.cookie } });
    const row = list.json().findings.find((f: { id: string }) => f.id === id);
    expect(row.body.detail).toBe('saved edit');
    expect(row.body).toMatchObject({ impact: 'Account takeover.', recommendation: 'Require MFA.', severityRationale: 'Privileged account exposed.', scopeNote: 'Applies to staging only.' });
    expect(row.expectedVersion).toBe(2);
  });

  it('attaches opaque evidence with digest/producer and refuses foreign findings', async () => {
    const { app, owner } = await setup();
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { title: 'With evidence' } });
    const id = created.json().id;
    const attached = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/evidence`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { kind: 'digest', digest: 'a'.repeat(64), producer: 'runtime:soundwave', expectedVersion: 1 } });
    expect(attached.statusCode).toBe(200);
    expect(attached.json().digest).toBe('a'.repeat(64));
    expect(attached.json().producer).toBe('runtime:soundwave');
    const malformed = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/evidence`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { kind: 'digest', digest: 'sha256:abc123', expectedVersion: 1 } });
    expect(malformed.statusCode).toBe(400);
    const missing = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/evidence`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { kind: 'artifact', expectedVersion: 1 } });
    expect(missing.statusCode).toBe(400);
    const foreign = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/f-999/transition`, headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf }, payload: { to: 'review' } });
    expect(foreign.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/engagements/eng-other/curated-findings', headers: { cookie: owner.cookie } })).statusCode).toBe(404);
  });

  it('attaches a classified retained capture once and invalidates the finding version', async () => {
    const retained: FindingsArtifactPort = {
      capture: async () => ({ engagementId: ENG, path: 'findings/capture-cap-1.bin', digest: 'd'.repeat(64), sizeBytes: 12, producer: 'web-user:owner' }),
      captureById: async (_actorId, _engagementId, captureId) => ({ captureId, classification: 'standard', engagementId: ENG, path: 'findings/capture-cap-1.bin', digest: 'd'.repeat(64), sizeBytes: 12, producer: 'web-user:owner' }),
    };
    const { app, owner } = await setup(retained);
    const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers, payload: { title: 'Capture binding' } });
    const findingId = created.json().id as string;
    const attach = () => app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${findingId}/evidence`, headers, payload: { kind: 'artifact', captureId: 'cap-1', expectedVersion: 1 } });
    const first = await attach();
    const replay = await attach();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ engagementId: ENG, captureId: 'cap-1', digest: 'd'.repeat(64) });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(first.json().id);
    const listed = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/curated-findings`, headers: { cookie: owner.cookie } });
    const row = listed.json().findings.find((finding: { id: string }) => finding.id === findingId);
    expect(row.expectedVersion).toBe(2);
    expect(row.evidence).toHaveLength(1);
    await app.close();
  });

  it('persists return decisions and idempotent version-pinned comments as separate records', async () => {
    const { app, owner, viewer, reviewer } = await setup();
    const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers, payload: { title: 'Commented finding' } });
    const id = created.json().id as string;
    const submit = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers, payload: { to: 'review', expectedVersion: 1 } });
    const returned = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { to: 'returned', expectedVersion: 2, note: 'Add impact evidence.' } });
    expect(submit.statusCode).toBe(200);
    expect(returned.json().status).toBe('returned');
    expect(returned.json().comments).toHaveLength(1);
    expect(returned.json().history.at(-1)).toMatchObject({ action: 'returned', reason: 'Add impact evidence.', version: 3 });

    const commentUrl = `/api/engagements/${ENG}/curated-findings/${id}/comments`;
    const payload = { text: 'Impact evidence added.', expectedVersion: 3, requestId: 'comment-1' };
    const first = await app.inject({ method: 'POST', url: commentUrl, headers, payload });
    const replay = await app.inject({ method: 'POST', url: commentUrl, headers, payload });
    const changedReplay = await app.inject({ method: 'POST', url: commentUrl, headers, payload: { ...payload, text: 'Different body.' } });
    const foreignActorReplay = await app.inject({ method: 'POST', url: commentUrl, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload });
    const denied = await app.inject({ method: 'POST', url: commentUrl, headers: { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf }, payload: { ...payload, requestId: 'viewer-comment' } });
    expect(first.statusCode).toBe(200);
    expect(replay.json().comments.filter((comment: { text: string }) => comment.text === payload.text)).toHaveLength(1);
    expect(replay.json().comments.at(-1).id).toBe(first.json().comments.at(-1).id);
    expect(changedReplay.statusCode).toBe(409);
    expect(foreignActorReplay.statusCode).toBe(409);
    expect(denied.statusCode).toBe(403);
    expect(first.json().history.at(-1)).toMatchObject({ action: 'commented', version: 4 });
    await app.close();
  });

  it('persists one retest per idempotency key and returns failed retests to remediation', async () => {
    const { app, owner, reviewer } = await setup();
    const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers, payload: { title: 'Retested finding' } });
    const id = created.json().id as string;
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers, payload: { to: 'review', expectedVersion: 1 } });
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { to: 'confirmed', expectedVersion: 2 } });
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers, payload: { to: 'remediation', expectedVersion: 3 } });
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers, payload: { to: 'retest', expectedVersion: 4 } });
    const url = `/api/engagements/${ENG}/curated-findings/${id}/retests`;
    const payload = { result: 'Persists', note: 'The issue remains reproducible.', expectedVersion: 5, requestId: 'retest-1' };
    const first = await app.inject({ method: 'POST', url, headers, payload });
    const replay = await app.inject({ method: 'POST', url, headers, payload });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe('remediation');
    expect(first.json().retests).toHaveLength(1);
    expect(replay.json().retests).toHaveLength(1);
    expect(replay.json().retests[0].id).toBe(first.json().retests[0].id);
    expect(first.json().history.at(-1)).toMatchObject({ action: 'retested', fromStatus: 'retest', toStatus: 'remediation', version: 6 });
    await app.close();
  });

  it('binds only managed in-engagement assets and owned execution identities', async () => {
    const { app, db, owner } = await setup();
    db.tables.set('webAsset', new Map([['asset-1', { id: 'asset-1', engagementId: ENG, identifier: 'web-01' }]]));
    db.tables.set('engagementThread', new Map([['thread-1', { threadId: 'thread-1', engagementId: ENG, kind: 'execution' }]]));
    db.tables.set('operationBinding', new Map([['binding-1', { id: 'binding-1', engagementId: ENG, threadId: 'thread-1' }]]));
    db.tables.set('webRequestLedger', new Map([['run-1', { id: 'request-1', engagementId: ENG, threadId: 'thread-1', runId: 'run-1' }]]));
    const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
    const options = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/curated-findings/options`, headers: { cookie: owner.cookie } });
    expect(options.json().assets).toEqual([{ id: 'asset-1', label: 'web-01' }]);
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers, payload: {
      title: 'Bound finding', references: { assetId: 'asset-1', bindingId: 'binding-1', threadId: 'thread-1', runId: 'run-1', techniqueId: null },
    } });
    expect(created.statusCode).toBe(200);
    expect(created.json().references).toMatchObject({ assetId: 'asset-1', bindingId: 'binding-1', threadId: 'thread-1', runId: 'run-1' });
    const foreign = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers, payload: { title: 'Foreign asset', references: { assetId: 'asset-foreign' } } });
    expect(foreign.statusCode).toBe(404);
    const foreignThread = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers, payload: { title: 'Foreign thread', references: { threadId: 'thread-foreign' } } });
    expect(foreignThread.statusCode).toBe(404);
    await app.close();
  });

  it('pages activity by stable cursor and pins each page to the requested finding version', async () => {
    const { app, owner } = await setup();
    const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers, payload: { title: 'Activity pages' } });
    const id = created.json().id as string;
    for (let index = 0; index < 3; index += 1) {
      await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/comments`, headers, payload: { text: `Comment ${index}`, expectedVersion: index + 1, requestId: `page-${index}` } });
    }
    const first = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/curated-findings/${id}/activity?kind=comments&version=4&limit=1`, headers: { cookie: owner.cookie } });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ version: 4, items: [{ text: 'Comment 2', findingVersion: 4 }] });
    const nextCursor = first.json().nextCursor as string;
    const second = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/curated-findings/${id}/activity?kind=comments&version=4&limit=1&cursor=${nextCursor}`, headers: { cookie: owner.cookie } });
    expect(second.json()).toMatchObject({ version: 4, items: [{ text: 'Comment 1', findingVersion: 3 }] });
    const foreignCursor = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/curated-findings/${id}/activity?kind=comments&version=4&cursor=findingComment-999`, headers: { cookie: owner.cookie } });
    expect(foreignCursor.statusCode).toBe(400);
    await app.close();
  });

  it('persists per-actor dismissals and restores them without changing another actor queue', async () => {
    const source: Pick<ArtifactsService, 'capture'> = { capture: async (_actorId, _engagementId, path) => ({ engagementId: ENG, path, digest: 'a'.repeat(64), sizeBytes: 1, producer: 'runtime' }) };
    const { app, owner, reviewer } = await setup(source);
    const post = (auth: { cookie: string; csrf: string }, body: Row) => app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/suggestions`, headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf }, payload: body });
    const sourceRef = 'findings/FIND-88.md';
    const dismissed = await post(owner, { producerRef: sourceRef, dismissed: true, reason: 'Duplicate claim.', expectedVersion: 0 });
    expect(dismissed.statusCode).toBe(200);
    expect(dismissed.json().disposition).toMatchObject({ dismissed: true, reason: 'Duplicate claim.', version: 1 });
    const replay = await post(owner, { producerRef: sourceRef, dismissed: true, reason: 'Duplicate claim.', expectedVersion: 0 });
    expect(replay.json().disposition.version).toBe(1);
    const ownerQueue = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/curated-findings/suggestions`, headers: { cookie: owner.cookie } });
    const reviewerQueue = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/curated-findings/suggestions`, headers: { cookie: reviewer.cookie } });
    expect(ownerQueue.json().dispositions[0]).toMatchObject({ producerRef: sourceRef, dismissed: true });
    expect(reviewerQueue.json().dispositions).toEqual([]);
    const restored = await post(owner, { producerRef: sourceRef, dismissed: false, reason: '', expectedVersion: 1 });
    expect(restored.json().disposition).toMatchObject({ dismissed: false, version: 2 });
    await app.close();
  });

  it('refuses reviewer writes to their own edited content and refuses closed-engagement writes', async () => {
    const { app, db, owner, reviewer } = await setup();
    const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers, payload: { title: 'Independent content review' } });
    const id = created.json().id as string;
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers, payload: { to: 'review', expectedVersion: 1 } });
    db.tables.get('findingRecord')!.get(id)!.contentUpdatedBy = 'u-3';
    const selfReview = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { to: 'confirmed', expectedVersion: 2 } });
    expect(selfReview.statusCode).toBe(403);
    db.tables.set('engagementClosure', new Map([['closed', { engagementId: ENG, status: 'closed' }]]));
    const closed = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/comments`, headers, payload: { text: 'Too late.', requestId: 'closed-comment', expectedVersion: 2 } });
    expect(closed.statusCode).toBe(409);
    await app.close();
  });

  it('validates technique links against the canonical corpus instead of accepting a plausible technique ID', async () => {
    const library: Pick<LibraryService, 'techniqueDetail'> = { techniqueDetail: async (id) => {
      if (id !== 'T1059') throw new ProjectApiError(404, 'Technique is not in the canonical corpus.');
      return { id: 'T1059', name: 'Command and Scripting Interpreter', description: null, url: null, skills: [] };
    } };
    const { app, owner } = await setup(undefined, library);
    const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
    const linked = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers, payload: { title: 'Corpus-backed finding', references: { techniqueId: 'T1059' } } });
    expect(linked.json().references.techniqueId).toBe('T1059');
    const invented = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers, payload: { title: 'Invented technique', references: { techniqueId: 'T9999' } } });
    expect(invented.statusCode).toBe(404);
    await app.close();
  });

  it('refuses stale review decisions racing a content edit and does not confirm the edited version', async () => {
    const { app, owner, reviewer } = await setup();
    const headers = { cookie: owner.cookie, 'x-csrf-token': owner.csrf };
    const created = await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings`, headers, payload: { title: 'Edit review race', detail: 'Reviewed content.' } });
    const id = created.json().id as string;
    await app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers, payload: { to: 'review', expectedVersion: 1 } });
    const [edit, decision] = await Promise.all([
      app.inject({ method: 'PATCH', url: `/api/engagements/${ENG}/curated-findings/${id}`, headers, payload: { expectedVersion: 2, detail: 'Changed content.' } }),
      app.inject({ method: 'POST', url: `/api/engagements/${ENG}/curated-findings/${id}/transition`, headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf }, payload: { to: 'confirmed', expectedVersion: 2 } }),
    ]);
    expect([edit.statusCode, decision.statusCode].sort()).toEqual([200, 409]);
    const listed = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/curated-findings`, headers });
    const finding = listed.json().findings[0];
    expect(finding.status === 'confirmed' && finding.body.detail === 'Changed content.').toBe(false);
    await app.close();
  });
});
