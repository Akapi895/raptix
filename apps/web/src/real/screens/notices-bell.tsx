/**
 * Real header notice center (integration ticket 15). Durable per-actor
 * notices from the API with persisted unread/read/dismiss state, scoped to
 * the trusted session; polling is bounded (30s) and every mutation refetches
 * the same actor's scope, so a stale response can never leak another user's
 * or project's work.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck, MailOpen, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { dismissNotice, fetchNotices, markAllNoticesRead, markNoticeRead } from '../api'
import { utcMinute } from '../format'

export function RealHeaderNotices(): ReactElement {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const notices = useQuery({
    queryKey: ['real', 'notices'],
    queryFn: () => fetchNotices(),
    refetchInterval: 30_000,
  })

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: ['real', 'notices'] })
    void client.invalidateQueries({ queryKey: ['real', 'tasks'] })
  }
  const markRead = useMutation({ mutationFn: (id: string) => markNoticeRead(id), onSuccess: invalidate })
  const dismiss = useMutation({ mutationFn: (id: string) => dismissNotice(id), onSuccess: invalidate })
  const markAll = useMutation({ mutationFn: () => markAllNoticesRead(), onSuccess: invalidate })

  const view = notices.data
  const unread = view?.unread ?? 0
  const mutationError = [markRead.error, dismiss.error, markAll.error].find((e) => e instanceof Error)
  const error = mutationError instanceof Error ? mutationError.message : null

  return (
    <div ref={rootRef} className="relative">
      <button
        aria-label={`Notices${unread > 0 ? ` (${unread} unread)` : ''}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-line text-muted hover:text-fg"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={16} aria-hidden />
        {unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[10px] font-semibold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-96 max-w-[90vw] rounded-xl border border-line bg-panel p-3 shadow-xl" role="dialog" aria-label="Notices">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">Notices</span>
            <button className="flex items-center gap-1 text-xs text-muted hover:text-fg" disabled={markAll.isPending || unread === 0} onClick={() => markAll.mutate()}>
              <CheckCheck size={13} aria-hidden /> Mark all read
            </button>
          </div>
          {notices.isPending ? (
            <p className="py-4 text-center text-xs text-muted">Loading…</p>
          ) : view === undefined || view.notices.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted">No notices. Lifecycle decisions that concern you appear here.</p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {view.notices.map((n) => (
                <li key={n.id} className="rounded-lg border border-line p-2.5">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{n.title}</span>
                      <span className="block text-xs text-muted">{n.engagementId !== null ? `${n.engagementId} · ` : ''}{utcMinute(n.createdAt)}{n.readAt === null ? ' · unread' : ''}</span>
                    </span>
                    <button aria-label="Mark notice read" className="text-muted hover:text-fg" onClick={() => markRead.mutate(n.id)}><MailOpen size={14} aria-hidden /></button>
                    <button aria-label="Dismiss notice" className="text-muted hover:text-fg" onClick={() => dismiss.mutate(n.id)}><X size={14} aria-hidden /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {error !== null && <p className="mt-2 text-xs text-bad" role="alert">{error}</p>}
        </div>
      )}
    </div>
  )
}
