import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    fetchEngagementAudit: vi.fn(),
  }
})

const api_audit = await import('./api');
const { createRealAuditService } = await import('./remote')

const ctx = { actor: { id: 'user-owner', role: 'manager' as const }, projectId: 'eng-1', corr: 'test' }

beforeEach(() => {
  vi.mocked(api_audit.fetchEngagementAudit).mockReset()
})

describe('real audit service', () => {
  it('reads the engagement audit with the filters and keeps the attribution the records carry', async () => {
    vi.mocked(api_audit.fetchEngagementAudit).mockResolvedValue({
      engagementId: 'eng-1', total: 2, truncated: false, source: 'db',
      entries: [
        { id: 'a1', engagementId: 'eng-1', actorId: 'user-owner', action: 'scope.revision_submitted', targetType: 'scope_revision', targetId: 'rev-2', reason: 'add host', createdAt: '2026-10-15T01:00:00.000Z', source: 'web' },
        { id: 'a2', engagementId: 'eng-1', actorId: null, action: 'vault.revealed', targetType: 'vault_secret', targetId: 'sec-1', reason: null, createdAt: '2026-10-15T02:00:00.000Z', source: 'vault' },
      ],
    } as unknown as Awaited<ReturnType<typeof api_audit.fetchEngagementAudit>>)

    const result = await createRealAuditService().read(ctx, { action: 'scope.' })

    expect(api_audit.fetchEngagementAudit).toHaveBeenCalledWith('eng-1', { action: 'scope.' })
    expect(result).toMatchObject({ ok: true, data: { total: 2, truncated: false } })
    if (result.ok) expect(result.data.entries.map((e) => e.actorId)).toEqual(['user-owner', null])
  })

  it('refuses the aggregate scope before calling the backend', async () => {
    const result = await createRealAuditService().read({ ...ctx, projectId: 'all' }, {})
    expect(result).toMatchObject({ ok: false, failure: { kind: 'validation' } })
    expect(api_audit.fetchEngagementAudit).not.toHaveBeenCalled()
  })
})
