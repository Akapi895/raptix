/**
 * Real System Overview — the real-mode landing page. Cross-project dashboard
 * with one independently-loading section per data domain (projects, findings,
 * durable C2 activity, task inbox). There is deliberately no single aggregate
 * endpoint: each section reads its own API surface, degrades to its own error
 * state, and never fabricates rows for a source that is unavailable. Every
 * read is authorized server-side per actor; links deep-link into the owning
 * project surface.
 */
import { useQuery } from '@tanstack/react-query'
import { FolderKanban } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { fetchOverviewC2, fetchOverviewFindings, fetchTasks, listEngagements, type OverviewC2View, type OverviewFindingsView, type TasksView } from '../api'
import { go } from '../../router/navigate'
import { parseHash } from '../../router/history'
import { Button, Card, CardHeader, Empty, PageHeader, Skeleton, Status } from '../../ui'
import { utcMinute } from '../format'

const KIND_LABEL: Record<string, string> = {
  'scope-revision': 'Scope review',
  'business-plan': 'Plan decision',
  'c2-grant': 'C2 grant review',
  'report-review': 'Report review',
  'finding-review': 'Finding confirmation',
  'active-stop': 'Active emergency stop',
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info']
const C2_STATUS_ORDER = ['creating', 'succeeded', 'failed', 'uncertain']

/** One section's degraded/loading/loaded states stay inside the section. */
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

function FindingsSection({ view }: { view: OverviewFindingsView }): ReactElement {
  const severities = [...SEVERITY_ORDER.filter((s) => (view.bySeverity[s] ?? 0) > 0), ...Object.keys(view.bySeverity).filter((s) => !SEVERITY_ORDER.includes(s))]
  return (
    <div className="p-4">
      {view.total === 0 ? (
        <p className="text-sm text-muted">No findings recorded yet across your {view.engagements} authorized project(s).</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {severities.map((s) => (
              <Status key={s} kind="gate" value={s === 'critical' || s === 'high' ? 'failed' : s === 'medium' ? 'pending' : 'passed'} size="sm" label={`${s}: ${view.bySeverity[s] ?? 0}`} />
            ))}
            <span className="text-xs text-muted">{view.total} total · in {view.engagementsWithFindings} of {view.engagements} project(s){view.truncated ? ' · scan truncated (counts are a lower bound)' : ''}</span>
          </div>
          <p className="mt-2 text-xs text-muted">
            {Object.entries(view.byStatus).map(([status, count]) => `${status}: ${count}`).join(' · ') || '—'}
          </p>
        </>
      )}
    </div>
  )
}

function C2Section({ view }: { view: OverviewC2View }): ReactElement {
  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        {C2_STATUS_ORDER.map((s) => (
          <Status key={s} kind="gate" value={s === 'failed' ? 'failed' : s === 'succeeded' ? 'passed' : 'pending'} size="sm" label={`${s}: ${view.commandsByStatus[s] ?? 0}`} />
        ))}
        <span className="text-xs text-muted">C2 session grants awaiting review: {view.pendingGrants} · live Sliver sessions are per-project (open a project's C2 Access tab)</span>
      </div>
      {view.recentCommands.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {view.recentCommands.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
              <button className="font-mono text-xs text-fg hover:text-accent hover:underline" onClick={() => go('project', { id: c.engagementId, tab: 'c2' })}>{c.engagementId}</button>
              <span className="truncate font-mono text-xs text-muted">{c.sessionId}</span>
              <Status kind="gate" value={c.status === 'failed' ? 'failed' : c.status === 'succeeded' ? 'passed' : 'pending'} size="sm" label={c.status} />
              <span className="ml-auto text-xs text-muted">{utcMinute(c.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TasksSection({ view }: { view: TasksView }): ReactElement {
  const top = view.tasks.slice(0, 8)
  return (
    <div className="p-4">
      {top.length === 0 ? (
        <p className="text-sm text-muted">No pending work. Approvals, reviews and stops appear here when lifecycle workflows create them.</p>
      ) : (
        <ul className="space-y-2">
          {top.map((t) => (
            <li key={`${t.kind}-${t.refId}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
              <Status kind="gate" value={t.kind === 'active-stop' ? 'failed' : 'pending'} size="sm" label={KIND_LABEL[t.kind] ?? t.kind} />
              <span className="min-w-0 flex-1 truncate text-sm">
                {t.title}
                <span className="text-xs text-muted"> · {t.engagementName ?? t.engagementId}{t.awaitingActor ? ' · awaiting your follow-up' : ''}</span>
              </span>
              <span className="text-xs text-muted">{utcMinute(t.createdAt)}</span>
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

export function RealOverview(): ReactElement {
  const engagements = useQuery({ queryKey: ['real', 'overview', 'projects'], queryFn: () => listEngagements(), refetchInterval: 60_000 })
  const findings = useQuery({ queryKey: ['real', 'overview', 'findings'], queryFn: () => fetchOverviewFindings(), refetchInterval: 60_000 })
  const c2 = useQuery({ queryKey: ['real', 'overview', 'c2'], queryFn: () => fetchOverviewC2(), refetchInterval: 60_000 })
  const tasks = useQuery({ queryKey: ['real', 'tasks'], queryFn: () => fetchTasks(), refetchInterval: 30_000 })

  return (
    <div className="space-y-4">
      <PageHeader
        title="System Overview"
        sub="Every project, finding, C2 activity and pending task your account is authorized to see — each section reads its own source and reports its real state"
      />

      <Card>
        <CardHeader title="Quick actions" />
        <div className="flex flex-wrap gap-2 p-4">
          <Button onClick={() => go('project-new')}>Create Project</Button>
          <Button onClick={() => go('operations')}>View all operations</Button>
          <Button onClick={() => go('tasks')}>Review pending decisions</Button>
          <Button onClick={() => go('analysis')}>View coverage</Button>
          <Button onClick={() => go('findings')}>Open Findings</Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Projects" sub="Open a project to work its planning, execution and governance surfaces" />
        <SourceState label="The project list" pending={engagements.isPending} error={engagements.error instanceof Error ? engagements.error : null} onRetry={() => void engagements.refetch()}>
          <div className="p-4">
            {(engagements.data ?? []).length === 0 ? (
              <Empty icon={FolderKanban} title="No projects yet" action={<Button variant="primary" onClick={() => go('project-new')}>Create the first project</Button>}>
                Projects created from the console or the CLI appear here with their live status.
              </Empty>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="pb-2">Project</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Target</th>
                    <th className="pb-2">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {(engagements.data ?? []).slice(0, 5).map((p) => (
                    <tr key={p.id} className="border-t border-line">
                      <td className="py-2 pr-3">
                        <button className="text-left font-medium text-fg hover:text-accent hover:underline" onClick={() => go('project', { id: p.id })}>{p.displayName}</button>
                        <div className="font-mono text-xs text-muted">{p.id} · {p.workspaceSlug}</div>
                      </td>
                      <td className="py-2 pr-3"><Status kind="project" value={p.lifecycleStatus} size="sm" /></td>
                      <td className="py-2 pr-3 font-mono text-xs text-muted">{p.targetValue}</td>
                      <td className="py-2 text-xs text-muted">{utcMinute(p.updatedAt)}</td>
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
          <CardHeader title="Findings" sub="Durable finding records across your authorized projects, by severity and workflow status" />
          <SourceState label="The findings rollup" pending={findings.isPending} error={findings.error instanceof Error ? findings.error : null} onRetry={() => void findings.refetch()}>
            {findings.data && <FindingsSection view={findings.data} />}
          </SourceState>
        </Card>

        <Card>
          <CardHeader title="C2 activity" sub="Durable command audit and pending session grants; live provider sessions stay per-project" />
          <SourceState label="The C2 rollup" pending={c2.isPending} error={c2.error instanceof Error ? c2.error : null} onRetry={() => void c2.refetch()}>
            {c2.data && <C2Section view={c2.data} />}
          </SourceState>
        </Card>
      </div>

      <Card>
        <CardHeader title={tasks.data ? `Task inbox (${tasks.data.tasks.length})` : 'Task inbox'} sub="Pending approvals, reviews and stops across your authorized projects" />
        <SourceState label="The task inbox" pending={tasks.isPending} error={tasks.error instanceof Error ? tasks.error : null} onRetry={() => void tasks.refetch()}>
          {tasks.data && <TasksSection view={tasks.data} />}
        </SourceState>
      </Card>

      <p className="text-xs text-muted">
        Reads aggregate only projects you own or hold a membership on; a source that is unavailable says so instead of showing zeros.
      </p>
    </div>
  )
}
