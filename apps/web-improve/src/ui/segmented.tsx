import { cx } from './cx'

/* ───────────── Segmented ───────────── */
export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-[10px] border border-line bg-subtle p-0.5">
      {/* aria-label keeps the option name when a wrapping <label> (Field) would
          otherwise override it with the field text, e.g. "Theme Dark" (ticket 64). */}
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} aria-pressed={value === o.id} aria-label={o.label} className={cx('h-8 rounded-md px-3 text-xs font-medium transition', value === o.id ? 'bg-panel text-fg shadow-sm' : 'text-muted hover:text-fg')}>{o.label}</button>
      ))}
    </div>
  )
}
