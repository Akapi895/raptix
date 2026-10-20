import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { isAssetMapMembersPage, isAssetMapNeighborhood, isAssetMapOverview, isAssetMapSearchResult } from '@raptix/web-contracts';
import {
  ASSET_MAP_LIMITS,
  AssetMapInputError,
  AssetMapNotFoundError,
  AssetMapRevisionError,
  AssetMapService,
} from '../src/services/asset-map-service.js';
import type { GraphConfig } from '../src/services/graph-service.js';
import { assetIdFor } from '../src/services/graph-service.js';

const SLUG = 'w13-graph-proj';
const ENGAGEMENT = 'eng-1';

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

/** Neo4j HTTP stub that answers the revision query and the neighborhood query separately. */
function neo4jStub(neighborRows: unknown[][]): Promise<{ server: Server; config: GraphConfig }> {
  return new Promise(resolve => {
    const server = createServer((request, response) => {
      let raw = '';
      request.on('data', chunk => {
        raw += chunk;
      });
      request.on('end', () => {
        const body = JSON.parse(raw) as { statements: Array<{ statement: string }> };
        const statement = body.statements[0]?.statement ?? '';
        const rows = statement.includes('count(n)') ? [[4, '2026-10-20T10:00:00Z']] : neighborRows;
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

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

describe('AssetMapService overview', () => {
  it('reports per-kind totals and a catalog revision, with the graph not queried', async () => {
    const rows = [...makeRows(3, 'host'), ...makeRows(2, 'web_origin')];
    const service = new AssetMapService(fakeDb(rows), { httpUri: 'http://unused', user: 'neo4j', password: 'x' });
    const view = await service.overview('local', ENGAGEMENT);
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
    const service = new AssetMapService(fakeDb(makeRows(7)), { httpUri: 'http://unused', user: 'neo4j', password: 'x' });
    const first = await service.members('local', ENGAGEMENT, 'host', null, 3);
    expect(isAssetMapMembersPage(first)).toBe(true);
    expect(first.items).toHaveLength(3);
    expect(first.completeness).toMatchObject({ loaded: 3, total: 7, hasMore: true });
    expect(first.nextCursor).not.toBeNull();

    const second = await service.members('local', ENGAGEMENT, 'host', first.nextCursor, 3);
    const seen = [...first.items, ...second.items].map(item => item.assetId);
    expect(new Set(seen).size).toBe(6);
    expect(second.completeness.hasMore).toBe(true);
  });

  it('refuses a cursor issued under an older revision instead of skipping or repeating rows', async () => {
    const rows = makeRows(4);
    const service = new AssetMapService(fakeDb(rows), { httpUri: 'http://unused', user: 'neo4j', password: 'x' });
    const first = await service.members('local', ENGAGEMENT, 'host', null, 2);
    rows.push({ ...makeRows(1, 'host')[0]!, id: assetIdFor(SLUG, 'host', 'default', '10.9.9.9'), canonicalKey: '10.9.9.9', createdAt: new Date('2026-10-21T00:00:00Z') });
    await expect(service.members('local', ENGAGEMENT, 'host', first.nextCursor, 2)).rejects.toBeInstanceOf(AssetMapRevisionError);
  });

  it('rejects a malformed cursor as input, not as a server fault', async () => {
    const service = new AssetMapService(fakeDb(makeRows(2)), { httpUri: 'http://unused', user: 'neo4j', password: 'x' });
    await expect(service.members('local', ENGAGEMENT, 'host', 'not-a-cursor', 2)).rejects.toBeInstanceOf(AssetMapInputError);
  });
});

describe('AssetMapService search', () => {
  it('matches canonical keys case-insensitively and bounds the result', async () => {
    const service = new AssetMapService(fakeDb(makeRows(60)), { httpUri: 'http://unused', user: 'neo4j', password: 'x' });
    const view = await service.search('local', ENGAGEMENT, '10.0.0.', ASSET_MAP_LIMITS.searchDefault);
    expect(isAssetMapSearchResult(view)).toBe(true);
    expect(view.items).toHaveLength(ASSET_MAP_LIMITS.searchDefault);
    expect(view.completeness).toMatchObject({ loaded: ASSET_MAP_LIMITS.searchDefault, total: 60, hasMore: true });
  });

  it('rejects a one-character query before touching the catalog', async () => {
    const service = new AssetMapService(fakeDb(makeRows(2)), { httpUri: 'http://unused', user: 'neo4j', password: 'x' });
    await expect(service.search('local', ENGAGEMENT, '1')).rejects.toBeInstanceOf(AssetMapInputError);
  });
});

describe('AssetMapService neighborhood', () => {
  const center = makeRows(1)[0]!;
  const assetId = center.id;

  it('returns a bounded neighborhood with the graph source marked ok', async () => {
    const rows = [['5:1', '4:a', '4:b', 'HOSTS', '4:b', ['Service'], null, '10.0.0.0:80/tcp', '4:a', ['Host'], '10.0.0.0']];
    const { server, config } = await neo4jStub(rows);
    servers.push(server);
    const service = new AssetMapService(fakeDb([center]), config);
    const view = await service.neighborhood('local', ENGAGEMENT, assetId);
    expect(isAssetMapNeighborhood(view)).toBe(true);
    expect(view.edges).toEqual([{ id: '5:1', source: '4:a', target: '4:b', type: 'HOSTS' }]);
    expect(view.completeness).toMatchObject({ loaded: 1, total: null, hasMore: false, truncated: false, source: { graph: 'ok' } });
    expect(view.nodes.map(node => node.assetId)).toEqual([assetId, null]);
  });

  it('marks the response truncated when the store has more edges than the bound', async () => {
    const rows = Array.from({ length: ASSET_MAP_LIMITS.neighborEdges + 1 }, (_, i) => [`5:${i}`, '4:a', `4:${i}`, 'HOSTS', `4:${i}`, ['Service'], null, `svc-${i}`, '4:a', ['Host'], '10.0.0.1']);
    const { server, config } = await neo4jStub(rows);
    servers.push(server);
    const service = new AssetMapService(fakeDb(makeRows(1)), config);
    const view = await service.neighborhood('local', ENGAGEMENT, assetId);
    expect(view.edges).toHaveLength(ASSET_MAP_LIMITS.neighborEdges);
    expect(view.completeness).toMatchObject({ hasMore: true, truncated: true, loaded: ASSET_MAP_LIMITS.neighborEdges });
  });

  it('trims edges to fit the byte budget and says so', async () => {
    const big = 'x'.repeat(4000);
    const rows = Array.from({ length: 200 }, (_, i) => [`5:${i}`, '4:a', `4:${i}`, 'HOSTS', `4:${i}`, ['Service'], null, big, '4:a', ['Host'], '10.0.0.1']);
    const { server, config } = await neo4jStub(rows);
    servers.push(server);
    const service = new AssetMapService(fakeDb(makeRows(1)), config);
    const view = await service.neighborhood('local', ENGAGEMENT, assetId);
    expect(Buffer.byteLength(JSON.stringify(view), 'utf8')).toBeLessThanOrEqual(ASSET_MAP_LIMITS.neighborhoodBytes);
    expect(view.completeness.truncated).toBe(true);
  });

  it('answers not-found for an asset outside the engagement catalog', async () => {
    const { server, config } = await neo4jStub([]);
    servers.push(server);
    const service = new AssetMapService(fakeDb([]), config);
    await expect(service.neighborhood('local', ENGAGEMENT, assetId)).rejects.toBeInstanceOf(AssetMapNotFoundError);
  });

  it('rejects an identifier that is not an asset id', async () => {
    const { server, config } = await neo4jStub([]);
    servers.push(server);
    const service = new AssetMapService(fakeDb(makeRows(1)), config);
    await expect(service.neighborhood('local', ENGAGEMENT, 'host::10.0.0.1')).rejects.toBeInstanceOf(AssetMapInputError);
  });
});

