import type { ServiceResult } from '../../domain/service'
import type { NoticeCenterItem, NoticeCenterService } from '../../features/notices/center'
import { dismissNotice, fetchNotices, markAllNoticesRead, markNoticeRead, type NoticeView } from '../../features/notices/remote';
import { guarded } from './shared'

/** A real notice names its text, its project and its instants; it carries no route, chip or review flag. */
function itemOf(n: NoticeView): NoticeCenterItem {
  return {
    id: n.id,
    text: n.title,
    read: n.readAt !== null,
    projectId: n.engagementId,
    at: n.createdAt,
    chip: null,
    needsReview: false,
    target: null,
  }
}

export function createRealNoticeCenterService(): NoticeCenterService {
  // The server scopes notices to the signed-in session, so the request context carries nothing this adapter needs.
  return {
    list: () => guarded(async () => {
      const view = await fetchNotices()
      return { ok: true, data: { items: view.notices.map(itemOf), unread: view.unread, canMutate: true } }
    }),
    setRead: (...[, id, read]: Parameters<NoticeCenterService['setRead']>) => guarded(async (): Promise<ServiceResult<NoticeCenterItem>> => {
      // The server has no "mark unread" action; a request for one is refused rather than faked.
      if (!read) return { ok: false, failure: { kind: 'validation', message: 'Marking a notice unread is not available on this server.' } }
      return { ok: true, data: itemOf(await markNoticeRead(id)) }
    }),
    dismiss: (...[, id]: Parameters<NoticeCenterService['dismiss']>) => guarded(async () => {
      await dismissNotice(id)
      return { ok: true, data: { id } }
    }),
    markAllRead: () => guarded(async () => {
      await markAllNoticesRead()
      return { ok: true, data: { unread: 0 } }
    }),
  }
}
