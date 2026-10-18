import { cloneElement, isValidElement, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
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
 *
 * Keyboard/state semantics (ticket 64, per the baseline brief in ticket 11):
 * ArrowDown on the trigger opens the menu and Escape closes it; open/close
 * move focus like the dialog utilities (first enabled item on open, back to
 * the trigger on close, only while it is still connected). Element triggers
 * get `aria-haspopup="menu"` and the `aria-expanded` open state.
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
    const previous = document.activeElement as HTMLElement | null
    const h = (e: MouseEvent) => { const n = e.target as Node; if (!ref.current?.contains(n) && !panel.current?.contains(n)) setOpen(false) }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false) } }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    const raf = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus())
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', k)
      if (previous?.isConnected) requestAnimationFrame(() => previous.focus())
    }
  }, [open, align])
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }
  return (
    <div ref={ref} className="relative" onKeyDown={onKeyDown} onClick={(e) => e.stopPropagation()}>
      <div onClick={() => setOpen(!open)}>
        {isValidElement<{ 'aria-haspopup'?: 'menu'; 'aria-expanded'?: boolean }>(trigger)
          ? cloneElement(trigger, { 'aria-haspopup': 'menu', 'aria-expanded': open })
          : trigger}
      </div>
      {open && createPortal(
        <div ref={panel} role="menu" style={{ position: 'fixed', ...pos }} className="z-50 min-w-52 max-w-[calc(100vw-1.5rem)] rounded-xl border border-line bg-panel p-1 shadow-xl">
          {items.map((it) => (
            <button key={it.label} role="menuitem" disabled={it.disabled} title={it.hint} onClick={() => { setOpen(false); it.onClick() }} className={cx('flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40', it.danger ? 'text-bad hover:bg-bad-soft' : 'text-fg')}>
              {it.icon && <it.icon size={15} aria-hidden />}{it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
