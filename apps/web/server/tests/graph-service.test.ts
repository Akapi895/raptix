import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { isAssetsView, isGraphView } from '@raptix/web-contracts';
import { GraphService, neo4jQuery, toAssetSummaries } from '../src/services/graph-service.js';
import type { GraphConfig } from '../src/services/graph-service.js';

/** Minimal Neo4j HTTP tx endpoint stub: echoes canned rows for the scoped query. */
function neo4jStub(rows: unknown, statusCode = 200, body?: unknown): Promise<{ server: Server; url: Promise<string> }> {
  return new Promise(resolve => {
    const server = createServer((request, response) => {
      let raw = '';
      request.on('data', chunk => { raw += chunk });
      request.on('end', () => {
        const parsed = JSON.parse(raw) as { statements?: Array<{ statement?: string; parameters?: Record<string, unknown> }> };
        const auth = request.headers.authorization ?? '';
        if (!auth.startsWith('Basic ') || Buffer.from(auth.slice(6), 'base64').toString() !== 'neo4j:gate-secret') {
          response.writeHead(401, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ errors: ['unauthorized'] }));
          return;
        }
        lastStatement = parsed.statements?.[0]?.statement ?? '';
        lastParameters = parsed.statements?.[0]?.parameters ?? {};
        response.writeHead(statusCode, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body ?? { results: [{ data: [{ row: rows }] }] }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: new Promise<string>(done => done(`http://127.0.0.1:${(server.address() as { port: number }).port}`)) }));
  });
}
let lastStatement = '';
let lastParameters: Record<string, unknown> = {};

const db = {
  engagement: {
    findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
      where.id === 'eng-1' && where.userId === 'local' ? { id: 'eng-1', name: 'w13-graph-proj', workspaceSlug: 'w13-graph-proj' } : null,
  },
} as never;

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve()));
});

const config = (uri: string) => ({ httpUri: uri, user: 'neo4j', password: 'gate-secret' });

it('W01: scopes the KG query by the global workspace slug, not the per-owner display name', async () => {
  const stub = await neo4jStub([[{ id: '4:a:1', labels: ['Host'], properties: { hostname: 'dc01' } }], []]);
  servers.push(stub.server);
  const url = await stub.url;
  const db = {
    engagement: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        where.id === 'eng-1' && where.userId === 'local' ? { id: 'eng-1', name: 'shared-display-name', workspaceSlug: 'unique-partition' } : null,
    },
  } as never;
  const view = await new GraphService(db, config(url)).graph('local', 'eng-1');
  expect(view.engagementId).toBe('eng-1');
  expect(lastParameters.engagement).toBe('unique-partition');
  expect(lastParameters.engagement).not.toBe('shared-display-name');
});

describe('W13 scoped graph projection', () => {
  it('projects an engagement-scoped graph with whitelisted, redacted properties and bounded edges', async () => {
    const stub = await neo4jStub([[
      { id: '4:a:1', labels: ['Host'], properties: { hostname: 'dc01.corp', ip: '10.0.1.5', password: 'hunter2', ntlm: 'NTLM:aabbccdd0011', os: 'Windows Server 2022', engagement: 'w13-graph-proj', internal_note: 'drop me', banner: 'creds=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c' } },
      { id: '4:a:2', labels: ['WebUrl'], properties: { url: 'https://api.corp/v1', title: 'API v1' } },
    ], [
      { id: '5:a:1', source: '4:a:1', target: '4:a:2', type: 'OPEN_PORT', properties: { port: 443, secret: 'zzz' } },
      { id: '5:a:2', source: '4:a:1', target: '4:OUTSIDE:9', type: 'LEAK', properties: {} },
      { id: '5:a:1', source: '4:a:1', target: '4:a:2', type: 'OPEN_PORT', properties: {} },
    ]]);
    servers.push(stub.server);
    const url = await stub.url;
    const view = await new GraphService(db, config(url)).graph('local', 'eng-1');
    expect(isGraphView(view)).toBe(true);
    expect(view.engagementId).toBe('eng-1');
    expect(view.nodes).toHaveLength(2);
    const host = view.nodes[0]!;
    expect(host.properties).toMatchObject({ hostname: 'dc01.corp', ip: '10.0.1.5', os: 'Windows Server 2022', engagement: 'w13-graph-proj' });
    expect(host.properties.password).toBeUndefined();
    expect(host.properties.ntlm).toBeUndefined();
    expect(host.properties.internal_note).toBeUndefined();
    expect(host.properties.banner).toBe('[REDACTED]');
    expect(JSON.stringify(view)).not.toContain('hunter2');
    expect(view.edges).toHaveLength(1);
    expect(view.edges[0]!.properties).toEqual({ port: 443 });
    expect(view.truncated).toBe(false);
    expect(lastParameters).toMatchObject({ engagement: 'w13-graph-proj' });
    expect(lastStatement).toContain('n.engagement = $engagement');
    expect(lastStatement).toContain('m.engagement = $engagement');
  });
  it('keeps a scoped empty graph truthful (200) and distinct from an unavailable store (503)', async () => {
    const empty = await neo4jStub([[], []]);
    servers.push(empty.server);
    const service = new GraphService(db, config(await empty.url));
    const view = await service.graph('local', 'eng-1');
    expect(view.nodes).toEqual([]);
    expect(view.edges).toEqual([]);
    expect(view.truncated).toBe(false);
    await expect(service.graph('local', 'eng-other')).rejects.toMatchObject({ name: 'ProjectNotFoundError' });
    const closed = createServer();
    await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
    const closedPort = (closed.address() as { port: number }).port;
    await new Promise<void>(resolve => closed.close(() => resolve()));
    const down = new GraphService(db, { httpUri: `http://127.0.0.1:${closedPort}`, user: 'neo4j', password: 'gate-secret' });
    await expect(down.graph('local', 'eng-1')).rejects.toBeInstanceOf(Error);
    await expect(down.graph('local', 'eng-1')).rejects.toThrow(/ECONNREFUSED/i);
  });
  it('derives deduped asset summaries from the graph projection without collapsing distinct assets', () => {
    const assets = toAssetSummaries({
      nodes: [
        { id: '1', labels: ['Host'], properties: { hostname: 'dc01.corp', ip: '10.0.1.5', os: 'Windows' } },
        { id: '2', labels: ['Host'], properties: { hostname: 'dc01.corp', ip: '10.0.1.5', port: 445 } },
        { id: '3', labels: ['Host'], properties: { hostname: 'dc01.corp', ip: '10.0.1.9' } },
        { id: '4', labels: ['WebUrl'], properties: { url: 'https://api.corp', finding_id: 'FIND-2026-001 CVE-2024-49113' } },
        { id: '5', labels: ['Identity'], properties: { username: 'CORP\\svc_backup' } },
        { id: '6', labels: ['MobileApk'], properties: { name: 'com.corp.app' } },
      ],
      edges: [],
    });
    expect(assets).toHaveLength(5);
    expect(assets[0]).toMatchObject({ type: 'Host', label: 'dc01.corp', hostname: 'dc01.corp', ip: '10.0.1.5', os: 'Windows', ports: ['445'] });
    expect(assets[1]).toMatchObject({ type: 'Host', ip: '10.0.1.9' });
    expect(assets[2]).toMatchObject({ type: 'Web', label: 'https://api.corp', relatedFindingIds: ['FIND-2026-001', 'CVE-2024-49113'] });
    expect(assets[3]).toMatchObject({ type: 'Identity', label: 'CORP\\svc_backup' });
    expect(assets[4]).toMatchObject({ type: 'Mobile', label: 'com.corp.app' });
  });
  it('W24: keeps bounded service arrays and does not collapse unnamed nodes', () => {
    const assets = toAssetSummaries({
      nodes: [
        { id: 'u1', labels: ['Host'], properties: { services: ['http', 'https'] } },
        { id: 'u2', labels: ['Host'], properties: {} },
        { id: 'h1', labels: ['Host'], properties: { ip: '10.0.0.7', services: ['ssh'] } },
      ],
      edges: [],
    });
    const withServices = assets.find((a) => a.ip === '10.0.0.7')
    expect(withServices?.services).toEqual(['ssh'])
    const arrayServices = assets.find((a) => Array.isArray(a.services) && a.services.includes('http'))
    expect(arrayServices?.services).toEqual(['http', 'https'])
    // Two identity-less nodes stay distinct rather than merging into one.
    expect(assets.filter((a) => a.ip === undefined).length).toBeGreaterThanOrEqual(2)
  });
  it('serves graph and assets routes with 503 unavailable vs 404 foreign scoping', async () => {
    const { registerGraphRoutes } = await import('../src/http/routes/graph.routes.js');
    const stub = await neo4jStub([[], []]);
    servers.push(stub.server);
    const { default: Fastify } = await import('fastify');
    const app = Fastify({ logger: false });
    const service = new GraphService(db, config(await stub.url));
    registerGraphRoutes(app, service, { id: 'local', mode: 'local-single-user' });
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/api/engagements/eng-1/graph' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/engagements/eng-1/assets' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/engagements/eng-other/graph' })).statusCode).toBe(404);
    const failing = await neo4jStub(null, 200, { results: [] });
    servers.push(failing.server);
    const broken = Fastify({ logger: false });
    registerGraphRoutes(broken, new GraphService(db, config(await failing.url)), { id: 'local', mode: 'local-single-user' });
    await broken.ready();
    expect((await broken.inject({ method: 'GET', url: '/api/engagements/eng-1/graph' })).statusCode).toBe(503);
    expect((await broken.inject({ method: 'GET', url: '/api/engagements/eng-1/assets' })).statusCode).toBe(503);
    expect(isAssetsView((await app.inject({ method: 'GET', url: '/api/engagements/eng-1/assets' })).json())).toBe(true);
    await app.close();
    await broken.close();
  });
});

describe('W16 graph result semantics', () => {
  const cfg = (uri: string): GraphConfig => ({ httpUri: uri, user: 'neo4j', password: 'gate-secret' });

  it('resolves a successful empty result and rejects malformed responses and Neo4j query errors as distinct classes', async () => {
    const empty = await neo4jStub(null, 200, { results: [{ data: [] }] });
    servers.push(empty.server);
    await expect(neo4jQuery(cfg(await empty.url), 'RETURN 1', {})).resolves.toEqual([]);

    const malformed = await neo4jStub(null, 200, { unexpected: true });
    servers.push(malformed.server);
    await expect(neo4jQuery(cfg(await malformed.url), 'RETURN 1', {})).rejects.toMatchObject({ name: 'GraphQueryError', message: expect.stringMatching(/malformed/i) });

    const queryError = await neo4jStub(null, 200, { errors: [{ code: 'Neo.ClientError.Statement.SyntaxError', message: 'Invalid syntax' }], results: [] });
    servers.push(queryError.server);
    await expect(neo4jQuery(cfg(await queryError.url), 'RETURN 1', {})).rejects.toMatchObject({
      name: 'GraphQueryError',
      message: expect.stringMatching(/Neo\.ClientError\.Statement\.SyntaxError/),
    });

    const auth = await neo4jStub(null, 401, { errors: ['unauthorized'] });
    servers.push(auth.server);
    await expect(neo4jQuery(cfg(await auth.url), 'RETURN 1', {})).rejects.toMatchObject({ name: 'GraphUnavailableError', message: /authentication/i });
  });

  it('keeps a successful empty graph projection truthful after the result-semantics change', async () => {
    const empty = await neo4jStub([[], []]);
    servers.push(empty.server);
    const view = await new GraphService(db, cfg(await empty.url)).graph('local', 'eng-1');
    expect(view.nodes).toEqual([]);
    expect(view.edges).toEqual([]);
  });
});
