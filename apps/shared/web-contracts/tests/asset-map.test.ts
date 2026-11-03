import { describe, expect, it } from 'vitest';
import {
  isAssetMapCompleteness,
  isAssetMapMembersPage,
  isAssetMapNeighborhood,
  isAssetMapOverview,
  isAssetMapSearchResult,
} from '../src/asset-map.js';

const completeness = {
  loaded: 2,
  total: 2,
  hasMore: false,
  truncated: false,
  source: { catalog: 'ok', graph: 'not_queried' },
  revision: 'rev-1',
};

const ref = { assetId: 'asset_c6102d397ce0da5a2cc12930f027d2b9', kind: 'host', namespace: 'default', canonicalKey: '10.0.0.5' };

describe('asset map read-model validators', () => {
  it('accepts a bounded overview with an explicit total', () => {
    expect(isAssetMapOverview({ engagementId: 'eng-1', groups: [{ kind: 'host', total: 2 }], completeness })).toBe(true);
  });

  it('accepts a members page with a cursor and rejects unknown kinds', () => {
    expect(isAssetMapMembersPage({ engagementId: 'eng-1', kind: 'host', items: [ref], nextCursor: 'abc', completeness: { ...completeness, hasMore: true, total: 9 } })).toBe(true);
    expect(isAssetMapMembersPage({ engagementId: 'eng-1', kind: 'host', items: [{ ...ref, kind: 'printer' }], nextCursor: null, completeness })).toBe(false);
  });

  it('accepts search results and rejects a missing completeness block', () => {
    expect(isAssetMapSearchResult({ engagementId: 'eng-1', query: '10.0', items: [ref], completeness })).toBe(true);
    expect(isAssetMapSearchResult({ engagementId: 'eng-1', query: '10.0', items: [ref] })).toBe(false);
  });

  it('accepts a neighborhood whose nodes may lack a catalog identity', () => {
    expect(
      isAssetMapNeighborhood({
        engagementId: 'eng-1',
        assetId: ref.assetId,
        centers: [{ id: '4:a', assetId: ref.assetId, labels: ['Host'], label: '10.0.0.5' }],
        nextCursor: null,
        nodes: [
          { id: '4:a', assetId: ref.assetId, labels: ['Host'], label: '10.0.0.5' },
          { id: '4:b', assetId: null, labels: ['Service'], label: '10.0.0.5:80/tcp' },
        ],
        edges: [{ id: '5:1', source: '4:a', target: '4:b', type: 'HOSTS' }],
        completeness,
      }),
    ).toBe(true);
  });

  it('keeps unknown total distinct from zero by requiring null or a number', () => {
    expect(isAssetMapCompleteness({ ...completeness, total: null })).toBe(true);
    expect(isAssetMapCompleteness({ ...completeness, total: '0' })).toBe(false);
    expect(isAssetMapCompleteness({ ...completeness, source: { catalog: 'fine', graph: 'ok' } })).toBe(false);
  });
});
