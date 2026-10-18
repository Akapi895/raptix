import type { ButtonHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'

/* ───────────── Button ───────────── */
type BtnV = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSolid' | 'destructive'
const BV: Record<BtnV, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover active:bg-accent-press border border-transparent shadow-sm',
  secondary: 'bg-panel text-fg border border-line hover:bg-hover',
  ghost: 'bg-transparent text-muted hover:bg-hover hover:text-fg border border-transparent',
  danger: 'bg-transparent text-bad border border-bad/50 hover:bg-bad-soft',
  dangerSolid: 'bg-bad text-white hover:brightness-110 border border-transparent',
  destructive: 'bg-bad text-white hover:brightness-110 border border-transparent',
}
export function Button({ variant = 'secondary', size = 'md', icon: I, children, className, disabled, title, ...r }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnV; size?: 'sm' | 'md' | 'lg'; icon?: LucideIcon }) {
  return (
    <button
      {...r} disabled={disabled} title={title}
      className={cx('inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-medium transition disabled:cursor-not-allowed disabled:opacity-45', size === 'sm' ? 'h-8 px-3 text-xs' : size === 'lg' ? 'h-11 px-5 text-sm' : 'h-10 px-4 text-sm', BV[variant], className)}
    >
      {I && <I size={size === 'sm' ? 14 : 16} aria-hidden />}
      {children}
    </button>
  )
}
export function IconButton({ icon: I, label, className, ...r }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button {...r} aria-label={label} title={label} className={cx('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-hover hover:text-fg disabled:opacity-40', className)}>
      <I size={18} aria-hidden />
    </button>
  )
}
