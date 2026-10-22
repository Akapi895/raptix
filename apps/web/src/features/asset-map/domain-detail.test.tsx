import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectStore } from '../../state/stores'

const fetchOverview = vi.fn()
const fetchMembers = vi.fn()
const fetchNeighborhood = vi.fn()
const fetchDetail = vi.fn()
const fetchOverlay = vi.fn()
const fetchSearch = vi.fn()

vi.mock('./api', () => ({
  fetchAssetMapOverview: (...args: unknown[]) => fetchOverview(...args),
  fetchAssetMapMembers: (...args: unknown[]) => fetchMembers(...args),
  fetchAssetMapNeighborhood: (...args: unknown[]) => fetchNeighborhood(...args),
  fetchAssetMapDetail: (...args: unknown[]) => fetchDetail(...args),
  fetchAssetMapOverlay: (...args: unknown[]) => fetchOverlay(...args),
  fetchAssetMapSearch: (...args: unknown[]) => fetchSearch(...args),
}))
vi.mock('../../platform/session', () => ({ useSession: () => ({ session: { actor: { id: 'user-1' } } }) }))
vi.mock('./AssetMapCanvas', () => ({ AssetMapCanvas: () => <div data-testid="asset-map-canvas" /> }))

const completeness = { loaded: 1, total: 1, hasMore: false, truncated: false, source: { catalog: 'ok', graph: 'ok' }, revision: 'rev-1' }
const host = { assetId: 'asset_a', kind: 'host', namespace: 'default', canonicalKey: '10.0.0.1' }
const origin = { assetId: 'asset_o', kind: 'web_origin', namespace: 'default', canonicalKey: 'http://10.0.0.1:80' }
const provenance = { sources: [{ source: 'katana', count: 2 }], graphNodes: 2, evidence: [{ source: 'katana', sourceEpisodeId: 'crawl-1', observedAt: null }] }
const savedKey = 'raptix.assetMap.selected.user-1.eng-1'

beforeEach(() => {
  for (const fn of [fetchOverview, fetchMembers, fetchNeighborhood, fetchDetail, fetchOverlay]) fn.mockReset()
  globalThis.localStorage.clear()
  useProjectStore.setState({ pid: 'eng-1' })
  fetchOverview.mockResolvedValue({ engagementId: 'eng-1', groups: [], completeness })
  fetchMembers.mockImplementation((_e: string, kind: string) =>
    Promise.resolve({ engagementId: 'eng-1', kind, items: kind === 'host' ? [host] : kind === 'web_origin' ? [origin] : [], nextCursor: null, completeness }))
  fetchNeighborhood.mockResolvedValue({ engagementId: 'eng-1', assetId: 'asset_o', centers: [], nodes: [], edges: [], nextCursor: null, completeness })
  fetchOverlay.mockResolvedValue({ engagementId: 'eng-1', asset: origin, linked: { total: 0, byStatus: {}, items: [] }, unlinkedFindings: 0 })
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
    expect(fetchDetail.mock.calls[1]).toEqual(['eng-1', 'asset_a', 'next', ''])
  });

  it('filters the sitemap by URL or path and keeps that filter when loading the next page', async () => {
    const endpoint = (id: string, path: string) => ({ id, method: 'GET', path, url: `http://10.0.0.1:80${path}`, statusCode: 200, source: 'katana', sourceEpisodeId: 'crawl-1', parameters: [] })
    fetchDetail
      .mockResolvedValueOnce({ engagementId: 'eng-1', asset: origin, provenance, detail: { kind: 'endpoints', items: [endpoint('4:1', '/a')] }, nextCursor: null, completeness })
      .mockResolvedValueOnce({ engagementId: 'eng-1', asset: origin, provenance, detail: { kind: 'endpoints', items: [endpoint('4:2', '/login')] }, nextCursor: null, completeness })
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'http://10.0.0.1:80' }))
    const sitemap = await screen.findByRole('region', { name: 'Sitemap' })
    fireEvent.change(within(sitemap).getByLabelText('Filter sitemap'), { target: { value: 'login' } })
    fireEvent.click(within(sitemap).getByRole('button', { name: 'Filter' }))
    await waitFor(() => expect(within(sitemap).getByText('http://10.0.0.1:80/login')).toBeTruthy())
    expect(fetchDetail.mock.calls[1]).toEqual(['eng-1', 'asset_o', null, 'login'])
    expect(within(sitemap).queryByText('http://10.0.0.1:80/a')).toBeNull()
  });

  it('reopens the asset the operator inspected last, so a reload returns to the same context', async () => {
    globalThis.localStorage.setItem(savedKey, 'asset_o')
    fetchDetail.mockResolvedValue({ engagementId: 'eng-1', asset: origin, provenance, detail: { kind: 'endpoints', items: [] }, nextCursor: null, completeness })
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    await waitFor(() => expect(fetchDetail).toHaveBeenCalledWith('eng-1', 'asset_o', null, ''))
    expect(await screen.findByRole('region', { name: 'Sitemap' })).toBeTruthy()
    expect(JSON.parse(globalThis.localStorage.getItem(savedKey) ?? '{}').assetId).toBe('asset_o')
  });

  it('shows the imported capture behind an observation and says so when an artifact was never imported', async () => {
    fetchDetail.mockResolvedValueOnce({
      engagementId: 'eng-1',
      asset: host,
      provenance: {
        sources: [{ source: 'nmap', count: 2 }],
        graphNodes: 2,
        evidence: [
          { source: 'nmap', sourceEpisodeId: 'scan-1', observedAt: null, artifactRef: 'recon/nmap.xml', artifactDigest: 'ab'.repeat(32), capture: { id: 'cap-1', path: 'findings/capture-cap-1.xml', digest: 'ab'.repeat(32), classification: 'standard' } },
          { source: 'nmap', sourceEpisodeId: 'scan-2', observedAt: null, artifactRef: 'recon/other.xml', artifactDigest: 'cd'.repeat(32), capture: null },
        ],
      },
      detail: { kind: 'services', items: [] },
      nextCursor: null,
      completeness,
    })
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    fireEvent.click(await screen.findByRole('button', { name: '10.0.0.1' }))
    const captured = await screen.findByTestId('evidence-capture')
    expect(captured.textContent).toContain('capture cap-1 (standard')
    expect(captured.querySelector('a')?.getAttribute('href')).toBe('/api/engagements/eng-1/artifacts/captures/cap-1/content')
    expect(screen.getByTestId('evidence-uncaptured').textContent).toContain('not imported as a capture')
  });
});
