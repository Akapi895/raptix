import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from './button'

/* ───────────── Pager ───────────── */
export function Pager({ page, pages, setPage, total }: { page: number; pages: number; setPage: (n: number) => void; total: number }) {
  if (pages <= 1) return <div className="mt-3 text-xs text-muted">{total} records</div>
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-muted">
      <span>{total} records</span>
      <div className="flex items-center gap-1">
        <IconButton icon={ChevronLeft} label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)} className="!h-8 !w-8" />
        <span className="px-2">Page {page} of {pages}</span>
        <IconButton icon={ChevronRight} label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)} className="!h-8 !w-8" />
      </div>
    </div>
  )
}
