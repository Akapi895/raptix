import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    decideScopeRevision: vi.fn(),
    fetchEffectiveScope: vi.fn(),
    fetchScopeRevisions: vi.fn(),
    submitScopeRevision: vi.fn(),
  }
})

const api = await import('../api')
const { createRealScopeService } = await import('./scope')

const ctx = { actor: { id: 'user-owner', role: 'manager' as const }, projectId: 'eng-1', corr: 'test' }

const REVISION = {
  id: 'rev-2', engagementId: 'eng-1', version: 2, status: 'pending' as const,
  diff: { added: ['web.example.test'], removed: [], rationale: 'add the portal' },
  roe: { windows: [], emergencyContacts: ['blue@example.test'], restrictions: [] },
  requestedBy: 'user-owner', decidedBy: null, decidedAt: null, decisionComment: null, createdAt: '2026-10-17T09:00:00.000Z',
}

beforeEach(() => {
  vi.mocked(api.fetchScopeRevisions).mockReset()
  vi.mocked(api.fetchEffectiveScope).mockReset()
  vi.mocked(api.submitScopeRevision).mockReset()
  vi.mocked(api.decideScopeRevision).mockReset()
})

describe('real scope service', () => {
  it('reads the revisions and the effective scope of the engagement', async () => {
    vi.mocked(api.fetchScopeRevisions).mockResolvedValue({ engagementId: 'eng-1', revisions: [REVISION], latestApprovedVersion: 1, submitSupported: true, source: 'db' })
    vi.mocked(api.fetchEffectiveScope).mockResolvedValue({ engagementId: 'eng-1', version: 1, rootTarget: '10.0.0.1', inScope: ['10.0.0.1'], roe: { windows: [], emergencyContacts: [], restrictions: [] }, source: 'db' })

    const result = await createRealScopeService().read(ctx)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(api.fetchScopeRevisions).toHaveBeenCalledWith('eng-1')
    expect(result.data.latestApprovedVersion).toBe(1)
    expect(result.data.revisions[0]).toMatchObject({ id: 'rev-2', version: 2, status: 'pending', requestedBy: 'user-owner' })
    expect(result.data.effective).toMatchObject({ version: 1, rootTarget: '10.0.0.1', inScope: ['10.0.0.1'] })
  })

  it('refuses a read without an engagement before calling the backend', async () => {
    const result = await createRealScopeService().read({ ...ctx, projectId: 'all' })
    expect(result).toMatchObject({ ok: false, failure: { kind: 'validation' } })
    expect(api.fetchScopeRevisions).not.toHaveBeenCalled()
  })

  it('submits a revision and returns it in the port shape', async () => {
    vi.mocked(api.submitScopeRevision).mockResolvedValue(REVISION)
    const input = { diff: REVISION.diff, roe: REVISION.roe }

    const result = await createRealScopeService().submit(ctx, input)

    expect(api.submitScopeRevision).toHaveBeenCalledWith('eng-1', input)
    expect(result).toMatchObject({ ok: true, data: { id: 'rev-2', status: 'pending' } })
  })

  it('reports a refused decision as the backend message, not a thrown error', async () => {
    const { ApiTransportError } = await import('../transport')
    vi.mocked(api.decideScopeRevision).mockRejectedValue(new ApiTransportError(403, 'forbidden', 'The requester cannot decide their own revision.'))

    const result = await createRealScopeService().decide(ctx, 'rev-2', 'approved')

    expect(result).toMatchObject({ ok: false, failure: { kind: 'forbidden', message: 'The requester cannot decide their own revision.' } })
  })
})
