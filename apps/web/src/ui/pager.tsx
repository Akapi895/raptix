import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from './button'

/* ───────────── Pager ───────────── */
export function Pager({ page, pages, setPage, total }: { page: number; pages: number; setPage: (n: number) => void; total: number }) {
  if (pages <= 1) return <div className="mt-3 text-xs text-muted">Showing all {total} record{total !== 1 ? 's' : ''}</div>
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-muted">
      <span>{total} total record{total !== 1 ? 's' : ''}</span>
      <div className="flex items-center gap-2">
        <IconButton icon={ChevronLeft} label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)} className="!h-8 !w-8" />
        <span className="rounded bg-subtle px-2.5 py-1">Page {page} of {pages}</span>
        <IconButton icon={ChevronRight} label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)} className="!h-8 !w-8" />
      </div>
    </div>
  )
}
