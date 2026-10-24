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
import { countText, splitTasks } from '../../decisions'
import { measureText, overviewMeasures, type MeasureId } from '../measures'
import type { OverviewProject } from '../service'
import { AttentionRegion, DecisionBlock, OperationsBlock, OverviewKpi, Panel, SeverityBlock, SourceState } from './overview-blocks'

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

/** The first project rows the source returns; the list is not sorted here, so the panel does not claim an order. */
function ProjectRows({ projects, total }: { projects: OverviewProject[]; total: number }): ReactElement {
  if (total === 0) return <p className="text-sm text-muted">No projects are visible to your account yet.</p>
  return (
    <ul className="divide-y divide-line">
      {projects.map((project) => (
        <li key={project.id}>
          <button type="button" onClick={() => go('project', { id: project.id })} className="flex w-full items-center gap-3 py-2 text-left text-sm hover:text-primary">
            <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
            <span className="hidden min-w-0 truncate text-xs text-muted sm:block">{project.detail}</span>
            <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs capitalize">{project.status}</span>
          </button>
        </li>
      ))}
    </ul>
  )
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
  const { decisions: decisionList, stops } = splitTasks(tasks.data?.items ?? [])
  const stopCount = stops.length
  const measures = overviewMeasures({ projects, operations, tasks, findings })
  const awaiting = measures.find((measure) => measure.id === 'awaiting-decisions')
  const unavailable = measures.filter((measure) => measure.state === 'unavailable').map((measure) => measure.label)
  const checking = measures.some((measure) => measure.state === 'pending')

  return (
    <div className="space-y-4">
      <PageHeader
        title="System Overview"
        sub="Projects, findings, operations and decisions your account is authorized to see."
        meta={readAt === null ? undefined : <span className="text-xs text-muted">Read at {readAt}</span>}
        actions={<Button variant="secondary" icon={RefreshCw} onClick={refreshAll}>Refresh</Button>}
      />

      <AttentionRegion stops={stopCount} stopsLimited={tasks.data?.stopsLimited ?? false} decisions={awaiting?.value ?? null} limited={awaiting?.limited ?? false} unavailable={unavailable} pending={checking} />

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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title={tasks.data ? `Decision queue (${countText(decisionList.length, tasks.data.limited)})` : 'Decision queue'} sub="Pending approvals, reviews and requests across your accessible projects. Emergency stops are listed under attention.">
          <SourceState label="The task inbox" pending={tasks.isPending} error={error(tasks)} onRetry={() => void tasks.refetch()}>
            {tasks.data && <DecisionBlock tasks={decisionList} />}
          </SourceState>
        </Panel>

        <Panel title="Operations queue" sub="Operation bindings by governance state">
          <SourceState label="The operations rollup" pending={operations.isPending} error={error(operations)} onRetry={() => void operations.refetch()}>
            {operations.data && <OperationsBlock view={operations.data} />}
          </SourceState>
        </Panel>
      </div>

      <Panel title="Projects" sub="The first projects your account can see"
          action={<button type="button" onClick={() => go('projects')} className="text-sm font-medium text-primary hover:underline">View all →</button>}>
        <SourceState label="The project list" pending={projects.isPending} error={error(projects)} onRetry={() => void projects.refetch()}>
          {projects.data && <ProjectRows projects={projects.data.slice(0, 5)} total={projects.data.length} />}
        </SourceState>
      </Panel>

      <Panel title="Severity distribution" sub="Curated findings across your accessible projects, by severity. The findings page holds the full list."
          action={<button type="button" onClick={() => go('findings')} className="text-sm font-medium text-primary hover:underline">View all →</button>}>
        <SourceState label="The findings rollup" pending={findings.isPending} error={error(findings)} onRetry={() => void findings.refetch()}>
          {findings.data && <SeverityBlock view={findings.data} />}
        </SourceState>
      </Panel>

      <p className="text-xs text-muted">Reads cover only the projects your account owns or holds a membership on. A source that is unavailable says so instead of showing zeros.</p>
    </div>
  )
}
