import { cx } from '../../../ui/index'

const TONE: Record<'ok' | 'neutral', { edge: string; figure: string }> = {
  ok: { edge: 'border-l-ok', figure: 'text-ok' },
  neutral: { edge: 'border-l-neutral', figure: 'text-neutral' },
}

/** A stat tile in the findings page's shape: centred label, large figure, and the note on what it counts. */
export function StatTile({ label, value, note, tone = 'neutral' }: { label: string; value: number; note: string; tone?: keyof typeof TONE }) {
  const style = TONE[tone]
  return (
    <div className={cx('rounded-lg border border-line border-l-4 bg-panel p-4 text-center shadow-sm', style.edge)}>
      <div className="text-sm text-muted">{label}</div>
      <div className={cx('mt-2 text-[2rem] font-bold leading-none tabular-nums', value === 0 ? 'text-muted opacity-50' : style.figure)}>{value}</div>
      <div className="mt-1.5 text-[13px] font-medium tracking-wide text-muted">{note}</div>
    </div>
  )
}

/** A filter chip in the findings page's shape: pressed state, label and count. */
export function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
        active ? 'border-primary/40 bg-primary/5 text-primary' : 'border-line bg-panel text-muted hover:bg-hover hover:text-fg',
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{count}</span>
    </button>
  )
}
