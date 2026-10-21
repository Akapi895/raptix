import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectStore } from '../../state/stores'

/** The props of the canvas on screen, so a test can report a camera the way a real pan or zoom does. */
const mockCanvas: { props: { onCameraChange?: (camera: { zoom: number; x: number; y: number }) => void; restore?: { camera: { zoom: number; x: number; y: number } } | null } | null } = { props: null }

const fetchOverview = vi.fn()
const fetchMembers = vi.fn()
const fetchNeighborhood = vi.fn()
const fetchDetail = vi.fn()
const fetchSearch = vi.fn()
const fetchOverlay = vi.fn()

vi.mock('../../real/asset-map-api', () => ({
  fetchAssetMapOverview: (...args: unknown[]) => fetchOverview(...args),
  fetchAssetMapMembers: (...args: unknown[]) => fetchMembers(...args),
  fetchAssetMapNeighborhood: (...args: unknown[]) => fetchNeighborhood(...args),
  fetchAssetMapDetail: (...args: unknown[]) => fetchDetail(...args),
  fetchAssetMapSearch: (...args: unknown[]) => fetchSearch(...args),
  fetchAssetMapOverlay: (...args: unknown[]) => fetchOverlay(...args),
}))
vi.mock('../../platform/session', () => ({ useSession: () => ({ session: { actor: { id: 'user-1' } } }) }))
vi.mock('./AssetMapCanvas', () => ({
  AssetMapCanvas: (props: typeof mockCanvas.props) => {
    mockCanvas.props = props
    return <div data-testid="asset-map-canvas" />
  },
}))

const completeness = { loaded: 1, total: 1, hasMore: false, truncated: false, source: { catalog: 'ok', graph: 'ok' }, revision: 'rev-1' }
const host = { assetId: 'asset_a', kind: 'host', namespace: 'default', canonicalKey: '10.0.0.1' }
const origin = { assetId: 'asset_o', kind: 'web_origin', namespace: 'default', canonicalKey: 'http://10.0.0.1:80' }
const savedKey = 'raptix.assetMap.selected.user-1.eng-1'

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
  fetchSearch.mockResolvedValue({ engagementId: 'eng-1', query: '', items: [], completeness })
  fetchOverlay.mockResolvedValue({ engagementId: 'eng-1', asset: host, linked: { total: 0, byStatus: {}, items: [] }, unlinkedFindings: 0 })
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
    await waitFor(() => expect(fetchDetail).toHaveBeenCalledWith('eng-1', 'asset_a', null, ''))
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
    await waitFor(() => expect(fetchDetail).toHaveBeenLastCalledWith('eng-1', 'asset_o', null, ''))
    resolveFirst({ engagementId: 'eng-1', assetId: 'asset_a', centers: [{ id: '4:stale', assetId: 'asset_a', labels: ['Host'], label: 'stale' }], nodes: [], edges: [], nextCursor: null, completeness })
    await new Promise(done => setTimeout(done, 10))
    expect(screen.queryByText('stale')).toBeNull()
  });

  it('restarts relation paging from the first page when the graph changed under the cursor', async () => {
    const { ApiTransportError } = await import('../../platform/transport')
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

  it('restores the last asset per user and project and does not carry it into another project', async () => {
    globalThis.localStorage.setItem(savedKey, 'asset_a')
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    await waitFor(() => expect(fetchDetail).toHaveBeenCalledWith('eng-1', 'asset_a', null, ''))
    cleanup()
    fetchDetail.mockClear()
    useProjectStore.setState({ pid: 'eng-2' })
    render(<AssetMapPage />)
    await waitFor(() => expect(fetchOverview).toHaveBeenCalledWith('eng-2'))
    expect(fetchDetail).not.toHaveBeenCalled()
    globalThis.localStorage.removeItem(savedKey)
  });

  it('keeps the saved asset and camera of each project apart when the operator goes A to B and back in one session', async () => {
    const savedEng2 = 'raptix.assetMap.selected.user-1.eng-2'
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    fireEvent.click(await screen.findByRole('button', { name: '10.0.0.1' }))
    await waitFor(() => expect(globalThis.localStorage.getItem(savedKey)).toContain('asset_a'))
    act(() => mockCanvas.props?.onCameraChange?.({ zoom: 2, x: 40, y: -10 }))
    await waitFor(() => expect(JSON.parse(globalThis.localStorage.getItem(savedKey) ?? '{}').camera).toEqual({ zoom: 2, x: 40, y: -10 }))

    act(() => useProjectStore.setState({ pid: 'eng-2' }))
    await waitFor(() => expect(fetchOverview).toHaveBeenCalledWith('eng-2'))
    await screen.findByRole('button', { name: '10.0.0.1' })
    expect(globalThis.localStorage.getItem(savedEng2)).toBeNull()
    expect(mockCanvas.props?.restore ?? null).toBeNull()

    act(() => useProjectStore.setState({ pid: 'eng-1' }))
    await waitFor(() => expect(mockCanvas.props?.restore?.camera).toEqual({ zoom: 2, x: 40, y: -10 }))
    expect(JSON.parse(globalThis.localStorage.getItem(savedKey) ?? '{}')).toEqual({ assetId: 'asset_a', camera: { zoom: 2, x: 40, y: -10 } })
    expect(globalThis.localStorage.getItem(savedEng2)).toBeNull()
    globalThis.localStorage.removeItem(savedKey)
  });

  it('restores a saved asset even when it sits past the first page of the lists', async () => {
    globalThis.localStorage.setItem(savedKey, 'asset_far')
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    await waitFor(() => expect(fetchDetail).toHaveBeenCalledWith('eng-1', 'asset_far', null, ''))
    globalThis.localStorage.removeItem(savedKey)
  });

  it('does not restore an asset saved by another user of the same browser', async () => {
    globalThis.localStorage.setItem('raptix.assetMap.selected.user-2.eng-1', 'asset_a')
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    await waitFor(() => expect(fetchOverview).toHaveBeenCalledWith('eng-1'))
    expect(fetchDetail).not.toHaveBeenCalled()
  });

  it('states the visible budget when more nodes were loaded than can be drawn', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ id: `4:n${i}`, assetId: null, labels: ['Service'], label: `svc-${i}` }))
    fetchNeighborhood.mockResolvedValueOnce({ engagementId: 'eng-1', assetId: 'asset_a', centers: [], nodes: many, edges: [], nextCursor: null, completeness })
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    fireEvent.click(await screen.findByRole('button', { name: '10.0.0.1' }))
    expect(await screen.findByTestId('visible-budget')).toBeTruthy()
  });

  it('finds an asset outside the loaded lists and opens it', async () => {
    const remote = { assetId: 'asset_far', kind: 'host', namespace: 'default', canonicalKey: '192.168.9.9' }
    fetchSearch.mockResolvedValueOnce({ engagementId: 'eng-1', query: '192.168.9', items: [remote], completeness })
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    fireEvent.change(await screen.findByLabelText('Find an asset'), { target: { value: '192.168.9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    fireEvent.click(await screen.findByRole('button', { name: '192.168.9.9' }))
    await waitFor(() => expect(fetchNeighborhood).toHaveBeenCalledWith('eng-1', 'asset_far'))
    expect(fetchSearch).toHaveBeenCalledWith('eng-1', '192.168.9')
  });

  it('refreshes the lists and says when the graph moved since the last load', async () => {
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    await screen.findByRole('button', { name: '10.0.0.1' })
    fetchOverview.mockResolvedValueOnce({ engagementId: 'eng-1', groups: [{ kind: 'host', total: 2 }], completeness: { ...completeness, revision: 'rev-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('graph changed')
  });

  it('switches off the origins kind without dropping the centre', async () => {
    const children = [{ id: '4:o', assetId: null, labels: ['Entrypoint'], label: 'http://10.0.0.1:80' }]
    fetchNeighborhood.mockResolvedValueOnce({ engagementId: 'eng-1', assetId: 'asset_a', centers: [{ id: '4:c', assetId: 'asset_a', labels: ['Host'], label: '10.0.0.1' }], nodes: children, edges: [], nextCursor: null, completeness })
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    fireEvent.click(await screen.findByRole('button', { name: '10.0.0.1' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Origins' }))
    expect(await screen.findByText('Switched off: 1 node(s) of the kinds unticked above.')).toBeTruthy()
  });

  it('shows the findings linked to the asset and the number that no owning record links', async () => {
    fetchOverlay.mockResolvedValueOnce({
      engagementId: 'eng-1',
      asset: host,
      linked: { total: 2, byStatus: { draft: 1, confirmed: 1 }, items: [{ id: 'f1', title: 'Exposed admin panel', severity: 'high', status: 'draft' }] },
      unlinkedFindings: 3,
    })
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    fireEvent.click(await screen.findByRole('button', { name: '10.0.0.1' }))
    expect((await screen.findByTestId('linked-findings')).textContent).toContain('Linked findings: 2 (draft 1, confirmed 1)')
    expect(screen.getByText('high · Exposed admin panel · draft')).toBeTruthy()
    expect(screen.getByTestId('unlinked-findings').textContent).toContain('Unlinked findings in this engagement: 3 (attribution unknown')
  });

  it('reports a failed findings read in the inspector and keeps the map and its relations on screen', async () => {
    fetchOverlay.mockRejectedValueOnce(new Error('Findings store unreachable'))
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    fireEvent.click(await screen.findByRole('button', { name: '10.0.0.1' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Findings for this asset could not be loaded (Findings store unreachable)')
    expect(screen.getByRole('region', { name: 'Services' })).toBeTruthy()
    expect(screen.getByTestId('asset-map-canvas')).toBeTruthy()
  });
});

describe('AssetMapPage project scope and paging', () => {
  it('drops a search answer that arrives after the operator switched project', async () => {
    let resolveSearch: (value: unknown) => void = () => undefined
    fetchSearch.mockImplementationOnce(() => new Promise(resolve => { resolveSearch = resolve }))
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    await screen.findByRole('button', { name: '10.0.0.1' })
    fireEvent.change(screen.getByLabelText('Find an asset'), { target: { value: '192.168' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    useProjectStore.setState({ pid: 'eng-2' })
    await waitFor(() => expect(fetchOverview).toHaveBeenCalledWith('eng-2'))
    resolveSearch({ engagementId: 'eng-1', query: '192.168', items: [{ assetId: 'asset_x', kind: 'host', namespace: 'default', canonicalKey: '192.168.0.9' }], completeness })
    await new Promise(done => setTimeout(done, 10))
    expect(screen.queryByRole('region', { name: 'Search results' })).toBeNull()
    expect(screen.queryByRole('button', { name: '192.168.0.9' })).toBeNull()
  });

  it('loads the next page of hosts with its cursor and keeps the rows already on screen', async () => {
    const second = { assetId: 'asset_h2', kind: 'host', namespace: 'default', canonicalKey: '10.0.0.2' }
    fetchMembers.mockImplementation((_e: string, kind: string, cursor?: string) => {
      if (kind !== 'host') return Promise.resolve({ engagementId: 'eng-1', kind, items: [origin], nextCursor: null, completeness })
      if (cursor === 'page-2') return Promise.resolve({ engagementId: 'eng-1', kind, items: [second], nextCursor: null, completeness: { ...completeness, loaded: 2, total: 2 } })
      return Promise.resolve({ engagementId: 'eng-1', kind, items: [host], nextCursor: 'page-2', completeness: { ...completeness, loaded: 1, total: 2, hasMore: true } })
    })
    const { AssetMapPage } = await import('./AssetMapPage')
    render(<AssetMapPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load more hosts' }))
    expect(await screen.findByRole('button', { name: '10.0.0.2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '10.0.0.1' })).toBeTruthy()
    expect(fetchMembers).toHaveBeenCalledWith('eng-1', 'host', 'page-2')
    expect(screen.queryByRole('button', { name: 'Load more hosts' })).toBeNull()
  });
});

