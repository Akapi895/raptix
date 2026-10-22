/**
 * The observed analysis adapter explains an unavailable graph in plain words
 * and never shows the server's route text. It maps the observed read into the
 * port shape without inventing coverage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../features/analysis/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../features/analysis/api')>()
  return { ...actual, fetchAnalysis: vi.fn() }
})

const api_analysis = await import('../../features/analysis/api');
const { ApiTransportError } = await import('../../platform/transport')
const { createRealObservedAnalysisService } = await import('./analysis')

const ctx = { actor: { id: 'u-owner', role: 'manager' as const }, projectId: 'eng-1', corr: 'test' }

beforeEach(() => {
  vi.mocked(api_analysis.fetchAnalysis).mockReset()
})

describe('real observed analysis service', () => {
  it('explains a missing graph route without the raw route text', async () => {
    vi.mocked(api_analysis.fetchAnalysis).mockRejectedValue(new ApiTransportError(404, 'not_found', 'Route GET /api/engagements/eng-1/analysis not found'))
    const result = await createRealObservedAnalysisService().read(ctx)
    expect(result).toMatchObject({ ok: false, failure: { kind: 'unavailable', message: expect.stringContaining('knowledge graph is not configured') } })
    if (!result.ok) expect(result.failure.message).not.toContain('Route GET')
  })

  it('says the graph is unavailable when the server reports it so', async () => {
    vi.mocked(api_analysis.fetchAnalysis).mockRejectedValue(new ApiTransportError(503, 'unavailable', 'Knowledge graph unavailable'))
    const result = await createRealObservedAnalysisService().read(ctx)
    expect(result).toMatchObject({ ok: false, failure: { message: expect.stringContaining('knowledge graph is unavailable right now') } })
  })

  it('maps the observed read and keeps a missing corpus count as null', async () => {
    vi.mocked(api_analysis.fetchAnalysis).mockResolvedValue({
      engagementId: 'eng-1', source: 'graph', excludedActions: [], quality: { graph: 'available', truncated: false },
      observed: [{ techniqueId: 'T1046', label: 'Network Service Discovery', nodeIds: ['n1'] }],
      coverage: { observedTechniques: 1, corpusTechniques: null, inCorpus: null },
      paths: [{ id: 'p1', steps: [{ nodeId: 'n1', techniqueId: 'T1046', label: 'banner read' }] }],
    } as unknown as Awaited<ReturnType<typeof api_analysis.fetchAnalysis>>)
    const result = await createRealObservedAnalysisService().read(ctx)
    expect(result).toMatchObject({ ok: true, data: { coverage: { corpusTechniques: null }, observed: [{ techniqueId: 'T1046' }], paths: [{ id: 'p1' }] } })
  })
})
