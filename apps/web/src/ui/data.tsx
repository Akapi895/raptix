import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'
import { toneText, type Tone } from './status-map'

/* ───────────── Data display ───────────── */
export function DescList({ items, cols = 2 }: { items: { k: ReactNode; v: ReactNode }[]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cx('grid gap-x-8 gap-y-4', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
      {items.map((i, n) => (
        <div key={n} className="min-w-0"><dt className="mb-1 text-xs text-muted">{i.k}</dt><dd className="break-words text-sm text-fg">{i.v || '—'}</dd></div>
      ))}
    </dl>
  )
}
export function Kpi({ label, value, sub, tone, onClick, icon: I }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; onClick?: () => void; icon?: LucideIcon }) {
  const cls = cx('rounded-xl border border-line bg-panel p-4 text-left', onClick && 'transition hover:bg-hover')
  const body = (
    <>
      <div className="mb-2 flex items-center justify-between text-xs text-muted"><span>{label}</span>{I && <I size={15} aria-hidden className={tone ? toneText(tone) : ''} />}</div>
      <div className={cx('text-2xl font-semibold tabular-nums', tone && toneText(tone))}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </>
  )
  if (onClick) return <button onClick={onClick} className={cls}>{body}</button>
  return <div className={cls}>{body}</div>
}
export function Progress({ value, tone = 'accent', label }: { value: number; tone?: Tone; label?: string }) {
  const bg = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', accent: 'bg-accent', cyan: 'bg-cyan', neutral: 'bg-neutral' }[tone]
  return (
    <div className="flex items-center gap-2">
      <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label} className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover"><div className={cx('h-full rounded-full', bg)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
      <span className="w-9 text-right text-xs tabular-nums text-muted">{value}%</span>
    </div>
  )
}
export function Timeline({ items }: { items: { at: string; title: ReactNode; sub?: ReactNode; tone?: Tone }[] }) {
  return (
    <ol className="relative ml-2 border-l border-line">
      {items.map((i, n) => (
        <li key={n} className="relative pb-5 pl-6 last:pb-0">
          <span className={cx('absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-panel', { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', accent: 'bg-accent', cyan: 'bg-cyan', neutral: 'bg-neutral' }[i.tone || 'accent'])} />
          <div className="text-sm text-fg">{i.title}</div>
          {i.sub && <div className="mt-0.5 text-xs text-muted">{i.sub}</div>}
          <div className="mt-0.5 font-mono text-xs text-neutral">{i.at}</div>
        </li>
      ))}
    </ol>
  )
}
export function Stepper({ steps, current, onJump }: { steps: string[]; current: number; onJump?: (i: number) => void }) {
  return (
    <ol className="no-scrollbar mb-6 flex gap-2 overflow-x-auto">
      {steps.map((s, i) => (
        <li key={s} className="flex-1" style={{ minWidth: 130 }}>
          <button disabled={!onJump || i > current} onClick={() => onJump?.(i)} className={cx('flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition', i === current ? 'border-accent bg-accent-soft text-fg' : i < current ? 'border-ok/40 text-fg hover:bg-hover' : 'border-line text-muted')}>
            <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold', i < current ? 'bg-ok text-white' : i === current ? 'bg-accent text-white' : 'bg-hover')}>{i < current ? '✓' : i + 1}</span>
            <span className="font-medium">{s}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}
