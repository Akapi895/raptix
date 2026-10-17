/**
 * The notice center adapter maps the server's notices onto the port without
 * inventing a route, a chip or a review flag. The server has no "mark unread"
 * action, so asking for one is refused rather than faked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchNotices: vi.fn(),
    markNoticeRead: vi.fn(),
    dismissNotice: vi.fn(),
    markAllNoticesRead: vi.fn(),
  }
})

const api = await import('../api')
const { createRealNoticeCenterService } = await import('./notices')

const ctx = { actor: { id: 'u-owner', role: 'manager' as const }, projectId: 'all', corr: 'test' }
const NOTICE = { id: 'n-1', engagementId: 'eng-1', kind: 'approval', title: 'Scope revision needs review', detail: null, readAt: null, dismissedAt: null, createdAt: '2026-10-17T09:00:00.000Z' }

beforeEach(() => {
  vi.mocked(api.fetchNotices).mockReset()
  vi.mocked(api.markNoticeRead).mockReset()
  vi.mocked(api.dismissNotice).mockReset()
  vi.mocked(api.markAllNoticesRead).mockReset()
})

describe('real notice center service', () => {
  it('maps a notice to its text, project and read state, with no invented route or chip', async () => {
    vi.mocked(api.fetchNotices).mockResolvedValue({ notices: [NOTICE], unread: 1, source: 'db' } as never)
    const result = await createRealNoticeCenterService().list(ctx)
    expect(result).toEqual({
      ok: true,
      data: {
        items: [{ id: 'n-1', text: 'Scope revision needs review', read: false, projectId: 'eng-1', at: '2026-10-17T09:00:00.000Z', chip: null, needsReview: false, target: null }],
        unread: 1,
        canMutate: true,
      },
    })
  })

  it('refuses a request to mark a notice unread instead of pretending it happened', async () => {
    const result = await createRealNoticeCenterService().setRead(ctx, 'n-1', false)
    expect(result).toEqual({ ok: false, failure: { kind: 'validation', message: 'Marking a notice unread is not available on this server.' } })
    expect(api.markNoticeRead).not.toHaveBeenCalled()
  })

  it('marks a notice read and reports its read state from the server row', async () => {
    vi.mocked(api.markNoticeRead).mockResolvedValue({ ...NOTICE, readAt: '2026-10-17T10:00:00.000Z' } as never)
    const result = await createRealNoticeCenterService().setRead(ctx, 'n-1', true)
    expect(api.markNoticeRead).toHaveBeenCalledWith('n-1')
    expect(result).toMatchObject({ ok: true, data: { id: 'n-1', read: true } })
  })

  it('dismisses one notice and clears the unread count on mark-all', async () => {
    vi.mocked(api.dismissNotice).mockResolvedValue({ ...NOTICE, dismissedAt: '2026-10-17T10:00:00.000Z' } as never)
    vi.mocked(api.markAllNoticesRead).mockResolvedValue({ updated: 3 })
    const service = createRealNoticeCenterService()
    expect(await service.dismiss(ctx, 'n-1')).toEqual({ ok: true, data: { id: 'n-1' } })
    expect(await service.markAllRead(ctx)).toEqual({ ok: true, data: { unread: 0 } })
  })
})
