/**
 * Approvals waiting for a decision on one engagement (real mode, P09): the server's pending scope revisions,
 * proposed plans, requested C2 grants, reports and findings in review. Active emergency stops are listed apart as
 * attention items, not as decisions (D-02). Read-only here; each item opens the page that records the decision, which
 * enforces the reviewer and role rules itself.
 */
import type { ReactElement } from 'react'
import { countText, splitTasks, type TaskItemView } from '../decisions'
import { useRealTaskInbox } from '../tasks'
import { utcMinute } from '../../platform/format'
import { Banner, Card, CardHeader, Empty } from '../../ui/index'

const KIND_LABEL: Record<TaskItemView['kind'], string> = {
  'scope-revision': 'Scope revision',
  'business-plan': 'Business plan',
  'c2-grant': 'C2 access request',
  'report-review': 'Report review',
  'finding-review': 'Finding review',
  'active-stop': 'Emergency stop',
}

function TaskRow({ task }: { task: TaskItemView }): ReactElement {
  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <span className="rounded-full border border-line px-2 py-0.5 text-xs">{KIND_LABEL[task.kind]}</span>
      <span className="font-medium">{task.title}</span>
      <span className="font-mono text-xs text-muted">{task.refId}</span>
      <span className="text-xs text-muted">{utcMinute(task.createdAt)}</span>
      {task.awaitingActor && <span className="text-xs font-medium text-warn">Waiting on you</span>}
      <a className="ml-auto text-accent hover:underline" href={task.href}>Open</a>
    </li>
  )
}

export function ApprovalInbox({ engagementId }: { engagementId: string }): ReactElement {
  const tasks = useRealTaskInbox({ enabled: engagementId !== '' && engagementId !== 'all' })

  return (
    <Card>
      <CardHeader title="Waiting for a decision" sub="Pending approvals on this engagement. Each item records its decision on its own page." />
      <div className="p-4">
        {tasks.isPending ? <p role="status" className="text-sm text-muted">Loading approvals…</p>
          : tasks.isError ? <Banner tone="warn" title="Approvals unavailable">{tasks.error instanceof Error ? tasks.error.message : 'The approval list could not be read.'} No substitute list is shown.</Banner>
          : (() => {
            const { decisions, stops } = splitTasks(tasks.data.tasks.filter((task) => task.engagementId === engagementId))
            const limited = tasks.data.limited === true
            return (
              <div className="space-y-4">
                {limited && <Banner tone="info" title="The list is limited">The server returns the newest items of each kind. Counts shown with a plus may be incomplete.</Banner>}
                {decisions.length === 0 && stops.length === 0 ? <Empty title="Nothing is waiting">No scope revision, plan, C2 request, report or finding is waiting on this engagement.</Empty> : null}
                {decisions.length > 0 && (
                  <section aria-label="Decisions">
                    <h3 className="text-sm font-semibold">Decisions · {countText(decisions.length, limited)}</h3>
                    <ul className="divide-y divide-line">{decisions.map((task) => <TaskRow key={`${task.kind}:${task.refId}`} task={task} />)}</ul>
                  </section>
                )}
                {stops.length > 0 && (
                  <section aria-label="Attention">
                    <h3 className="text-sm font-semibold">Attention · {countText(stops.length, limited)} active emergency stop{stops.length === 1 ? '' : 's'}</h3>
                    <ul className="divide-y divide-line">{stops.map((task) => <TaskRow key={`${task.kind}:${task.refId}`} task={task} />)}</ul>
                  </section>
                )}
              </div>
            )
          })()}
      </div>
    </Card>
  )
}
