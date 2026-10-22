import { apiFetch } from '../../platform/transport';

export interface NoticeView {
  id: string
  engagementId: string | null
  kind: string
  title: string
  detail: Record<string, unknown> | null
  readAt: string | null
  dismissedAt: string | null
  createdAt: string
}

export interface NoticesView {
  notices: NoticeView[]
  unread: number
  source: 'db'
}

export function isNoticesView(v: unknown): v is NoticesView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as NoticesView
  return Array.isArray(doc.notices) && typeof doc.unread === 'number' && doc.source === 'db'
}

export function fetchNotices(): Promise<NoticesView> {
  return apiFetch('/notices', isNoticesView)
}

export function markNoticeRead(noticeId: string): Promise<NoticeView> {
  return apiFetch(`/notices/${encodeURIComponent(noticeId)}/read`, (v): v is NoticeView =>
    typeof v === 'object' && v !== null && typeof (v as NoticeView).id === 'string',
  { method: 'POST', body: {} })
}

export function dismissNotice(noticeId: string): Promise<NoticeView> {
  return apiFetch(`/notices/${encodeURIComponent(noticeId)}/dismiss`, (v): v is NoticeView =>
    typeof v === 'object' && v !== null && typeof (v as NoticeView).dismissedAt === 'string',
  { method: 'POST', body: {} })
}

export function markAllNoticesRead(): Promise<{ updated: number }> {
  return apiFetch('/notices/read-all', (v): v is { updated: number } =>
    typeof v === 'object' && v !== null && typeof (v as { updated?: unknown }).updated === 'number',
  { method: 'POST', body: {} })
}
