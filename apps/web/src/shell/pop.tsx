/**
 * Shared anchored popover (ticket 08c, extracted from the shell monolith
 * verbatim). Used by the header controls and the context ribbon.
 * Supports keyboard navigation: Escape to close, arrow keys to focus items.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { cx } from '../ui'

export function Pop({ open, onClose, label, align = 'left', width = 340, children }: { open: boolean; onClose: () => void; label: string; align?: 'left' | 'right'; width?: number; children: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
      const items = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled]), a, [role="option"]')
      if (!items || items.length === 0) return
      e.preventDefault()
      const current = document.activeElement as HTMLElement
      const index = Array.from(items).indexOf(current as HTMLButtonElement)
      let next = 0
      if (e.key === 'ArrowDown') next = index < items.length - 1 ? index + 1 : 0
      else if (e.key === 'ArrowUp') next = index > 0 ? index - 1 : items.length - 1
      else if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = items.length - 1
      items[next]?.focus()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div ref={dialogRef} role="dialog" aria-label={label} style={{ width }} className={cx('absolute top-full z-50 mt-2 max-w-[calc(100vw-1.5rem)] whitespace-normal rounded-2xl border border-line bg-panel p-4 text-left text-sm font-normal text-fg shadow-xl', align === 'right' ? 'right-0' : 'left-0')}>{children}</div>
    </>
  )
}
