import type { ReactNode } from 'react'

/* ───────────── Filter bar ───────────── */
export function FilterBar({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {children}
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  )
}
