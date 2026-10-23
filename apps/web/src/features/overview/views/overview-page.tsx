/**
 * The global System Overview (plan §5.1, reference R01): one presentation for both modes. The page reads each section
 * through its own port hook and lays the blocks out in the reference's order: the KPI row, the main column (severity,
 * recent findings, C2, recommended actions, projects) and the side column (operations queue, decision queue, tool
 * execution, recent events, capabilities, sources). A section that cannot be read shows as unavailable, and a figure the
 * source does not record shows as not recorded; neither is shown as zero.
 */
import type { ReactElement } from 'react'
import { Activity, FolderKanban, RefreshCw, ShieldAlert, ClipboardList } from 'lucide-react'
import { go } from '../../../router/navigate'
import { Button, PageHeader } from '../../../ui/index'
import { useOverviewFindings, useOverviewOperations, useOverviewProjects, useOverviewTasks } from '../query'
import { openCuratedCount, type OverviewProject } from '../service'
import { AttentionBanner, DecisionBlock, OperationsBlock, OverviewKpi, Panel, SeverityBlock, SourceState } from './overview-blocks'

/** Project states that count as active: the real lifecycle values and the demo vocabulary. */
const ACTIVE_PROJECT_STATUSES = new Set(['active', 'approved', 'planning', 'running'])

/** A read's display for a KPI: pending shows a placeholder, an unreadable source shows unavailable, a missing count says so. */
function kpiDisplay<T>(read: { isPending: boolean; error: unknown; data?: T }, pick: (data: T) => string): string {
  if (read.isPending) return '…'
  if (read.error || read.data === undefined) return 'Unavailable'
  return pick(read.data)
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="System Overview"
        sub="Projects, findings, operations and decisions your account is authorized to see."
        meta={readAt === null ? undefined : <span className="text-xs text-muted">Read at {readAt}</span>}
        actions={<Button variant="secondary" icon={RefreshCw} onClick={refreshAll}>Refresh</Button>}
      />

      <AttentionBanner stops={stopCount} decisions={tasks.data?.length ?? 0} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <OverviewKpi
          label="Active projects" icon={FolderKanban} tint="primary" note="Planning or running" onOpen={() => go('projects')}
          display={kpiDisplay(projects, (list: OverviewProject[]) => String(list.filter((p) => ACTIVE_PROJECT_STATUSES.has(p.status.toLowerCase())).length))}
        />
        <OverviewKpi
          label="Active operations" icon={Activity} tint="ok" note="Operations running now" onOpen={() => go('operations')}
          display={kpiDisplay(operations, (view) => (view.counts === null ? 'Not recorded' : String(view.counts.running ?? 0)))}
        />
        <OverviewKpi
          label="Awaiting decisions" icon={ClipboardList} tint="warn" note="Approvals, reviews and stops" onOpen={() => go('tasks')}
          display={kpiDisplay(tasks, (list) => String(list.length))}
        />
        <OverviewKpi
          label="Open curated findings" icon={ShieldAlert} tint="danger" note="Confirmed, remediation or retest" onOpen={() => go('findings')}
          display={kpiDisplay(findings, (view) => String(openCuratedCount(view)))}
        />
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
