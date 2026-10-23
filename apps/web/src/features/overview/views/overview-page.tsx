/**
 * The global System Overview (plan §5.1, reference R01): one presentation for both modes. The page reads each section
 * through its own port hook and lays the blocks out in the reference's order: the KPI row, the main column (severity,
 * recent findings, C2, recommended actions, projects) and the side column (operations queue, decision queue, tool
 * execution, recent events, capabilities, sources). A section that cannot be read shows as unavailable, and a figure the
 * source does not record shows as not recorded; neither is shown as zero.
 */
import type { ComponentProps, ReactElement } from 'react'
import { Activity, FolderKanban, RefreshCw, ShieldAlert, ClipboardList, type LucideIcon } from 'lucide-react'
import { go } from '../../../router/navigate'
import { Button, PageHeader } from '../../../ui/index'
import { useOverviewFindings, useOverviewOperations, useOverviewProjects, useOverviewTasks } from '../query'
import { measureText, overviewMeasures, type MeasureId } from '../measures'
import { AttentionBanner, DecisionBlock, OperationsBlock, OverviewKpi, Panel, SeverityBlock, SourceState } from './overview-blocks'

type KpiTint = ComponentProps<typeof OverviewKpi>['tint']

/** Icon and tint of each measure card; the label, caption, figure and target come from the measure itself. */
const KPI_STYLE: Readonly<Record<MeasureId, { icon: LucideIcon; tint: KpiTint }>> = {
  'active-projects': { icon: FolderKanban, tint: 'primary' },
  'active-operations': { icon: Activity, tint: 'ok' },
  'awaiting-decisions': { icon: ClipboardList, tint: 'warn' },
  'open-curated-findings': { icon: ShieldAlert, tint: 'danger' },
}

/** The newest time any read in this view returned, in the browser's clock: a freshness marker, not a business time. */
function readAtLabel(reads: { dataUpdatedAt?: number }[]): string | null {
  const newest = Math.max(0, ...reads.map((r) => r.dataUpdatedAt ?? 0))
  return newest === 0 ? null : new Date(newest).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function OverviewPage(): ReactElement {
  const projects = useOverviewProjects()
  const findings = useOverviewFindings()
  const operations = useOverviewOperations()
  const tasks = useOverviewTasks()
  const error = (read: { error: unknown }): Error | null => (read.error instanceof Error ? read.error : null)
  const refreshAll = () => {
    void projects.refetch()
    void findings.refetch()
    void operations.refetch()
    void tasks.refetch()
  }
  const readAt = readAtLabel([projects, findings, operations, tasks])
  const stopCount = (tasks.data ?? []).filter((t) => t.kind === 'active-stop').length
  const measures = overviewMeasures({ projects, operations, tasks, findings })
  const decisions = measures.find((measure) => measure.id === 'awaiting-decisions')?.value ?? 0

  return (
    <div className="space-y-4">
      <PageHeader
        title="System Overview"
        sub="Projects, findings, operations and decisions your account is authorized to see."
        meta={readAt === null ? undefined : <span className="text-xs text-muted">Read at {readAt}</span>}
        actions={<Button variant="secondary" icon={RefreshCw} onClick={refreshAll}>Refresh</Button>}
      />

      <AttentionBanner stops={stopCount} decisions={decisions} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {measures.map((measure) => (
          <OverviewKpi
            key={measure.id}
            label={measure.label}
            icon={KPI_STYLE[measure.id].icon}
            tint={KPI_STYLE[measure.id].tint}
            note={measure.definition}
            display={measureText(measure)}
            onOpen={() => go(measure.target)}
          />
        ))}
      </div>

      <div className="space-y-4">
        <Panel title="Severity distribution" sub="Curated findings across your accessible projects, by severity"
            action={<button type="button" onClick={() => go('findings')} className="text-sm font-medium text-primary hover:underline">View all →</button>}>
            <SourceState label="The findings rollup" pending={findings.isPending} error={error(findings)} onRetry={() => void findings.refetch()}>
              {findings.data && <SeverityBlock view={findings.data} />}
            </SourceState>
          </Panel>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Panel title="Operations queue" sub="Operation bindings by governance state">
            <SourceState label="The operations rollup" pending={operations.isPending} error={error(operations)} onRetry={() => void operations.refetch()}>
              {operations.data && <OperationsBlock view={operations.data} />}
            </SourceState>
          </Panel>

          <Panel title={tasks.data ? `Decision queue (${tasks.data.length})` : 'Decision queue'} sub="Pending approvals, reviews and stops across your accessible projects">
            <SourceState label="The task inbox" pending={tasks.isPending} error={error(tasks)} onRetry={() => void tasks.refetch()}>
              {tasks.data && <DecisionBlock tasks={tasks.data} />}
            </SourceState>
          </Panel>
        </div>
      </div>

      <p className="text-xs text-muted">Reads cover only the projects your account owns or holds a membership on. A source that is unavailable says so instead of showing zeros.</p>
    </div>
  )
}
