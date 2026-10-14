import type { ReactNode } from 'react'
import { FileText, type LucideIcon } from 'lucide-react'

/* ───────────── Empty ───────────── */
export function Empty({ icon: I = FileText, title, children, action }: { icon?: LucideIcon; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-hover text-muted"><I size={22} aria-hidden /></div>
      <div className="text-[15px] font-semibold">{title}</div>
      {children && <p className="mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
