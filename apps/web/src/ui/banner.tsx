import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Info, ShieldCheck, ShieldOff, XCircle, type LucideIcon } from 'lucide-react'
import { cx } from './cx'

/* ───────────── Banners ───────────── */
export function ApprovalBanner({ state, title, children, action }: { state: 'none' | 'waiting' | 'approved' | 'rejected' | 'expired'; title?: string; children?: ReactNode; action?: ReactNode }) {
  const m = {
    none: { t: 'Approval not requested', icon: ShieldOff, cls: 'border-l-4 border-l-neutral border-line bg-subtle text-muted' },
    waiting: { t: 'Waiting for approval', icon: Clock, cls: 'border-l-4 border-l-warn border-warn/30 bg-warn-soft text-warn' },
    approved: { t: 'Approved', icon: ShieldCheck, cls: 'border-l-4 border-l-ok border-ok/30 bg-ok-soft text-ok' },
    rejected: { t: 'Rejected', icon: XCircle, cls: 'border-l-4 border-l-bad border-bad/30 bg-bad-soft text-bad' },
    expired: { t: 'Approval expired', icon: Clock, cls: 'border-l-4 border-l-neutral border-line bg-subtle text-muted' },
  }[state]
  return (
    <div role={state === 'rejected' ? 'alert' : 'status'} className={cx('flex w-full items-start gap-3 rounded-xl border px-4 py-3', m.cls)}>
      <m.icon size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold">{title || m.t}</div>
        {children && <div className="mt-0.5 text-fg/90">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
export function Banner({ tone = 'info', title, children, action, icon }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; title?: ReactNode; children?: ReactNode; action?: ReactNode; icon?: LucideIcon }) {
    const m = { info: ['text-cyan bg-info-soft border-cyan/30 border-l-4 border-l-cyan', Info], warn: ['text-warn bg-warn-soft border-warn/30 border-l-4 border-l-warn', AlertTriangle], bad: ['text-bad bg-bad-soft border-bad/30 border-l-4 border-l-bad', XCircle], ok: ['text-ok bg-ok-soft border-ok/30 border-l-4 border-l-ok', CheckCircle2] }[tone] as [string, LucideIcon]
  const I = icon || m[1]
  return (
    <div role={tone === 'bad' || tone === 'warn' ? 'alert' : 'status'} className={cx('mb-4 flex items-start gap-3 rounded-xl border px-4 py-3', m[0])}>
      <I size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className="text-fg/90">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
