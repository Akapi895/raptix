import { useEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

interface DialogProps {
  onClose: () => void
  labelId?: string
  describedById?: string
  panelClassName?: string
  panelStyle?: CSSProperties
  children: ReactNode
}

export default function Dialog({
  onClose,
  labelId,
  describedById,
  panelClassName,
  panelStyle,
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const target = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? panel
    target?.focus()
    return () => previous?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const panel = panelRef.current
      if (!panel) return
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter(el => el.offsetParent !== null)
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && panel.contains(active)
      if (!inside || (e.shiftKey && active === first)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        aria-describedby={describedById}
        tabIndex={-1}
        className={panelClassName ? `outline-none ${panelClassName}` : 'outline-none'}
        style={{
          backgroundColor: '#121821',
          border: '1px solid #273142',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          maxHeight: 'calc(100dvh - 2rem)',
          overflowY: 'auto',
          ...panelStyle,
        }}
      >
        {children}
      </div>
    </div>
  )
}
