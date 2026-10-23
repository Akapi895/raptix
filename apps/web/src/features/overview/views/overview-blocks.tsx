/**
 * The blocks of the System Overview (plan §5.1, reference R01): KPI cards, the severity distribution (risk summary, the
 * semi-donut and the breakdown, then the status cards and the fix rate), the operations queue and the decision queue. A
 * block takes the data its page already read and never reads a source itself. A source it could not read shows as
 * unavailable, and a count the source does not record shows as not recorded; neither is shown as zero.
 */
import type { ReactElement, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { go } from '../../../router/navigate'
import { parseHash } from '../../../router/history'
import { countText } from '../../decisions'
import { Button, Card, CardHeader, Progress, Skeleton, Status, cx } from '../../../ui/index'
import { riskAssessment, type OverviewFindings, type OverviewOperation, type OverviewOperations, type OverviewTask, type OverviewTaskKind, type RiskLevel } from '../service'

const KIND_LABEL: Record<OverviewTaskKind, string> = {
  'scope-revision': 'Scope review',
  'business-plan': 'Plan decision',
  'c2-grant': 'C2 grant review',
  'report-review': 'Report review',
  'finding-review': 'Finding confirmation',
  'active-stop': 'Active emergency stop',
}

/** Severity order of the donut and breakdown. Unknown severities follow in the order the source reports them. */
const SEVERITY_ORDER: string[] = ['critical', 'high', 'medium', 'low', 'info']
const SEVERITY_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Informational' }
/**
 * Severity fills, checked with the dataviz palette validator: the findings page's hues fail its lightness and chroma checks,
 * so these are the nearest values that pass the categorical checks in light mode.
 */
const SEVERITY_COLOR: Record<string, string> = { critical: '#b91c1c', high: '#f97316', medium: '#a16207', low: '#0d9488', info: '#1d4ed8' }
/** A lighter stop of each fill: the ring runs from it into the solid colour, so a large segment reads softer than a flat block. */
const SEVERITY_LIGHT: Record<string, string> = { critical: '#ef4444', high: '#fb923c', medium: '#ca8a04', low: '#2dd4bf', info: '#3b82f6' }

/** Pastel card of each status group, mapped from the workflow states: Open is draft, review and returned. */
const STATUS_CARDS: { label: string; statuses: string[]; wash: string; text: string }[] = [
  { label: 'Open', statuses: ['draft', 'review', 'returned'], wash: 'border-warn/30 bg-warn-soft', text: 'text-warn' },
  { label: 'Confirmed', statuses: ['confirmed'], wash: 'border-primary/30 bg-info-soft', text: 'text-primary' },
  { label: 'Remediation', statuses: ['remediation'], wash: 'border-cyan/30 bg-info-soft', text: 'text-cyan' },
  { label: 'Retest', statuses: ['retest'], wash: 'border-line bg-hover', text: 'text-muted' },
  { label: 'Resolved', statuses: ['resolved'], wash: 'border-ok/30 bg-ok-soft', text: 'text-ok' },
]

/** Risk level badges: soft tints, so no level reads as a heavy block of colour. */
const RISK_STYLE: Record<RiskLevel | 'unassessed', { label: string; badge: string; bar: string }> = {
  safe: { label: 'Safe', badge: 'bg-ok-soft text-ok', bar: 'bg-ok' },
  low: { label: 'Low', badge: 'bg-info-soft text-cyan', bar: 'bg-cyan' },
  medium: { label: 'Medium', badge: 'bg-warn-soft text-warn', bar: 'bg-warn' },
  high: { label: 'High', badge: 'bg-orange/15 text-fg', bar: 'bg-orange' },
  severe: { label: 'Severe', badge: 'bg-bad-soft text-bad', bar: 'bg-bad' },
  unassessed: { label: 'Not assessed', badge: 'bg-hover text-muted', bar: 'bg-line' },
}

/** The score at which the risk bar is full: the severe threshold of the weighted score. */
const RISK_BAR_FULL = 40

/** Icon tile and card wash per KPI, as in the reference's tinted cards: the wash fades from the panel into the tint. */
const TINT: Record<'primary' | 'danger' | 'ok' | 'warn' | 'neutral', { tile: string; wash: string }> = {
  primary: { tile: 'bg-info-soft text-primary', wash: 'bg-gradient-to-br from-panel to-info-soft' },
  danger: { tile: 'bg-accent-soft text-accent', wash: 'bg-gradient-to-br from-panel to-accent-soft' },
  ok: { tile: 'bg-ok-soft text-ok', wash: 'bg-gradient-to-br from-panel to-ok-soft' },
  warn: { tile: 'bg-warn-soft text-warn', wash: 'bg-gradient-to-br from-panel to-warn-soft' },
  neutral: { tile: 'bg-hover text-muted', wash: 'bg-panel' },
}

/** One section's loading and error states stay inside the section. */
export function SourceState({ label, pending, error, onRetry, children }: { label: string; pending: boolean; error: Error | null; onRetry: () => void; children: ReactNode }): ReactElement {
  if (pending) return <div className="p-4"><Skeleton className="h-24" /></div>
  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-3 p-4 text-sm text-muted" role="status">
        <span>{label} is unavailable: {error.message}</span>
        <Button size="sm" onClick={onRetry}>Retry</Button>
      </div>
    )
  }
  return <>{children}</>
}

/** A KPI card in the reference's shape: label, tinted icon tile, large figure, and the source line under it. */
export function OverviewKpi({ label, display, note, icon: Icon, tint, onOpen }: { label: string; display: string; note: string; icon: LucideIcon; tint: keyof typeof TINT; onOpen: () => void }): ReactElement {
  const numeric = /^\d+$/.test(display)
  return (
    <button type="button" onClick={onOpen} className={cx('flex min-h-[118px] flex-col justify-between rounded-xl border border-line p-4 text-left transition hover:border-primary', TINT[tint].wash)}>
      <span className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', TINT[tint].tile)}><Icon size={16} aria-hidden /></span>
      </span>
      <span className={cx('mt-2 font-semibold tabular-nums text-fg', numeric ? 'text-[30px] leading-none' : 'text-sm text-muted')}>{display}</span>
      <span className="mt-2 text-xs text-muted">{note}</span>
    </button>
  )
}

/**
 * The attention region, first on the page: active emergency stops, the workflow decisions pending in the visible projects
 * and any figure that could not be read. A figure still loading is said to be checked, never shown as zero.
 */
export function AttentionRegion({ stops, decisions, limited, unavailable, pending }: { stops: number; decisions: number | null; limited: boolean; unavailable: string[]; pending: boolean }): ReactElement {
  const rows: string[] = []
  if (stops > 0) rows.push(`${stops} active emergency stop${stops === 1 ? '' : 's'} ${stops === 1 ? 'needs' : 'need'} attention.`)
  if (decisions !== null && decisions > 0) rows.push(`${countText(decisions, limited)} workflow decision${decisions === 1 ? '' : 's'} pending in your projects.`)
  if (unavailable.length > 0) rows.push(`${unavailable.join(', ')} ${unavailable.length === 1 ? 'is' : 'are'} unavailable. Those figures are not zero.`)
  const message = rows.length > 0 ? rows : [pending ? 'Checking attention items…' : 'Nothing needs your attention right now.']
  const urgent = stops > 0
  return (
    <section aria-label="Needs attention" className={cx('flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm', urgent ? 'border-bad/40 bg-bad-soft' : 'border-line bg-panel')}>
      <div className="min-w-0 flex-1 space-y-1">
        {message.map((text) => <p key={text} className="font-medium text-fg">{text}</p>)}
      </div>
      {(stops > 0 || (decisions ?? 0) > 0) && <Button size="sm" variant="secondary" onClick={() => go('tasks')}>Open decision queue</Button>}
    </section>
  )
}

/** The left zone: the risk level of the unresolved findings and the weighted score behind it, both from recorded counts. */
function RiskSummary({ view }: { view: OverviewFindings }): ReactElement {
  const empty = view.total === 0
  const risk = riskAssessment(view.unresolvedBySeverity)
  const style = RISK_STYLE[empty ? 'unassessed' : risk.level]
  const fill = empty ? 0 : Math.min(100, (risk.score / RISK_BAR_FULL) * 100)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted">Risk level</span>
        <span className={cx('rounded-full px-3 py-1 text-xs font-semibold', style.badge)}>{style.label}</span>
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-3xl font-semibold tabular-nums text-fg">{empty ? '—' : Number.isInteger(risk.score) ? risk.score : risk.score.toFixed(1)}</span>
          <span className="text-xs text-muted">weighted score</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-hover" aria-hidden>
          <div className={cx('h-2 rounded-full transition-[width]', style.bar)} style={{ width: `${fill}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted">Unresolved findings only: critical 10, high 5, medium 2 and low 0.5 each.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-line bg-panel p-3">
          <span className="block text-xs text-muted">Unresolved critical</span>
          <span className="text-xl font-semibold tabular-nums">{view.unresolvedBySeverity.critical ?? 0}</span>
        </div>
        <div className="rounded-lg border border-line bg-panel p-3">
          <span className="block text-xs text-muted">Unresolved high</span>
          <span className="text-xl font-semibold tabular-nums">{view.unresolvedBySeverity.high ?? 0}</span>
        </div>
      </div>
    </div>
  )
}

/** The donut's geometry: a half ring whose arcs run left to right, with a fixed gap between neighbouring segments. */
const DONUT = { cx: 210, cy: 178, outer: 150, inner: 108, gap: 0.035 }

/**
 * The severity donut as the reference draws it: a half ring whose arcs are proportional to the counts, with the total in
 * its centre. Each segment fades from a lighter stop into its colour, and carries a native tooltip with its count and share.
 */
function SeverityDonut({ rows, total }: { rows: [string, number][]; total: number }): ReactElement {
  const { cx, cy, outer, inner, gap } = DONUT
  const visible = rows.filter(([, count]) => count > 0)
  const gapFraction = visible.length > 1 ? gap / Math.PI : 0
  const span = (1 - gapFraction * Math.max(0, visible.length - 1))
  const point = (radius: number, fraction: number): [number, number] => {
    const angle = Math.PI * (1 - fraction)
    return [cx + radius * Math.cos(angle), cy - radius * Math.sin(angle)]
  }
  const arc = (from: number, to: number): string => {
    const [ox1, oy1] = point(outer, from)
    const [ox2, oy2] = point(outer, to)
    const [ix2, iy2] = point(inner, to)
    const [ix1, iy1] = point(inner, from)
    return `M ${ox1.toFixed(2)} ${oy1.toFixed(2)} A ${outer} ${outer} 0 0 1 ${ox2.toFixed(2)} ${oy2.toFixed(2)} L ${ix2.toFixed(2)} ${iy2.toFixed(2)} A ${inner} ${inner} 0 0 0 ${ix1.toFixed(2)} ${iy1.toFixed(2)} Z`
  }
  let cursor = 0
  const segments = visible.map(([severity, count]) => {
    const from = cursor
    const to = from + (count / total) * span
    cursor = to + gapFraction
    const share = Math.round((count / total) * 100)
    // The share sits just outside the ring, at the segment's midpoint, with a short leader; a sliver too small for its label has none.
    const middle = Math.PI * (1 - (from + to) / 2)
    const cos = Math.cos(middle)
    const sin = Math.sin(middle)
    const anchor = cos < -0.2 ? 'end' : cos > 0.2 ? 'start' : 'middle'
    return (
      <g key={severity}>
        <path d={arc(from, to)} fill={`url(#severity-fill-${severity})`}>
          <title>{`${SEVERITY_LABEL[severity] ?? severity}: ${count} (${share}%)`}</title>
        </path>
        {share >= 5 && (
          <>
            <line x1={(cx + (outer + 4) * cos).toFixed(1)} y1={(cy - (outer + 4) * sin).toFixed(1)} x2={(cx + (outer + 12) * cos).toFixed(1)} y2={(cy - (outer + 12) * sin).toFixed(1)} style={{ stroke: 'var(--c-neutral)' }} strokeWidth="1" />
            <text x={(cx + (outer + 16) * cos).toFixed(1)} y={(cy - (outer + 16) * sin + 4).toFixed(1)} textAnchor={anchor} className="fill-fg text-[15px] font-semibold tabular-nums">{share}%</text>
          </>
        )}
      </g>
    )
  })
  const track = `M ${cx - outer} ${cy} A ${outer} ${outer} 0 0 1 ${cx + outer} ${cy} L ${cx + inner} ${cy} A ${inner} ${inner} 0 0 0 ${cx - inner} ${cy} Z`
  return (
    <svg viewBox="0 0 420 200" role="img" aria-label={`Curated findings by severity: ${total} in total`} className="mx-auto w-full max-w-[420px]">
      <defs>
        {visible.map(([severity]) => (
          <linearGradient key={severity} id={`severity-fill-${severity}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={SEVERITY_LIGHT[severity] ?? 'var(--c-neutral)'} />
            <stop offset="1" stopColor={SEVERITY_COLOR[severity] ?? 'var(--c-neutral)'} />
          </linearGradient>
        ))}
      </defs>
      <path d={track} style={{ fill: 'var(--c-hover)' }} />
      {segments}
      <text x={cx} y={cy - 52} textAnchor="middle" className="fill-fg text-[40px] font-semibold tabular-nums">{total}</text>
      <text x={cx} y={cy - 24} textAnchor="middle" className="fill-muted text-[14px]">Curated findings</text>
    </svg>
  )
}

/** The right zone: each severity with its count, its share, and a bar in the severity colour. */
function SeverityBreakdown({ rows, total }: { rows: [string, number][]; total: number }): ReactElement {
  return (
    <ul className="flex flex-col gap-2" aria-label="Curated findings by severity">
      {rows.map(([severity, count]) => {
        const share = total > 0 ? Math.round((count / total) * 100) : 0
        return (
          <li key={severity} className="rounded-lg border border-line bg-panel px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[severity] ?? 'var(--c-neutral)' }} aria-hidden />
              <span className="flex-1">{SEVERITY_LABEL[severity] ?? severity}</span>
              <span className="font-semibold tabular-nums">{count}</span>
              <span className="w-10 text-right text-xs tabular-nums text-muted">{share}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden>
              <div className="h-1.5 rounded-full opacity-80" style={{ width: `${share}%`, background: SEVERITY_COLOR[severity] ?? 'var(--c-neutral)' }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** The status cards: the workflow states grouped into five pastel cards. Each opens the Findings page. */
function StatusStrip({ byStatus }: { byStatus: Record<string, number> }): ReactElement {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {STATUS_CARDS.map((card) => {
        const count = card.statuses.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0)
        return (
          <button key={card.label} type="button" onClick={() => go('findings')} className={cx('rounded-xl border px-4 py-3 text-left transition hover:border-primary', card.wash)}>
            <span className={cx('block text-xs font-medium', card.text)}>{card.label}</span>
            <span className="mt-1 block text-2xl font-semibold tabular-nums text-fg">{count}</span>
          </button>
        )
      })}
    </div>
  )
}

/** The fix rate: resolved findings over all curated findings, from recorded counts; with none recorded, there is no rate. */
function FixRate({ resolved, total }: { resolved: number; total: number }): ReactElement {
  if (total === 0) {
    return <div className="rounded-xl border border-line bg-panel p-4 text-sm text-muted">Fix rate: no curated findings to fix yet.</div>
  }
  const percent = ((resolved / total) * 100).toFixed(1)
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">Fix rate</span>
        <span className="text-sm tabular-nums">{percent}% <span className="text-xs text-muted">({resolved} of {total} resolved)</span></span>
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-hover" aria-hidden>
        <div className="h-2.5 rounded-full bg-gradient-to-r from-ok/60 to-ok" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

/**
 * Severity distribution: the risk summary, the semi-donut and the breakdown side by side, then the status cards and the fix
 * rate. With no curated findings the layout stays the same and each figure reads as not recorded yet; with every finding
 * critical the ring is one segment and the risk is the severe band.
 */
export function SeverityBlock({ view }: { view: OverviewFindings }): ReactElement {
  const rows = [...SEVERITY_ORDER, ...Object.keys(view.bySeverity).filter((s) => !SEVERITY_ORDER.includes(s))].map((s): [string, number] => [s, view.bySeverity[s] ?? 0])
  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-panel to-info-soft/40 p-5">
        <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 h-48 w-[30rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
          <RiskSummary view={view} />
          <SeverityDonut rows={rows} total={view.total} />
          <SeverityBreakdown rows={rows} total={view.total} />
        </div>
        {view.total === 0 && (
          <p className="relative mt-4 text-center text-sm text-muted">No curated findings recorded yet across your {view.engagements} accessible project(s). AI suggestions are not counted here.</p>
        )}
      </div>
      <StatusStrip byStatus={view.byStatus} />
      <FixRate resolved={view.byStatus.resolved ?? 0} total={view.total} />
      {view.truncated && <p className="text-xs text-muted">The scan reached its row cap, so these counts are a lower bound.</p>}
    </div>
  )
}

/** The batch queue: operation bindings by governance state, with the share that has completed. */
export function OperationsBlock({ view }: { view: OverviewOperations }): ReactElement {
  if (view.counts === null) return <p className="text-sm text-muted">Operation status is not recorded for this source.</p>
  const counts = view.counts
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  const completed = counts.completed ?? 0
  const tiles: { key: string; label: string; border: string }[] = [
    { key: 'bound', label: 'Bound', border: 'border-t-warn' },
    { key: 'running', label: 'Running', border: 'border-t-primary' },
    { key: 'stopped', label: 'Stopped', border: 'border-t-neutral' },
    { key: 'completed', label: 'Completed', border: 'border-t-ok' },
  ]
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((tile) => (
          <div key={tile.key} className={cx('rounded-lg border border-t-2 border-line p-3', tile.border)}>
            <span className="block text-xs text-muted">{tile.label}</span>
            <span className="text-lg font-semibold tabular-nums">{counts[tile.key] ?? 0}</span>
          </div>
        ))}
      </div>
      <Progress value={total > 0 ? Math.round((completed / total) * 100) : 0} tone="ok" label={`${completed} of ${total} bindings completed`} />
      {view.recent.length === 0 ? (
        <p className="text-sm text-muted">No operations are bound in your accessible projects yet.</p>
      ) : (
        <ul className="space-y-2">
          {view.recent.slice(0, 5).map((item) => <OperationRow key={item.id} item={item} />)}
        </ul>
      )}
      {view.truncated && <p className="text-xs text-muted">Scan truncated: counts are a lower bound.</p>}
      <Button variant="secondary" onClick={() => go('operations')}>View all operations</Button>
    </div>
  )
}

function OperationRow({ item }: { item: OverviewOperation }): ReactElement {
  const open = () => {
    const href = item.threadId === null ? `project/${item.engagementId}?tab=operations` : `operation/${item.threadId}?tab=overview&engagement=${item.engagementId}`
    const route = parseHash(href)
    go(route.page, route)
  }
  return (
    <li>
      <button type="button" onClick={open} className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-left hover:border-primary">
        <span className="min-w-0 flex-1 truncate text-sm">{item.engagementName ?? item.engagementId}</span>
        <Status kind="gate" value={item.status === 'completed' ? 'passed' : 'pending'} size="sm" label={item.status} />
        <span className="text-xs text-muted">{item.updatedAt}</span>
      </button>
    </li>
  )
}

/** The decision queue: approvals, reviews and emergency stops that wait for the actor. */
export function DecisionBlock({ tasks }: { tasks: OverviewTask[] }): ReactElement {
  const top = tasks.slice(0, 6)
  return (
    <div className="space-y-3">
      {top.length === 0 ? (
        <p className="text-sm text-muted">No pending work. Approvals, reviews and stops appear here when lifecycle workflows create them.</p>
      ) : (
        <ul className="space-y-2">
          {top.map((t) => (
            <li key={`${t.kind}-${t.refId}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
              <Status kind="gate" value={t.kind === 'active-stop' ? 'failed' : 'pending'} size="sm" label={KIND_LABEL[t.kind]} />
              <span className="min-w-0 flex-1 truncate text-sm">
                {t.title}
                <span className="text-xs text-muted"> · {t.engagementName ?? t.engagementId}{t.awaitingActor ? ' · awaiting your follow-up' : ''}</span>
              </span>
              <Button variant="secondary" onClick={() => { const r = parseHash(t.href); go(r.page, r) }}>Open</Button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" onClick={() => go('tasks')}>Open full task inbox</Button>
    </div>
  )
}

/** A card with the reference's section title and an optional action on the right. */
export function Panel({ title, sub, action, children }: { title: string; sub?: string; action?: ReactNode; children: ReactNode }): ReactElement {
  return (
    <Card>
      <CardHeader title={title} sub={sub} actions={action} />
      <div className="p-4">{children}</div>
    </Card>
  )
}
