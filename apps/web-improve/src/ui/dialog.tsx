import { useId, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cx } from './cx'
import { IconButton } from './button'
import { useDialogFocus } from './use-dialog-focus'

/* ───────────── Modal / Drawer ───────────── */
export function Modal({ open, onClose, title, children, footer, width = 520, danger }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number; danger?: boolean }) {
  const titleId = useId()
  const ref = useDialogFocus<HTMLDivElement>(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div ref={ref} data-dialog-layer role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={{ maxWidth: width }} className={cx('relative flex max-h-[90vh] w-full flex-col rounded-2xl border bg-panel shadow-xl outline-none', danger ? 'border-bad/50' : 'border-line')}>
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} className="!h-8 !w-8" />
        </div>
        <div className="overflow-y-auto px-6 py-5 text-sm">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}
export function Drawer({ open, onClose, title, children, footer, width = 480 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  const titleId = useId()
  const ref = useDialogFocus<HTMLElement>(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <aside ref={ref} data-dialog-layer role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={{ maxWidth: width }} className="absolute right-0 top-0 flex h-full w-full flex-col border-l border-line bg-panel shadow-2xl outline-none">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} className="!h-8 !w-8" />
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 text-sm">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </aside>
    </div>
  )
}
