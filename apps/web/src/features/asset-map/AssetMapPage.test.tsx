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
  globalThis.localStorage.clear()
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

describe('AssetMapPage state handling', () => {
  it('ignores a relations response that arrives after the operator moved to another asset', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined
    fetchNeighborhood.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    fireEvent.click(await screen.findByRole('button', { name: '10.0.0.1' }))
    fireEvent.click(await screen.findByRole('button', { name: 'http://10.0.0.1:80' }))
    await waitFor(() => expect(fetchDetail).toHaveBeenLastCalledWith('eng-1', 'asset_o'))
    resolveFirst({ engagementId: 'eng-1', assetId: 'asset_a', centers: [{ id: '4:stale', assetId: 'asset_a', labels: ['Host'], label: 'stale' }], nodes: [], edges: [], nextCursor: null, completeness })
    await new Promise(done => setTimeout(done, 10))
    expect(screen.queryByText('stale')).toBeNull()
  });

  it('restarts relation paging from the first page when the graph changed under the cursor', async () => {
    const { ApiTransportError } = await import('../../real/transport')
    fetchNeighborhood
      .mockResolvedValueOnce({ engagementId: 'eng-1', assetId: 'asset_a', centers: [], nodes: [], edges: [], nextCursor: 'old', completeness })
      .mockRejectedValueOnce(new ApiTransportError(409, 'conflict', 'graph changed'))
      .mockResolvedValueOnce({ engagementId: 'eng-1', assetId: 'asset_a', centers: [], nodes: [], edges: [], nextCursor: null, completeness })
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    fireEvent.click(await screen.findByRole('button', { name: '10.0.0.1' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Load more relations' }))
    await waitFor(() => expect(fetchNeighborhood).toHaveBeenCalledTimes(3))
    expect(fetchNeighborhood.mock.calls[2]).toEqual(['eng-1', 'asset_a'])
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more relations' })).toBeNull())
  });

  it('restores the last asset per project and does not carry it into another project', async () => {
    globalThis.localStorage.setItem('raptix.assetMap.selected.eng-1', 'asset_a')
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    await waitFor(() => expect(fetchDetail).toHaveBeenCalledWith('eng-1', 'asset_a'))
    cleanup()
    fetchDetail.mockClear()
    useProjectStore.setState({ pid: 'eng-2' })
    render(<AssetMapPage />)
    await waitFor(() => expect(fetchOverview).toHaveBeenCalledWith('eng-2'))
    expect(fetchDetail).not.toHaveBeenCalled()
    globalThis.localStorage.removeItem('raptix.assetMap.selected.eng-1')
  });

  it('states the visible budget when more nodes were loaded than can be drawn', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ id: `4:n${i}`, assetId: null, labels: ['Service'], label: `svc-${i}` }))
    fetchNeighborhood.mockResolvedValueOnce({ engagementId: 'eng-1', assetId: 'asset_a', centers: [], nodes: many, edges: [], nextCursor: null, completeness })
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    fireEvent.click(await screen.findByRole('button', { name: '10.0.0.1' }))
    expect(await screen.findByTestId('visible-budget')).toBeTruthy()
  });
});
