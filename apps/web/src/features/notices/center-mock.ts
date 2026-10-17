/**
 * Mock adapter for the notice center port (plan P09, Notices slice). The mock
 * notice service keeps the authority's rows; this adapter presents them as the
 * port's rows, so the mock and the real header render the same shape.
 */
import type { RequestContext, ServiceResult } from '../../domain/service'
import type { NoticeCenterItem, NoticeCenterRead, NoticeCenterService } from './center'
import type { NoticeService, NoticeView } from './service'

function itemOf(n: NoticeView): NoticeCenterItem {
  return {
    id: n.id,
    text: n.text,
    read: n.read,
    projectId: n.projectId || null,
    at: n.at,
    chip: n.chip,
    needsReview: n.group === 'todo',
    target: n.to ? { page: n.to.name, id: n.to.id } : null,
  }
}

export function createMockNoticeCenter(notices: NoticeService): NoticeCenterService {
  return {
    list: async (ctx: RequestContext): Promise<ServiceResult<NoticeCenterRead>> => {
      const res = await notices.list(ctx)
      if (!res.ok) return res
      return { ok: true, data: { items: res.data.items.map(itemOf), unread: res.data.unread, canMutate: res.data.canMutate } }
    },
    setRead: async (ctx, id, read) => {
      const res = await notices.setRead(ctx, id, read)
      return res.ok ? { ok: true, data: itemOf(res.data) } : res
    },
    dismiss: (ctx, id) => notices.dismiss(ctx, id),
    markAllRead: (ctx) => notices.markAllRead(ctx),
  }
}
