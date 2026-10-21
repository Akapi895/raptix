import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { isAssetMapDetail } from '@raptix/web-contracts';
import { AssetMapInputError, AssetMapNotFoundError, AssetMapService, catalogIdForWebAsset } from '../src/services/asset-map-service.js';
import { GraphUnavailableError, type GraphConfig, assetIdFor } from '../src/services/graph-service.js';
import { ProjectApiError } from '../src/services/projects-service.js';

// Domain detail on the server: service and endpoint grouping, paging with a filter, and the access
// and failure paths. The graph is a recording Neo4j HTTP stub, so each test can read the parameters the
// service sent with every statement.

const SLUG = 'w13-domain-detail';
const ENGAGEMENT = 'eng-1';
const OWNER = 'owner-1';
const MEMBER = 'viewer-1';
const STRANGER = 'stranger-1';
const CREATED = new Date('2026-10-20T10:00:00Z');

function row(kind: string, canonicalKey: string) {
  return { id: assetIdFor(SLUG, kind, 'default', canonicalKey), engagementId: ENGAGEMENT, kind, namespace: 'default', canonicalKey, createdAt: CREATED };
}

const HOST = row('host', '10.0.0.5');
const ORIGIN = row('web_origin', 'http://app.example.com:80');
const DNS = row('dns_name', 'app.example.com');

/** Captures imported from workspace artifacts: one in this engagement, one for the same path in another engagement. */
const CAPTURES = [
  { id: 'cap-1', engagementId: ENGAGEMENT, path: 'findings/capture-cap-1.xml', digest: 'a'.repeat(64), classification: 'unclassified', producer: 'workspace:recon/nmap.xml' },
  { id: 'cap-v2', engagementId: ENGAGEMENT, path: 'findings/capture-cap-v2.xml', digest: 'e'.repeat(64), classification: 'standard', producer: 'workspace:recon/nmap.xml' },
  { id: 'cap-other', engagementId: 'eng-other', path: 'findings/capture-cap-other.xml', digest: 'b'.repeat(64), classification: 'standard', producer: 'workspace:recon/unimported.xml' },
];

/** Web inventory: two host identifiers the catalog can resolve, an IPv6 address it cannot, and web URLs for origins. */
const WEB_ASSETS = [
  { id: 'wa-ip', kind: 'host', identifier: '10.0.0.5' },
  { id: 'wa-dns', kind: 'host', identifier: 'App.Example.com.' },
  { id: 'wa-url', kind: 'web_url', identifier: 'http://10.0.0.5:8080' },
  { id: 'wa-v6', kind: 'host', identifier: 'fe80::1' },
  { id: 'wa-origin', kind: 'web_url', identifier: 'HTTP://App.Example.com:80/login?next=/a' },
  { id: 'wa-https', kind: 'web_url', identifier: 'https://app.example.com/' },
  { id: 'wa-port', kind: 'web_url', identifier: 'http://app.example.com:8080/' },
];
/** Findings with their owning record: three name a web asset, one names none. */
const FINDINGS = [
  { id: 'f-1', title: 'Open admin panel', severity: 'high', status: 'draft', assetId: 'wa-ip', updatedAt: new Date('2026-10-20T11:00:00Z') },
  { id: 'f-2', title: 'Weak TLS', severity: 'medium', status: 'confirmed', assetId: 'wa-ip', updatedAt: new Date('2026-10-20T10:00:00Z') },
  { id: 'f-3', title: 'Stale banner', severity: 'low', status: 'draft', assetId: 'wa-dns', updatedAt: new Date('2026-10-20T09:00:00Z') },
  { id: 'f-4', title: 'On a URL', severity: 'low', status: 'draft', assetId: 'wa-url', updatedAt: new Date('2026-10-20T08:00:00Z') },
  { id: 'f-5', title: 'No owner', severity: 'info', status: 'draft', assetId: null, updatedAt: new Date('2026-10-20T07:00:00Z') },
  { id: 'f-6', title: 'Login form served over HTTP', severity: 'medium', status: 'draft', assetId: 'wa-origin', updatedAt: new Date('2026-10-20T06:00:00Z') },
  { id: 'f-7', title: 'Redirect to HTTPS', severity: 'info', status: 'draft', assetId: 'wa-https', updatedAt: new Date('2026-10-20T05:00:00Z') },
  { id: 'f-8', title: 'Admin on port 8080', severity: 'low', status: 'draft', assetId: 'wa-port', updatedAt: new Date('2026-10-20T04:00:00Z') },
];

/** Prisma surface the service touches: the owner, one viewer, catalog rows, web inventory and findings. */
function fakeDb() {
  const rows = [HOST, ORIGIN, DNS];
  const linkedTo = (where: { assetId?: unknown }) => {
    const ids = (where.assetId as { in?: string[] } | undefined)?.in;
    return ids === undefined ? FINDINGS : FINDINGS.filter(item => item.assetId !== null && ids.includes(item.assetId));
  };
  const unlinkedOf = (where: { OR?: Array<{ assetId: null | { notIn: string[] } }> }) => {
    const notIn = where.OR?.find(clause => clause.assetId !== null && typeof clause.assetId === 'object')?.assetId as { notIn: string[] };
    return FINDINGS.filter(item => item.assetId === null || (notIn !== undefined && !notIn.notIn.includes(item.assetId)));
  };
  return {
    engagement: {
      findFirst: async ({ where }: { where: { id: string } }) => (where.id === ENGAGEMENT ? { id: ENGAGEMENT, userId: OWNER } : null),
      findUnique: async () => ({ workspaceSlug: SLUG }),
    },
    webMembership: {
      findFirst: async ({ where }: { where: { userId: string } }) =>
        where.userId === MEMBER ? { engagementId: ENGAGEMENT, userId: MEMBER, role: 'viewer' } : null,
    },
    assetIdentity: {
      findFirst: async ({ where }: { where: { engagementId: string; id: string } }) =>
        rows.find(item => item.engagementId === where.engagementId && item.id === where.id) ?? null,
      findMany: async ({ where }: { where: { engagementId: string; id: { in: string[] } } }) =>
        rows.filter(item => item.engagementId === where.engagementId && where.id.in.includes(item.id)),
    },
    webAsset: {
      findMany: async () => WEB_ASSETS,
    },
    retainedCapture: {
      findMany: async ({ where }: { where: { engagementId: string; producer: { in: string[] } } }) =>
        CAPTURES.filter(item => item.engagementId === where.engagementId && where.producer.in.includes(item.producer)),
    },
    findingRecord: {
      findMany: async ({ where, take }: { where: { assetId?: unknown }; take?: number }) => linkedTo(where).slice(0, take),
      groupBy: async ({ where }: { where: { assetId?: unknown } }) => {
        const counts = new Map<string, number>();
        for (const item of linkedTo(where)) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
        return [...counts].map(([status, n]) => ({ status, _count: { _all: n } }));
      },
      count: async ({ where }: { where: { OR?: Array<{ assetId: null | { notIn: string[] } }> } }) => unlinkedOf(where).length,
    },
  } as never;
}

type Statement = { statement: string; parameters: Record<string, unknown> };

/** Neo4j HTTP stub: answers each statement by a key it contains and records every statement it was sent. */
async function recordingGraph(routes: Array<[string, unknown[][]]>): Promise<{ config: GraphConfig; sent: Statement[]; close: () => void }> {
  const sent: Statement[] = [];
  const table: Array<[string, unknown[][]]> = [
    ['MATCH (v:KGRevision', [[3]]],
    ...routes,
  ];
  const server: Server = createServer((request, response) => {
    let raw = '';
    request.on('data', chunk => {
      raw += chunk;
    });
    request.on('end', () => {
      const body = JSON.parse(raw) as { statements: Statement[] };
      const first = body.statements[0]!;
      sent.push(first);
      const match = table.find(([key]) => first.statement.includes(key));
      const rows = match ? match[1] : [];
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ results: [{ data: rows.map(item => ({ row: item })) }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  return { config: { httpUri: `http://127.0.0.1:${port}`, user: 'neo4j', password: 'x' }, sent, close: () => server.close() };
}

const SERVICE_ROUTES: Array<[string, unknown[][]]> = [
  ['ORDER BY source LIMIT 50', [['nmap', 2]]],
  ['ORDER BY observed DESC LIMIT 20', []],
  ['RETURN count(s) AS count', [[2]]],
  ['ORDER BY s.port SKIP $skip LIMIT $limit', [
    ['4:s1', 22, 'tcp', 'ssh', null, null, 'nmap', 'ep-1'],
    ['4:s2', 80, 'tcp', 'http', 'nginx', '1.18', 'nmap', 'ep-1'],
  ]],
];

const ENDPOINT_ROUTES: Array<[string, unknown[][]]> = [
  ['ORDER BY source LIMIT 50', [['katana', 2]]],
  ['ORDER BY observed DESC LIMIT 20', []],
  ['RETURN count(e) AS count', [[2]]],
  ['ORDER BY e.path, e.method SKIP $skip LIMIT $limit', [
    ['4:e1', 'GET', '/login', 'http://app.example.com:80/login?token=REDACTED', 200, 'katana', 'crawl-1', ['token']],
    ['4:e2', 'GET', '/users', 'http://app.example.com:80/users', 200, 'katana', 'crawl-1', []],
  ]],
];

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function graphFor(routes: Array<[string, unknown[][]]>): Promise<GraphConfig> {
  const stub = await recordingGraph(routes);
  closers.push(stub.close);
  return stub.config;
}

describe('domain detail: services of a host', () => {
  it('lists a host\'s services under the host identity and reports the complete total', async () => {
    const config = await graphFor(SERVICE_ROUTES);
    const view = await new AssetMapService(fakeDb(), config).detail(OWNER, ENGAGEMENT, HOST.id, null, 50);
    expect(isAssetMapDetail(view)).toBe(true);
    expect(view.detail.kind).toBe('services');
    expect(view.completeness).toMatchObject({ loaded: 2, total: 2, hasMore: false, source: { graph: 'ok' } });
  });
});

describe('domain detail: sitemap of an origin', () => {
  it('redacts each endpoint URL and reports the parameter names on the endpoint', async () => {
    const config = await graphFor(ENDPOINT_ROUTES);
    const view = await new AssetMapService(fakeDb(), config).detail(OWNER, ENGAGEMENT, ORIGIN.id, null, 50);
    // The default port is dropped by URL normalization, the same form the catalog shows.
    expect(view.detail).toMatchObject({
      kind: 'endpoints',
      items: [
        { id: '4:e1', url: 'http://app.example.com/login?token=REDACTED', parameters: ['token'] },
        { id: '4:e2', url: 'http://app.example.com/users', parameters: [] },
      ],
    });
  });

  it('sends the filter to both the count and the page, and only as a parameter', async () => {
    const stub = await recordingGraph(ENDPOINT_ROUTES);
    closers.push(stub.close);
    await new AssetMapService(fakeDb(), stub.config).detail(OWNER, ENGAGEMENT, ORIGIN.id, null, 50, 'login');
    const endpointStatements = stub.sent.filter(item => item.statement.includes('count(e)') || item.statement.includes('e.path, e.method'));
    expect(endpointStatements.map(item => item.parameters.filter)).toEqual(['login', 'login']);
    expect(endpointStatements.every(item => item.parameters.assetId === ORIGIN.id)).toBe(true);
    expect(endpointStatements.every(item => !item.statement.includes('login'))).toBe(true);
  });

  it('issues a cursor for the filter it was read with and refuses it under another filter', async () => {
    const stub = await recordingGraph(ENDPOINT_ROUTES);
    closers.push(stub.close);
    const service = new AssetMapService(fakeDb(), stub.config);
    const first = await service.detail(OWNER, ENGAGEMENT, ORIGIN.id, null, 1, 'login');
    expect(first.nextCursor).not.toBeNull();
    await expect(service.detail(OWNER, ENGAGEMENT, ORIGIN.id, first.nextCursor, 1, '')).rejects.toBeInstanceOf(AssetMapInputError);
    await service.detail(OWNER, ENGAGEMENT, ORIGIN.id, first.nextCursor, 1, 'login');
    const pages = stub.sent.filter(item => item.statement.includes('ORDER BY e.path, e.method'));
    expect(pages.at(-1)?.parameters).toMatchObject({ filter: 'login', skip: 1 });
  });

  it('labels every identity lookup, so the planner can seek the index instead of scanning the graph', async () => {
    const stub = await recordingGraph([...SERVICE_ROUTES, ...ENDPOINT_ROUTES]);
    closers.push(stub.close);
    const service = new AssetMapService(fakeDb(), stub.config);
    await service.detail(OWNER, ENGAGEMENT, HOST.id, null, 50);
    await service.detail(OWNER, ENGAGEMENT, ORIGIN.id, null, 50);
    await service.neighborhood(OWNER, ENGAGEMENT, HOST.id);
    const lookups = stub.sent.filter(item => /\basset_id\b|\borigin_asset_id\b/.test(item.statement));
    expect(lookups.length).toBeGreaterThan(0);
    for (const item of lookups) expect(item.statement).toMatch(/MATCH \(\w+:(Host|Entrypoint|Endpoint)\b/);
  });

  it('refuses a filter longer than the server accepts before any graph read', async () => {
    const stub = await recordingGraph(ENDPOINT_ROUTES);
    closers.push(stub.close);
    const tooLong = 'a'.repeat(201);
    await expect(new AssetMapService(fakeDb(), stub.config).detail(OWNER, ENGAGEMENT, ORIGIN.id, null, 50, tooLong)).rejects.toBeInstanceOf(AssetMapInputError);
    expect(stub.sent).toEqual([]);
  });
});

describe('domain detail: access and failures', () => {
  it('lets a project member with the viewer role read the detail, not only the owner', async () => {
    const view = await new AssetMapService(fakeDb(), await graphFor(SERVICE_ROUTES)).detail(MEMBER, ENGAGEMENT, HOST.id, null, 50);
    expect(view.detail.kind).toBe('services');
  });

  it('answers a stranger with not-found, the same as for a project that does not exist', async () => {
    const service = new AssetMapService(fakeDb(), await graphFor(SERVICE_ROUTES));
    await expect(service.detail(STRANGER, ENGAGEMENT, HOST.id, null, 50)).rejects.toBeInstanceOf(ProjectApiError);
  });

  it('answers an asset that belongs to another engagement with not-found', async () => {
    const service = new AssetMapService(fakeDb(), await graphFor(SERVICE_ROUTES));
    await expect(service.detail(OWNER, 'eng-other', HOST.id, null, 50)).rejects.toBeInstanceOf(ProjectApiError);
    await expect(service.detail(OWNER, ENGAGEMENT, row('host', '10.9.9.9').id, null, 50)).rejects.toBeInstanceOf(AssetMapNotFoundError);
  });

  it('reports an unreachable graph as unavailable, which the route answers with 503 and never an empty view', async () => {
    const service = new AssetMapService(fakeDb(), { httpUri: 'http://127.0.0.1:1', user: 'neo4j', password: 'x' });
    await expect(service.detail(OWNER, ENGAGEMENT, HOST.id, null, 50)).rejects.toBeInstanceOf(GraphUnavailableError);
  });
});

const UNUSED_GRAPH: GraphConfig = { httpUri: 'http://127.0.0.1:1', user: 'neo4j', password: 'x' };

describe('findings on an asset', () => {
  it('links a finding only through an owning web asset that resolves to the asset, without the graph', async () => {
    const view = await new AssetMapService(fakeDb(), UNUSED_GRAPH).overlay(OWNER, ENGAGEMENT, HOST.id);
    expect(view.linked.total).toBe(2);
    expect(view.linked.byStatus).toEqual({ draft: 1, confirmed: 1 });
    expect(view.linked.items.map(item => item.id)).toEqual(['f-1', 'f-2']);
    expect(view.unlinkedFindings).toBe(4);
  });

  it('links the finding of a DNS-name asset to that asset and leaves the rest unlinked', async () => {
    const view = await new AssetMapService(fakeDb(), UNUSED_GRAPH).overlay(OWNER, ENGAGEMENT, DNS.id);
    expect(view.linked.items.map(item => item.id)).toEqual(['f-3']);
    expect(view.unlinkedFindings).toBe(4);
  });

  it('links a finding on a web URL to the origin it names, whatever its path, and to no other origin', async () => {
    const view = await new AssetMapService(fakeDb(), UNUSED_GRAPH).overlay(OWNER, ENGAGEMENT, ORIGIN.id);
    expect(view.linked.items.map(item => item.id)).toEqual(['f-6']);
    expect(view.linked.byStatus).toEqual({ draft: 1 });
    expect(view.unlinkedFindings).toBe(4);
  });

  it('keeps web URLs on another scheme, another port or another engagement away from the origin', () => {
    expect(catalogIdForWebAsset(SLUG, { kind: 'web_url', identifier: 'https://app.example.com/' })).not.toBe(ORIGIN.id);
    expect(catalogIdForWebAsset(SLUG, { kind: 'web_url', identifier: 'http://app.example.com:8080/' })).not.toBe(ORIGIN.id);
    expect(catalogIdForWebAsset('other-engagement', { kind: 'web_url', identifier: 'HTTP://App.Example.com:80/login' })).not.toBe(ORIGIN.id);
  });

  it('counts a finding on an identity the catalog does not hold as unlinked, not as linked', async () => {
    const view = await new AssetMapService(fakeDb(), UNUSED_GRAPH).overlay(OWNER, ENGAGEMENT, ORIGIN.id);
    expect(view.linked.items.map(item => item.id)).not.toContain('f-4');
    expect(view.unlinkedFindings).toBe(4);
  });

  it('keeps a stranger out of the overlay the same way as the rest of the asset map', async () => {
    await expect(new AssetMapService(fakeDb(), UNUSED_GRAPH).overlay('stranger-1', ENGAGEMENT, HOST.id)).rejects.toBeInstanceOf(ProjectApiError);
  });
});

describe('web inventory identities', () => {
  it('resolves host and web URL identifiers the way the catalog does, and nothing else', () => {
    expect(catalogIdForWebAsset(SLUG, { kind: 'host', identifier: '10.0.0.5' })).toBe(HOST.id);
    expect(catalogIdForWebAsset(SLUG, { kind: 'host', identifier: 'App.Example.com.' })).toBe(DNS.id);
    expect(catalogIdForWebAsset(SLUG, { kind: 'web_url', identifier: 'HTTP://App.Example.com:80/login' })).toBe(ORIGIN.id);
    expect(catalogIdForWebAsset(SLUG, { kind: 'web_url', identifier: 'http://10.0.0.5:8080' })).toBe(assetIdFor(SLUG, 'web_origin', 'default', 'http://10.0.0.5:8080'));
    expect(catalogIdForWebAsset(SLUG, { kind: 'web_url', identifier: 'ftp://files.example.com/' })).toBeNull();
    expect(catalogIdForWebAsset(SLUG, { kind: 'other', identifier: 'http://app.example.com/' })).toBeNull();
    expect(catalogIdForWebAsset(SLUG, { kind: 'host', identifier: 'fe80::1' })).toBeNull();
    // Leading zeros are not an IPv4 address, so the runtime reads it as a DNS name; the web side must agree.
    expect(catalogIdForWebAsset(SLUG, { kind: 'host', identifier: '010.0.0.5' })).toBe(assetIdFor(SLUG, 'dns_name', 'default', '010.0.0.5'));
  });
});

describe('evidence and captures', () => {
  it('links an observation only to the imported version whose digest it was parsed from, in the same engagement', async () => {
    const evidence = [
      ['nmap', 'ep-1', 1792500000, 'recon/nmap.xml', 'a'.repeat(64)],
      ['nmap', 'ep-2', 1792500001, 'recon/nmap.xml', 'e'.repeat(64)],
      ['nmap', 'ep-3', 1792500002, 'recon/nmap.xml', 'd'.repeat(64)],
      ['nmap', 'ep-4', 1792500003, 'recon/nmap.xml', null],
      ['nmap', 'ep-5', 1792500004, 'recon/unimported.xml', 'b'.repeat(64)],
      ['httpx', 'ep-6', 1792500005, null, null],
    ];
    const routes = [...SERVICE_ROUTES.filter(([key]) => !key.includes('observed DESC')), ['ORDER BY observed DESC LIMIT 20', evidence] as [string, unknown[][]]];
    const view = await new AssetMapService(fakeDb(), await graphFor(routes)).detail(OWNER, ENGAGEMENT, HOST.id, null, 50);
    expect(view.provenance.evidence.map(item => [item.artifactRef, item.artifactDigest?.slice(0, 1) ?? null, item.capture?.id ?? null])).toEqual([
      ['recon/nmap.xml', 'a', 'cap-1'],
      ['recon/nmap.xml', 'e', 'cap-v2'],
      ['recon/nmap.xml', 'd', null],
      ['recon/nmap.xml', null, null],
      ['recon/unimported.xml', 'b', null],
      [null, null, null],
    ]);
    expect(view.provenance.evidence[0]?.capture).toEqual({ id: 'cap-1', path: 'findings/capture-cap-1.xml', digest: 'a'.repeat(64), classification: 'unclassified' });
  });
});

