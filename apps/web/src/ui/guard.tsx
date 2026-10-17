import { useState, type ReactNode } from 'react'
import { Info, Lock } from 'lucide-react'
import { useMe } from '../state/console'
import { useAuthStore } from '../state/stores'
import { Button } from './button'

/* ───────────── Guards ───────────── */
/** Visibly disabled control; hover, focus or click explains why */
export function Gated({ allowed, reason, children }: { allowed: boolean; reason: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  if (allowed) return <>{children}</>
  return (
    <span
      className="relative inline-flex" aria-disabled="true" tabIndex={0}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      onClick={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' || e.key === ' ') setOpen(true) }}
    >
      <span className="inline-flex cursor-not-allowed opacity-50" inert>{children}</span>
      {open && (
        <span role="tooltip" className="absolute left-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-line bg-panel p-3 text-left shadow-xl">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-fg"><Lock size={12} aria-hidden />Why is this disabled?</span>
          <span className="block text-xs font-normal text-muted">{reason}</span>
        </span>
      )}
    </span>
  )
}
/** Shows why an action is locked (no permission / read-only) */
export function Locked({ reason }: { reason: string }) {
  return <span className="inline-flex items-center gap-1.5 text-xs text-muted"><Lock size={13} aria-hidden />{reason}</span>
}
/** Suggests switching persona when the current role cannot perform the next demo step; a real session passes no persona */
export function PersonaHint({ need, persona, children }: { need: string; persona?: string; children?: ReactNode }) {
  const me = useMe()
  const setMe = useAuthStore((s) => s.setMe)
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line bg-hover/50 px-4 py-3 text-sm">
      <Info size={16} className="text-cyan" aria-hidden />
      <span className="flex-1 text-muted">{children || `This step requires ${need}. You are signed in as ${me.role}.`}</span>
      {persona && <Button size="sm" onClick={() => setMe(persona)}>Switch to {persona}</Button>}
    </div>
  )
}
