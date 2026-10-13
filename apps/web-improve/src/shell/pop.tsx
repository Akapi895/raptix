/**
 * Shared anchored popover (ticket 08c, extracted from the shell monolith
 * verbatim). Used by the header controls and the context ribbon.
 */
import { useEffect, type ReactNode } from 'react'
import { cx } from '../ui'

export function Pop({ open, onClose, label, align = 'left', width = 340, children }: { open: boolean; onClose: () => void; label: string; align?: 'left' | 'right'; width?: number; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div role="dialog" aria-label={label} style={{ width }} className={cx('absolute top-full z-50 mt-2 max-w-[calc(100vw-1.5rem)] whitespace-normal rounded-2xl border border-line bg-panel p-4 text-left text-sm font-normal text-fg shadow-xl', align === 'right' ? 'right-0' : 'left-0')}>{children}</div>
    </>
  )
}
