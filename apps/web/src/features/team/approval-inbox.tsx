/**
 * Decisions waiting on one project (real mode, P09): the server's pending scope revisions, proposed plans, requested C2
 * grants, reports and findings in review; the project's pending closure request and library proposals; and the active
 * emergency stops, which are attention items and not decisions (D-02). Reading the list needs only membership. Each item
 * records its decision on its own page, which checks the reviewer and role rules. Runtime tool approvals are not listed
 * here: they wait in the AI Workspace of the project.
 */
import type { ReactElement } from 'react'
import { countText, inboxLimits, splitTasks, type TaskItemView } from '../decisions'
import { useRealTaskInbox } from '../tasks'
import { go } from '../../router/navigate'
import { utcMinute } from '../../platform/format'
import { Banner, Button, Card, CardHeader, Empty } from '../../ui/index'
import { useProjectWaiting, type ProjectWaitingItem } from './waiting'

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

function WaitingRow({ item, onOpen }: { item: ProjectWaitingItem; onOpen: () => void }): ReactElement {
  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <span className="rounded-full border border-line px-2 py-0.5 text-xs">{item.kind === 'closure' ? 'Closeout' : 'Library'}</span>
      <span className="font-medium">{item.title}</span>
      <span className="font-mono text-xs text-muted">{item.refId}</span>
      <Button className="ml-auto" size="sm" variant="secondary" onClick={onOpen}>Open</Button>
    </li>
  )
}

export function ApprovalInbox({ engagementId }: { engagementId: string }): ReactElement {
  const scoped = engagementId !== '' && engagementId !== 'all'
  const tasks = useRealTaskInbox({ enabled: scoped })
  const waiting = useProjectWaiting(engagementId, scoped)
  const openWaiting = (item: ProjectWaitingItem) => (item.kind === 'closure' ? go('project', { id: engagementId, tab: 'close' }) : go('playbook-review', { id: item.refId }))

  return (
    <Card>
      <CardHeader title="Waiting for a decision" sub="Pending approvals on this project. Viewing the list needs only membership; each item records its decision on its own page, which checks your role." />
      <div className="space-y-4 p-4">
        {tasks.isPending ? <p role="status" className="text-sm text-muted">Loading approvals…</p>
          : tasks.isError ? <Banner tone="warn" title="Approvals unavailable">{tasks.error instanceof Error ? tasks.error.message : 'The approval list could not be read.'} No substitute list is shown.</Banner>
          : (() => {
            const { decisions, stops } = splitTasks(tasks.data.tasks.filter((task) => task.engagementId === engagementId))
            const limits = inboxLimits(tasks.data)
            return (
              <>
                {(limits.decisions || limits.stops) && <Banner tone="info" title="The list is limited">The server returns the newest items of each kind. Counts shown with a plus may be incomplete.</Banner>}
                {decisions.length === 0 && stops.length === 0 && waiting.items.length === 0 && !waiting.closure.isPending && !waiting.library.isPending
                  ? <Empty title="Nothing is waiting">No scope revision, plan, C2 request, report, finding, closure request or library proposal is waiting on this project.</Empty> : null}
                {decisions.length > 0 && (
                  <section aria-label="Decisions">
                    <h3 className="text-sm font-semibold">Decisions · {countText(decisions.length, limits.decisions)}</h3>
                    <ul className="divide-y divide-line">{decisions.map((task) => <TaskRow key={`${task.kind}:${task.refId}`} task={task} />)}</ul>
                  </section>
                )}
                {stops.length > 0 && (
                  <section aria-label="Attention">
                    <h3 className="text-sm font-semibold">Attention · {countText(stops.length, limits.stops)} active emergency stop{stops.length === 1 ? '' : 's'}</h3>
                    <ul className="divide-y divide-line">{stops.map((task) => <TaskRow key={`${task.kind}:${task.refId}`} task={task} />)}</ul>
                  </section>
                )}
              </>
            )
          })()}
        {waiting.items.length > 0 && (
          <section aria-label="Also waiting on this project">
            <h3 className="text-sm font-semibold">Also waiting · {waiting.items.length}</h3>
            <p className="text-xs text-muted">Closure requests and library proposals are not counted on the Overview yet.</p>
            <ul className="divide-y divide-line">{waiting.items.map((item) => <WaitingRow key={`${item.kind}:${item.refId}`} item={item} onOpen={() => openWaiting(item)} />)}</ul>
          </section>
        )}
        {waiting.closure.isError && <p className="text-xs text-muted">The closeout state could not be read.</p>}
        {waiting.library.isError && <p className="text-xs text-muted">The library proposals could not be read.</p>}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
          <span className="text-muted">Runtime tool approvals wait in the AI Workspace of this project.</span>
          <Button size="sm" variant="secondary" onClick={() => go('project', { id: engagementId, tab: 'ai-workspace' })}>Open AI Workspace</Button>
        </div>
      </div>
    </Card>
  )
}
