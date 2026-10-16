import { useRef, useState, useEffect, type ComponentType, type ReactNode } from 'react'
import { Lock, SlidersHorizontal } from 'lucide-react'
import { useSessionStore } from '../state/session'
import { Button, Empty, Mono, PageSkeleton, cx } from '../ui'

/** Wraps a screen: shows a skeleton while the project is switching */
// eslint-disable-next-line react-refresh/only-export-components -- shared agent/asset/library screen helpers
export function withLoading(C: ComponentType): ComponentType {
  return function Wrapped() {
    const loading = useSessionStore((s) => s.loading)
    return loading ? <PageSkeleton /> : <C />
  }
}

// eslint-disable-next-line react-refresh/only-export-components -- shared agent/asset/library screen helpers
export const hashNum = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7)

// eslint-disable-next-line react-refresh/only-export-components -- shared agent/asset/library screen helpers
export const POOL_LABEL = 'Unassigned (shared pool)'

export function Blocked({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return <Empty icon={Lock} title={title} action={actions}>{children}</Empty>
}

/** Non-wrapping mono ID */
export const Id = ({ children, className }: { children: ReactNode; className?: string }) => <Mono className={cx('whitespace-nowrap', className)}>{children}</Mono>

/** Non-wrapping clickable ID */
export const IdL = ({ children, onClick }: { children: ReactNode; onClick: () => void }) => <button onClick={(e) => { e.stopPropagation(); onClick() }} className="whitespace-nowrap font-mono text-[13px] text-accent hover:underline">{children}</button>

/** "More filters" popover button for compact filter bars */
export function MoreFilters({ children, active = 0 }: { children: ReactNode; active?: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <Button icon={SlidersHorizontal} onClick={() => setOpen(!open)} aria-expanded={open}>More filters{active > 0 ? ` (${active})` : ''}</Button>
      {open && <div className="absolute left-0 top-full z-30 mt-1 flex w-64 flex-col gap-2 rounded-xl border border-line bg-panel p-3 shadow-lg">{children}</div>}
    </div>
  )
}

/** Table with sticky header + sticky first (ID) column, container-only scroll, row click */
export interface DCol<T> { key: string; header: ReactNode; render: (r: T) => ReactNode; hideBelow?: 'md' | 'lg'; width?: string }
export function DTable<T>({ cols, rows, rowKey, onRow, empty, selectedKey }: { cols: DCol<T>[]; rows: T[]; rowKey: (r: T) => string; onRow?: (r: T) => void; empty?: ReactNode; selectedKey?: string }) {
  if (!rows.length) return <>{empty || <Empty title="No data yet" />}</>
  const hide = (c: DCol<T>) => (c.hideBelow === 'md' ? 'max-md:hidden' : c.hideBelow === 'lg' ? 'max-lg:hidden' : '')
  return (
    <div className="no-scrollbar max-h-[62vh] overflow-auto rounded-xl border border-line bg-panel">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted">
            {cols.map((c, i) => <th key={c.key} style={{ width: c.width }} className={cx('sticky top-0 h-11 whitespace-nowrap border-b border-line bg-panel px-4 font-medium', i === 0 ? 'left-0 z-20' : 'z-10', hide(c))}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} onClick={onRow ? () => onRow(r) : undefined} onKeyDown={onRow ? (e) => e.key === 'Enter' && e.target === e.currentTarget && onRow(r) : undefined} tabIndex={onRow ? 0 : undefined}
              className={cx('group h-14 border-b border-line/60 last:border-0', onRow && 'cursor-pointer transition hover:bg-hover focus-visible:bg-hover focus-visible:outline-none', selectedKey === rowKey(r) && 'bg-hover')}>
              {cols.map((c, i) => <td key={c.key} className={cx('px-4 align-middle', i === 0 && 'sticky left-0 z-[5] bg-panel group-hover:bg-hover', hide(c))}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Truncating text with full value in title */
export const Trunc = ({ children, max = 'max-w-[180px]' }: { children: string; max?: string }) => <span title={children} className={cx('block truncate', max)}>{children}</span>

/** Short date: "Oct 13, 10:42 AM" -> keeps as is but strips trailing tz words */
// eslint-disable-next-line react-refresh/only-export-components -- shared agent/asset/library screen helpers
export const shortDate = (s: string) => s.replace(/\s*\(UTC\+7\)/, '').replace(/^(\w{3}) (\d+),? (\d{4}),?\s*/, '$1 $2, ')
