/**
 * The global System Overview (migration Mốc 2): one presentation for both modes. Each section reads its own port
 * hook and keeps its own loading, error and not-recorded states. A section never shows zero for a source it could
 * not read, and never shows demo data in real mode.
 */
import type { ReactElement, ReactNode } from 'react'
import { FolderKanban } from 'lucide-react'
import { go } from '../../../router/navigate'
import { parseHash } from '../../../router/history'
import { Button, Card, CardHeader, Empty, PageHeader, Skeleton, Status } from '../../../ui/index'
import { showCreateProject } from '../../projects'
import { useOverviewC2, useOverviewFindings, useOverviewProjects, useOverviewTasks } from '../query'
import type { OverviewC2, OverviewFindings, OverviewTask, OverviewTaskKind } from '../service'

const KIND_LABEL: Record<OverviewTaskKind, string> = {
  'scope-revision': 'Scope review',
  'business-plan': 'Plan decision',
  'c2-grant': 'C2 grant review',
  'report-review': 'Report review',
  'finding-review': 'Finding confirmation',
  'active-stop': 'Active emergency stop',
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info']
const COMMAND_ORDER = ['creating', 'succeeded', 'failed', 'uncertain']

/** One section's loading and error states stay inside the section. */
function SourceState({ label, pending, error, onRetry, children }: { label: string; pending: boolean; error: Error | null; onRetry: () => void; children: ReactNode }): ReactElement {
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

function FindingsSection({ view }: { view: OverviewFindings }): ReactElement {
  const severities = [...SEVERITY_ORDER.filter((s) => (view.bySeverity[s] ?? 0) > 0), ...Object.keys(view.bySeverity).filter((s) => !SEVERITY_ORDER.includes(s))]
  return (
    <div className="p-4">
      {view.total === 0 ? (
        <p className="text-sm text-muted">No curated findings recorded yet across your {view.engagements} accessible project(s). AI suggestions are not counted here.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {severities.map((s) => (
              <Status key={s} kind="gate" value={s === 'critical' || s === 'high' ? 'failed' : s === 'medium' ? 'pending' : 'passed'} size="sm" label={`${s}: ${view.bySeverity[s] ?? 0}`} />
            ))}
            <span className="text-xs text-muted">{view.total} curated · in {view.engagementsWithFindings} of {view.engagements} project(s){view.truncated ? ' · scan truncated (counts are a lower bound)' : ''}</span>
          </div>
          <p className="mt-2 text-xs text-muted">{Object.entries(view.byStatus).map(([status, count]) => `${status}: ${count}`).join(' · ') || '—'}</p>
        </>
      )}
    </div>
  )
}

function C2Section({ view }: { view: OverviewC2 }): ReactElement {
  return (
    <div className="p-4">
      {view.commandsByStatus === null ? (
        <p className="text-sm text-muted">The command audit is not recorded for this source.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {COMMAND_ORDER.map((s) => (
            <Status key={s} kind="gate" value={s === 'failed' ? 'failed' : s === 'succeeded' ? 'passed' : 'pending'} size="sm" label={`${s}: ${view.commandsByStatus?.[s] ?? 0}`} />
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-muted">Pending session grants: {view.pendingGrants}. Live sessions are read per project.</p>
      {view.recentCommands.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {view.recentCommands.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
              <button className="font-mono text-xs text-fg hover:text-accent hover:underline" onClick={() => go('project', { id: c.engagementId, tab: 'c2' })}>{c.engagementId}</button>
              <span className="truncate font-mono text-xs text-muted">{c.sessionId}</span>
              <Status kind="gate" value={c.status === 'failed' ? 'failed' : c.status === 'succeeded' ? 'passed' : 'pending'} size="sm" label={c.status} />
              <span className="ml-auto text-xs text-muted">{c.createdAt}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TasksSection({ tasks }: { tasks: OverviewTask[] }): ReactElement {
  const top = tasks.slice(0, 8)
  return (
    <div className="p-4">
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
              <span className="text-xs text-muted">{t.createdAt}</span>
              <Button variant="secondary" onClick={() => { const r = parseHash(t.href); go(r.page, r) }}>Open</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        <Button variant="secondary" onClick={() => go('tasks')}>Open full task inbox</Button>
      </div>
    </div>
  )
}

export function OverviewPage(): ReactElement {
  const projects = useOverviewProjects()
  const findings = useOverviewFindings()
  const c2 = useOverviewC2()
  const tasks = useOverviewTasks()
  const error = (read: { error: unknown }): Error | null => (read.error instanceof Error ? read.error : null)

  return (
    <div className="space-y-4">
      <PageHeader title="System Overview" sub="Every project, finding, C2 activity and pending task your account is authorized to see. Each section reads its own source and reports its real state." />

      <Card>
        <CardHeader title="Quick actions" />
        <div className="flex flex-wrap gap-2 p-4">
          <Button onClick={() => showCreateProject()}>Create Project</Button>
          <Button onClick={() => go('operations')}>View all operations</Button>
          <Button onClick={() => go('tasks')}>Review pending decisions</Button>
          <Button onClick={() => go('analysis')}>View coverage</Button>
          <Button onClick={() => go('findings')}>Open Findings</Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Projects" sub="Open a project to work its planning, execution and governance sections" />
        <SourceState label="The project list" pending={projects.isPending} error={error(projects)} onRetry={() => void projects.refetch()}>
          <div className="p-4">
            {(projects.data ?? []).length === 0 ? (
              <Empty icon={FolderKanban} title="No projects yet" action={<Button variant="primary" onClick={() => showCreateProject()}>Create the first project</Button>}>
                Projects created from the console or the CLI appear here with their live status.
              </Empty>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="pb-2">Project</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Detail</th>
                    <th className="pb-2">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {(projects.data ?? []).slice(0, 5).map((p) => (
                    <tr key={p.id} className="border-t border-line">
                      <td className="py-2 pr-3">
                        <button className="text-left font-medium text-fg hover:text-accent hover:underline" onClick={() => go('project', { id: p.id })}>{p.name}</button>
                        <div className="font-mono text-xs text-muted">{p.id}</div>
                      </td>
                      <td className="py-2 pr-3"><Status kind="project" value={p.status} size="sm" /></td>
                      <td className="py-2 pr-3 font-mono text-xs text-muted">{p.detail}</td>
                      <td className="py-2 text-xs text-muted">{p.updatedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Button variant="ghost" onClick={() => go('projects')}>View all projects</Button>
          </div>
        </SourceState>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Findings" sub="Curated findings across your accessible projects, by severity and workflow status" />
          <SourceState label="The findings rollup" pending={findings.isPending} error={error(findings)} onRetry={() => void findings.refetch()}>
            {findings.data && <FindingsSection view={findings.data} />}
          </SourceState>
        </Card>
        <Card>
          <CardHeader title="C2 activity" sub="Recorded command audit and pending session grants; live provider sessions stay per project" />
          <SourceState label="The C2 rollup" pending={c2.isPending} error={error(c2)} onRetry={() => void c2.refetch()}>
            {c2.data && <C2Section view={c2.data} />}
          </SourceState>
        </Card>
      </div>

      <Card>
        <CardHeader title={tasks.data ? `Task inbox (${tasks.data.length})` : 'Task inbox'} sub="Pending approvals, reviews and stops across your accessible projects" />
        <SourceState label="The task inbox" pending={tasks.isPending} error={error(tasks)} onRetry={() => void tasks.refetch()}>
          {tasks.data && <TasksSection tasks={tasks.data} />}
        </SourceState>
      </Card>

      <p className="text-xs text-muted">Reads cover only the projects your account owns or holds a membership on. A source that is unavailable says so instead of showing zeros.</p>
    </div>
  )
}
