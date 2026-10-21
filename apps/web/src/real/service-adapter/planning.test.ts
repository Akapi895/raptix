/**
 * The planning adapter maps the server's planning view into the port: the
 * readiness reasons become sentences, the typed documents become facts and
 * prose, and ROE is marked as never publishable from the console.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../features/planning/remote', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../features/planning/remote')>()
  return {
    ...actual,
    fetchPlanning: vi.fn(),
    fetchDocumentSource: vi.fn(),
    discardDocumentDraft: vi.fn(),
  }
})

const api_planning = await import('../../features/planning/remote');
const { createRealPlanningService } = await import('./planning')

const ctx = { actor: { id: 'u-owner', role: 'manager' as const }, projectId: 'eng-1', corr: 'test' }

beforeEach(() => {
  vi.mocked(api_planning.fetchPlanning).mockReset()
  vi.mocked(api_planning.fetchDocumentSource).mockReset()
  vi.mocked(api_planning.discardDocumentDraft).mockReset()
})

describe('real planning service', () => {
  it('reads the bundle into documents, facts and OPPLAN objectives, with reasons in plain words', async () => {
    vi.mocked(api_planning.fetchPlanning).mockResolvedValue({
      version: 1, engagementId: 'eng-1',
      documents: {
        roe: { state: 'ready', content: { engagement_name: 'E', client: 'Acme', start_date: '2026-10-01', end_date: '2026-10-31', engagement_type: 'external', testing_window: '09-17', in_scope: [{ target: 't', type: 'cidr' }], out_of_scope: [], prohibited_actions: ['DoS'] } },
        conops: { state: 'missing' }, deconfliction: { state: 'missing' },
        opplan: { state: 'ready', content: { engagement_name: 'E', threat_profile: 'web', objectives: [{ id: 'OBJ-1', title: 'Map', description: 'd', phase: 'recon', blocked_by: ['OBJ-0'] }] } },
      },
      bundle: { roe: 'ready', conops: 'missing', deconfliction: 'missing', opplan: 'ready', 'threat-profile': 'missing', contact: 'missing', 'data-handling': 'missing', abort: 'missing', cleanup: 'missing' },
      readiness: { state: 'blocked', reasons: ['roe:missing', 'target_not_in_scope'], runtimeSignal: 'not_observed' },
    } as never)
    const result = await createRealPlanningService().read(ctx)
    expect(result).toMatchObject({
      ok: true,
      data: {
        ready: false,
        reasons: ['Rules of Engagement is not drafted yet.', 'The ROE in_scope list does not contain the engagement target.'],
        runtimeSignal: 'not_observed',
        opplan: { state: 'ready', threatProfile: 'web', objectives: [{ id: 'OBJ-1', status: 'pending', blockedBy: ['OBJ-0'] }] },
      },
    })
    if (!result.ok) throw new Error('expected a planning read')
    expect(result.data.documents.map((d) => d.name)).toEqual(['roe', 'conops', 'deconfliction', 'threat-profile', 'contact', 'data-handling', 'abort', 'cleanup'])
    expect(result.data.documents[0]).toMatchObject({ name: 'roe', state: 'ready', facts: expect.arrayContaining([{ label: 'Engagement type', value: 'external' }]) })
    expect(result.data.documents[1]).toMatchObject({ name: 'conops', state: 'missing', facts: [], body: null })
  })

  it('marks ROE as not publishable from the console and maps a discard', async () => {
    vi.mocked(api_planning.fetchDocumentSource).mockResolvedValue({
      version: 1, engagementId: 'eng-1', name: 'roe', state: 'ready', digest: 'a'.repeat(64), updatedAt: null, sizeBytes: 2,
      source: '{}', validation: { valid: true, errors: [] }, readable: null, draft: { body: '{"x":1}', baseDigest: null, updatedBy: 'u', updatedAt: '2026-10-17T09:00:00.000Z' },
    } as never)
    const source = await createRealPlanningService().source(ctx, 'roe')
    expect(source).toMatchObject({ ok: true, data: { name: 'roe', publishable: false, draft: '{"x":1}', valid: true } })
    vi.mocked(api_planning.discardDocumentDraft).mockResolvedValue({ discarded: true })
    expect(await createRealPlanningService().discardDraft(ctx, 'roe')).toEqual({ ok: true, data: { discarded: true } })
  })
})
