/**
 * Shared UI primitives compatibility barrel (ticket 09).
 *
 * Input, button, status, identity, table/pager, tabs/segmented, filter/empty,
 * dialog/menu primitives (09–11) and the composed/domain blocks (12) are
 * extracted into `src/ui/*`; this module re-exports them so existing `./ui`
 * imports keep resolving while the chart family and the remaining badge/
 * console/reason leftovers (13) still live here. No reimplementation — every
 * extracted export forwards to its owning module.
 */
import type { ReactNode } from 'react'
import { Ban, Clock, Eye, Info, Lightbulb, Lock, WifiOff, Zap, type LucideIcon } from 'lucide-react'
import { cx } from './ui/cx'

export { cx } from './ui/cx'
export { STATUS, toneText, type StatusKind, type Tone } from './ui/status-map'
export { Status, Sev } from './ui/status'
export { Button, IconButton } from './ui/button'
export { Field, Input, Textarea, Select, SearchBox, Check, Toggle } from './ui/input'
export { Mono, IdLink, Avatar, Person } from './ui/identity'
export { Table, type Col } from './ui/table'
export { usePaged } from './ui/use-paged'
export { Pager } from './ui/pager'
export { Tabs } from './ui/tabs'
export { Segmented } from './ui/segmented'
export { Empty } from './ui/empty'
export { FilterBar } from './ui/filter-bar'
export { Modal, Drawer } from './ui/dialog'
export { Menu } from './ui/menu'
export { Card, CardHeader, PageHeader } from './ui/layout'
export { Banner, ApprovalBanner } from './ui/banner'
export { Skeleton, PageSkeleton } from './ui/skeleton'
export { DescList, Kpi, Progress, Timeline, Stepper } from './ui/data'
export { DemoTag } from './ui/demo-tag'
export { Gated, Locked, PersonaHint } from './ui/guard'
export { useGuard } from './ui/use-guard'
export { useDebounced, useMemoList } from './ui/use-debounced'

/* ───────────── V2 badges / console ───────────── */
export function AiModeBadge({ mode }: { mode: 'observe' | 'propose' | 'execution' }) {
  const m = {
    observe: { label: 'Observe', icon: Eye, cls: 'border-cyan/30 bg-info-soft text-cyan' },
    propose: { label: 'Propose', icon: Lightbulb, cls: 'border-warn/30 bg-warn-soft text-warn' },
    execution: { label: 'Approved Execution', icon: Zap, cls: 'border-accent bg-panel text-accent' },
  }[mode]
  return <span className={cx('inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium', m.cls)}><m.icon size={13} aria-hidden />{m.label}</span>
}
export const ConsolePane = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cx('no-scrollbar overflow-auto rounded-lg border border-console-line bg-console font-mono text-[12.5px] leading-relaxed text-console-fg', className)}>{children}</div>
)
export type ReasonCodeValue = 'Missing approval' | 'Out of scope' | 'Expired grant' | 'Agent unavailable' | 'Project not selected' | 'Permission denied'
export function ReasonCode({ code }: { code: ReasonCodeValue }) {
  const I = ({ 'Missing approval': Clock, 'Out of scope': Ban, 'Expired grant': Clock, 'Agent unavailable': WifiOff, 'Project not selected': Info, 'Permission denied': Lock } as Record<string, LucideIcon>)[code] || Info
  return <span className="inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md border border-line bg-subtle px-1.5 text-xs font-medium text-muted"><I size={12} aria-hidden />{code}</span>
}

/* ───────────── SVG charts ───────────── */
export function Donut({ data, size = 140, center }: { data: { label: string; value: number; color: string }[]; size?: number; center?: ReactNode }) {
  const total = data.reduce((a, b) => a + b.value, 0)
  const r = size / 2 - 12, c = 2 * Math.PI * r
  let off = 0
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={data.map((d) => `${d.label}: ${d.value}`).join(', ')}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--c-hover)" strokeWidth={14} />
        {total > 0 && data.map((d) => { const len = (d.value / total) * c; const el = <circle key={d.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth={14} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} />; off += len; return el })}
      </svg>
      <div className="absolute text-center">{center}</div>
    </div>
  )
}
export function Legend({ data }: { data: { label: string; value: number | string; color: string }[] }) {
  return <ul className="space-y-1.5 text-xs">{data.map((d) => <li key={d.label} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} /><span className="text-muted">{d.label}</span><span className="ml-auto font-medium tabular-nums">{d.value}</span></li>)}</ul>
}
export function BarChart({ data, height = 160, color = 'var(--c-accent)' }: { data: { label: string; value: number; color?: string }[]; height?: number; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div role="img" aria-label={data.map((d) => `${d.label}: ${d.value}`).join(', ')} className="flex items-end gap-3" style={{ height }}>
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center justify-end gap-1" style={{ height: '100%' }}>
          <span className="text-xs tabular-nums text-muted">{d.value}</span>
          <div className="w-full max-w-10 rounded-t-md" style={{ height: `${(d.value / max) * (height - 44)}px`, minHeight: 2, background: d.color || color }} />
          <span className="truncate text-xs text-muted">{d.label}</span>
        </div>
      ))}
    </div>
  )
}
export function LineChart({ series, labels, height = 160 }: { series: { name: string; values: number[]; color: string }[]; labels: string[]; height?: number }) {
  const W = 480, H = height, pad = 24
  const max = Math.max(1, ...series.flatMap((s) => s.values))
  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, labels.length - 1)
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={series.map((s) => s.name).join(', ')}>
      {[0, 0.5, 1].map((t) => <line key={t} x1={pad} x2={W - pad} y1={y(max * t)} y2={y(max * t)} stroke="var(--c-line)" strokeDasharray="3 4" />)}
      {series.map((s) => (
        <g key={s.name}>
          <polyline fill="none" stroke={s.color} strokeWidth={2} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
          {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={s.color} />)}
        </g>
      ))}
      {labels.map((l, i) => <text key={l} x={x(i)} y={H - 6} textAnchor="middle" fontSize="12" fill="var(--c-muted)">{l}</text>)}
    </svg>
  )
}
