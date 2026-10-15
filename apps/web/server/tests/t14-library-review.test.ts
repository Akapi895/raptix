/** Public HTTP library details and version-pinned proposal lifecycle. */
import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LibraryService } from '../src/services/library-service.js';
import { registerLibraryRoutes } from '../src/http/routes/library.routes.js';
import { LibraryReviewService } from '../src/services/library-review-service.js';
import { registerLibraryReviewRoutes } from '../src/http/routes/library-review.routes.js';
import type { FastifyInstance } from 'fastify';

const config = { httpUri: 'http://graph.test', user: 'neo4j', password: 'test' };
const canonical = {
  name: 'dcsync', path: '/skills/standard/ad/dcsync/SKILL.md', body: 'Keep OPSEC checks.\nRead the RoE.\n',
  description: 'Replication reference', subdomain: 'active-directory', mitre_attack_raw: ['T1003.006'],
  when_to_use: 'During authorized AD assessment', content_sha256: 'sha256:base', commit_sha: 'abc123', allowed_tools: ['bash'],
};
function graphSource(): void {
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { statement, parameters } = JSON.parse(String(init?.body)).statements[0];
    const rows = statement.includes('t:Technique')
      ? parameters.id === 'T1003.006' ? [[{ id: 'T1003.006', name: 'DCSync', description: 'Technique description', url: 'https://attack.mitre.org/techniques/T1003/006/' }, [canonical]]] : []
      : parameters.name === 'dcsync' ? [[canonical]] : [];
    return new Response(JSON.stringify({ results: [{ data: rows.map((row) => ({ row })) }] }));
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe('library detail HTTP', () => {
  it('returns exact canonical body and technique description rather than a filtered list', async () => {
    graphSource();
    const app = Fastify();
    registerLibraryRoutes(app, new LibraryService({} as never, config), { id: 'author', mode: 'multi-user' });
    const skill = await app.inject('/api/library/skills/dcsync');
    expect(skill.statusCode).toBe(200);
    expect(skill.json()).toMatchObject({ name: 'dcsync', body: canonical.body, commitSha: 'abc123', publication: 'canonical' });
    const technique = await app.inject('/api/library/techniques/T1003.006');
    expect(technique.statusCode).toBe(200);
    expect(technique.json()).toMatchObject({ id: 'T1003.006', description: 'Technique description', skills: [{ name: 'dcsync' }] });
    expect((await app.inject('/api/library/skills/missing')).statusCode).toBe(404);
    await app.close();
  });
});

type Row = Record<string, unknown>;

/** ADR-0070 fixture: real service + routes over an in-memory persistence double. */
function reviewFixture() {
  const tables: Record<string, Row[]> = {};
  const db: Row = {};
  interface QueryArgs { where?: Row; orderBy?: Record<string, string>; select?: Row; data?: Row }
  for (const name of ['engagement', 'engagementClosure', 'webMembership', 'libraryReviewProposal', 'libraryProposalReview', 'webAuditEntry']) {
    const rows: Row[] = tables[name] = [];
    const findMany = async ({ where, orderBy }: QueryArgs = {}): Promise<Row[]> => {
      let selected = rows.filter((row) => Object.entries(where ?? {}).every(([key, value]) => row[key] === value));
      if (orderBy) for (const [key, direction] of Object.entries(orderBy)) selected = selected.sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : String(a[key]) > String(b[key]) ? 1 : 0) * (direction === 'desc' ? -1 : 1));
      return selected.map((row) => ({ ...row }));
    };
    db[name] = {
      findMany,
      findFirst: async (args: QueryArgs) => (await findMany(args))[0] ?? null,
      count: async (args: QueryArgs) => (await findMany(args)).length,
      create: async ({ data }: QueryArgs) => {
        const row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), comment: null, ...data };
        rows.push(row);
        return { ...row };
      },
      updateMany: async ({ where, data }: QueryArgs) => {
        const selected = rows.filter((row) => Object.entries(where ?? {}).every(([key, value]) => row[key] === value));
        for (const row of selected) Object.assign(row, data);
        return { count: selected.length };
      },
    };
  }
  db.$transaction = async (fn: (tx: Row) => Promise<unknown>) => {
    const snapshot = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
    try {
      return await fn(db);
    } catch (err) {
      for (const [name, rows] of Object.entries(snapshot)) {
        const live = tables[name]!;
        live.length = 0;
        for (const row of rows) live.push(row);
      }
      throw err;
    }
  };
  tables.engagement!.push({ id: 'eng', userId: 'author' });
  tables.webMembership!.push({ engagementId: 'eng', userId: 'solomon', role: 'reviewer' }, { engagementId: 'eng', userId: 'spectator', role: 'viewer' });
  const library = new LibraryService({} as never, config);
  const service = new LibraryReviewService(db as never, library);
  const appFor = (actorId: string): FastifyInstance => {
    const app = Fastify();
    registerLibraryReviewRoutes(app, service, { id: actorId, mode: 'multi-user' });
    return app;
  };
  return { db, tables, service, appFor };
}

describe('library proposal lifecycle (ADR-0070)', () => {
  it('pins the canonical snapshot, enforces author-only amendment and version-pinned independent decisions', async () => {
    graphSource();
    const { tables, appFor } = reviewFixture();
    const author = appFor('author');
    const reviewer = appFor('solomon');
    const library = new LibraryService({} as never, config);
    const expectedRevision = createHash('sha256').update(JSON.stringify(await library.skillDetail('dcsync'))).digest('hex');

    const submitted = await author.inject({ method: 'POST', url: '/api/engagements/eng/library-proposals', payload: { skillName: 'dcsync', proposedBody: 'Rewritten body.\n', rationale: 'Tighten the OPSEC paragraph.' } });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json()).toMatchObject({ skillName: 'dcsync', status: 'draft', version: 1, baseRevision: expectedRevision, baseBody: canonical.body, createdBy: 'author' });
    const proposalId = submitted.json().id as string;

    const detail = await author.inject(`/api/engagements/eng/library-proposals/${proposalId}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id: proposalId, canonicalCurrent: true });

    const foreignAmend = await reviewer.inject({ method: 'POST', url: `/api/engagements/eng/library-proposals/${proposalId}/amendments`, payload: { proposedBody: 'Hijack.\n', expectedVersion: 1 } });
    expect(foreignAmend.statusCode).toBe(403);
    const staleAmend = await author.inject({ method: 'POST', url: `/api/engagements/eng/library-proposals/${proposalId}/amendments`, payload: { proposedBody: 'Stale.\n', expectedVersion: 9 } });
    expect(staleAmend.statusCode).toBe(409);
    const amended = await author.inject({ method: 'POST', url: `/api/engagements/eng/library-proposals/${proposalId}/amendments`, payload: { proposedBody: 'Amended body.\n', expectedVersion: 1 } });
    expect(amended.statusCode).toBe(200);
    expect(amended.json()).toMatchObject({ version: 2, status: 'draft', proposedBody: 'Amended body.\n' });

    expect((await author.inject(`/api/engagements/eng/library-proposals/${proposalId}/export`)).statusCode).toBe(409);
    const proposed = await author.inject({ method: 'POST', url: `/api/engagements/eng/library-proposals/${proposalId}/propose` });
    expect(proposed.statusCode).toBe(200);
    expect(proposed.json()).toMatchObject({ status: 'proposed', version: 2 });
    expect((await author.inject({ method: 'POST', url: '/api/engagements/eng/library-proposals', payload: { skillName: 'dcsync', proposedBody: 'Duplicate.\n' } })).statusCode).toBe(409);

    const selfDecision = await author.inject({ method: 'POST', url: `/api/engagements/eng/library-proposals/${proposalId}/decision`, payload: { decision: 'approved', expectedVersion: 2 } });
    expect(selfDecision.statusCode).toBe(403);
    const wrongVersion = await reviewer.inject({ method: 'POST', url: `/api/engagements/eng/library-proposals/${proposalId}/decision`, payload: { decision: 'approved', expectedVersion: 1 } });
    expect(wrongVersion.statusCode).toBe(409);
    const decided = await reviewer.inject({ method: 'POST', url: `/api/engagements/eng/library-proposals/${proposalId}/decision`, payload: { decision: 'approved', expectedVersion: 2, comment: 'Body replacement is sound.' } });
    expect(decided.statusCode).toBe(200);
    expect(decided.json()).toMatchObject({ status: 'approved', reviews: [{ proposalVersion: 2, decision: 'approved', reviewerId: 'solomon' }] });

    const exported = await reviewer.inject(`/api/engagements/eng/library-proposals/${proposalId}/export`);
    expect(exported.statusCode).toBe(200);
    expect(exported.json()).toMatchObject({ kind: 'library-body-replacement-proposal', proposed: { body: 'Amended body.\n' }, proposal: { version: 2, status: 'approved', baseRevision: expectedRevision } });
    expect(exported.json().publicationContract).toHaveLength(3);
    expect(tables.webAuditEntry!.length).toBeGreaterThanOrEqual(4);
    await author.close();
    await reviewer.close();
  });

  it('blocks review, export and submission when the canonical corpus drifted or the engagement closed', async () => {
    graphSource();
    const { tables, appFor } = reviewFixture();
    const author = appFor('author');
    const submitted = await author.inject({ method: 'POST', url: '/api/engagements/eng/library-proposals', payload: { skillName: 'dcsync', proposedBody: 'Body.\n' } });
    expect(submitted.statusCode).toBe(200);
    const proposalId = submitted.json().id as string;

    canonical.body = 'Drifted canonical body.\n';
    const drifted = await author.inject({ method: 'POST', url: `/api/engagements/eng/library-proposals/${proposalId}/propose` });
    expect(drifted.statusCode).toBe(409);
    const detail = await author.inject(`/api/engagements/eng/library-proposals/${proposalId}`);
    expect(detail.json()).toMatchObject({ canonicalCurrent: false });
    canonical.body = 'Keep OPSEC checks.\nRead the RoE.\n';

    const spectator = appFor('spectator');
    expect((await spectator.inject({ method: 'POST', url: '/api/engagements/eng/library-proposals', payload: { skillName: 'dcsync', proposedBody: 'Nope.\n' } })).statusCode).toBe(403);

    tables.engagementClosure!.push({ engagementId: 'eng', status: 'closed' });
    expect((await author.inject({ method: 'POST', url: '/api/engagements/eng/library-proposals', payload: { skillName: 'dcsync', proposedBody: 'Closed.\n' } })).statusCode).toBe(409);
    await author.close();
    await spectator.close();
  });
});
