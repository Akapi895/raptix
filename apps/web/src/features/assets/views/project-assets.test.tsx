/**
 * The project Assets tab: the scope classification and the inventory status are two attributes, the status is shown as not
 * recorded rather than inferred, the inventory filters go to the server, and the map says when it is not enabled.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssetListRead } from '../service'

const hooks = vi.hoisted(() => ({ list: vi.fn(), go: vi.fn() }))

vi.mock('../query', () => ({ useAssetList: (query: unknown) => hooks.list(query) }))
vi.mock('../../../router/navigate', () => ({ go: (...args: unknown[]) => hooks.go(...args) }))
vi.mock('../preview-modal', () => ({ AssetPreviewModal: () => null }))

const { ProjectAssets } = await import('./project-assets')

const read: AssetListRead = {
  items: [
    { asset: { id: 'a1', name: 'web-01', ident: '10.0.0.5', ip: '10.0.0.5', type: 'Host', os: '', owner: '', projectId: 'eng-1', scope: 'in', source: 'managed', updated: '2026-10-20T09:00:00Z', observation: null } },
    { asset: { id: 'a2', name: 'admin', ident: 'https://admin.example', ip: '', type: 'URL', os: '', owner: '', projectId: 'eng-1', scope: 'pending', source: 'observed', updated: '2026-10-21T09:00:00Z', observation: { ports: ['443'], services: ['https'], findingCount: 2 } } },
  ],
  page: 1,
  pageSize: 50,
  total: 2,
  kpis: { in: 1, out: 0, pending: 1, unclassified: 0 },
  owners: [],
  types: { Host: 1, URL: 1 },
  sources: { managed: 1, observed: 1 },
  oses: [],
  observation: 'ok',
}

function renderTab(mapEnabled = true): void {
  hooks.list.mockReturnValue({ isPending: false, isError: false, error: null, data: read })
  render(<ProjectAssets engagementId="eng-1" mapEnabled={mapEnabled} />)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('project assets', () => {
  it('states that the inventory does not record a status, and does not infer it from the scope', () => {
    renderTab()
    expect(screen.getByText(/does not record an asset/)).toBeTruthy()
    expect(screen.getByText('Total assets')).toBeTruthy()
  })

  it('shows the inventory status as not recorded on each row, beside its scope', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Inventory' }))
    expect(screen.getAllByText('Not recorded')).toHaveLength(2)
    expect(screen.getByText('web-01')).toBeTruthy()
    expect(screen.getByText('Seen in a run')).toBeTruthy()
  })

  it('sends the scope and the search to the server, and goes back to the first page', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Inventory' }))
    fireEvent.change(screen.getByLabelText('Search assets'), { target: { value: 'web' } })
    expect(hooks.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'web', page: 1, pageSize: 50 }))
    fireEvent.click(screen.getByRole('button', { name: 'Pending' }))
    expect(hooks.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'web', scope: 'pending', page: 1 }))
  })

  it('keeps the inventory and the search on screen while a filter reloads', () => {
    hooks.list.mockReturnValue({ isPending: false, isError: false, error: null, data: read, isPlaceholderData: true, isFetching: true })
    render(<ProjectAssets engagementId="eng-1" mapEnabled />)
    fireEvent.click(screen.getByRole('button', { name: 'Inventory' }))
    expect(screen.getByText('web-01')).toBeTruthy()
    expect(screen.getByLabelText('Search assets')).toBeTruthy()
    expect(screen.getByRole('status')).toHaveTextContent('Updating…')
  })

  it('says the asset map is not enabled when its flag is off, and offers the scope map', () => {
    renderTab(false)
    fireEvent.click(screen.getByRole('button', { name: 'Map' }))
    expect(screen.getByText('The asset map is not enabled in this deployment.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open scope map' }))
    expect(hooks.go).toHaveBeenCalledWith('asset-scope')
  })
})
