import { cx } from './cx'

/* ───────────── Skeleton ───────────── */
export const Skeleton = ({ className }: { className?: string }) => <div className={cx('animate-pulse rounded-md bg-hover', className)} />
export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading data">
      <Skeleton className="mb-3 h-7 w-64" /><Skeleton className="mb-8 h-4 w-96" />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      <Skeleton className="h-72" />
    </div>
  )
}
