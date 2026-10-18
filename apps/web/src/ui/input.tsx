import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { AlertTriangle, Search } from 'lucide-react'
import { cx } from './cx'

/* ───────────── Forms ───────────── */
const fieldCls = 'w-full rounded-[10px] border border-line bg-panel px-3 text-sm text-fg placeholder:text-neutral outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50'
export function Field({ label, hint, error, required, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}{required && <span className="text-bad"> *</span>}</span>
      {children}
      {error ? <span className="mt-1 flex items-center gap-1 text-xs text-bad"><AlertTriangle size={12} />{error}</span> : hint ? <span className="mt-1 block text-xs text-neutral">{hint}</span> : null}
    </label>
  )
}
export const Input = ({ className, ...r }: InputHTMLAttributes<HTMLInputElement>) => <input {...r} className={cx(fieldCls, 'h-10', className)} />
export const Textarea = ({ className, ...r }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...r} className={cx(fieldCls, 'min-h-24 py-2.5 leading-relaxed', className)} />
export const Select = ({ className, children, ...r }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...r} className={cx(fieldCls, 'h-10 appearance-none pr-8', className)}>{children}</select>
export function SearchBox({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral" aria-hidden />
      <input aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cx(fieldCls, 'h-10 pl-9')} />
    </div>
  )
}
export function Check({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm transition hover:bg-hover', disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 cursor-pointer rounded accent-[var(--c-accent)]" />
      {label}
    </label>
  )
}
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const thumbPos = on ? 'left-[calc(100%-20px)]' : 'left-0.5'
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className={cx('relative h-6 w-11 shrink-0 rounded-full border border-2 transition disabled:opacity-50', on ? 'border-accent bg-accent' : 'border-line bg-panel')}>
      <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', thumbPos)} />
    </button>
  )
}
