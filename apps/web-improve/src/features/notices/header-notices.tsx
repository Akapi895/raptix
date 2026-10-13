/**
 * Header notification center (ticket 59) — the `notifications` shell slot
 * implementation. Composes through the ticket-08 typed slot
 * (`HeaderSlots.notifications`, wired at the mount site in
 * src/router/host.tsx); no shell internals are edited and no store state is
 * duplicated: panel visibility stays in the shared ticket-05 UI authority
 * (`noticesOpen`), data comes from the typed notice service through Query.
 * Badge counts, the list and every action reflect the persona's scoped
 * read; refusals render their handler reasons.
 */
import { useState } from 'react'
import { Bell, CheckCheck, Mail, MailOpen, X } from 'lucide-react'
import { useStore } from '../../store'
import { Button, IconButton, cx } from '../../ui'
import { useNotices, useNoticeMutations } from './query'
import { NOTICE_CHIPS, type NoticeChip } from './service'

export function HeaderNotices() {
  const s = useStore()
  const { noticesOpen, setNoticesOpen, setCopilotOpen, go, toast, confirm, me } = s
  const notices = useNotices()
  const { setRead, dismiss, markAllRead } = useNoticeMutations()
  const [tab, setTab] = useState<'unread' | 'all'>('unread')
  const [chip, setChip] = useState<NoticeChip | ''>('')

  const items = notices.data?.items ?? []
  const unread = notices.data?.unread ?? 0
  const canMutate = notices.data?.canMutate ?? false
  const list = items.filter((n) => (tab === 'all' || !n.read) && (!chip || n.chip === chip))

  const toggle = () => { if (!noticesOpen) setCopilotOpen(false); setNoticesOpen(!noticesOpen) }
  const open = (n: (typeof items)[number]) => { setNoticesOpen(false); go(n.to.name, { id: n.to.id }) }
  const fail = (r: { ok: boolean; failure?: { message: string } }) => { if (!r.ok && r.failure) toast(r.failure.message, 'warn') }

  const onToggleRead = async (id: string, read: boolean) => fail(await setRead.mutateAsync({ id, read }))
  const onDismiss = (n: (typeof items)[number]) =>
    confirm({
      title: 'Dismiss notification?',
      body: <>“{n.text}” will be removed for everyone on the team. The dismissal is recorded in the audit log.</>,
      confirmLabel: 'Dismiss',
      danger: true,
      onConfirm: async () => { fail(await dismiss.mutateAsync(n.id)) },
    })
  const onMarkAllRead = async () => fail(await markAllRead.mutateAsync())

  return (
    <div className="relative" data-testid="notice-center">
      {/* Accessible announcement: screen readers hear unread-count changes without opening the panel. */}
      <span className="sr-only" role="status" aria-live="polite">{unread === 0 ? 'No unread notifications' : `${unread} unread notifications`}</span>
      <IconButton icon={Bell} label={`Notifications${unread ? ` (${unread} unread)` : ''}`} onClick={toggle} aria-expanded={noticesOpen} data-testid="notice-bell" />
      {unread > 0 && (
        <span data-testid="notice-badge" className="pointer-events-none absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold leading-none tnum text-white">{unread}</span>
      )}
      {noticesOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setNoticesOpen(false)} aria-hidden />
          <div role="dialog" aria-label="Notifications" data-testid="notice-panel" className="fixed left-3 right-3 top-[68px] z-50 rounded-2xl border border-line bg-panel p-3 shadow-xl sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[420px]">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Notifications</h2>
              <button onClick={onMarkAllRead} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"><CheckCheck size={13} aria-hidden />Mark all read</button>
            </div>
            <div role="tablist" className="mb-2 flex gap-1 border-b border-line">
              {([['unread', `Unread (${unread})`], ['all', 'All']] as const).map(([id, l]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('h-9 border-b-2 px-3 text-xs font-medium', tab === id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}>{l}</button>
              ))}
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {NOTICE_CHIPS.map((c) => (
                <button key={c} aria-pressed={chip === c} onClick={() => setChip(chip === c ? '' : c)} className={cx('h-7 rounded-full border px-2.5 text-xs font-medium', chip === c ? 'border-accent-line bg-accent-soft text-accent' : 'border-line text-muted hover:bg-hover')}>{c}</button>
              ))}
            </div>
            <div className="no-scrollbar max-h-[340px] overflow-y-auto">
              {notices.isLoading ? (
                <div className="py-10 text-center text-sm text-muted" role="status" aria-busy="true" data-testid="notice-loading">Loading notifications…</div>
              ) : notices.isError ? (
                <div role="alert" data-testid="notice-error" className="py-6 text-center text-sm text-bad">{notices.error instanceof Error ? notices.error.message : 'Notifications are unavailable right now.'}</div>
              ) : list.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted" data-testid="notice-empty">You're all caught up.</div>
              ) : list.map((n) => (
                <div key={n.id} data-testid={`notice-row-${n.id}`} className="flex items-start gap-3 rounded-[10px] px-3 py-2.5 hover:bg-hover">
                  <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-accent')} aria-label={n.read ? 'Read' : 'Unread'} />
                  <div className="min-w-0 flex-1"><div className="text-sm">{n.text}</div><div className="mt-0.5 text-xs text-muted">{n.chip} · {n.projectId || 'System'} · {n.at}</div></div>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton
                      icon={n.read ? Mail : MailOpen}
                      label={`Mark ${n.id} as ${n.read ? 'unread' : 'read'}`}
                      onClick={() => void onToggleRead(n.id, !n.read)}
                    />
                    <IconButton
                      icon={X}
                      label={canMutate ? `Dismiss ${n.id}` : `Dismiss ${n.id} (read-only account)`}
                      disabled={!canMutate}
                      onClick={() => onDismiss(n)}
                    />
                    <Button size="sm" variant={n.group === 'todo' ? 'primary' : 'secondary'} onClick={() => open(n)}>{n.group === 'todo' ? 'Review' : 'Open'}</Button>
                  </div>
                </div>
              ))}
            </div>
            {me.role === 'viewer' && <p className="mt-2 text-xs text-neutral">Your account has read-only access: you can review notifications but not dismiss them.</p>}
          </div>
        </>
      )}
    </div>
  )
}
