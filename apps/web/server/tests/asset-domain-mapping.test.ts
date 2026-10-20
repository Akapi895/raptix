import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { isAssetMapDetail } from '@raptix/web-contracts';
import { AssetMapService } from '../src/services/asset-map-service.js';
import { assetIdFor, type GraphConfig } from '../src/services/graph-service.js';

// Domain mapping on the server (plan phase 7): every catalogued kind gets the typed view it has data for,
// and every other kind answers "unsupported" with a reason. Nothing is filled with host-shaped rows.

const SLUG = 'w13-domain-mapping';
const ENGAGEMENT = 'eng-1';
const OWNER = 'owner-1';
const CREATED = new Date('2026-10-20T10:00:00Z');

const CASES = [
  { kind: 'host', canonicalKey: '10.0.0.7', typed: 'services' },
  { kind: 'dns_name', canonicalKey: 'app.example.com', typed: 'services' },
  { kind: 'web_origin', canonicalKey: 'http://app.example.com:80', typed: 'endpoints' },
  { kind: 'identity', canonicalKey: 'svc-backup', typed: 'unsupported' },
  { kind: 'device', canonicalKey: 'plc-7', typed: 'unsupported' },
  { kind: 'artifact', canonicalKey: 'sha256:abc', typed: 'unsupported' },
  { kind: 'cloud_resource', canonicalKey: 'arn:aws:s3:::bucket', typed: 'unsupported' },
  { kind: 'mobile_app', canonicalKey: 'com.example.app', typed: 'unsupported' },
  { kind: 'network_segment', canonicalKey: '10.0.0.0/24', typed: 'unsupported' },
] as const;

const SERVICE_ROUTES: Array<[string, unknown[][]]> = [
  ['ORDER BY source LIMIT 50', [['nmap', 1]]],
  ['ORDER BY observed DESC LIMIT 20', []],
  ['RETURN count(s) AS count', [[1]]],
  ['ORDER BY s.port SKIP $skip LIMIT $limit', [['4:s1', 443, 'tcp', 'https', null, null, 'nmap', 'ep-1']]],
];
const ENDPOINT_ROUTES: Array<[string, unknown[][]]> = [
  ['ORDER BY source LIMIT 50', [['katana', 1]]],
  ['ORDER BY observed DESC LIMIT 20', []],
  ['RETURN count(e) AS count', [[1]]],
  ['ORDER BY e.path, e.method SKIP $skip LIMIT $limit', [['4:e1', 'GET', '/', 'http://app.example.com:80/', 200, 'katana', 'crawl-1', []]]],
];

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function graph(routes: Array<[string, unknown[][]]>): Promise<GraphConfig> {
  const table: Array<[string, unknown[][]]> = [['CALL () { MATCH (v:KGRevision', [[1, 1792500000, 1792500000]]], ...routes];
  const server: Server = createServer((request, response) => {
    let raw = '';
    request.on('data', chunk => {
      raw += chunk;
    });
    request.on('end', () => {
      const body = JSON.parse(raw) as { statements: Array<{ statement: string }> };
      const statement = body.statements[0]?.statement ?? '';
      const match = table.find(([key]) => statement.includes(key));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ results: [{ data: (match ? match[1] : []).map(item => ({ row: item })) }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  closers.push(() => server.close());
  const port = (server.address() as { port: number }).port;
  return { httpUri: `http://127.0.0.1:${port}`, user: 'neo4j', password: 'x' };
}

function fakeDb(kind: string, canonicalKey: string) {
  const row = { id: assetIdFor(SLUG, kind, 'default', canonicalKey), engagementId: ENGAGEMENT, kind, namespace: 'default', canonicalKey, createdAt: CREATED };
  return {
    engagement: {
      findFirst: async () => ({ id: ENGAGEMENT, userId: OWNER }),
      findUnique: async () => ({ workspaceSlug: SLUG }),
    },
    assetIdentity: {
      findFirst: async ({ where }: { where: { id: string } }) => (where.id === row.id ? row : null),
    },
  } as never;
}

describe('domain mapping: each catalogued kind has its own view or says it has none', () => {
  it.each(CASES)('answers $kind with the $typed view', async ({ kind, canonicalKey, typed }) => {
    const routes = typed === 'services' ? SERVICE_ROUTES : typed === 'endpoints' ? ENDPOINT_ROUTES : [];
    const service = new AssetMapService(fakeDb(kind, canonicalKey), await graph(routes));
    const view = await service.detail(OWNER, ENGAGEMENT, assetIdFor(SLUG, kind, 'default', canonicalKey), null, 50);
    expect(isAssetMapDetail(view)).toBe(true);
    expect(view.asset.kind).toBe(kind);
    expect(view.detail.kind).toBe(typed);
    if (typed === 'unsupported') {
      expect(view.detail.kind === 'unsupported' && view.detail.reason).toContain(kind);
      expect(view.nextCursor).toBeNull();
      expect(view.completeness.total).toBeNull();
    }
  });
});
