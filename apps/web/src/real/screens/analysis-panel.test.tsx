/**
 * The observed analysis tab explains an unavailable graph in plain words and
 * never shows the server's route text.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { ApiTransportError } from '../transport'

const fetchAnalysis = vi.fn()

vi.mock('../api', () => ({
  fetchAnalysis: (...a: unknown[]) => fetchAnalysis(...a),
}))

async function renderPanel(): Promise<void> {
  const { RealAnalysisPanel } = await import('./analysis-panel')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<RealAnalysisPanel engagementId="eng-1" />, { wrapper })
}

afterEach(() => {
  cleanup()
  fetchAnalysis.mockReset()
})

describe('RealAnalysisPanel error states', () => {
  it('explains a missing graph route without the raw "Route ... not found" text', async () => {
    fetchAnalysis.mockRejectedValue(new ApiTransportError(404, 'not_found', 'Route GET /api/engagements/eng-1/analysis not found'))
    await renderPanel()
    expect(await screen.findByText(/knowledge graph is not configured/)).toBeInTheDocument()
    expect(screen.queryByText(/Route GET/)).not.toBeInTheDocument()
  })

  it('says the graph is unavailable when the server reports it so', async () => {
    fetchAnalysis.mockRejectedValue(new ApiTransportError(503, 'unavailable', 'Knowledge graph unavailable'))
    await renderPanel()
    expect(await screen.findByText(/knowledge graph is unavailable right now/)).toBeInTheDocument()
  })
})
