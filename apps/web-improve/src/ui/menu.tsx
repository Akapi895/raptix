import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'

/* ───────────── Menu ───────────── */
/**
 * Dropdown menu (ticket 62): the panel renders through a portal anchored to
 * the trigger's viewport rect. An absolutely positioned panel inside a scroll
 * container (tables, tab strips) is clipped by the container's overflow, so
 * in-table row actions and the project-detail "More" tabs were cut off at
 * narrow widths. The panel is clamped to the viewport like the shell `Pop`.
 */
export function Menu({ trigger, items, align = 'right' }: { trigger: ReactNode; items: { label: string; icon?: LucideIcon; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string }[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<CSSProperties>({})
  useLayoutEffect(() => {
    if (!open) return
    const t = ref.current?.getBoundingClientRect()
    if (t) {
      const vw = window.innerWidth
      setPos(align === 'right'
        ? { top: t.bottom + 4, right: Math.max(12, vw - t.right) }
        : { top: t.bottom + 4, left: Math.min(t.left, Math.max(12, vw - 240)) })
    }
    const h = (e: MouseEvent) => { const n = e.target as Node; if (!ref.current?.contains(n) && !panel.current?.contains(n)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open, align])
  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && createPortal(
        <div ref={panel} role="menu" style={{ position: 'fixed', ...pos }} className="z-50 min-w-52 max-w-[calc(100vw-1.5rem)] rounded-xl border border-line bg-panel p-1 shadow-xl">
          {items.map((it) => (
            <button key={it.label} role="menuitem" disabled={it.disabled} title={it.hint} onClick={() => { setOpen(false); it.onClick() }} className={cx('flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition hover:bg-hover disabled:opacity-40', it.danger ? 'text-bad' : 'text-fg')}>
              {it.icon && <it.icon size={15} aria-hidden />}{it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
