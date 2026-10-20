import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

beforeEach(() => {
  useProjectStore.setState({ pid: 'eng-1' })
  fetchOverview.mockResolvedValue({ engagementId: 'eng-1', groups: [{ kind: 'host', total: 1 }], completeness })
  fetchMembers.mockImplementation((_e: string, kind: string) =>
    Promise.resolve({ engagementId: 'eng-1', kind, items: kind === 'host' ? [host] : [origin], nextCursor: null, completeness }))
  fetchNeighborhood.mockResolvedValue({ engagementId: 'eng-1', assetId: 'asset_a', centers: [], nodes: [], edges: [], nextCursor: null, completeness })
  fetchDetail.mockResolvedValue({
    engagementId: 'eng-1',
    asset: host,
    provenance: { sources: [{ source: 'nmap', count: 1 }], graphNodes: 1, evidence: [{ source: 'nmap', sourceEpisodeId: 'ep-7', observedAt: null }] },
    detail: { kind: 'services', items: [{ id: '4:s', port: 80, protocol: 'tcp', service: 'http', product: null, version: null, source: 'nmap', sourceEpisodeId: 'ep-7' }] },
    nextCursor: null,
    completeness,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AssetMapPage', () => {
  it('lists hosts and origins from the catalog and inspects the selected host', async () => {
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    const hostButton = await screen.findByRole('button', { name: '10.0.0.1' })
    fireEvent.click(hostButton)
    await waitFor(() => expect(fetchDetail).toHaveBeenCalledWith('eng-1', 'asset_a'))
    expect(await screen.findByRole('region', { name: 'Services' })).toBeTruthy()
    expect(screen.getByTestId('evidence').textContent).toContain('episode ep-7')
    expect(screen.getByTestId('asset-map-canvas')).toBeTruthy()
  });

  it('reports a failed load as an error and shows no map as complete', async () => {
    fetchOverview.mockRejectedValueOnce(new Error('Graph store unreachable'))
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Nothing is shown as complete')
  });

  it('asks for a project before showing any assets', async () => {
    useProjectStore.setState({ pid: 'all' })
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    expect(screen.getByText(/Open the Asset Map from a project/)).toBeTruthy()
    expect(fetchOverview).not.toHaveBeenCalled()
  });
});
