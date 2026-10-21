/**
 * Real command center (integration ticket 15). KPIs, readiness and the task
 * inbox come from the API's aggregate over only the engagements the actor is
 * authorized to see; readiness consumes the governance preflight (never a
 * re-decision). Missing sources render as explicit unavailable states — no
 * fake zeros, no demo KPIs. Actions deep-link to the owning feature's
 * authoritative surface.
 */
import { useQuery } from '@tanstack/react-query'
import { Gauge } from 'lucide-react'
import type { ReactElement } from 'react'
import { fetchTasks } from '../../features/overview/remote';
import { go } from '../../router/navigate'
import { parseHash } from '../../router/history'
import { useRoute } from '../../router/navigate'
import { Button, Card, CardHeader, Empty, PageHeader, Skeleton, Status } from '../../ui/index'
import { utcMinute } from '../format'

const KIND_LABEL: Record<string, string> = {
  'scope-revision': 'Scope review',
  'business-plan': 'Plan decision',
  'c2-grant': 'C2 grant review',
  'report-review': 'Report review',
  'finding-review': 'Finding confirmation',
  'active-stop': 'Active emergency stop',
}

export function RealCommandCenter(): ReactElement {
  const route = useRoute()
  const tasks = useQuery({
    queryKey: ['real', 'tasks'],
    queryFn: () => fetchTasks(),
    refetchInterval: 30_000,
  })

  if (tasks.isPending) {
    return <Card><CardHeader title="Command center" /><div className="p-4"><Skeleton className="h-32" /></div></Card>
  }
  if (tasks.isError || !tasks.data) {
    return <Empty icon={Gauge} title="The command center is unavailable" action={<Button onClick={() => void tasks.refetch()}>Retry</Button>}>
      {tasks.error instanceof Error ? tasks.error.message : 'The aggregate read failed.'}
    </Empty>
  }
  const view = tasks.data

  return (
    <div className="space-y-4">
      <PageHeader
        title={route.page === 'tasks' ? 'Tasks' : 'Command center'}
        sub={`${view.engagements.length} authorized engagement(s) · aggregated live from the API — sources without data show as unavailable, never as zeros`}
      />
      <Card>
        <CardHeader title="Engagement readiness" sub="Consumes the governance preflight per engagement (authoritative checklist)" />
        <div className="p-4">
          {view.engagements.length === 0 ? (
            <p className="text-sm text-muted">No engagements are authorized for your account yet. Create one from Projects.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2">Engagement</th>
                  <th className="pb-2">Readiness</th>
                  <th className="pb-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {view.engagements.map((e) => (
                  <tr key={e.engagementId} className="border-t border-line">
                    <td className="py-2 pr-3">
                      <button className="text-left font-mono text-xs text-fg hover:text-accent hover:underline" onClick={() => go('project', { id: e.engagementId })}>
                        {e.name ?? e.engagementId}
                      </button>
                    </td>
                    <td className="py-2 pr-3">
                      {e.readiness.state === 'available'
                        ? <Status kind="gate" value={e.readiness.ok ? 'passed' : 'failed'} size="sm" label={e.readiness.ok ? 'Ready' : `${e.readiness.failedChecks} check(s) failed`} />
                        : <Status kind="gate" value="pending" size="sm" label="Unavailable" />}
                    </td>
                    <td className="py-2 text-xs text-muted">{e.readiness.reason ?? (e.readiness.ok === false ? 'Open the Governance tab for the failing checks.' : '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title={`Task inbox (${view.tasks.length})`} sub="Pending work grouped by kind across your authorized engagements; actions open the owning feature's authoritative surface" />
        <div className="p-4">
          {view.tasks.length === 0 ? (
            <p className="text-sm text-muted">No pending work. Approvals, reviews and stops appear here when lifecycle workflows create them.</p>
          ) : (
            <ul className="space-y-2">
              {view.tasks.map((t) => (
                <li key={`${t.kind}-${t.refId}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
                  <Status kind="gate" value={t.kind === 'active-stop' ? 'failed' : 'pending'} size="sm" label={KIND_LABEL[t.kind] ?? t.kind} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {t.title}
                    <span className="text-xs text-muted"> · {t.engagementName ?? t.engagementId}{t.awaitingActor ? ' · awaiting your follow-up' : ''}</span>
                  </span>
                  <span className="text-xs text-muted">{utcMinute(t.createdAt)}</span>
                  <Button variant="secondary" onClick={() => { const route = parseHash(t.href); go(route.page, route) }}>Open</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  )
}
