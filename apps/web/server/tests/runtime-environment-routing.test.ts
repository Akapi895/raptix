import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuntimeRouter, EnvironmentNotReadyError, type EnvironmentRoute, type EnvironmentRouteSource } from '../src/integrations/runtime/runtime-router.js';
import { RuntimeUnavailableError } from '../src/integrations/runtime/read-client.js';
import { RunService } from '../src/services/runtime/run-service.js';
import { RuntimeContextService } from '../src/services/runtime/runtime-context.js';
import { ProjectPolicyError } from '../src/security/project-policy.js';

// Distinct runtime doubles on loopback. Each answers with its own name, so a reply proves which runtime served it.
interface Double { name: string; url: string; hits: string[]; server: Server }

const STAMP = '2026-10-19T00:00:00.000Z';

async function startDouble(name: string): Promise<Double> {
  const hits: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '';
    const path = url.split('?')[0] ?? '';
    hits.push(`${req.method} ${url}`);
    if (path.endsWith('/stream')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`id: 1\nevent: values\ndata: ${JSON.stringify({ served_by: name })}\n\n`);
      return;
    }
    if (url.includes('/runs/')) {
      const [threadId = '', runId = ''] = url.slice('/threads/'.length).split('/runs/').map(part => decodeURIComponent(part));
      res.writeHead(200, { 'content-type': 'application/json' });
      // The run carries the trusted identity the server checks: its engagement, request, assistant and context hash.
      const trusted = { engagement_id: 'eng-alpha', ui_request_id: 'req-1', ui_assistant_id: 'decepticon', graph_id: 'decepticon', ui_flow: 'execution', runtime_context_hash: 'hash' };
      res.end(JSON.stringify({ thread_id: threadId, run_id: runId, status: 'running', metadata: { served_by: name, ...trusted }, created_at: STAMP, updated_at: STAMP }));
      return;
    }
    if (url.startsWith('/threads/')) {
      const threadId = decodeURIComponent(url.slice('/threads/'.length));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ thread_id: threadId, metadata: { served_by: name } }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { name, url: `http://127.0.0.1:${port}`, hits, server };
}

class MemoryRoutes implements EnvironmentRouteSource {
  public readonly rows = new Map<string, EnvironmentRoute>();
  public async route(engagementId: string): Promise<EnvironmentRoute | null> { return this.rows.get(engagementId) ?? null; }
}

const ready = (environmentId: string, runtimeUrl: string, generation = 1): EnvironmentRoute => ({ environmentId, observedState: 'ready', generation, runtimeUrl });

let legacy: Double;
let alpha: Double;
let bravo: Double;
let routes: MemoryRoutes;
let router: RuntimeRouter;

beforeEach(async () => {
  legacy = await startDouble('legacy');
  alpha = await startDouble('alpha');
  bravo = await startDouble('bravo');
  routes = new MemoryRoutes();
  router = new RuntimeRouter(legacy.url, routes);
});

afterEach(async () => {
  for (const double of [legacy, alpha, bravo]) await new Promise(resolve => double.server.close(resolve));
});

describe('runtime routing by environment (ADR-0092)', () => {
  it('keeps a project without an environment record on the legacy runtime', async () => {
    const reads = await router.reads('eng-legacy');
    expect((await reads.thread('thread-1')).metadata.served_by).toBe('legacy');
    expect(legacy.hits).toHaveLength(1);
    expect(alpha.hits).toHaveLength(0);
  });

  it('sends each managed project only to its own ready runtime', async () => {
    routes.rows.set('eng-alpha', ready('env-alpha', alpha.url));
    routes.rows.set('eng-bravo', ready('env-bravo', bravo.url));
    expect((await (await router.reads('eng-alpha')).thread('t-a')).metadata.served_by).toBe('alpha');
    expect((await (await router.reads('eng-bravo')).thread('t-b')).metadata.served_by).toBe('bravo');
    expect(alpha.hits).toHaveLength(1);
    expect(bravo.hits).toHaveLength(1);
    expect(legacy.hits).toHaveLength(0);
  });

  it('refuses a stopped project with a named state and sends nothing to any runtime', async () => {
    routes.rows.set('eng-alpha', { ...ready('env-alpha', alpha.url), observedState: 'stopped' });
    routes.rows.set('eng-bravo', ready('env-bravo', bravo.url));
    const before = [legacy.hits.length, alpha.hits.length, bravo.hits.length];
    await expect(router.reads('eng-alpha')).rejects.toMatchObject({ state: 'stopped', statusCode: 503 });
    expect([legacy.hits.length, alpha.hits.length, bravo.hits.length]).toEqual(before);
  });

  it('answers every non-ready state explicitly, never with an empty or legacy result', async () => {
    for (const observedState of ['starting', 'stopping', 'uncertain', 'unprovisioned']) {
      routes.rows.set('eng-alpha', { ...ready('env-alpha', alpha.url), observedState });
      await expect(router.endpoint('eng-alpha')).rejects.toMatchObject({ state: observedState });
    }
    routes.rows.set('eng-alpha', { ...ready('env-alpha', alpha.url), runtimeUrl: null });
    await expect(router.endpoint('eng-alpha')).rejects.toBeInstanceOf(EnvironmentNotReadyError);
    expect(legacy.hits).toHaveLength(0);
  });

  it('follows a generation change to the new endpoint on the next call, not a cached one', async () => {
    routes.rows.set('eng-alpha', ready('env-alpha', alpha.url, 1));
    expect((await router.endpoint('eng-alpha')).apiUrl).toBe(alpha.url);
    routes.rows.set('eng-alpha', ready('env-alpha', bravo.url, 2));
    expect(await router.endpoint('eng-alpha')).toEqual({ apiUrl: bravo.url, environmentId: 'env-alpha', generation: 2 });
  });

  it('keeps a join stream on the runtime that answered its open', async () => {
    routes.rows.set('eng-alpha', ready('env-alpha', alpha.url));
    const join = await router.join('eng-alpha');
    const subscription = await join.open('t-a', 'run-1', '-1', new AbortController().signal);
    const frames: string[] = [];
    for await (const frame of subscription.frames) frames.push(String(frame.data));
    subscription.close();
    expect(frames.join('\n')).toContain('"served_by":"alpha"');
    expect(bravo.hits).toHaveLength(0);
  });

  it('refuses to open a join for a stopped project', async () => {
    routes.rows.set('eng-alpha', { ...ready('env-alpha', alpha.url), observedState: 'stopped' });
    await expect(router.join('eng-alpha')).rejects.toBeInstanceOf(EnvironmentNotReadyError);
    expect(alpha.hits).toHaveLength(0);
  });

  it('reports an unreachable endpoint as a runtime unavailability, not as success', async () => {
    routes.rows.set('eng-alpha', ready('env-alpha', 'http://127.0.0.1:1'));
    await expect((await router.reads('eng-alpha')).thread('t-a')).rejects.toBeInstanceOf(RuntimeUnavailableError);
  });
});

describe('RunService with the runtime router (ADR-0092)', () => {
  // Any call that bypasses the router would reach this proxy and fail the test.
  const bypass = new Proxy({}, { get: () => () => { throw new Error('a fixed runtime port was used while a router is configured'); } });
  const ownership = {
    runOwner: async () => ({ requestId: 'req-1', dispatchAssistantId: 'decepticon', dispatchKind: 'execution', dispatchConfigHash: 'hash' }),
    getBinding: async () => ({}),
    releaseCompletedRun: async () => undefined,
  };
  const service = () => new RunService({ ownership, context: {}, runtime: bypass, reads: bypass, router } as unknown as ConstructorParameters<typeof RunService>[0]);

  it('prepares an authorized managed environment before resolving a runtime or reserving a thread', async () => {
    routes.rows.set('eng-alpha', { ...ready('env-alpha', alpha.url), observedState: 'unprovisioned' });
    let authorized = false;
    const preparing = new RunService({
      ownership: { replay: async () => null }, context: {}, runtime: bypass, reads: bypass, router,
      authorizeMutation: async () => { authorized = true; },
      prepareEnvironment: async () => {
        expect(authorized).toBe(true);
        throw new ProjectPolicyError('conflict', 'Preparing environment', { field: 'environment' });
      },
    } as unknown as ConstructorParameters<typeof RunService>[0]);
    await expect(preparing.createThread('local', 'eng-alpha', { requestId: 'prepare-thread-0001', kind: 'planning' })).rejects.toMatchObject({ code: 'conflict', details: { field: 'environment' } });
    expect(legacy.hits).toHaveLength(0);
    expect(alpha.hits).toHaveLength(0);
  });

  it('reads a run from the runtime of its own engagement only', async () => {
    routes.rows.set('eng-alpha', ready('env-alpha', alpha.url));
    routes.rows.set('eng-bravo', ready('env-bravo', bravo.url));
    const view = await service().getRun('local', 'eng-alpha', 't-a', 'run-1');
    expect(view).toMatchObject({ engagementId: 'eng-alpha', runId: 'run-1', rawStatus: 'running' });
    expect(alpha.hits.some(hit => hit.includes('/runs/run-1'))).toBe(true);
    expect(bravo.hits).toHaveLength(0);
    expect(legacy.hits).toHaveLength(0);
  });

  it('refuses a run read for a stopped project without contacting any runtime', async () => {
    routes.rows.set('eng-alpha', { ...ready('env-alpha', alpha.url), observedState: 'stopped' });
    await expect(service().getRun('local', 'eng-alpha', 't-a', 'run-1')).rejects.toMatchObject({ state: 'stopped' });
    expect(alpha.hits).toHaveLength(0);
  });
});

describe('RuntimeContextService with the runtime router (ADR-0092)', () => {
  // The fixed legacy runtime must never answer for a managed project. Any call to it fails the test.
  const bypass = new Proxy({}, { get: () => () => { throw new Error('the fixed legacy runtime was used for a managed project'); } });

  it('discovers the agent catalog from the runtime of the engagement that asks', async () => {
    routes.rows.set('eng-alpha', ready('env-alpha', alpha.url));
    const config = { apiUrl: legacy.url, workspaceRoot: '/workspace', assistants: ['decepticon', 'soundwave'], perProjectSandbox: false };
    const context = new RuntimeContextService({
      config,
      workspaceRoot: '/workspace',
      projects: { getProject: async () => ({}), getPlanning: async () => ({}) },
      ownership: {},
      runtime: bypass,
      router: router,
    } as unknown as ConstructorParameters<typeof RuntimeContextService>[0]);
    // The double does not implement the catalog, so the call fails after it reaches the engagement's runtime. The
    // point under test is where the request goes: the first catalog read must hit alpha and never the legacy runtime.
    await expect(context.agents('eng-alpha')).rejects.toThrow();
    expect(alpha.hits.some(hit => hit.startsWith('GET /info'))).toBe(true);
    expect(legacy.hits.some(hit => hit.includes('/info'))).toBe(false);
  });
});
