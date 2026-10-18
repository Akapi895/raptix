import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cx } from './cx'

/* ───────────── Layout ───────────── */
type CardVariant = 'default' | 'elevated' | 'highlight'
const CardVariants: Record<CardVariant, string> = {
  default: 'border border-line bg-panel',
  elevated: 'border border-line bg-panel shadow-sm',
  highlight: 'border border-accent/20 bg-accent-soft',
}
export const Card = ({ children, className, pad = true, variant = 'default' }: { children: ReactNode; className?: string; pad?: boolean; variant?: CardVariant }) => (
  <div className={cx('rounded-xl', CardVariants[variant], pad && 'p-5', className)}>{children}</div>
)
export function CardHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
export function PageHeader({ title, sub, actions, back, meta, crumbs }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: { label: string; to: () => void }; meta?: ReactNode; crumbs?: { label: string; to?: () => void }[] }) {
  return (
    <div className="mb-6">
      {crumbs && (
        <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1 text-xs text-muted">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {c.to ? <button onClick={c.to} className="rounded px-1 py-0.5 transition hover:bg-hover hover:text-fg hover:underline">{c.label}</button> : <span className="text-fg font-medium">{c.label}</span>}
              {i < crumbs.length - 1 && <ChevronRight size={12} className="text-muted" aria-hidden />}
            </span>
          ))}
        </nav>
      )}
      {back && (
        <button onClick={back.to} className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
          <ChevronLeft size={14} /> {back.label}
        </button>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-fg">{title}</h1>
            {meta}
          </div>
          {sub && <p className="mt-1 max-w-3xl text-sm text-muted">{sub}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}
