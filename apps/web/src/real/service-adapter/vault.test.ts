import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchVault: vi.fn(),
    revealVaultSecret: vi.fn(),
    createVaultSecret: vi.fn(),
    revokeVaultSecret: vi.fn(),
  }
})

const api = await import('../api')
const { createRealVaultService } = await import('./vault')

const ctx = { actor: { id: 'u-owner', role: 'manager' as const }, projectId: 'eng-1', corr: 'test' }

beforeEach(() => {
  vi.mocked(api.fetchVault).mockReset()
  vi.mocked(api.revealVaultSecret).mockReset()
  vi.mocked(api.createVaultSecret).mockReset()
  vi.mocked(api.revokeVaultSecret).mockReset()
})

describe('real vault service', () => {
  it('lists metadata only and never carries a plaintext value into the list', async () => {
    vi.mocked(api.fetchVault).mockResolvedValue({
      engagementId: 'eng-1', truncated: false, source: 'db',
      secrets: [{ id: 'sec-1', engagementId: 'eng-1', kind: 'api-key', label: 'SIEM token', createdBy: 'u-owner', revealCount: 2, lastRevealedAt: '2026-10-15T01:00:00.000Z', createdAt: '2026-10-14T09:00:00.000Z', updatedAt: '2026-10-14T09:00:00.000Z' }],
    } as unknown as Awaited<ReturnType<typeof api.fetchVault>>)

    const result = await createRealVaultService().list(ctx)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.secrets).toEqual([expect.objectContaining({ id: 'sec-1', projectId: 'eng-1', revealCount: 2 })])
    expect(JSON.stringify(result.data.secrets)).not.toContain('plaintext')
  })

  it('returns the revealed value only from an explicit reveal', async () => {
    vi.mocked(api.revealVaultSecret).mockResolvedValue({ secretId: 'sec-1', engagementId: 'eng-1', plaintext: 'value-once', revealedAt: '2026-10-15T01:00:00.000Z' })
    const result = await createRealVaultService().reveal(ctx, 'sec-1')
    expect(api.revealVaultSecret).toHaveBeenCalledWith('eng-1', 'sec-1')
    expect(result).toMatchObject({ ok: true, data: { secretId: 'sec-1', plaintext: 'value-once' } })
  })

  it('refuses a read without an engagement before calling the backend', async () => {
    const result = await createRealVaultService().list({ ...ctx, projectId: 'all' })
    expect(result).toMatchObject({ ok: false, failure: { kind: 'validation' } })
    expect(api.fetchVault).not.toHaveBeenCalled()
  })
})
