import { useEffect, useRef } from 'react'

/* ───────────── Dialog focus ───────────── */
export function useDialogFocus<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open || !ref.current) return
    const dialog = ref.current
    const previous = document.activeElement as HTMLElement | null
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((el) => !el.closest('[inert]'))
    const topmost = () => {
      const layers = document.querySelectorAll('[data-dialog-layer]')
      return layers[layers.length - 1] === dialog
    }
    const h = (e: KeyboardEvent) => {
      if (!topmost()) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusable()
      if (!items.length) {
        e.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', h)
    requestAnimationFrame(() => (focusable()[0] || dialog).focus())
    return () => {
      document.removeEventListener('keydown', h)
      if (previous?.isConnected) requestAnimationFrame(() => previous.focus())
    }
  }, [open])
  return ref
}
