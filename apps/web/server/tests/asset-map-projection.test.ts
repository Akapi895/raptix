import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { isAssetMapDetail, isAssetMapMembersPage, isAssetMapNeighborhood, isAssetMapOverview, isAssetMapSearchResult } from '@raptix/web-contracts';
import {
  ASSET_MAP_LIMITS,
  AssetMapInputError,
  AssetMapNotFoundError,
  AssetMapRevisionError,
  AssetMapService,
  fitPrefix,
  redactUrl,
} from '../src/services/asset-map-service.js';
import type { GraphConfig } from '../src/services/graph-service.js';
import { assetIdFor } from '../src/services/graph-service.js';

const SLUG = 'w13-graph-proj';
const ENGAGEMENT = 'eng-1';
const NO_GRAPH: GraphConfig = { httpUri: 'http://unused', user: 'neo4j', password: 'x' };

interface Row {
  id: string;
  engagementId: string;
  kind: string;
  namespace: string;
  canonicalKey: string;
  createdAt: Date;
}

function makeRows(count: number, kind = 'host'): Row[] {
  return Array.from({ length: count }, (_, index) => {
    const canonicalKey = `10.0.${Math.floor(index / 250)}.${index % 250}`;
    return {
      id: assetIdFor(SLUG, kind, 'default', canonicalKey),
      engagementId: ENGAGEMENT,
      kind,
      namespace: 'default',
      canonicalKey,
      createdAt: new Date('2026-10-20T10:00:00Z'),
    };
  });
}

/** Just enough of the Prisma surface AssetMapService uses, over in-memory rows. */
function fakeDb(rows: Row[]) {
  const scoped = (where: Record<string, unknown>) =>
    rows.filter(row => {
      if (where.engagementId !== undefined && row.engagementId !== where.engagementId) return false;
      if (where.kind !== undefined && row.kind !== where.kind) return false;
      if (where.id !== undefined && typeof where.id === 'string' && row.id !== where.id) return false;
      const idFilter = where.id as { gt?: string } | undefined;
      if (idFilter && typeof idFilter === 'object' && idFilter.gt !== undefined && !(row.id > idFilter.gt)) return false;
      const canonical = where.canonicalKey as { contains?: string } | undefined;
      if (canonical?.contains !== undefined && !row.canonicalKey.toLowerCase().includes(canonical.contains.toLowerCase())) return false;
      return true;
    });
  return {
    engagement: {
      findFirst: async () => ({ id: ENGAGEMENT, userId: 'local' }),
      findUnique: async () => ({ workspaceSlug: SLUG }),
    },
    assetIdentity: {
      findMany: async ({ where, take, orderBy }: { where: Record<string, unknown>; take?: number; orderBy?: Record<string, string> }) => {
        const key = orderBy ? Object.keys(orderBy)[0]! : 'id';
        const sorted = [...scoped(where)].sort((a, b) => (a[key as keyof Row] < b[key as keyof Row] ? -1 : 1));
        return take === undefined ? sorted : sorted.slice(0, take);
      },
      count: async ({ where }: { where: Record<string, unknown> }) => scoped(where).length,
      findFirst: async ({ where }: { where: Record<string, unknown> }) => scoped(where)[0] ?? null,
      aggregate: async ({ where }: { where: Record<string, unknown> }) => {
        const matched = scoped(where);
        const newest = matched.reduce<Date | null>((max, row) => (max === null || row.createdAt > max ? row.createdAt : max), null);
        return { _count: { _all: matched.length }, _max: { createdAt: newest } };
      },
      groupBy: async ({ where }: { where: Record<string, unknown> }) => {
        const counts = new Map<string, number>();
        for (const row of scoped(where)) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
        return [...counts].map(([kind, n]) => ({ kind, _count: { _all: n } }));
      },
    },
  } as never;
}

/** Neo4j HTTP stub that answers each statement by a key it contains; unknown statements get a harmless row. */
function neo4jRouter(routes: Array<[string, unknown[][]]>): Promise<{ server: Server; config: GraphConfig }> {
  return new Promise(resolve => {
    const server = createServer((request, response) => {
      let raw = '';
      request.on('data', chunk => {
        raw += chunk;
      });
      request.on('end', () => {
        const body = JSON.parse(raw) as { statements: Array<{ statement: string }> };
        const statement = body.statements[0]?.statement ?? '';
        const match = routes.find(([key]) => statement.includes(key));
        const rows = match ? match[1] : [];
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ results: [{ data: rows.map(row => ({ row })) }] }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, config: { httpUri: `http://127.0.0.1:${port}`, user: 'neo4j', password: 'x' } });
    });
  });
}

/** KG revision row in the shape KGStore.revision reads: counter, node timestamp, edge timestamp. */
const REVISION_ROW: [string, unknown[][]] = ['MATCH (v:KGRevision', [[3]]];

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function graph(routes: Array<[string, unknown[][]]>): Promise<GraphConfig> {
  const stub = await neo4jRouter([REVISION_ROW, ...routes]);
  servers.push(stub.server);
  return stub.config;
}

describe('AssetMapService overview', () => {
  it('reports per-kind totals and a catalog revision, with the graph not queried', async () => {
    const rows = [...makeRows(3, 'host'), ...makeRows(2, 'web_origin')];
    const view = await new AssetMapService(fakeDb(rows), NO_GRAPH).overview('local', ENGAGEMENT);
    expect(isAssetMapOverview(view)).toBe(true);
    expect(view.groups).toEqual([
      { kind: 'host', total: 3 },
      { kind: 'web_origin', total: 2 },
    ]);
    expect(view.completeness).toMatchObject({ loaded: 5, total: 5, hasMore: false, source: { catalog: 'ok', graph: 'not_queried' } });
  });
});

describe('AssetMapService members paging', () => {
  it('pages by identity with the total reported separately from the loaded slice', async () => {
    const service = new AssetMapService(fakeDb(makeRows(7)), NO_GRAPH);
    const first = await service.members('local', ENGAGEMENT, 'host', null, 3);
    expect(isAssetMapMembersPage(first)).toBe(true);
    expect(first.items).toHaveLength(3);
    expect(first.completeness).toMatchObject({ loaded: 3, total: 7, hasMore: true });
    const second = await service.members('local', ENGAGEMENT, 'host', first.nextCursor, 3);
    const seen = [...first.items, ...second.items].map(item => item.assetId);
    expect(new Set(seen).size).toBe(6);
  });

  it('refuses a cursor issued under an older catalog revision', async () => {
    const rows = makeRows(4);
    const service = new AssetMapService(fakeDb(rows), NO_GRAPH);
    const first = await service.members('local', ENGAGEMENT, 'host', null, 2);
    rows.push({ ...makeRows(1, 'host')[0]!, id: assetIdFor(SLUG, 'host', 'default', '10.9.9.9'), canonicalKey: '10.9.9.9', createdAt: new Date('2026-10-21T00:00:00Z') });
    await expect(service.members('local', ENGAGEMENT, 'host', first.nextCursor, 2)).rejects.toBeInstanceOf(AssetMapRevisionError);
  });

  it('rejects a malformed cursor as input, not as a server fault', async () => {
    const service = new AssetMapService(fakeDb(makeRows(2)), NO_GRAPH);
    await expect(service.members('local', ENGAGEMENT, 'host', 'not-a-cursor', 2)).rejects.toBeInstanceOf(AssetMapInputError);
  });
});

describe('AssetMapService search', () => {
  it('matches canonical keys case-insensitively and bounds the result', async () => {
    const view = await new AssetMapService(fakeDb(makeRows(60)), NO_GRAPH).search('local', ENGAGEMENT, '10.0.', ASSET_MAP_LIMITS.searchDefault);
    expect(isAssetMapSearchResult(view)).toBe(true);
    expect(view.items).toHaveLength(ASSET_MAP_LIMITS.searchDefault);
    expect(view.completeness).toMatchObject({ loaded: ASSET_MAP_LIMITS.searchDefault, total: 60, hasMore: true });
  });

  it('rejects a one-character query before touching the catalog', async () => {
    await expect(new AssetMapService(fakeDb(makeRows(2)), NO_GRAPH).search('local', ENGAGEMENT, '1')).rejects.toBeInstanceOf(AssetMapInputError);
  });
});

describe('redactUrl', () => {
  it('drops credentials and fragments and masks sensitive query values', () => {
    expect(redactUrl('https://alice:hunter2@app.example.com/reset?token=abc123&page=2#frag')).toBe('https://app.example.com/reset?token=REDACTED&page=2');
  });

  it('leaves an ordinary URL unchanged and refuses to echo an unparseable one', () => {
    expect(redactUrl('http://10.0.0.1:8080/users?id=1')).toBe('http://10.0.0.1:8080/users?id=1');
    expect(redactUrl('not a url at all')).toBe('[unparseable url]');
  });
});

describe('AssetMapService neighborhood', () => {
  const center = makeRows(1)[0]!;
  const centerRoute: [string, unknown[][]] = ['elementId(c) AS id', [['4:c', ['Host'], '10.0.0.0']]];

  it('returns every centre with its incident edges and the graph source marked ok', async () => {
    const config = await graph([
      centerRoute,
      ['elementId(r) AS rid', [['5:1', '4:c', '4:s', 'HOSTS', '4:s', ['Service'], null, '10.0.0.0:80/tcp']]],
    ]);
    const view = await new AssetMapService(fakeDb([center]), config).neighborhood('local', ENGAGEMENT, center.id);
    expect(isAssetMapNeighborhood(view)).toBe(true);
    expect(view.centers.map(node => node.assetId)).toEqual([center.id]);
    expect(view.edges).toEqual([{ id: '5:1', source: '4:c', target: '4:s', type: 'HOSTS' }]);
    expect(view.nodes.map(node => node.id)).toEqual(['4:s']);
    expect(view.nextCursor).toBeNull();
    expect(view.completeness).toMatchObject({ loaded: 1, total: null, hasMore: false, truncated: false, source: { graph: 'ok' } });
  });

  it('pages edges with a cursor when the store has more than one page', async () => {
    const rows = Array.from({ length: ASSET_MAP_LIMITS.neighborEdges + 1 }, (_, i) => [`5:${i}`, '4:c', `4:${i}`, 'HOSTS', `4:${i}`, ['Service'], null, `svc-${i}`]);
    const config = await graph([centerRoute, ['elementId(r) AS rid', rows]]);
    const service = new AssetMapService(fakeDb([center]), config);
    const first = await service.neighborhood('local', ENGAGEMENT, center.id);
    expect(first.edges).toHaveLength(ASSET_MAP_LIMITS.neighborEdges);
    expect(first.completeness).toMatchObject({ hasMore: true, loaded: ASSET_MAP_LIMITS.neighborEdges });
    expect(first.nextCursor).not.toBeNull();
    const second = await service.neighborhood('local', ENGAGEMENT, center.id, first.nextCursor);
    expect(second.completeness.revision).toBe(first.completeness.revision);
  });

  it('trims trailing items to fit a byte budget and reports the cut', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: `4:${i}`, pad: 'x'.repeat(10_000) }));
    const kept = fitPrefix(items, 100_000, list => ({ items: list }));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(items.length);
    expect(Buffer.byteLength(JSON.stringify({ items: kept }), 'utf8')).toBeLessThanOrEqual(100_000);
  });

  it('answers not-found for an asset outside the engagement catalog', async () => {
    const config = await graph([]);
    await expect(new AssetMapService(fakeDb([]), config).neighborhood('local', ENGAGEMENT, center.id)).rejects.toBeInstanceOf(AssetMapNotFoundError);
  });

  it('rejects an identifier that is not an asset id', async () => {
    const config = await graph([]);
    await expect(new AssetMapService(fakeDb([center]), config).neighborhood('local', ENGAGEMENT, 'host::10.0.0.1')).rejects.toBeInstanceOf(AssetMapInputError);
  });
});

const DETAIL_ROUTES: Array<[string, unknown[][]]> = [
  ['coalesce(n.source, \'unknown\') AS source, count(n)', [['nmap', 2], ['httpx', 1]]],
  ['coalesce(n.source, \'unknown\') AS source, n.source_episode_id', [['nmap', 'ep-scan-1', 1792500000]]],
  ['count(s) AS count', [[2]]],
  ['elementId(s) AS id', [['4:s1', 80, 'tcp', 'http', 'nginx', '1.18', 'nmap', 'ep-scan-1'], ['4:s2', 22, 'tcp', 'ssh', null, null, 'nmap', 'ep-scan-1']]],
  ['count(e) AS count', [[1]]],
  ['elementId(e) AS id', [['4:e1', 'GET', '/users', 'https://app.example.com/users?id=1&token=abc', 200, 'katana', 'ep-crawl-1', ['id', 'token']]]],
];

describe('AssetMapService detail', () => {
  it('lists services for a host with evidence and a complete total', async () => {
    const host = makeRows(1)[0]!;
    const view = await new AssetMapService(fakeDb([host]), await graph(DETAIL_ROUTES)).detail('local', ENGAGEMENT, host.id, null, 50);
    expect(isAssetMapDetail(view)).toBe(true);
    expect(view.detail).toEqual({
      kind: 'services',
      items: [
        { id: '4:s1', port: 80, protocol: 'tcp', service: 'http', product: 'nginx', version: '1.18', source: 'nmap', sourceEpisodeId: 'ep-scan-1' },
        { id: '4:s2', port: 22, protocol: 'tcp', service: 'ssh', product: null, version: null, source: 'nmap', sourceEpisodeId: 'ep-scan-1' },
      ],
    });
    expect(view.provenance.sources).toEqual([
      { source: 'nmap', count: 2 },
      { source: 'httpx', count: 1 },
    ]);
    expect(view.provenance.evidence).toEqual([{ source: 'nmap', sourceEpisodeId: 'ep-scan-1', observedAt: new Date(1792500000 * 1000).toISOString(), artifactRef: null, capture: null }]);
    expect(view.completeness).toMatchObject({ loaded: 2, total: 2, hasMore: false, source: { graph: 'ok' } });
  });

  it('pages services and refuses a cursor from an older graph revision', async () => {
    const host = makeRows(1)[0]!;
    const service = new AssetMapService(fakeDb([host]), await graph(DETAIL_ROUTES));
    const first = await service.detail('local', ENGAGEMENT, host.id, null, 1);
    expect(first.detail.kind === 'services' && first.detail.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const stale = Buffer.from(JSON.stringify({ r: 'rev-old-0:0:0', k: '1' }), 'utf8').toString('base64url');
    await expect(service.detail('local', ENGAGEMENT, host.id, stale, 1)).rejects.toBeInstanceOf(AssetMapRevisionError);
  });

  it('redacts endpoint URLs and reports parameters on the endpoint, with evidence per item', async () => {
    const origin = makeRows(1, 'web_origin')[0]!;
    const view = await new AssetMapService(fakeDb([origin]), await graph(DETAIL_ROUTES)).detail('local', ENGAGEMENT, origin.id, null, 50);
    expect(view.detail).toEqual({
      kind: 'endpoints',
      items: [
        {
          id: '4:e1',
          method: 'GET',
          path: '/users',
          url: 'https://app.example.com/users?id=1&token=REDACTED',
          statusCode: 200,
          source: 'katana',
          sourceEpisodeId: 'ep-crawl-1',
          parameters: ['id', 'token'],
        },
      ],
    });
    expect(view.completeness.total).toBe(1);
  });

  it('trims detail items to the byte budget and resumes after the last kept item', async () => {
    const origin = makeRows(1, 'web_origin')[0]!;
    const long = 'p'.repeat(4000);
    const many = Array.from({ length: 100 }, (_, i) => [`4:e${i}`, 'GET', `/${long}${i}`, `https://app.example.com/${long}${i}`, 200, 'katana', 'ep', [long]]);
    const routes = [...DETAIL_ROUTES.filter(([key]) => key !== 'elementId(e) AS id'), ['elementId(e) AS id', many] as [string, unknown[][]]];
    const view = await new AssetMapService(fakeDb([origin]), await graph(routes)).detail('local', ENGAGEMENT, origin.id, null, 100);
    expect(Buffer.byteLength(JSON.stringify(view), 'utf8')).toBeLessThanOrEqual(ASSET_MAP_LIMITS.detailBytes);
    expect(view.completeness.truncated).toBe(true);
    expect(view.nextCursor).not.toBeNull();
  });

  it('answers unsupported with a reason for a kind that has no typed view yet', async () => {
    const cloud = makeRows(1, 'cloud_resource')[0]!;
    const view = await new AssetMapService(fakeDb([cloud]), await graph(DETAIL_ROUTES)).detail('local', ENGAGEMENT, cloud.id, null, 50);
    expect(view.detail).toEqual({ kind: 'unsupported', reason: 'no typed detail view for cloud_resource yet' });
    expect(view.completeness.total).toBeNull();
    expect(isAssetMapDetail(view)).toBe(true);
  });

  it('rejects an unknown asset and a malformed identifier', async () => {
    const service = new AssetMapService(fakeDb([]), await graph(DETAIL_ROUTES));
    await expect(service.detail('local', ENGAGEMENT, makeRows(1)[0]!.id, null, 50)).rejects.toBeInstanceOf(AssetMapNotFoundError);
    await expect(service.detail('local', ENGAGEMENT, 'web_origin::x', null, 50)).rejects.toBeInstanceOf(AssetMapInputError);
  });
});
