import { describe, expect, it } from 'vitest';
import { isAssetMapDetail } from '../src/asset-map-detail.js';

const completeness = {
  loaded: 1,
  total: 1,
  hasMore: false,
  truncated: false,
  source: { catalog: 'ok', graph: 'ok' },
  revision: 'g8:1',
};
const asset = { assetId: 'asset_c6102d397ce0da5a2cc12930f027d2b9', kind: 'host', namespace: 'default', canonicalKey: '10.0.0.5' };
const provenance = { sources: [{ source: 'nmap', count: 1 }], graphNodes: 1, evidence: [{ source: 'nmap', sourceEpisodeId: 'ep-1', observedAt: null, artifactRef: null, capture: null }] };

describe('asset detail validator', () => {
  it('accepts services and endpoints detail bodies', () => {
    const services = { kind: 'services', items: [{ id: '4:s', port: 80, protocol: 'tcp', service: 'http', product: null, version: null, source: 'nmap', sourceEpisodeId: 'ep-1' }] };
    expect(isAssetMapDetail({ engagementId: 'eng-1', asset, provenance, detail: services, nextCursor: null, completeness })).toBe(true);
    const endpoints = { kind: 'endpoints', items: [{ id: '4:e', method: 'GET', path: '/', url: 'http://h/', statusCode: 200, source: 'katana', sourceEpisodeId: 'ep-2', parameters: [] }] };
    expect(isAssetMapDetail({ engagementId: 'eng-1', asset, provenance, detail: endpoints, nextCursor: 'abc', completeness: { ...completeness, hasMore: true } })).toBe(true);
  });

  it('requires a reason for an unsupported kind so it cannot read as an empty list', () => {
    const detail = { kind: 'unsupported', reason: 'no typed detail view for cloud_resource yet' };
    expect(isAssetMapDetail({ engagementId: 'eng-1', asset: { ...asset, kind: 'cloud_resource' }, provenance, detail, nextCursor: null, completeness: { ...completeness, total: null, loaded: 0 } })).toBe(true);
    expect(isAssetMapDetail({ engagementId: 'eng-1', asset, provenance, detail: { kind: 'unsupported' }, nextCursor: null, completeness })).toBe(false);
  });

  it('rejects an unknown detail kind', () => {
    expect(isAssetMapDetail({ engagementId: 'eng-1', asset, provenance, detail: { kind: 'graph' }, nextCursor: null, completeness })).toBe(false);
  });
});

describe('evidence captures', () => {
  it('accepts an evidence item linked to its capture and refuses a link without an id', () => {
    const linked = { ...provenance, evidence: [{ source: 'nmap', sourceEpisodeId: 'ep-1', observedAt: null, artifactRef: 'recon/nmap.xml', capture: { id: 'cap-1', path: 'findings/capture-cap-1.xml', digest: 'ab'.repeat(32), classification: 'standard' } }] }
    expect(isAssetMapDetail({ engagementId: 'eng-1', asset, provenance: linked, detail: { kind: 'services', items: [] }, nextCursor: null, completeness })).toBe(true)
    const broken = { ...provenance, evidence: [{ source: 'nmap', sourceEpisodeId: 'ep-1', observedAt: null, artifactRef: 'recon/nmap.xml', capture: { path: 'findings/x.xml', digest: 'ab', classification: 'standard' } }] }
    expect(isAssetMapDetail({ engagementId: 'eng-1', asset, provenance: broken, detail: { kind: 'services', items: [] }, nextCursor: null, completeness })).toBe(false)
  })
})

