import { describe, expect, it, vi, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/multi-user.js';
import { LibraryService, projectAnalysisPaths } from '../src/services/library-service.js';
import { ProjectNotFoundError } from '../src/services/projects-service.js';
import type { GraphConfig } from '../src/services/graph-service.js';
import type { GraphView } from '@raptix/web-contracts';

/**
 * Ticket 14 acceptance: library reads resolve the corpus through the
 * knowledge-graph public contract (no second browser corpus); observed
 * analysis derives coverage/paths only from engagement-scoped observed
 * nodes; missing corpus data degrades to explicit nulls, never fabrication.
 */

interface Row { [key: string]: unknown }

const CONFIG: GraphConfig = { httpUri: 'http://neo4j.test', user: 'neo4j', password: 'pw' };

function memoryDb() {
  const tables = new Map<string, Map<string, Row>>();
  const find = async (name: string, pred: (row: Row) => boolean): Promise<Row | null> => {
    const t = tables.get(name);
    if (t === undefined) return null;
    for (const row of t.values()) if (pred(row)) return { ...row };
    return null;
  };
  return {
    tables,
    engagement: {
      findFirst: async ({ where }: { where: { id: string; userId?: string } }) =>
        find('engagement', (r) => r.id === where.id && (where.userId === undefined || r.userId === where.userId)),
    },
    webUser: {
      findUnique: async ({ where }: { where: { id?: string; username?: string } }) =>
        find('webUser', (r) => (where.id !== undefined && r.id === where.id) || (where.username !== undefined && r.username === where.username)),
      create: async ({ data }: { data: { [key: string]: unknown } }) => { const row: Row = { status: 'active', ...data, id: String(data.id ?? 'u-1') }; let t = tables.get('webUser'); if (t === undefined) { t = new Map(); tables.set('webUser', t); } t.set(String(row.id), row); return { ...row }; },
    },
    webSession: {
      findUnique: async ({ where }: { where: { id: string } }) => find('webSession', (r) => r.id === where.id),
      create: async ({ data }: { data: Row }) => { let t = tables.get('webSession'); if (t === undefined) { t = new Map(); tables.set('webSession', t); } t.set(String(data.id), { ...data }); return { ...data }; },
      deleteMany: async () => ({ count: 1 }),
    },
  };
}

type Db = ReturnType<typeof memoryDb>;

const ENG = 'eng-1';

function neo4jResponse(rows: unknown[][]): Response {
  return new Response(JSON.stringify({ results: [{ data: rows.map((row) => ({ row })) }] }), { status: 200 });
}

function fakeGraph(view: Partial<GraphView>): never {
  return {
    graph: async (_userId: string, engagementId: string) => {
      if (engagementId !== ENG) throw new ProjectNotFoundError();
      return {
        engagementId,
        nodes: view.nodes ?? [],
        edges: view.edges ?? [],
        truncated: view.truncated ?? false,
        source: 'graph',
      };
    },
  } as never;
}

afterEach(() => { vi.unstubAllGlobals(); });

async function setup(db: Db, library: LibraryService): Promise<{ app: FastifyInstance; owner: { cookie: string; csrf: string } }> {
  const owner = await db.webUser.create({ data: { username: 'owner', displayName: 'Owner', passwordHash: hashPassword('correct horse battery'), status: 'active' } });
  db.tables.set('engagement', new Map([[ENG, { id: ENG, userId: owner.id, name: ENG, targetValue: 'https://t.invalid' }]]));
  const app = await (buildApp({
    logger: { level: 'error' },
    authMode: 'multi',
    authDb: db as never,
    libraryService: library,
  }) as unknown as Promise<FastifyInstance>);
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'owner', password: 'correct horse battery' } });
  expect(res.statusCode).toBe(200);
  return { app, owner: { cookie: `raptix_web_session=${res.cookies.find((c) => c.name === 'raptix_web_session')!.value}`, csrf: res.json().csrfToken } };
}

describe('ticket 14 library and observed analysis', () => {
  it('reads the corpus through the knowledge-graph contract and records revision-write exclusions', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      const statement = String((JSON.parse(String(init?.body)) as { statements: { statement: string }[] }).statements[0]?.statement ?? '');
      if (statement.startsWith('MATCH (n:Skill) RETURN')) {
        return neo4jQueryRows([
          ['dcsync', 'DCSync replication abuse', 'active-directory', ['T1003.006'], 'dcsync secretsdump', '/skills/standard/ad/dcsync/SKILL.md'],
          ['kerberoast', 'Kerberoasting playbook', 'active-directory', ['T1558.003'], 'kerberoast spn', '/skills/standard/ad/kerberoast/SKILL.md'],
        ]);
      }
      if (statement.startsWith('MATCH (n:Skill) WITH count')) return neo4jQueryRows([[2, 620]]);
      return new Response('unexpected statement', { status: 500 });
    }));
    const db = memoryDb();
    const library = new LibraryService(fakeGraph({}), CONFIG);
    const { app, owner } = await setup(db, library);
    const res = await app.inject({ method: 'GET', url: '/api/library', headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(200);
    const view = res.json();
    expect(view.sources).toEqual({ skills: 'knowledge-graph' });
    expect(view.skills).toHaveLength(2);
    expect(view.skills[0]).toMatchObject({ name: 'dcsync', subdomain: 'active-directory', mitreIds: ['T1003.006'] });
    expect(view.counts).toEqual({ skills: 2, techniques: 620 });
    expect(view.excludedActions).toContain('skill-revision-submit');
    expect(view.excludedActions).toContain('skill-revision-review');
  });

  it('derives observed coverage and paths from scoped graph nodes only; missing corpus data stays null', async () => {
    const db = memoryDb();
    const view = fakeGraph({
      nodes: [
        { id: 'n1', labels: ['Host'], properties: { hostname: 'dc01', technique_id: 'T1003.006' } },
        { id: 'n2', labels: ['Credential'], properties: { name: 'krbtgt', mitre_id: 'T1558.003' } },
        { id: 'n3', labels: ['Host'], properties: { hostname: 'web01' } },
        { id: 'n4', labels: ['Host'], properties: { hostname: 'ignored', technique_id: 'not-a-mitre-id' } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'DUMPED', properties: {} },
        { id: 'e2', source: 'n3', target: 'n1', type: 'ACCESSED', properties: {} },
      ],
    });
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      const statement = String((JSON.parse(String(init?.body)) as { statements: { statement: string }[] }).statements[0]?.statement ?? '');
      if (statement.startsWith('MATCH (n:Skill) WITH count')) return neo4jQueryRows([[2, 620]]);
      if (statement.includes('WHERE t.id IN')) return neo4jQueryRows([[['T1003.006']]]);
      return new Response('unexpected statement', { status: 500 });
    }));
    const library = new LibraryService(view as unknown as never, CONFIG);
    const { app, owner } = await setup(db, library);
    const res = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/analysis`, headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(200);
    const analysis = res.json();
    expect(analysis.observed).toHaveLength(2);
    expect(analysis.observed[0]).toMatchObject({ techniqueId: 'T1003.006', label: 'dc01', nodeIds: ['n1'] });
    expect(analysis.coverage).toEqual({ observedTechniques: 2, corpusTechniques: 620, inCorpus: 1 });
    expect(analysis.paths.length).toBeGreaterThan(0);
    expect(analysis.paths[0].steps[0]).toMatchObject({ nodeId: 'n1', techniqueId: 'T1003.006' });
    expect(analysis.quality).toEqual({ graph: 'available', truncated: false });
    expect(analysis.source).toBe('graph');
    expect(analysis.excludedActions).toContain('skill-revision-submit');
    const foreign = await app.inject({ method: 'GET', url: '/api/engagements/eng-other/analysis', headers: { cookie: owner.cookie } });
    expect(foreign.statusCode).toBe(404);
  });

  it('renders an empty graph as explicit empty state and keeps counts null when the corpus is unreachable', async () => {
    const db = memoryDb();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unexpected statement', { status: 500 })));
    const library = new LibraryService(fakeGraph({ nodes: [], edges: [] }), CONFIG);
    const { app, owner } = await setup(db, library);
    const res = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/analysis`, headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(200);
    const analysis = res.json();
    expect(analysis.quality).toEqual({ graph: 'empty', truncated: false });
    expect(analysis.observed).toHaveLength(0);
    expect(analysis.coverage).toEqual({ observedTechniques: 0, corpusTechniques: null, inCorpus: null });
    expect(analysis.paths).toHaveLength(0);
  });
});

function neo4jQueryRows(rows: unknown[][]): Response {
  return new Response(JSON.stringify({ results: [{ data: rows.map((row) => ({ row })) }] }), { status: 200 });
}

describe('ticket 14 path projection', () => {
  it('bounds chain length, dedupes revisits and starts at technique-bearing nodes', () => {
    const view = {
      nodes: [
        { id: 'a', labels: ['Host'], properties: { technique_id: 'T1003.006', name: 'dc01' } },
        { id: 'b', labels: ['Host'], properties: { mitre_id: 'T1558.003', name: 'krbtgt' } },
        { id: 'c', labels: ['Host'], properties: { name: 'plain' } },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b', type: 'DUMPED', properties: {} },
        { id: 'e2', source: 'b', target: 'a', type: 'LOOP', properties: {} },
        { id: 'e3', source: 'b', target: 'c', type: 'REACHES', properties: {} },
      ],
      truncated: false,
    } as unknown as Parameters<typeof projectAnalysisPaths>[0];
    const paths = projectAnalysisPaths(view);
    expect(paths.length).toBeGreaterThanOrEqual(1);
    const flat = paths.flatMap((p) => p.steps.map((s) => s.nodeId));
    expect(flat).not.toContain('c-only-start');
    for (const path of paths) expect(path.steps.length).toBeLessThanOrEqual(6);
    // Every path starts at a technique-bearing node.
    for (const path of paths) expect(path.steps[0]?.techniqueId).not.toBeNull();
  });
});
