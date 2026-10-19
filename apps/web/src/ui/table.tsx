import type { ReactNode } from 'react'
import { Empty } from './empty'
import { cx } from './cx'

/* ───────────── Table ───────────── */
export interface Col<T> { key: string; header: ReactNode; render: (r: T) => ReactNode; width?: string; className?: string; hideBelow?: 'md' | 'lg' }
export function Table<T>({ cols, rows, rowKey, onRow, empty, dense, selectedKey }: { cols: Col<T>[]; rows: T[]; rowKey: (r: T) => string; onRow?: (r: T) => void; empty?: ReactNode; dense?: boolean; selectedKey?: string }) {
  if (!rows.length) return <>{empty || <Empty title="No data yet" />}</>
  return (
    <div className={cx('scrollable rounded-xl border border-line bg-panel', onRow ? 'overflow-x-auto' : 'overflow-x-hidden')}>
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wide text-muted">
            {cols.map((c) => <th key={c.key} style={{ width: c.width }} className={cx('h-11 whitespace-nowrap px-4 font-medium', c.hideBelow === 'md' && 'max-md:hidden', c.hideBelow === 'lg' && 'max-lg:hidden', c.className)}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr
              key={rowKey(r)} onClick={onRow ? () => onRow(r) : undefined}
              onKeyDown={onRow ? (e) => e.key === 'Enter' && onRow(r) : undefined} tabIndex={onRow ? 0 : undefined}
              className={cx('border-b border-line/60 last:border-0 transition', dense ? 'h-12' : 'h-14', idx % 2 === 1 && 'bg-subtle/40', onRow && 'cursor-pointer hover:bg-hover', selectedKey === rowKey(r) && 'bg-hover')}
            >
              {cols.map((c) => <td key={c.key} className={cx('px-4 align-middle', selectedKey === rowKey(r) && 'font-medium', c.hideBelow === 'md' && 'max-md:hidden', c.hideBelow === 'lg' && 'max-lg:hidden', c.className)}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
