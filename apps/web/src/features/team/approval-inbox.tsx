/**
 * Approvals waiting for a decision on one engagement (real mode, P09): the server's pending scope revisions,
 * proposed plans, requested C2 grants, reports and findings in review, and active stops. Read-only here; each
 * item opens the page that records the decision, which enforces the reviewer and role rules itself.
 */
import type { ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchTasks, type TaskItemView } from '../overview/remote';
import { utcMinute } from '../../platform/format'
import { consoleKeys, useQueryScope } from '../../state/keys'
import { Banner, Card, CardHeader, Empty } from '../../ui/index'

const KIND_LABEL: Record<TaskItemView['kind'], string> = {
  'scope-revision': 'Scope revision',
  'business-plan': 'Business plan',
  'c2-grant': 'C2 access request',
  'report-review': 'Report review',
  'finding-review': 'Finding review',
  'active-stop': 'Emergency stop',
}

export function ApprovalInbox({ engagementId }: { engagementId: string }): ReactElement {
  const scope = useQueryScope()
  const tasks = useQuery({
    queryKey: consoleKeys.view('approval-inbox', scope, engagementId),
    queryFn: () => fetchTasks(),
    enabled: engagementId !== '' && engagementId !== 'all',
  })

  return (
    <Card>
      <CardHeader title="Waiting for a decision" sub="Pending approvals on this engagement. Each item records its decision on its own page." />
      <div className="p-4">
        {tasks.isPending ? <p role="status" className="text-sm text-muted">Loading approvals…</p>
          : tasks.isError ? <Banner tone="warn" title="Approvals unavailable">{tasks.error instanceof Error ? tasks.error.message : 'The approval list could not be read.'} No substitute list is shown.</Banner>
          : (() => {
            const items = tasks.data.tasks.filter((task) => task.engagementId === engagementId)
            if (items.length === 0) return <Empty title="Nothing is waiting">No scope revision, plan, C2 request, report, finding or stop is waiting on this engagement.</Empty>
            return (
              <ul className="divide-y divide-line">
                {items.map((task) => (
                  <li key={`${task.kind}:${task.refId}`} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="rounded-full border border-line px-2 py-0.5 text-xs">{KIND_LABEL[task.kind]}</span>
                    <span className="font-medium">{task.title}</span>
                    <span className="font-mono text-xs text-muted">{task.refId}</span>
                    <span className="text-xs text-muted">{utcMinute(task.createdAt)}</span>
                    {task.awaitingActor && <span className="text-xs font-medium text-warn">Waiting on you</span>}
                    <a className="ml-auto text-accent hover:underline" href={task.href}>Open</a>
                  </li>
                ))}
              </ul>
            )
          })()}
      </div>
    </Card>
  )
}
