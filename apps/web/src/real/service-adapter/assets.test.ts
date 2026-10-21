import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../features/assets/remote', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../features/assets/remote')>()
  return {
    ...actual,
    fetchAssetInventory: vi.fn(),
    fetchEffectiveScope: vi.fn(),
    fetchGraph: vi.fn(),
    getEngagement: vi.fn(),
    importAssets: vi.fn(),
    classifyAsset: vi.fn(),
  }
})
vi.mock('../../features/scope/remote', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../features/scope/remote')>()
  return {
    ...actual,
    fetchAssetInventory: vi.fn(),
    fetchEffectiveScope: vi.fn(),
    fetchGraph: vi.fn(),
    getEngagement: vi.fn(),
    importAssets: vi.fn(),
    classifyAsset: vi.fn(),
  }
})
vi.mock('../../features/analysis/remote', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../features/analysis/remote')>()
  return {
    ...actual,
    fetchAssetInventory: vi.fn(),
    fetchEffectiveScope: vi.fn(),
    fetchGraph: vi.fn(),
    getEngagement: vi.fn(),
    importAssets: vi.fn(),
    classifyAsset: vi.fn(),
  }
})
vi.mock('../../features/projects/remote', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../features/projects/remote')>()
  return {
    ...actual,
    fetchAssetInventory: vi.fn(),
    fetchEffectiveScope: vi.fn(),
    fetchGraph: vi.fn(),
    getEngagement: vi.fn(),
    importAssets: vi.fn(),
    classifyAsset: vi.fn(),
  }
})

const api_assets = await import('../../features/assets/remote');
const api_scope = await import('../../features/scope/remote');
const api_analysis = await import('../../features/analysis/remote');
const api_projects = await import('../../features/projects/remote');
const { createRealAssetService } = await import('./assets')

const ctx = { actor: { id: 'user-operator', role: 'operator' as const }, projectId: 'eng-1', corr: 'test' }

function inventory(assets: Partial<import('../../features/assets/remote').AssetInventoryView['assets'][number]>[]): import('../../features/assets/remote').AssetInventoryView {
  return {
    engagementId: 'eng-1',
    latestApprovedVersion: 1,
    source: 'db',
    assets: assets.map((asset, index) => ({
      id: `as-${index + 1}`, engagementId: 'eng-1', identifier: `host-${index + 1}.example.test`, kind: 'host',
      classification: 'pending', observed: false, version: 3, updatedAt: '2026-10-14T09:00:00.000Z', ...asset,
    })),
  }
}

beforeEach(() => {
  vi.mocked(api_assets.fetchAssetInventory).mockReset()
  vi.mocked(api_scope.fetchEffectiveScope).mockReset()
  vi.mocked(api_analysis.fetchGraph).mockReset()
  vi.mocked(api_projects.getEngagement).mockReset()
  vi.mocked(api_assets.importAssets).mockReset()
  vi.mocked(api_assets.classifyAsset).mockReset()
})

describe('real asset reads', () => {
  it('keeps managed and observed provenance and counts the scope pills from the whole inventory', async () => {
    vi.mocked(api_assets.fetchAssetInventory).mockResolvedValue(inventory([
      { classification: 'in_scope' }, { classification: 'out_of_scope', observed: true }, { classification: 'pending' },
    ]))
    const res = await createRealAssetService().list(ctx, { pageSize: 10 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.items.map((item) => item.asset.source)).toEqual(['managed', 'observed', 'managed'])
    expect(res.data.kpis).toEqual({ in: 1, out: 1, pending: 1, unclassified: 0 })
    expect(res.data.total).toBe(3)
  })

  it('pages and filters the inventory without reading the mock store', async () => {
    vi.mocked(api_assets.fetchAssetInventory).mockResolvedValue(inventory(Array.from({ length: 12 }, () => ({}))))
    const second = await createRealAssetService().list(ctx, { page: 2, pageSize: 10 })
    expect(second.ok && second.data.items.length).toBe(2)
    const none = await createRealAssetService().list(ctx, { scope: 'in' })
    expect(none.ok && none.data.total).toBe(0)
  })

  it('names the sections the inventory does not model instead of showing empty lists as none', async () => {
    vi.mocked(api_assets.fetchAssetInventory).mockResolvedValue(inventory([{ id: 'as-9' }]))
    vi.mocked(api_projects.getEngagement).mockResolvedValue({ id: 'eng-1', displayName: 'Lab', lifecycleStatus: 'planning' } as never)
    const detail = await createRealAssetService().get(ctx, 'as-9')
    expect(detail.ok).toBe(true)
    if (!detail.ok) return
    expect(detail.data.operations).toEqual([])
    expect(detail.data.unmodelled).toEqual(expect.arrayContaining(['operations', 'findings', 'evidence', 'history']))
  })

  it('refuses an asset outside the inventory as not found', async () => {
    vi.mocked(api_assets.fetchAssetInventory).mockResolvedValue(inventory([{ id: 'as-1' }]))
    vi.mocked(api_projects.getEngagement).mockResolvedValue({ id: 'eng-1', displayName: 'Lab', lifecycleStatus: 'planning' } as never)
    const res = await createRealAssetService().get(ctx, 'as-404')
    expect(res.ok === false && res.failure.kind).toBe('not-found')
  })

  it('reads the effective scope and names the operations and approvals the backend does not model', async () => {
    vi.mocked(api_assets.fetchAssetInventory).mockResolvedValue(inventory([{ classification: 'in_scope' }]))
    vi.mocked(api_scope.fetchEffectiveScope).mockResolvedValue({ engagementId: 'eng-1', version: 2, rootTarget: null, inScope: [], roe: { windows: [{ start: '2026-10-01T00:00:00.000Z', end: '2026-10-31T00:00:00.000Z', tz: 'UTC' }], emergencyContacts: [], restrictions: [] }, source: 'db' })
    vi.mocked(api_projects.getEngagement).mockResolvedValue({ id: 'eng-1', displayName: 'Lab', lifecycleStatus: 'active' } as never)
    const res = await createRealAssetService().scope(ctx)
    expect(res.ok && res.data.projects[0]?.roeVersion).toBe('v2')
    expect(res.ok && res.data.unmodelled).toEqual(expect.arrayContaining(['operations', 'approvals', 'governance']))
  })

  it('maps the observed graph verbatim and reports an unavailable source explicitly', async () => {
    vi.mocked(api_analysis.fetchGraph).mockResolvedValue({ engagementId: 'eng-1', nodes: [{ id: 'n1', labels: ['Host'], properties: {} }], edges: [], truncated: false, source: 'graph' } as never)
    const graph = await createRealAssetService().observedGraph(ctx)
    expect(graph.ok && graph.data.nodes.map((node) => node.id)).toEqual(['n1'])
    vi.mocked(api_analysis.fetchGraph).mockRejectedValue(new Error('graph is down'))
    const failed = await createRealAssetService().observedGraph(ctx)
    expect(failed.ok).toBe(false)
  })
})

describe('real asset writes', () => {
  it('imports each console type under its inventory kind and reports the rows it stored', async () => {
    vi.mocked(api_assets.importAssets).mockResolvedValue({ imported: 2, skipped: 0 })
    const res = await createRealAssetService().importRows(ctx, [
      { name: 'web', ident: 'https://web.example.test', type: 'URL', os: '', owner: '', scope: 'out', source: 'manual' },
      { name: 'lab', ident: '10.20.0.0/24', type: 'Subnet', os: '', owner: '', scope: 'out', source: 'manual' },
    ])
    expect(api_assets.importAssets).toHaveBeenCalledWith('eng-1', ['https://web.example.test'], 'web_url')
    expect(api_assets.importAssets).toHaveBeenCalledWith('eng-1', ['10.20.0.0/24'], 'ip_range')
    expect(res.ok && res.data.added).toBe(4)
  })

  it('refuses a type the inventory does not store before any import call', async () => {
    const res = await createRealAssetService().importRows(ctx, [{ name: 'app', ident: 'billing', type: 'Application', os: '', owner: '', scope: 'out', source: 'manual' }])
    expect(res.ok === false && res.failure.kind).toBe('validation')
    expect(api_assets.importAssets).not.toHaveBeenCalled()
  })

  it('changes the classification at the version it read and refuses an unclassified target', async () => {
    vi.mocked(api_assets.fetchAssetInventory).mockResolvedValue(inventory([{ id: 'as-1', version: 7 }]))
    vi.mocked(api_assets.classifyAsset).mockResolvedValue({ ok: true })
    const res = await createRealAssetService().changeScope(ctx, 'as-1', 'out')
    expect(api_assets.classifyAsset).toHaveBeenCalledWith('eng-1', 'as-1', 'out_of_scope', 7)
    expect(res.ok && res.data.scope).toBe('out')
    const refused = await createRealAssetService().changeScope(ctx, 'as-1', 'unclassified')
    expect(refused.ok === false && refused.failure.kind).toBe('validation')
  })
})
