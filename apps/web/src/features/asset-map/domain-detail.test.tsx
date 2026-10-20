import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectStore } from '../../state/stores'

const fetchOverview = vi.fn()
const fetchMembers = vi.fn()
const fetchNeighborhood = vi.fn()
const fetchDetail = vi.fn()

vi.mock('../../real/asset-map-api', () => ({
  fetchAssetMapOverview: (...args: unknown[]) => fetchOverview(...args),
  fetchAssetMapMembers: (...args: unknown[]) => fetchMembers(...args),
  fetchAssetMapNeighborhood: (...args: unknown[]) => fetchNeighborhood(...args),
  fetchAssetMapDetail: (...args: unknown[]) => fetchDetail(...args),
}))
vi.mock('./AssetMapCanvas', () => ({ AssetMapCanvas: () => <div data-testid="asset-map-canvas" /> }))

const completeness = { loaded: 1, total: 1, hasMore: false, truncated: false, source: { catalog: 'ok', graph: 'ok' }, revision: 'rev-1' }
const host = { assetId: 'asset_a', kind: 'host', namespace: 'default', canonicalKey: '10.0.0.1' }
const origin = { assetId: 'asset_o', kind: 'web_origin', namespace: 'default', canonicalKey: 'http://10.0.0.1:80' }
const provenance = { sources: [{ source: 'katana', count: 2 }], graphNodes: 2, evidence: [{ source: 'katana', sourceEpisodeId: 'crawl-1', observedAt: null }] }

beforeEach(() => {
  for (const fn of [fetchOverview, fetchMembers, fetchNeighborhood, fetchDetail]) fn.mockReset()
  globalThis.localStorage.clear()
  useProjectStore.setState({ pid: 'eng-1' })
  fetchOverview.mockResolvedValue({ engagementId: 'eng-1', groups: [], completeness })
  fetchMembers.mockImplementation((_e: string, kind: string) =>
    Promise.resolve({ engagementId: 'eng-1', kind, items: kind === 'host' ? [host] : kind === 'web_origin' ? [origin] : [], nextCursor: null, completeness }))
  fetchNeighborhood.mockResolvedValue({ engagementId: 'eng-1', assetId: 'asset_o', centers: [], nodes: [], edges: [], nextCursor: null, completeness })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('domain detail renderer', () => {
  it('shows the sitemap of a web origin with redacted URLs, parameters and per-item episode', async () => {
    fetchDetail.mockResolvedValueOnce({
      engagementId: 'eng-1',
      asset: origin,
      provenance,
      detail: { kind: 'endpoints', items: [{ id: '4:e', method: 'GET', path: '/users', url: 'http://10.0.0.1:80/users?id=1&token=REDACTED', statusCode: 200, source: 'katana', sourceEpisodeId: 'crawl-1', parameters: ['id', 'token'] }] },
      nextCursor: null,
      completeness,
    })
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'http://10.0.0.1:80' }))
    const sitemap = await screen.findByRole('region', { name: 'Sitemap' })
    expect(within(sitemap).getByText('http://10.0.0.1:80/users?id=1&token=REDACTED')).toBeTruthy()
    expect(within(sitemap).getByText('id, token')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Services' })).toBeNull()
  });

  it('states why a kind has no typed view instead of showing an empty list', async () => {
    fetchDetail.mockResolvedValueOnce({
      engagementId: 'eng-1',
      asset: host,
      provenance,
      detail: { kind: 'unsupported', reason: 'no typed detail view for host yet' },
      nextCursor: null,
      completeness: { ...completeness, loaded: 0, total: null },
    })
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    fireEvent.click(await screen.findByRole('button', { name: '10.0.0.1' }))
    expect(await screen.findByText('no typed detail view for host yet')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Services' })).toBeNull()
  });

  it('appends the next page of services without repeating rows already on screen', async () => {
    const row = (id: string, port: number) => ({ id, port, protocol: 'tcp', service: 'http', product: null, version: null, source: 'nmap', sourceEpisodeId: 'scan-1' })
    fetchDetail
      .mockResolvedValueOnce({ engagementId: 'eng-1', asset: host, provenance, detail: { kind: 'services', items: [row('4:1', 22)] }, nextCursor: 'next', completeness })
      .mockResolvedValueOnce({ engagementId: 'eng-1', asset: host, provenance, detail: { kind: 'services', items: [row('4:2', 80)] }, nextCursor: null, completeness })
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    fireEvent.click(await screen.findByRole('button', { name: '10.0.0.1' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    const services = await screen.findByRole('region', { name: 'Services' })
    await waitFor(() => expect(within(services).getAllByRole('row').length).toBe(3))
    expect(fetchDetail.mock.calls[1]).toEqual(['eng-1', 'asset_a', 'next'])
  });
});
