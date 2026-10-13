import { cx } from './cx'

/* ───────────── Segmented ───────────── */
export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-[10px] border border-line bg-subtle p-0.5">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} aria-pressed={value === o.id} className={cx('h-8 rounded-md px-3 text-xs font-medium transition', value === o.id ? 'bg-panel text-fg shadow-sm' : 'text-muted hover:text-fg')}>{o.label}</button>
      ))}
    </div>
  )
}
