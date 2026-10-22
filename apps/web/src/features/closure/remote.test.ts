import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    fetchClosure: vi.fn(),
    requestClosure: vi.fn(),
    decideClosure: vi.fn(),
  }
})

const api_closure = await import('./api');
const { createRealClosureService } = await import('./remote')

const ctx = { actor: { id: 'u-owner', role: 'manager' as const }, projectId: 'eng-1', corr: 'test' }

beforeEach(() => {
  vi.mocked(api_closure.fetchClosure).mockReset()
  vi.mocked(api_closure.requestClosure).mockReset()
  vi.mocked(api_closure.decideClosure).mockReset()
})

describe('real closure service', () => {
  it('maps the server checklist, marking an unreadable source as unknown rather than passing it', async () => {
    vi.mocked(api_closure.fetchClosure).mockResolvedValue({
      engagementId: 'eng-1', readOnly: false, closure: null, source: 'db',
      checklist: { ok: false, entries: [
        { id: 'findings', state: 'pass', detail: null },
        { id: 'c2', state: 'unavailable', detail: 'The C2 provider is not configured.' },
      ] },
    } as unknown as Awaited<ReturnType<typeof api_closure.fetchClosure>>)

    const result = await createRealClosureService().read(ctx)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.checklist).toEqual([
      expect.objectContaining({ id: 'findings', label: 'No findings left in review', ok: true, unknown: false }),
      expect.objectContaining({ id: 'c2', ok: false, unknown: true, detail: 'The C2 provider is not configured.' }),
    ])
    expect(result.data.waivedChecklist).toBeNull()
  })

  it('refuses a no-findings waiver, which this deployment does not have', async () => {
    const result = await createRealClosureService().request(ctx, { reason: 'Done.', waiverNoFindings: true })
    expect(result).toMatchObject({ ok: false, failure: { kind: 'validation' } })
    expect(api_closure.requestClosure).not.toHaveBeenCalled()
  })

  it('sends a request with its reason and maps the record it returns', async () => {
    vi.mocked(api_closure.requestClosure).mockResolvedValue({ id: 'cl-1', engagementId: 'eng-1', status: 'requested', requestedBy: 'u-owner', decidedBy: null, decidedAt: null, reason: 'Done.', checklist: { entries: [], ok: true }, createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z', source: 'db' })
    const result = await createRealClosureService().request(ctx, { reason: 'Done.', waiverNoFindings: false })
    expect(api_closure.requestClosure).toHaveBeenCalledWith('eng-1', 'Done.')
    expect(result).toMatchObject({ ok: true, data: { id: 'cl-1', status: 'requested', reason: 'Done.' } })
  })
})
