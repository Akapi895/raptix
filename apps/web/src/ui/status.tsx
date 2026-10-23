import { Circle, Loader2 } from 'lucide-react'
import { cx } from './cx'
import { S, STATUS, TONE, type StatusKind } from './status-map'

export function Status({ kind, value, size = 'md', label }: { kind: StatusKind; value: string; size?: 'sm' | 'md'; label?: string }) {
  const m = (STATUS[kind] as Record<string, ReturnType<typeof S> | undefined>)[value]
  const x = m || S(value, 'neutral', Circle)
  const I = x.icon
  const solid = kind === 'sev' && value === 'critical'
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium', solid ? 'border-danger-fill bg-danger-fill text-white' : TONE[x.tone], size === 'sm' ? 'h-5 px-2 text-xs' : 'h-6 px-2.5 text-xs')}>
      <I size={size === 'sm' ? 12 : 13} className={I === Loader2 ? 'motion-safe:animate-spin' : ''} aria-hidden />
      {label || x.label}
    </span>
  )
}
export const Sev = ({ v }: { v: string }) => <Status kind="sev" value={v} />
