/**
 * Shared UI primitives compatibility barrel (ticket 09).
 *
 * Input, button, status, identity, table/pager, tabs/segmented, filter/empty,
 * dialog/menu primitives (09–11), the composed/domain blocks (12) and the
 * shared SVG chart family (13) are extracted into `src/ui/*`; this module
 * re-exports them so existing `./ui` imports keep resolving while the remaining
 * badge/console/reason leftovers still live here. No reimplementation — every
 * extracted export forwards to its owning module.
 */
import type { ReactNode } from 'react'
import { Ban, Clock, Eye, Info, Lightbulb, Lock, WifiOff, Zap, type LucideIcon } from 'lucide-react'
import { cx } from './cx'

// eslint-disable-next-line react-refresh/only-export-components -- shared UI kit: constants/helpers co-exported with primitives
export { cx } from './cx'
// eslint-disable-next-line react-refresh/only-export-components -- shared UI kit: constants/helpers co-exported with primitives
export { STATUS, toneText, type StatusKind, type Tone } from './status-map'
export { Status, Sev } from './status'
export { Button, IconButton } from './button'
export { Field, Input, Textarea, Select, SearchBox, Check, Toggle } from './input'
export { Mono, IdLink, Avatar, Person } from './identity'
export { Table, type Col } from './table'
// eslint-disable-next-line react-refresh/only-export-components -- shared UI kit: constants/helpers co-exported with primitives
export { usePaged } from './use-paged'
export { Pager } from './pager'
export { Tabs } from './tabs'
export { Segmented } from './segmented'
export { Empty } from './empty'
export { FilterBar } from './filter-bar'
export { Modal, Drawer } from './dialog'
export { Menu } from './menu'
export { Card, CardHeader, PageHeader } from './layout'
export { Banner, ApprovalBanner } from './banner'
export { Skeleton, PageSkeleton } from './skeleton'
export { DescList, Kpi, Progress, Timeline, Stepper } from './data'
export { Gated, Locked, PersonaHint } from './guard'
// eslint-disable-next-line react-refresh/only-export-components -- shared UI kit: constants/helpers co-exported with primitives
export { useGuard } from './use-guard'
// eslint-disable-next-line react-refresh/only-export-components -- shared UI kit: constants/helpers co-exported with primitives
export { useDebounced, useMemoList } from './use-debounced'
export { Donut, Legend, BarChart, LineChart } from './charts'

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
