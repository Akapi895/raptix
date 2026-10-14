import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/multi-user.js';
import { FleetService, projectFleetBranches } from '../src/services/fleet-service.js';
import type { CustomPayload, ThreadHistoryEvent } from '@raptix/web-contracts';

/**
 * Ticket 13 acceptance: fleet reads distinguish catalog identity, bound
 * threads and checkpoint-provenance subagent branches; missing runtime data
 * renders as honest unknown, never fabricated health; branch-level actions
 * are recorded as excluded; foreign engagements 404.
 */

interface Row { [key: string]: unknown }

function memoryDb() {
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
    engagement: {
      findFirst: async ({ where }: { where: { id: string } }) => find('engagement', (r) => r.id === where.id),
    },
    webUser: {
      findUnique: async ({ where }: { where: { id?: string; username?: string } }) =>
        find('webUser', (r) => (where.id !== undefined && r.id === where.id) || (where.username !== undefined && r.username === where.username)),
      create: async ({ data }: { data: { [key: string]: unknown } }) => { const row: Row = { status: 'active', ...data, id: String(data.id ?? 'u-1') }; table('webUser').set(String(row.id), row); return { ...row }; },
    },
    webSession: {
      findUnique: async ({ where }: { where: { id: string } }) => find('webSession', (r) => r.id === where.id),
      create: async ({ data }: { data: Row }) => { table('webSession').set(String(data.id), { ...data }); return { ...data }; },
      deleteMany: async () => ({ count: 1 }),
    },
    webMembership: {
      findFirst: async ({ where }: { where: { engagementId: string; userId: string } }) => find('webMembership', (r) => r.engagementId === where.engagementId && r.userId === where.userId),
    },
  };
}

type Db = ReturnType<typeof memoryDb>;

const ENG = 'eng-1';

const ev = (type: string, agent: string, extra: Record<string, unknown> = {}): ThreadHistoryEvent =>
  ({ key: null, runId: null, source: 'checkpoint', truncated: false, payload: { type, agent, createdAt: '2026-10-15T00:00:00.000Z', ...extra } as unknown as CustomPayload });

function fakeContext(graphs: string[]): never {
  return { agents: async () => ({ source: 'runtime', graphs }) } as never;
}

function fakeRuns(options: {
  threads: { threadId: string; assistantId: string | null; kind: string | null; updatedAt: string }[];
  snapshots: Map<string, { rawStatus: string | null; transcripts: ThreadHistoryEvent[] }>;
  failThreads?: Set<string>;
  runs?: Map<string, { runId: string; rawStatus: string }[]>;
}): never {
  return {
    listThreads: async () => ({ engagementId: ENG, threads: options.threads, source: 'runtime' }),
    snapshot: async (_u: string, _e: string, threadId: string) => {
      if (options.failThreads?.has(threadId)) throw new Error('checkpoint missing');
      const snap = options.snapshots.get(threadId);
      if (!snap) throw new Error('no snapshot');
      return { rawStatus: snap.rawStatus, transcripts: snap.transcripts };
    },
    listRuns: async (_u: string, _e: string, threadId: string) => ({ runs: options.runs?.get(threadId) ?? [], offset: 0, nextOffset: null }),
  } as never;
}

async function setup(db: Db, fleet: FleetService): Promise<{ app: FastifyInstance; owner: { cookie: string; csrf: string } }> {
  const owner = await db.webUser.create({ data: { username: 'owner', displayName: 'Owner', passwordHash: hashPassword('correct horse battery'), status: 'active' } });
  db.tables.set('engagement', new Map([[ENG, { id: ENG, userId: owner.id, name: ENG, targetValue: 'https://t.invalid' }]]));
  const app = await (buildApp({
    logger: { level: 'error' },
    authMode: 'multi',
    authDb: db as never,
    fleetService: fleet,
  }) as unknown as Promise<FastifyInstance>);
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'owner', password: 'correct horse battery' } });
  expect(res.statusCode).toBe(200);
  return { app, owner: { cookie: `raptix_web_session=${res.cookies.find((c) => c.name === 'raptix_web_session')!.value}`, csrf: res.json().csrfToken } };
}

describe('ticket 13 fleet projection', () => {
  it('separates catalog identity, thread status and checkpoint branches; counts stay observed', async () => {
    const db = memoryDb();
    const transcripts = [
      ev('subagent_start', 'recon', { sessionId: 'sa-1', prompt: 'scan' }),
      ev('subagent_tool_call', 'recon', { sessionId: 'sa-1', tool: 'bash', toolId: 'tc-1', toolPhase: 'call' }),
      ev('subagent_end', 'recon', { sessionId: 'sa-1', status: 'ok', elapsed: 12.5 }),
      ev('subagent_start', 'exploit', { sessionId: 'sa-2' }),
    ];
    const fleet = new FleetService(
      db as never,
      fakeContext(['raptix', 'raptix-subagents']),
      fakeRuns({
        threads: [
          { threadId: 'th-1', assistantId: 'raptix', kind: 'execution', updatedAt: '2026-10-15T01:00:00.000Z' },
          { threadId: 'th-2', assistantId: 'raptix', kind: 'planning', updatedAt: '2026-10-15T00:30:00.000Z' },
        ],
        snapshots: new Map([
          ['th-1', { rawStatus: 'busy', transcripts }],
          ['th-2', { rawStatus: 'idle', transcripts: [] }],
        ]),
        runs: new Map([['th-1', [{ runId: 'run-9', rawStatus: 'running' }]]]),
      }),
    );
    const { app, owner } = await setup(db, fleet);
    const res = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/fleet`, headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(200);
    const view = res.json();
    expect(view.sources).toEqual({ agents: 'runtime-catalog', threads: 'runtime', branches: 'checkpoint' });
    expect(view.agents).toEqual([{ graphId: 'raptix', source: 'catalog' }, { graphId: 'raptix-subagents', source: 'catalog' }]);
    expect(view.threads).toHaveLength(2);
    expect(view.threads[0]).toMatchObject({ threadId: 'th-1', rawStatus: 'busy', activeRunId: 'run-9' });
    expect(view.threads[1]).toMatchObject({ threadId: 'th-2', rawStatus: 'idle', activeRunId: null });
    expect(view.branches).toHaveLength(2);
    expect(view.branches[0]).toMatchObject({ threadId: 'th-1', key: 'sa-1', agent: 'recon', state: 'ended', outcome: 'ok', provenance: 'checkpoint' });
    expect(view.branches[1]).toMatchObject({ threadId: 'th-1', key: 'sa-2', agent: 'exploit', state: 'running', outcome: null });
    expect(view.counts).toMatchObject({ threads: 2, threadsTruncated: false, activeRuns: 1, branches: 2, runningBranches: 1 });
    expect(view.excludedActions).toContain('branch-retry');
    expect(view.excludedActions).toContain('branch-reassign');
    expect(view.excludedActions).toContain('branch-cancel');
  });

  it('renders a failing thread read as honest unknown and answers 404 for foreign engagements', async () => {
    const db = memoryDb();
    const fleet = new FleetService(
      db as never,
      fakeContext(['raptix']),
      fakeRuns({
        threads: [{ threadId: 'th-x', assistantId: 'raptix', kind: 'execution', updatedAt: '2026-10-15T01:00:00.000Z' }],
        snapshots: new Map(),
        failThreads: new Set(['th-x']),
      }),
    );
    const { app, owner } = await setup(db, fleet);
    const res = await app.inject({ method: 'GET', url: `/api/engagements/${ENG}/fleet`, headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(200);
    const view = res.json();
    expect(view.threads[0]).toMatchObject({ threadId: 'th-x', rawStatus: null, activeRunId: null });
    expect(view.branches).toHaveLength(0);
    expect(view.counts.threadsTruncated).toBe(false);
    const foreign = await app.inject({ method: 'GET', url: '/api/engagements/eng-other/fleet', headers: { cookie: owner.cookie } });
    expect(foreign.statusCode).toBe(404);
  });

  it('pairs branch states from start/end checkpoint events and flags outcome polarity', () => {
    const ended = projectFleetBranches('th-1', [
      ev('subagent_start', 'recon', { sessionId: 'sa-1' }),
      ev('subagent_end', 'recon', { sessionId: 'sa-1', error: true }),
    ]);
    expect(ended[0]).toMatchObject({ state: 'ended', outcome: 'failed', endedAt: '2026-10-15T00:00:00.000Z' });
    const cancelled = projectFleetBranches('th-1', [
      ev('subagent_start', 'recon', { sessionId: 'sa-2' }),
      ev('subagent_end', 'recon', { sessionId: 'sa-2', cancelled: true }),
    ]);
    expect(cancelled[0]?.outcome).toBe('cancelled');
    const orphanEnd = projectFleetBranches('th-1', [ev('subagent_end', 'ghost', { sessionId: 'sa-3' })]);
    expect(orphanEnd[0]).toMatchObject({ state: 'ended', outcome: 'completed' });
    const restart = projectFleetBranches('th-1', [
      ev('subagent_start', 'recon', { sessionId: 'sa-4' }),
      ev('subagent_end', 'recon', { sessionId: 'sa-4' }),
      ev('subagent_start', 'recon', { sessionId: 'sa-4' }),
    ]);
    expect(restart[0]).toMatchObject({ state: 'running', outcome: null });
  });
});
