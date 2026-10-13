import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'

/* ───────────── Menu ───────────── */
export function Menu({ trigger, items, align = 'right' }: { trigger: ReactNode; items: { label: string; icon?: LucideIcon; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string }[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <div role="menu" className={cx('absolute top-full z-50 mt-1 min-w-52 rounded-xl border border-line bg-panel p-1 shadow-xl', align === 'right' ? 'right-0' : 'left-0')}>
          {items.map((it) => (
            <button key={it.label} role="menuitem" disabled={it.disabled} title={it.hint} onClick={() => { setOpen(false); it.onClick() }} className={cx('flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition hover:bg-hover disabled:opacity-40', it.danger ? 'text-bad' : 'text-fg')}>
              {it.icon && <it.icon size={15} aria-hidden />}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
