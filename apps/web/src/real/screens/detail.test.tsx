/**
 * The project overview counts come from the sources that own them. A failing
 * source shows "No source" for its own count only.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

const fetchFindings = vi.fn()
const fetchAssetInventory = vi.fn()
const fetchFleet = vi.fn()

vi.mock('../../features/findings/remote', () => ({
  fetchFindings: (...a: unknown[]) => fetchFindings(...a),
  fetchAssetInventory: (...a: unknown[]) => fetchAssetInventory(...a),
  fetchFleet: (...a: unknown[]) => fetchFleet(...a),
}))
vi.mock('../../features/assets/remote', () => ({
  fetchFindings: (...a: unknown[]) => fetchFindings(...a),
  fetchAssetInventory: (...a: unknown[]) => fetchAssetInventory(...a),
  fetchFleet: (...a: unknown[]) => fetchFleet(...a),
}))
vi.mock('../../features/operations/remote', () => ({
  fetchFindings: (...a: unknown[]) => fetchFindings(...a),
  fetchAssetInventory: (...a: unknown[]) => fetchAssetInventory(...a),
  fetchFleet: (...a: unknown[]) => fetchFleet(...a),
}))

async function renderCounts(): Promise<void> {
  const { ProjectCounts } = await import('./detail')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<ProjectCounts engagementId="eng-1" />, { wrapper })
}

beforeEach(() => {
  fetchFindings.mockReset()
  fetchAssetInventory.mockReset()
  fetchFleet.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('ProjectCounts', () => {
  it('shows each count from its own source', async () => {
    fetchFindings.mockResolvedValue({ engagementId: 'eng-1', findings: [{ id: 'f1' }, { id: 'f2' }], truncated: false, source: 'workspace' })
    fetchAssetInventory.mockResolvedValue({ engagementId: 'eng-1', assets: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }], latestApprovedVersion: 1, source: 'db' })
    fetchFleet.mockResolvedValue({ engagementId: 'eng-1', counts: { activeRuns: 4 } })
    await renderCounts()
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument())
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.queryByText('No source')).not.toBeInTheDocument()
  })

  it('shows "No source" only for the count whose source failed', async () => {
    fetchFindings.mockResolvedValue({ engagementId: 'eng-1', findings: [{ id: 'f1' }], truncated: false, source: 'workspace' })
    fetchAssetInventory.mockRejectedValue(new Error('inventory unavailable'))
    fetchFleet.mockResolvedValue({ engagementId: 'eng-1', counts: { activeRuns: 0 } })
    await renderCounts()
    await waitFor(() => expect(screen.getByText('No source')).toBeInTheDocument())
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})
