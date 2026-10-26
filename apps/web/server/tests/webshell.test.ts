import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { RuntimeWebShellError, RuntimeWebShellUnavailableError } from '../src/integrations/webshell/runtime-webshell-client.js';
import type { RuntimeWebShellClient, RuntimeWebShellCommandResult, RuntimeWebShellProbeResult } from '../src/integrations/webshell/runtime-webshell-client.js';
import { WebShellService } from '../src/services/webshell-service.js';
import { configureSingleOperator } from '../src/auth/membership-policy.js';
import { registerWebShellRoutes } from '../src/http/routes/webshell.routes.js';

const ENGINE = 'eng-1';
const ACTOR = 'local';
const TARGET = '10.129.88.4';

type Row = Record<string, unknown>;
type FindArgs = { where?: Record<string, unknown>; orderBy?: Record<string, string>; take?: number; include?: unknown };
type CreateArgs = { data: Row; include?: unknown };
type UpdateArgs = { where: { id: string }; data: Row; include?: unknown };

function at(row: Row): number {
  const value = row.createdAt;
  return value instanceof Date ? value.getTime() : 0;
}

function profile() {
  return {
    provider: 'http-form-command' as const,
    target: TARGET,
    endpoint: `http://${TARGET}/dev/phpbash.php`,
    method: 'POST' as const,
    content_type: 'application/x-www-form-urlencoded' as const,
    command_parameter: 'cmd',
    probe_command: 'id;hostname',
    probe_pattern: 'uid=33',
    expected_user: 'www-data',
  };
}

function createInput(requestId = 'req-create-0001') {
  return { requestId, name: 'phpbash', profile: profile() };
}

function memoryDb() {
  const engagements = new Map<string, Row>();
  engagements.set(ENGINE, { id: ENGINE, userId: ACTOR, workspaceSlug: 'lab', targetType: 'host', targetValue: TARGET });
  engagements.set('eng-2', { id: 'eng-2', userId: 'other', workspaceSlug: 'other', targetType: 'host', targetValue: '10.0.0.9' });
  const assets = new Map<string, Row>();
  assets.set('asset-1', { id: 'asset-1', engagementId: ENGINE, identifier: TARGET, kind: 'host', classification: 'in_scope' });
  const connections = new Map<string, Row>();
  const probes = new Map<string, Row>();
  const commands = new Map<string, Row>();
  let role: string | null = null;
  let closed = false;
  let seq = 0;
  const now = () => new Date(Date.now() + ++seq);
  const withProbes = (row: Row, include: unknown) => {
    if (include === undefined) return row;
    const latest = [...probes.values()].filter((p) => p.connectionId === row.id).sort((a, b) => at(b) - at(a))[0];
    return { ...row, probes: latest === undefined ? [] : [latest] };
  };
  const db = {
    engagement: {
      findFirst: async ({ where }: FindArgs) => {
        const row = engagements.get(String(where?.id));
        return row !== undefined && (where?.userId === undefined || row.userId === where.userId) ? { ...row } : null;
      },
    },
    webMembership: {
      findFirst: async () => (role === null ? null : { role }),
    },
    engagementClosure: {
      findFirst: async () => (closed ? { status: 'closed' } : null),
    },
    webAsset: {
      findFirst: async ({ where }: FindArgs) => {
        const row = assets.get(String(where?.id));
        return row !== undefined && row.engagementId === where?.engagementId ? { ...row } : null;
      },
    },
    webShellConnection: {
      findUnique: async ({ where, include }: FindArgs) => {
        if (where?.id !== undefined) return connections.has(String(where.id)) ? withProbes(connections.get(String(where.id))!, include) : null;
        const key = where?.engagementId_provider_endpoint_commandParameter as Row | undefined;
        if (key === undefined) return null;
        const row = [...connections.values()].find((r) => r.engagementId === key.engagementId && r.provider === key.provider && r.endpoint === key.endpoint && r.commandParameter === key.commandParameter);
        return row === undefined ? null : withProbes(row, include);
      },
      findFirst: async ({ where, include }: FindArgs) => {
        const row = [...connections.values()].find((r) => r.id === where?.id && r.engagementId === where?.engagementId);
        return row === undefined ? null : withProbes(row, include);
      },
      findMany: async ({ where, orderBy, take, include }: FindArgs) => {
        let rows = [...connections.values()].filter((r) => r.engagementId === where?.engagementId);
        rows = rows.sort((a, b) => String(orderBy?.createdAt) === 'desc' ? at(b) - at(a) : at(a) - at(b));
        return rows.slice(0, take).map((r) => withProbes(r, include));
      },
      create: async ({ data, include }: CreateArgs) => {
        const row: Row = {
          id: `conn-${connections.size + 1}`, assetId: null, headers: null, expectedUser: null,
          producerFindingId: null, producerPocSha256: null, producerSpecSha256: null, producerAcquisitionId: null,
          lastProbeId: null, lastProbeAt: null, concurrencyVersion: 1, state: 'unverified', source: 'manual',
          createdAt: now(), updatedAt: now(), ...data,
        };
        connections.set(String(row.id), row);
        return withProbes(row, include);
      },
      update: async ({ where, data, include }: UpdateArgs) => {
        const row = connections.get(where.id)!;
        const next: Row = { ...row, ...data };
        const version = data.concurrencyVersion as { increment?: number } | undefined;
        if (version?.increment !== undefined) next.concurrencyVersion = Number(row.concurrencyVersion) + version.increment;
        next.updatedAt = now();
        connections.set(where.id, next);
        return withProbes(next, include);
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const row of connections.values()) {
          if (row.id !== where.id || row.engagementId !== where.engagementId) continue;
          if ((where.state as { not?: string } | undefined)?.not === row.state) continue;
          Object.assign(row, data, { updatedAt: now() });
          count += 1;
        }
        return { count };
      },
    },
    webShellProbe: {
      findUnique: async ({ where }: FindArgs) => {
        const key = where?.connectionId_requestId as Row | undefined;
        if (key === undefined) return null;
        return [...probes.values()].find((p) => p.connectionId === key.connectionId && p.requestId === key.requestId) ?? null;
      },
      findMany: async ({ where, orderBy, take }: FindArgs) => {
        let rows = [...probes.values()].filter((p) => p.connectionId === where?.connectionId && p.engagementId === where?.engagementId);
        rows = rows.sort((a, b) => String(orderBy?.createdAt) === 'desc' ? at(b) - at(a) : at(a) - at(b));
        return rows.slice(0, take);
      },
      create: async ({ data }: CreateArgs) => {
        const key = `${data.connectionId}:${data.requestId}`;
        if ([...probes.values()].some((p) => `${p.connectionId}:${p.requestId}` === key)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        const row: Row = { id: `probe-${probes.size + 1}`, createdAt: now(), httpStatus: null, matched: false, error: null, ...data };
        probes.set(String(row.id), row);
        return row;
      },
    },
    webShellCommand: {
      findUnique: async ({ where }: FindArgs) => {
        if (where?.id !== undefined) return commands.get(String(where.id)) ?? null;
        if (where?.activeConnectionId !== undefined) return [...commands.values()].find((c) => c.activeConnectionId === where.activeConnectionId) ?? null;
        const key = where?.engagementId_requestId as Row | undefined;
        if (key === undefined) return null;
        return [...commands.values()].find((c) => c.engagementId === key.engagementId && c.requestId === key.requestId) ?? null;
      },
      findFirst: async ({ where }: FindArgs) => [...commands.values()].find((c) => {
        if (where?.id !== undefined && c.id !== where.id) return false;
        if (c.connectionId !== where?.connectionId || c.engagementId !== where?.engagementId) return false;
        const status = where?.status as { in?: string[] } | undefined;
        return status?.in === undefined || status.in.includes(String(c.status));
      }) ?? null,
      findMany: async ({ where, orderBy, take }: FindArgs) => {
        let rows = [...commands.values()].filter((c) => c.connectionId === where?.connectionId && c.engagementId === where?.engagementId);
        rows = rows.sort((a, b) => String(orderBy?.createdAt) === 'desc' ? at(b) - at(a) : at(a) - at(b));
        return rows.slice(0, take);
      },
      create: async ({ data }: CreateArgs) => {
        if (data.activeConnectionId !== undefined && [...commands.values()].some((c) => c.activeConnectionId === data.activeConnectionId)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        if ([...commands.values()].some((c) => c.engagementId === data.engagementId && c.requestId === data.requestId)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        const row: Row = { id: `cmd-${commands.size + 1}`, status: 'creating', httpStatus: null, exitCode: null, output: '', outputTruncated: false, error: null, activeConnectionId: null, createdAt: now(), updatedAt: now(), ...data };
        commands.set(String(row.id), row);
        return row;
      },
      update: async ({ where, data }: UpdateArgs) => {
        const row = commands.get(where.id)!;
        Object.assign(row, data, { updatedAt: now() });
        return row;
      },
    },
  };
  return { db: db as unknown as PrismaClient, setRole: (value: string | null) => { role = value; }, setClosed: (value: boolean) => { closed = value; } };
}

interface TestGates {
  latestApproved: () => Promise<{ version: number } | null>;
  roeWindowAllows: () => Promise<{ ok: boolean; reason: string | null; version: number | null }>;
  targetInScope: (_engagementId: string, target: string) => Promise<{ ok: boolean; reason: string | null }>;
  assertNoActiveStop: () => Promise<void>;
}

function gates(): TestGates {
  return {
    latestApproved: async () => ({ version: 1 }),
    roeWindowAllows: async () => ({ ok: true, reason: null, version: 1 }),
    targetInScope: async (_engagementId: string, target: string) => target === TARGET ? { ok: true, reason: null } : { ok: false, reason: 'outside approved scope' },
    assertNoActiveStop: async () => undefined,
  };
}

function runtime() {
  let probeCalls = 0;
  let executeCalls = 0;
  let probeResult: RuntimeWebShellProbeResult = { state: 'reachable', httpStatus: 200, matched: true, output: 'uid=33(www-data)', outputTruncated: false, error: null, durationMs: 12 };
  let commandResult: RuntimeWebShellCommandResult = { state: 'delivered', httpStatus: 200, exitCode: null, output: 'www-data', outputTruncated: false, error: null, durationMs: 10 };
  const client = {
    probe: async () => { probeCalls += 1; return probeResult; },
    execute: async () => { executeCalls += 1; return commandResult; },
  } as unknown as RuntimeWebShellClient;
  return {
    client,
    probeCalls: () => probeCalls,
    executeCalls: () => executeCalls,
    setProbe: (value: RuntimeWebShellProbeResult) => { probeResult = value; },
    setCommand: (value: RuntimeWebShellCommandResult) => { commandResult = value; },
  };
}

function service(deps: ReturnType<typeof memoryDb>, client: RuntimeWebShellClient, gate = gates()) {
  return new WebShellService({
    db: deps.db,
    runtime: client,
    scope: gate as never,
    governance: gate as never,
    sandboxKey: 'sandbox-key',
    perProjectSandbox: true,
  });
}

async function addConnection(svc: WebShellService) {
  return svc.create(ACTOR, ENGINE, createInput());
}

beforeEach(() => configureSingleOperator(true));
afterEach(() => configureSingleOperator(false));

describe('WebShellService', () => {
  it('creates, lists, reads, updates and closes a connection', async () => {
    const deps = memoryDb();
    const svc = service(deps, runtime().client);
    const created = await addConnection(svc);
    expect(created).toMatchObject({ engagementId: ENGINE, name: 'phpbash', state: 'unverified', source: 'manual', concurrencyVersion: 1 });
    expect((await svc.list(ACTOR, ENGINE)).connections).toHaveLength(1);
    expect((await svc.get(ACTOR, ENGINE, created.id)).id).toBe(created.id);
    const updated = await svc.update(ACTOR, ENGINE, created.id, { name: 'shell' });
    expect(updated).toMatchObject({ name: 'shell', concurrencyVersion: 2 });
    const closed = await svc.close(ACTOR, ENGINE, created.id);
    expect(closed).toMatchObject({ state: 'closed', concurrencyVersion: 3 });
  });

  it('replaces a profile and resets the connection to unverified', async () => {
    const deps = memoryDb();
    const svc = service(deps, runtime().client);
    const created = await addConnection(svc);
    const replacement = { ...profile(), endpoint: `http://${TARGET}/dev/phpbash.min.php` };
    const updated = await svc.update(ACTOR, ENGINE, created.id, { profile: replacement });
    expect(updated.state).toBe('unverified');
    expect(updated.profile.endpoint).toBe(`http://${TARGET}/dev/phpbash.min.php`);
    expect(updated.concurrencyVersion).toBe(2);
  });

  it('refuses a profile replacement while an unresolved command holds the connection', async () => {
    const deps = memoryDb();
    const fake = runtime();
    fake.setCommand({ state: 'uncertain', httpStatus: null, exitCode: null, output: '', outputTruncated: false, error: 'timeout', durationMs: 30_000 });
    const svc = service(deps, fake.client);
    const created = await addConnection(svc);
    await svc.execute(ACTOR, ENGINE, created.id, { requestId: 'req-command-0005', command: 'id' });
    await expect(svc.update(ACTOR, ENGINE, created.id, { profile: { ...profile(), endpoint: `http://${TARGET}/dev/phpbash.min.php` } })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('answers 404 for a foreign engagement and never touches the runtime', async () => {
    const deps = memoryDb();
    const fake = runtime();
    const svc = service(deps, fake.client);
    const created = await addConnection(svc);
    await expect(svc.get(ACTOR, 'eng-2', created.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.create(ACTOR, 'eng-2', createInput('req-create-0002'))).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.probe(ACTOR, 'eng-2', created.id, { requestId: 'req-probe-0001' })).rejects.toMatchObject({ statusCode: 404 });
    expect(fake.probeCalls()).toBe(0);
  });

  it('refuses direct mutations when single-operator mode is off, but reads stay available', async () => {
    const deps = memoryDb();
    const svc = service(deps, runtime().client);
    const created = await addConnection(svc);
    configureSingleOperator(false);
    await expect(svc.create(ACTOR, ENGINE, createInput('req-create-0003'))).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.execute(ACTOR, ENGINE, created.id, { requestId: 'req-command-0001', command: 'id' })).rejects.toMatchObject({ statusCode: 403 });
    expect((await svc.list(ACTOR, ENGINE)).connections).toHaveLength(1);
  });

  it('refuses viewers, out-of-scope targets, outside ROE windows, stops and closed engagements before the runtime', async () => {
    const deps = memoryDb();
    const fake = runtime();
    const gate = gates();
    const svc = service(deps, fake.client, gate);
    const created = await addConnection(svc);

    gate.latestApproved = async () => null;
    await expect(svc.probe(ACTOR, ENGINE, created.id, { requestId: 'req-probe-0002' })).rejects.toMatchObject({ statusCode: 403 });
    gate.latestApproved = async () => ({ version: 1 });
    gate.roeWindowAllows = async () => ({ ok: false, reason: 'outside window', version: 1 });
    await expect(svc.probe(ACTOR, ENGINE, created.id, { requestId: 'req-probe-0003' })).rejects.toMatchObject({ statusCode: 403 });
    gate.roeWindowAllows = async () => ({ ok: true, reason: null, version: 1 });
    gate.assertNoActiveStop = async () => { throw Object.assign(new Error('stop'), { statusCode: 409 }); };
    await expect(svc.probe(ACTOR, ENGINE, created.id, { requestId: 'req-probe-0004' })).rejects.toMatchObject({ statusCode: 409 });
    gate.assertNoActiveStop = async () => undefined;
    gate.targetInScope = async () => ({ ok: false, reason: 'outside approved scope' });
    await expect(svc.probe(ACTOR, ENGINE, created.id, { requestId: 'req-probe-0005' })).rejects.toMatchObject({ statusCode: 403 });
    gate.targetInScope = async (_engagementId: string, target: string) => target === TARGET ? { ok: true, reason: null } : { ok: false, reason: 'outside approved scope' };
    deps.setClosed(true);
    await expect(svc.probe(ACTOR, ENGINE, created.id, { requestId: 'req-probe-0006' })).rejects.toMatchObject({ statusCode: 409 });
    expect(fake.probeCalls()).toBe(0);
  });

  it('refuses a viewer who may read but not probe', async () => {
    const deps = memoryDb();
    const fake = runtime();
    const svc = service(deps, fake.client);
    const created = await addConnection(svc);
    deps.setRole('viewer');
    expect((await svc.list('viewer-1', ENGINE)).connections).toHaveLength(1);
    await expect(svc.probe('viewer-1', ENGINE, created.id, { requestId: 'req-probe-0007' })).rejects.toMatchObject({ statusCode: 403 });
    expect(fake.probeCalls()).toBe(0);
  });

  it('persists probe states and the latest probe state on the connection', async () => {
    const deps = memoryDb();
    const fake = runtime();
    const svc = service(deps, fake.client);
    const created = await addConnection(svc);
    const reachable = await svc.probe(ACTOR, ENGINE, created.id, { requestId: 'req-probe-0010' });
    expect(reachable).toMatchObject({ state: 'reachable', matched: true, httpStatus: 200 });
    expect((await svc.get(ACTOR, ENGINE, created.id)).lastProbeState).toBe('reachable');
    fake.setProbe({ state: 'unknown', httpStatus: null, matched: false, output: '', outputTruncated: false, error: 'timeout', durationMs: 30_000 });
    const unknown = await svc.probe(ACTOR, ENGINE, created.id, { requestId: 'req-probe-0011' });
    expect(unknown.state).toBe('unknown');
    expect((await svc.get(ACTOR, ENGINE, created.id)).lastProbeState).toBe('unknown');
  });

  it.each([
    ['reachable_no_proof', 200],
    ['unreachable', 500],
  ] as const)('persists the %s probe state', async (state, httpStatus) => {
    const deps = memoryDb();
    const fake = runtime();
    fake.setProbe({ state, httpStatus, matched: false, output: 'response', outputTruncated: false, error: null, durationMs: 5 });
    const svc = service(deps, fake.client);
    const created = await addConnection(svc);
    const result = await svc.probe(ACTOR, ENGINE, created.id, { requestId: `req-probe-${state}` });
    expect(result.state).toBe(state);
    expect(result.httpStatus).toBe(httpStatus);
    expect((await svc.get(ACTOR, ENGINE, created.id)).lastProbeState).toBe(state);
  });

  it('replays the same command request without redispatch and refuses changed input', async () => {
    const deps = memoryDb();
    const fake = runtime();
    const svc = service(deps, fake.client);
    const created = await addConnection(svc);
    const first = await svc.execute(ACTOR, ENGINE, created.id, { requestId: 'req-command-0010', command: 'id' });
    const replay = await svc.execute(ACTOR, ENGINE, created.id, { requestId: 'req-command-0010', command: 'id' });
    expect(replay.id).toBe(first.id);
    expect(fake.executeCalls()).toBe(1);
    await expect(svc.execute(ACTOR, ENGINE, created.id, { requestId: 'req-command-0010', command: 'whoami' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('keeps one unresolved command per connection and never re-dispatches an uncertain result', async () => {
    const deps = memoryDb();
    const fake = runtime();
    fake.setCommand({ state: 'uncertain', httpStatus: null, exitCode: null, output: '', outputTruncated: false, error: 'timeout', durationMs: 30_000 });
    const svc = service(deps, fake.client);
    const created = await addConnection(svc);
    const first = await svc.execute(ACTOR, ENGINE, created.id, { requestId: 'req-command-0020', command: 'id' });
    expect(first.status).toBe('uncertain');
    const replay = await svc.execute(ACTOR, ENGINE, created.id, { requestId: 'req-command-0020', command: 'id' });
    expect(replay.id).toBe(first.id);
    await expect(svc.execute(ACTOR, ENGINE, created.id, { requestId: 'req-command-0021', command: 'pwd' })).rejects.toMatchObject({ statusCode: 409 });
    expect(fake.executeCalls()).toBe(1);
  });

  it('marks a runtime transport failure uncertain and keeps the unresolved slot', async () => {
    const deps = memoryDb();
    const failing = { execute: async () => { throw new RuntimeWebShellUnavailableError(); } } as unknown as RuntimeWebShellClient;
    const svc = service(deps, failing);
    const created = await addConnection(svc);
    const first = await svc.execute(ACTOR, ENGINE, created.id, { requestId: 'req-command-0025', command: 'id' });
    expect(first.status).toBe('uncertain');
    await expect(svc.execute(ACTOR, ENGINE, created.id, { requestId: 'req-command-0026', command: 'pwd' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('turns a runtime refusal into a failed command and releases the slot', async () => {
    const deps = memoryDb();
    const refusing = { execute: async () => { throw new RuntimeWebShellError(403, 'target is out of scope'); } } as unknown as RuntimeWebShellClient;
    const svc = service(deps, refusing);
    const created = await addConnection(svc);
    await expect(svc.execute(ACTOR, ENGINE, created.id, { requestId: 'req-command-0027', command: 'id' })).rejects.toMatchObject({ statusCode: 403 });
    const commands = await svc.commands(ACTOR, ENGINE, created.id);
    expect(commands.commands[0]).toMatchObject({ status: 'failed', error: 'target is out of scope' });
  });

  it('blocks commands on a closed connection', async () => {
    const deps = memoryDb();
    const fake = runtime();
    const svc = service(deps, fake.client);
    const created = await addConnection(svc);
    await svc.close(ACTOR, ENGINE, created.id);
    await expect(svc.execute(ACTOR, ENGINE, created.id, { requestId: 'req-command-0030', command: 'id' })).rejects.toMatchObject({ statusCode: 409 });
    expect(fake.executeCalls()).toBe(0);
  });

  it('bounds stored probe output and marks it truncated', async () => {
    const deps = memoryDb();
    const fake = runtime();
    fake.setProbe({ state: 'reachable', httpStatus: 200, matched: true, output: 'x'.repeat(200_000), outputTruncated: false, error: null, durationMs: 1 });
    const svc = service(deps, fake.client);
    const created = await addConnection(svc);
    const probe = await svc.probe(ACTOR, ENGINE, created.id, { requestId: 'req-probe-0020' });
    expect(probe.output).toHaveLength(196_608);
    expect(probe.outputTruncated).toBe(true);
  });

  it('sets no-store on WebShell reads', async () => {
    const app = Fastify();
    const stub = { list: async () => ({ engagementId: ENGINE, connections: [] }) } as unknown as WebShellService;
    registerWebShellRoutes(app, stub, { id: ACTOR, mode: 'local-single-user' });
    const response = await app.inject({ method: 'GET', url: `/api/engagements/${ENGINE}/webshell/connections` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    await app.close();
  });
});
