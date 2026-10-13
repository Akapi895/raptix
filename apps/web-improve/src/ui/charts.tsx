import type { ReactNode } from 'react'

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
