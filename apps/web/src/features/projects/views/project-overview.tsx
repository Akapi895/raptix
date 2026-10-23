/**
 * The project overview (real mode): a compact header, the engagement lifecycle as three stages, four figures that follow the
 * stage, and the work of that stage leading the main column. Each block reads its own source; a source that is loading,
 * failed or not configured says so in place of a number. Nothing here estimates progress or scores a risk.
 */
import { useState, type ReactElement, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, Bug, CheckCircle2, ClipboardCheck, Copy, Crosshair, FileText, OctagonX, ShieldAlert, Target, Users, type LucideIcon } from 'lucide-react'
import type { ProjectViewModel } from '@raptix/web-contracts'
import { useAssetList } from '../../assets'
import { useFindingList } from '../../findings'
import { useProviderSurface } from '../../c2'
import { useOverviewTasks } from '../../overview'
import { countText, splitTasks } from '../../decisions'
import { useRuntimeFleet } from '../../operations'
import { usePlanningRead } from '../../planning'
import { useScopeRead } from '../../scope'
import { go } from '../../../router/navigate'
import { utcMinuteOr } from '../../../platform/format'
import { Banner, Button, Card, CardHeader, cx, Donut, Drawer, Skeleton, Status } from '../../../ui/index'
import { fetchEnvironment } from '../environment-api'
import { fetchEngagementOverview } from '../overview-api'
import {
  activityLabel, activityTone, decisionsFor, DECISION_LABEL, DECISION_TAB, DECISION_TONE, environmentStatus, KPIS_BY_STAGE, LEAD_BLOCK_BY_STAGE,
  lifecycleStages, nextStepFor, type KpiKey, type LifecycleStage, type OverviewTone, STAGE_STATE_LABEL, STAGE_TONE,
} from '../overview-model'
import { preparationChecks, projectStage, STAGE_LABEL, type CheckState, type ProjectStage, type Read, type WorkspaceInput } from '../workspace'
import { EnvironmentPanel } from './environment-panel'

const TONE_TEXT: Record<OverviewTone, string> = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', primary: 'text-primary', neutral: 'text-neutral' }
const TONE_EDGE: Record<OverviewTone, string> = { ok: 'border-l-ok', warn: 'border-l-warn', bad: 'border-l-bad', primary: 'border-l-primary', neutral: 'border-l-neutral' }
const TONE_FILL: Record<OverviewTone, string> = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', primary: 'bg-primary', neutral: 'bg-neutral' }
const KPI_FROM: Record<OverviewTone, string> = { ok: 'from-ok-soft', warn: 'from-warn-soft', bad: 'from-bad-soft', primary: 'from-primary/15', neutral: 'from-subtle' }

const CHECK_TONE: Record<CheckState, OverviewTone> = { met: 'ok', open: 'warn', unknown: 'neutral' }
const CHECK_LABEL: Record<CheckState, string> = { met: 'Met', open: 'Open', unknown: 'Unknown' }

/** The severity order and colours of the findings page. */
const SEVERITIES = [
  { key: 'critical', label: 'Critical', fill: '#dc3545' },
  { key: 'high', label: 'High', fill: '#fd7e14' },
  { key: 'medium', label: 'Medium', fill: '#ffc107' },
  { key: 'low', label: 'Low', fill: '#20c997' },
  { key: 'info', label: 'Info', fill: '#6c757d' },
] as const

/** The finding categories the list counts, in the order the posture shows them. */
const CATEGORIES = [
  { key: 'drafts', label: 'Drafts' },
  { key: 'review', label: 'In review' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'remediation', label: 'Remediation' },
  { key: 'ai', label: 'AI suggested' },
] as const

/** The scope colours of the assets page. */
const SCOPES = [
  { key: 'in', label: 'In scope', fill: 'var(--c-ok)' },
  { key: 'out', label: 'Out of scope', fill: 'var(--c-bad)' },
  { key: 'pending', label: 'Pending', fill: 'var(--c-warn)' },
  { key: 'unclassified', label: 'Unclassified', fill: 'var(--c-neutral)' },
] as const

/** The label of a project tab, as the navigation names it. */
const TAB_LABEL: Readonly<Record<string, string>> = {
  scope: 'Scope & ROE',
  planning: 'Planning',
  operations: 'Operations',
  findings: 'Findings',
  reports: 'Reports',
  c2: 'C2',
}

/** The workspace inputs for one project, from the scope and planning reads the overview shares with those tabs. */
function useWorkspaceInput(d: ProjectViewModel): WorkspaceInput {
  const scope = useScopeRead()
  const planning = usePlanningRead(d.id)
  const scopeRead: Read<{ approvedVersion: number | null }> = scope.data
    ? { state: 'loaded', value: { approvedVersion: scope.data.latestApprovedVersion } }
    : scope.isError ? { state: 'failed' } : { state: 'pending' }
  const planningRead: Read<{ ready: boolean; reasons: number }> = planning.data
    ? { state: 'loaded', value: { ready: planning.data.ready, reasons: planning.data.reasons.length } }
    : planning.isError ? { state: 'failed' } : { state: 'pending' }
  return {
    metadataVerified: d.metadataState === 'verified',
    authorizationConfirmed: d.authorizationConfirmed,
    handoffConfirmed: d.handoffConfirmedAt !== null,
    lifecycle: d.lifecycleStatus,
    scope: scopeRead,
    planning: planningRead,
  }
}

function failureText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** An objective's status tone. The runtime's vocabulary is not fixed, so only clear words are coloured; the rest stay neutral. */
function objectiveTone(status: string): OverviewTone {
  const name = status.toLowerCase()
  if (/done|complete|pass|achiev/.test(name)) return 'ok'
  if (/block|fail|abort/.test(name)) return 'bad'
  if (/progress|running|active|start/.test(name)) return 'primary'
  return 'neutral'
}

/** The panel of one block: a title, a sub line, and the content. */
function Block({ title, sub, action, children }: { title: string; sub?: string; action?: ReactNode; children: ReactNode }): ReactElement {
  return (
    <Card className="min-w-0">
      <CardHeader title={title} sub={sub} actions={action} />
      <div className="px-4 pb-4">{children}</div>
    </Card>
  )
}

interface KpiProps {
  label: string
  value: string | number
  sub: string
  tone: OverviewTone
  icon: LucideIcon
}

/** One figure across the top: a soft tone, the label and icon, the value, and one line of context. */
function Kpi({ label, value, sub, tone, icon: Icon }: KpiProps): ReactElement {
  return (
    <div className={cx('min-w-0 rounded-xl border border-line border-l-4 bg-gradient-to-br to-panel p-4 shadow-sm', TONE_EDGE[tone], KPI_FROM[tone])}>
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-xs font-medium text-muted">{label}</span>
        <Icon className={cx('h-4 w-4 shrink-0', TONE_TEXT[tone])} aria-hidden />
      </div>
      <div className={cx('mt-2 truncate text-3xl font-semibold tabular-nums', TONE_TEXT[tone])}>{value}</div>
      <div className="mt-1 truncate text-xs text-muted" title={sub}>{sub}</div>
    </div>
  )
}

/** A row of a list of counts: a label, the count, and an optional coloured dot. */
function CountRow({ label, count, fill }: { label: string; count: string | number; fill?: string }): ReactElement {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="flex min-w-0 items-center gap-2 text-muted">
        {fill && <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: fill }} aria-hidden />}
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 font-mono tabular-nums">{count}</span>
    </li>
  )
}

/** A labelled value with one line of context under it, for a source that is not a count. */
function InfoRow({ label, value, sub }: { label: string; value: string; sub: string }): ReactElement {
  return (
    <li className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 text-right">
        <span className="block font-medium">{value}</span>
        <span className="block truncate text-xs text-muted" title={sub}>{sub}</span>
      </span>
    </li>
  )
}

/** The project ID, shortened, with its full value on hover and a copy action. */
function IdChip({ id }: { id: string }): ReactElement {
  const [copied, setCopied] = useState(false)
  return (
    <span className="inline-flex min-w-0 max-w-[12rem] items-center gap-1.5 rounded-md border border-line bg-subtle px-2 py-0.5">
      <span className="min-w-0 truncate font-mono" title={id}>{id}</span>
      <button
        type="button"
        aria-label="Copy project ID"
        title={copied ? 'Copied' : 'Copy project ID'}
        onClick={() => void copyText(id).then(setCopied)}
        className="shrink-0 text-muted transition hover:text-fg"
      >
        {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-ok" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </span>
  )
}

export function ProjectOverview({ d }: { d: ProjectViewModel }): ReactElement {
  const [environmentOpen, setEnvironmentOpen] = useState(false)
  const input = useWorkspaceInput(d)
  const overview = useQuery({ queryKey: ['engagement-overview', d.id], queryFn: () => fetchEngagementOverview(d.id), refetchInterval: 30_000 })
  const fleet = useRuntimeFleet(d.id)
  const surface = useProviderSurface(d.id)
  const environment = useQuery({ queryKey: ['environment', d.id], queryFn: () => fetchEnvironment(d.id) })
  const findings = useFindingList({})
  const assets = useAssetList({})
  const tasks = useOverviewTasks()
  const planning = usePlanningRead(d.id)

  const checks = preparationChecks(input)
  const metCount = checks.filter((check) => check.state === 'met').length
  const prepared = metCount === checks.length
  const stage: ProjectStage = projectStage(d.lifecycleStatus)
  const completion = overview.data?.completion
  const activeStops = completion?.activeStops ?? null
  // While the overview is still loading, the next step follows the preparation checks alone; the stops are not known yet.
  const next = nextStepFor(input, activeStops ?? 0)
  const preflightFailed = overview.data?.readiness.ok === false ? overview.data.readiness.failed.length : 0
  // Emergency stops are attention items: the activeStops figure above counts them, so they are not decisions here.
  const decisions = tasks.data ? splitTasks(decisionsFor(tasks.data.items, d.id)).decisions : []
  const yours = decisions.filter((task) => task.awaitingActor).length
  const threads = fleet.data?.threads ?? []
  const activeRuns = fleet.data?.counts.activeRuns ?? null
  const env = environment.data ? environmentStatus(environment.data) : null
  const objectives = planning.data?.opplan.objectives ?? []
  const doneObjectives = objectives.filter((objective) => objectiveTone(objective.status) === 'ok').length
  const objectiveCounts = Object.entries(objectives.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.status]: (acc[o.status] ?? 0) + 1 }), {}))
  const kpis = assets.data?.kpis
  const assetTotal = kpis ? SCOPES.reduce((sum, scope) => sum + kpis[scope.key], 0) : null
  const severityTotal = findings.data ? SEVERITIES.reduce((sum, sev) => sum + (findings.data?.summary.severity[sev.key] ?? 0), 0) : null
  const critical = findings.data?.summary.severity.critical ?? null
  const inScope = new Set((assets.data?.items ?? []).filter((item) => item.asset.scope === 'in').map((item) => item.asset.name))
  const affected = findings.data ? new Set(findings.data.items.map((item) => item.finding.asset).filter((name) => inScope.has(name))).size : null
  const findingsPartial = findings.data && findings.data.total > findings.data.items.length
  const scopeCheck = checks.find((check) => check.id === 'scope')
  const stages = lifecycleStages({ checksMet: metCount, checksTotal: checks.length, lifecycle: d.lifecycleStatus, findingsConfirmed: completion?.findingsConfirmed ?? null })
  const stageTab: Record<LifecycleStage['id'], string> = {
    preparation: checks.find((check) => check.state !== 'met')?.tab ?? 'planning',
    execution: 'operations',
    results: d.lifecycleStatus === 'completed' ? 'reports' : 'findings',
  }
  const unreadable = [
    overview.isError && 'the overview',
    fleet.isError && 'runtime threads',
    surface.isError && 'the C2 provider',
    environment.isError && 'the environment',
    findings.isError && 'findings',
    assets.isError && 'targets',
  ].filter((name): name is string => Boolean(name))

  const figure = (key: KpiKey): KpiProps => {
    switch (key) {
      case 'targets':
        return { label: 'Targets', value: assetTotal ?? '—', sub: kpis ? `${kpis.in} in scope · ${kpis.pending} pending` : failureText(assets.error, 'Assets unavailable'), tone: 'primary', icon: Target }
      case 'checks':
        return { label: 'Checks met', value: `${metCount} / ${checks.length}`, sub: prepared ? 'All preparation checks met' : 'Preparation checks still open', tone: prepared ? 'ok' : 'warn', icon: ClipboardCheck }
      case 'decisions':
        return { label: 'Decisions', value: tasks.data ? countText(decisions.length, tasks.data.limited) : '—', sub: tasks.data ? (yours > 0 ? `${yours} waiting for you` : 'None waiting for you') : failureText(tasks.error, 'Decisions unavailable'), tone: yours > 0 ? 'warn' : 'neutral', icon: Users }
      case 'findings':
        return { label: 'Findings', value: severityTotal ?? '—', sub: findings.data ? 'Curated, across this engagement' : failureText(findings.error, 'Findings unavailable'), tone: 'primary', icon: Bug }
      case 'critical':
        return { label: 'Critical findings', value: critical ?? '—', sub: critical === null ? failureText(findings.error, 'Findings unavailable') : critical > 0 ? 'Need review' : 'None recorded', tone: critical === null ? 'neutral' : critical > 0 ? 'bad' : 'ok', icon: ShieldAlert }
      case 'runs':
        return { label: 'Active runs', value: activeRuns ?? '—', sub: fleet.data ? `${fleet.data.counts.runningBranches} subagent branches running` : failureText(fleet.error, 'Fleet unavailable'), tone: activeRuns ? 'primary' : 'neutral', icon: Activity }
      case 'objectives':
        return { label: 'Objectives done', value: planning.data ? `${doneObjectives} / ${objectives.length}` : '—', sub: planning.data ? (objectives.length === 0 ? 'None recorded in the OPPLAN' : 'From the OPPLAN') : failureText(planning.error, 'Planning unavailable'), tone: objectives.length > 0 && doneObjectives === objectives.length ? 'ok' : 'neutral', icon: Crosshair }
      case 'stops':
        return { label: 'Emergency stops', value: activeStops ?? '—', sub: activeStops === null ? failureText(overview.error, 'Overview unavailable') : activeStops > 0 ? 'Active: nothing proceeds' : 'None active', tone: activeStops === null ? 'neutral' : activeStops > 0 ? 'bad' : 'ok', icon: OctagonX }
      case 'confirmed':
        return { label: 'Confirmed', value: completion?.findingsConfirmed ?? '—', sub: completion ? (completion.findingsConfirmed === null ? 'Not reported by the server' : 'Confirmed findings') : failureText(overview.error, 'Overview unavailable'), tone: 'ok', icon: CheckCircle2 }
      case 'reports':
        return { label: 'Reports delivered', value: completion?.reportsDelivered ?? '—', sub: completion ? (completion.reportsDelivered === null ? 'Not reported by the server' : 'Delivered for this engagement') : failureText(overview.error, 'Overview unavailable'), tone: completion?.reportsDelivered ? 'ok' : 'neutral', icon: FileText }
    }
  }

  const readinessBlock = (
    <Block title="Readiness" sub={`${metCount} of ${checks.length} preparation checks met`}>
      <ul className="divide-y divide-line">
        {checks.map((check) => (
          <li key={check.id} className="flex items-start justify-between gap-4 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium">{check.label}</div>
              <div className="text-xs text-muted">{check.detail}</div>
            </div>
            <span className={cx('shrink-0 text-xs font-medium', TONE_TEXT[CHECK_TONE[check.state]])}>{CHECK_LABEL[check.state]}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-1 text-sm font-medium">Governance preflight</div>
        {overview.isPending ? <Skeleton className="h-12" /> : overview.isError || !overview.data ? (
          <p className="text-sm text-muted">Preflight unavailable: {failureText(overview.error, 'the overview could not be read.')}</p>
        ) : overview.data.readiness.state === 'unavailable' ? (
          <p className="text-sm text-muted">Preflight unavailable: {overview.data.readiness.reason ?? 'the server did not give a reason.'}</p>
        ) : overview.data.readiness.ok === null ? (
          <p className="text-sm text-muted">Preflight not evaluated.</p>
        ) : overview.data.readiness.ok ? (
          <p className="text-sm text-ok">Preflight passed.</p>
        ) : (
          <ul className="divide-y divide-line">
            {overview.data.readiness.failed.map((item) => (
              <li key={item.id} className="border-l-4 border-l-bad py-2 pl-3 text-sm">
                <span className="font-mono text-xs text-muted">{item.id}</span>
                {item.detail && <div>{item.detail}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Block>
  )

  const executionBlock = (
    <Block title="Execution" sub="Objectives and runs as the runtime reports them; progress is not estimated">
      {planning.isPending ? <Skeleton className="h-16" /> : planning.isError || !planning.data ? (
        <p className="text-sm text-muted">Objectives unavailable: {failureText(planning.error, 'the OPPLAN could not be read.')}</p>
      ) : objectives.length === 0 ? (
        <p className="text-sm text-muted">No objectives recorded yet.</p>
      ) : (
        <>
          <div className="flex h-3 overflow-hidden rounded-full bg-line">
            {objectiveCounts.map(([status, count]) => (
              <div key={status} className={TONE_FILL[objectiveTone(status)]} style={{ width: `${(count / objectives.length) * 100}%` }} title={`${status}: ${count}`} />
            ))}
          </div>
          <ul className="mt-2 space-y-0.5">
            {objectiveCounts.map(([status, count]) => (
              <CountRow key={status} label={status} count={count} fill={`var(--c-${objectiveTone(status)})`} />
            ))}
          </ul>
        </>
      )}
      <div className="mt-4 border-t border-line pt-3">
        <ul>
          <CountRow label="Active runs" count={activeRuns ?? '—'} />
          <CountRow label="Runtime threads" count={fleet.data ? threads.length : '—'} />
        </ul>
        {fleet.isPending ? <Skeleton className="mt-3 h-20" /> : fleet.isError || !fleet.data ? (
          <p className="mt-3 text-sm text-muted">Fleet unavailable: {failureText(fleet.error, 'the runtime could not be read.')}</p>
        ) : threads.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No runtime thread is bound to this engagement.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {threads.slice(0, 5).map((thread) => (
              <li key={thread.threadId} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{thread.assistantId ?? 'Unnamed assistant'}</div>
                  <div className="truncate font-mono text-xs text-muted">{thread.threadId}</div>
                </div>
                <span className="shrink-0 rounded-full border border-line bg-subtle px-2.5 py-0.5 text-xs text-muted">{thread.rawStatus ?? 'not reported'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Block>
  )

  const resultsBlock = (
    <Block title="Results" sub="What this engagement has confirmed, is reviewing and has delivered">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-line bg-subtle px-3 py-2">
          <div className="text-xs text-muted">Confirmed</div>
          <div className="mt-1 font-mono text-lg tabular-nums">{completion?.findingsConfirmed ?? '—'}</div>
        </div>
        <div className="rounded-lg border border-line bg-subtle px-3 py-2">
          <div className="text-xs text-muted">For review</div>
          <div className="mt-1 font-mono text-lg tabular-nums">{findings.data?.counts ? findings.data.counts.drafts + findings.data.counts.review : '—'}</div>
        </div>
        <div className="rounded-lg border border-line bg-subtle px-3 py-2">
          <div className="text-xs text-muted">Remediation</div>
          <div className="mt-1 font-mono text-lg tabular-nums">{findings.data?.counts?.remediation ?? '—'}</div>
        </div>
        <div className="rounded-lg border border-line bg-subtle px-3 py-2">
          <div className="text-xs text-muted">Reports delivered</div>
          <div className="mt-1 font-mono text-lg tabular-nums">{completion?.reportsDelivered ?? '—'}</div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
        <Button size="sm" onClick={() => go('project', { id: d.id, tab: 'reports' })}>Open Reports</Button>
        <Button size="sm" variant="ghost" onClick={() => go('project', { id: d.id, tab: 'findings' })}>Open findings</Button>
      </div>
    </Block>
  )

  const leadBlocks = { readiness: readinessBlock, execution: executionBlock, results: resultsBlock }

  const findingsBlock = (
    <Block
      title="Security findings"
      sub={severityTotal === null ? 'Reading findings' : 'Curated findings by severity and status'}
      action={<Button size="sm" variant="ghost" onClick={() => go('project', { id: d.id, tab: 'findings' })}>View all</Button>}
    >
      {findings.isPending ? <Skeleton className="h-40" /> : findings.isError || !findings.data ? (
        <p className="text-sm text-muted">Findings unavailable: {failureText(findings.error, 'the list could not be read.')}</p>
      ) : severityTotal === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
          <p className="text-sm font-medium">No curated findings yet.</p>
          <p className="mt-1 text-xs text-muted">Confirmed findings appear here with their severity and status.</p>
          <div className="mt-3"><Button size="sm" variant="ghost" onClick={() => go('project', { id: d.id, tab: 'findings' })}>Open findings</Button></div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-6">
            <Donut
              size={150}
              data={SEVERITIES.map((sev) => ({ label: sev.label, value: findings.data?.summary.severity[sev.key] ?? 0, color: sev.fill }))}
              center={<span className="text-center"><span className="block text-2xl font-semibold tabular-nums">{severityTotal}</span><span className="block text-xs text-muted">total</span></span>}
            />
            <ul className="min-w-[10rem] flex-1">
              {SEVERITIES.map((sev) => (
                <CountRow key={sev.key} label={sev.label} count={findings.data?.summary.severity[sev.key] ?? 0} fill={sev.fill} />
              ))}
            </ul>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {CATEGORIES.map((category) => (
              <div key={category.key} className="rounded-lg border border-line bg-subtle px-3 py-2">
                <div className="text-xs text-muted">{category.label}</div>
                <div className="mt-1 font-mono text-lg tabular-nums">{findings.data?.counts?.[category.key] ?? '—'}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 overflow-x-auto border-t border-line pt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">Finding</th>
                  <th className="py-2 pr-3 font-medium">Severity</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {findings.data.items.slice(0, 5).map((item) => (
                  <tr key={item.finding.id} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="font-mono text-xs text-muted">{item.finding.id}</div>
                      <div className="max-w-[28rem] truncate font-medium">{item.finding.title}</div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SEVERITIES.find((s) => s.key === item.finding.severity)?.fill ?? '#6c757d' }} aria-hidden />
                        <span className="capitalize">{item.finding.severity}</span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-muted">{String(item.finding.status).replace(/_/g, ' ')}</td>
                    <td className="whitespace-nowrap py-2.5 text-xs text-muted">{utcMinuteOr(item.finding.updated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {findingsPartial && <p className="mt-2 text-xs text-muted">Showing the first {findings.data.items.length} of {findings.data.total}.</p>}
          </div>
        </>
      )}
    </Block>
  )

  const openChecks = checks.filter((check) => check.state !== 'met')
  const attentionCount = (activeStops ?? 0) + preflightFailed + openChecks.length + decisions.length
  const attentionBlock = (
    <Block title="Attention" sub="Stops, failing preflight, open checks and decisions waiting on someone">
      <ul className="space-y-2">
        {activeStops !== null && activeStops > 0 && (
          <li>
            <button type="button" onClick={() => go('project', { id: d.id, tab: 'operations' })} className={cx('flex w-full items-center gap-3 border-l-4 py-2 pl-3 pr-1 text-left transition hover:bg-hover', TONE_EDGE.bad)}>
              <span className="min-w-0 flex-1 truncate text-sm">{activeStops} emergency {activeStops === 1 ? 'stop is' : 'stops are'} active</span>
            </button>
          </li>
        )}
        {preflightFailed > 0 && (
          <li>
            <button type="button" onClick={() => go('project', { id: d.id, tab: 'scope' })} className={cx('flex w-full items-center gap-3 border-l-4 py-2 pl-3 pr-1 text-left transition hover:bg-hover', TONE_EDGE.warn)}>
              <span className="min-w-0 flex-1 truncate text-sm">{preflightFailed} preflight {preflightFailed === 1 ? 'check is' : 'checks are'} failing</span>
            </button>
          </li>
        )}
        {stage !== 'preparation' && openChecks.map((check) => (
          <li key={check.id}>
            <button type="button" onClick={() => go('project', { id: d.id, tab: check.tab })} className={cx('flex w-full items-center gap-3 border-l-4 py-2 pl-3 pr-1 text-left transition hover:bg-hover', TONE_EDGE[CHECK_TONE[check.state]])}>
              <span className="min-w-0 flex-1 truncate text-sm">{check.label}</span>
              <span className="hidden shrink-0 truncate text-xs text-muted sm:inline">{check.detail}</span>
            </button>
          </li>
        ))}
      </ul>
      {stage === 'preparation' && openChecks.length > 0 && <p className="mt-3 text-sm text-muted">The open checks are listed under Readiness.</p>}
      {tasks.isPending ? <Skeleton className="mt-3 h-16" /> : tasks.isError ? (
        <p className="mt-3 text-sm text-muted">Decisions unavailable: {failureText(tasks.error, 'the task inbox could not be read.')}</p>
      ) : decisions.length > 0 ? (
        <ul className="mt-3 border-t border-line pt-3">
          {decisions.slice(0, 4).map((task) => (
            <li key={`${task.kind}:${task.refId}`}>
              <button
                type="button"
                onClick={() => go('project', { id: d.id, tab: DECISION_TAB[task.kind] })}
                className={cx('flex w-full items-center gap-3 border-l-4 py-2 pl-3 pr-1 text-left transition hover:bg-hover', TONE_EDGE[DECISION_TONE[task.kind]])}
              >
                <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                <span className="hidden shrink-0 text-xs text-muted sm:inline">{DECISION_LABEL[task.kind]}</span>
                {task.awaitingActor && <span className="shrink-0 rounded-full bg-accent-soft px-2 text-[11px] font-semibold text-accent">Yours</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : overview.data && attentionCount === 0 ? (
        <p className="mt-3 text-sm text-muted">Nothing needs attention.</p>
      ) : null}
    </Block>
  )

  const scopeBlock = (
    <Block title="Targets and scope" sub={affected === null ? 'Reading targets' : `${affected} of ${inScope.size} in-scope targets have a finding`}>
      <p className="mb-3 text-sm text-muted">{scopeCheck?.detail}</p>
      {assets.isPending ? <Skeleton className="h-32" /> : assets.isError || !assets.data || !kpis ? (
        <p className="text-sm text-muted">Assets unavailable: {failureText(assets.error, 'the inventory could not be read.')}</p>
      ) : (
        <>
          <div className="flex h-3 overflow-hidden rounded-full bg-subtle ring-1 ring-line">
            {SCOPES.map((scope) => (
              <div key={scope.key} style={{ width: `${assetTotal ? (kpis[scope.key] / assetTotal) * 100 : 0}%`, background: scope.fill }} />
            ))}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-4">
            {SCOPES.map((scope) => (
              <CountRow key={scope.key} label={scope.label} count={kpis[scope.key]} fill={scope.fill} />
            ))}
          </ul>
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {assets.data.items.slice(0, 5).map((item) => (
              <li key={item.asset.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">{item.asset.name}</span>
                <span className="shrink-0 text-xs text-muted">{item.asset.type}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-4 border-t border-line pt-3">
        <Button size="sm" onClick={() => go('project', { id: d.id, tab: 'scope' })}>Open Scope &amp; ROE</Button>
      </div>
    </Block>
  )

  const environmentBlock = (
    <Block title="Environment and resources" sub="Availability, configuration and runtime health are shown apart">
      <ul className="divide-y divide-line">
        <InfoRow
          label="Environment"
          value={env ? env.label : 'Unavailable'}
          sub={env ? env.detail : failureText(environment.error, 'The environment could not be read.')}
        />
        <InfoRow
          label="C2 provider"
          value={surface.data ? `${surface.data.sessions.length} sessions` : 'Not configured'}
          sub={surface.data ? 'Configured for this deployment' : failureText(surface.error, 'The C2 provider is not configured in this deployment')}
        />
        <InfoRow
          label="Runtime"
          value={fleet.data ? `${threads.length} threads` : 'Unavailable'}
          sub={fleet.data ? `${fleet.data.counts.threads} bound to this engagement` : failureText(fleet.error, 'The runtime could not be read.')}
        />
      </ul>
      <div className="mt-4 border-t border-line pt-3">
        <Button size="sm" onClick={() => setEnvironmentOpen(true)}>Manage environment</Button>
      </div>
    </Block>
  )

  const activityBlock = (
    <Block title="Recent activity" sub="The latest audit entries for this engagement" action={<Button size="sm" variant="ghost" onClick={() => go('project', { id: d.id, tab: 'audit' })}>All activity</Button>}>
      {overview.isPending ? <Skeleton className="h-40" /> : overview.isError || !overview.data ? (
        <p className="text-sm text-muted">Activity unavailable: {failureText(overview.error, 'the audit could not be read.')}</p>
      ) : overview.data.activity.length === 0 ? (
        <p className="text-sm text-muted">No audit entries yet.</p>
      ) : (
        <ol className="relative ml-1.5 border-l border-line">
          {overview.data.activity.slice(0, 5).map((entry) => {
            const tone = activityTone(entry.action)
            return (
              <li key={`${entry.createdAt}:${entry.action}:${entry.actorId}`} className="relative pb-4 pl-5 last:pb-0">
                <span className={cx('absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-panel', TONE_FILL[tone])} aria-hidden />
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium">{activityLabel(entry.action)}</span>
                  <span className="shrink-0 text-xs text-muted">{utcMinuteOr(entry.createdAt)}</span>
                </div>
                <div className="truncate text-xs text-muted">{entry.actorId}</div>
              </li>
            )
          })}
        </ol>
      )}
    </Block>
  )

  return (
    <div className="space-y-5">
      {unreadable.length > 0 && (
        <Banner tone="warn" title="Some figures could not be read">
          Could not read {unreadable.join(', ')}. Those blocks say so in place of a number.
        </Banner>
      )}
      {d.metadataState !== 'verified' && (
        <Banner tone="warn" title="Engagement metadata needs review">
          The stored target is not policy-verified yet. Fix the target or confirm authorization before planning starts.
        </Banner>
      )}

      {/* Header: identity, the stage, the next step, and the quick actions. The ID is shortened and can be copied. */}
      <header className="rounded-xl border border-line border-l-4 border-l-accent bg-panel p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight">{d.displayName}</h1>
              <Status kind="project" value={d.lifecycleStatus} size="sm" />
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">{STAGE_LABEL[stage]}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
              <IdChip id={d.id} />
              <span className="min-w-0 max-w-xs truncate font-mono" title={d.targetValue}>{d.targetValue}</span>
              <span>Updated {utcMinuteOr(d.updatedAt)}</span>
            </div>
            {d.brief && <p className="mt-2 line-clamp-1 max-w-3xl text-sm text-muted">{d.brief}</p>}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-4">
            <div className="min-w-0 text-right">
              <div className="text-xs text-muted">Next step</div>
              <div className="max-w-xs truncate text-sm font-medium" title={next.why}>{next.title}</div>
            </div>
            <Button variant="primary" size="sm" onClick={() => go('project', { id: d.id, tab: next.tab })}>Open {TAB_LABEL[next.tab] ?? next.tab}</Button>
          </div>
        </div>
      </header>

      {/* The lifecycle: three stages, each with its state, the reason for it, and the tab that owns the work */}
      <section aria-label="Lifecycle" className="grid gap-3 md:grid-cols-3">
        {stages.map((item) => {
          const tone = STAGE_TONE[item.state]
          return (
            <article key={item.id} className={cx('flex min-w-0 flex-col gap-2 rounded-xl border border-line border-l-4 bg-panel p-4 shadow-sm', TONE_EDGE[tone])}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{item.label}</h2>
                <span className={cx('text-xs font-medium', TONE_TEXT[tone])}>{STAGE_STATE_LABEL[item.state]}</span>
              </div>
              <p className="text-sm text-muted">{item.detail}</p>
              <div className="mt-auto pt-1">
                <Button size="sm" variant="ghost" onClick={() => go('project', { id: d.id, tab: stageTab[item.id] })}>Open {TAB_LABEL[stageTab[item.id]] ?? stageTab[item.id]}</Button>
              </div>
            </article>
          )
        })}
      </section>

      {/* Four figures that follow the stage */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Figures">
        {KPIS_BY_STAGE[stage].map((key) => (
          <Kpi key={key} {...figure(key)} />
        ))}
      </section>

      {/* Main column: the stage's own work first, then the findings. Side column: what needs attention, and the context. */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <div className="min-w-0 space-y-5">
          {leadBlocks[LEAD_BLOCK_BY_STAGE[stage]]}
          {findingsBlock}
        </div>
        <div className="min-w-0 space-y-5">
          {attentionBlock}
          {scopeBlock}
          {environmentBlock}
          {activityBlock}
        </div>
      </div>

      <Drawer open={environmentOpen} onClose={() => setEnvironmentOpen(false)} title="Environment" width={560}>
        <EnvironmentPanel engagementId={d.id} projectName={d.displayName} />
      </Drawer>
    </div>
  )
}
