import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphService, assetIdFor } from '../src/services/graph-service.js';
import type { GraphConfig } from '../src/services/graph-service.js';

const SLUG = 'w13-graph-proj';

// Expected values produced by raptix_core.types.asset.asset_id (Python) for the same inputs.
const PYTHON_HOST_ID = 'asset_c6102d397ce0da5a2cc12930f027d2b9';
const PYTHON_ORIGIN_ID = 'asset_55b8f466a41ed6e19f6d69460cb63e2f';

describe('assetIdFor parity with raptix_core', () => {
  it('derives the same identifiers as the Python runtime', () => {
    expect(assetIdFor(SLUG, 'host', 'default', '10.0.0.5')).toBe(PYTHON_HOST_ID);
    expect(assetIdFor(SLUG, 'web_origin', 'default', 'https://app.example.com:443')).toBe(PYTHON_ORIGIN_ID);
  });
});

/** Neo4j HTTP tx stub that answers the reconcile query with fixed identity rows. */
function neo4jRows(rows: unknown[][]): Promise<{ server: Server; config: GraphConfig }> {
  return new Promise(resolve => {
    const server = createServer((request, response) => {
      request.resume();
      request.on('end', () => {
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

function fakeDb(created: Array<Record<string, unknown>>) {
  return {
    engagement: {
      findFirst: async () => ({ id: 'eng-1', userId: 'local' }),
      findUnique: async () => ({ workspaceSlug: SLUG }),
    },
    assetIdentity: {
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        created.push(...data);
        return { count: data.length };
      },
    },
  } as never;
}

describe('GraphService.reconcileCatalog', () => {
  it('catalogues valid identities once and reports every rejected row by reason', async () => {
    const host = assetIdFor(SLUG, 'host', 'default', '10.0.0.5');
    const { server, config } = await neo4jRows([
      [host, 'host', 'default', '10.0.0.5', 1],
      [host, 'host', 'default', '10.0.0.5', 1],
      ['asset_00000000000000000000000000000000', 'host', 'default', '10.0.0.6', 1],
      [assetIdFor(SLUG, 'printer', 'default', 'lobby'), 'printer', 'default', 'lobby', 1],
      [assetIdFor(SLUG, 'host', 'default', '10.0.0.7', 2), 'host', 'default', '10.0.0.7', 2],
    ]);
    servers.push(server);

    const created: Array<Record<string, unknown>> = [];
    const service = new GraphService(fakeDb(created), config);
    const report = await service.reconcileCatalog('local', 'eng-1');

    expect(report.observed).toBe(5);
    expect(report.created).toBe(1);
    expect(created).toEqual([
      { id: host, engagementId: 'eng-1', kind: 'host', namespace: 'default', canonicalKey: '10.0.0.5', keyVersion: 1 },
    ]);
    expect(report.rejected.sort((a, b) => a.reason.localeCompare(b.reason))).toEqual([
      { reason: 'id_mismatch', count: 1 },
      { reason: 'unknown_kind', count: 1 },
      { reason: 'unsupported_key_version', count: 1 },
    ]);
  });
});
