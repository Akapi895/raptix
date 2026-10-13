import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'

/* ───────────── Tabs ───────────── */
export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string; count?: number; icon?: LucideIcon }[]; value: string; onChange: (id: string) => void }) {
  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    const buttons = Array.from(e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') || [])
    if (!buttons.length) return
    e.preventDefault()
    const current = buttons.indexOf(e.currentTarget)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (current + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next].focus()
    buttons[next].click()
  }
  return (
    <div role="tablist" className="no-scrollbar mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id} role="tab" aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1} onKeyDown={onKeyDown} onClick={() => onChange(t.id)}
          className={cx('-mb-px inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-3.5 text-sm font-medium transition', value === t.id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}
        >
          {t.icon && <t.icon size={15} aria-hidden />}
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-hover px-1.5 text-xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}
