/**
 * Operations tab over the runtime (plan P12, Operations slice), shared by the real
 * project detail, the operations feature route and the AI workspace history. The
 * list shows one row per operation with its state, runs and outcome; an operation opens
 * on its own page with its runs, agent instances, trace and results. Pause, resume and
 * completion follow the operation state the runtime reports (plan P11). A stop is
 * requested from Governance, and a stop that still blocks work is named here.
 */
import { useState, type ReactElement } from 'react'
import { Bot } from 'lucide-react'
import { go, useRoute } from '../../router/navigate'
import { Banner, Button, Card, CardHeader, cx, Empty, Skeleton } from '../../ui/index'
import { OperationsTable } from './operation-table'
import { ActiveStopBanner, OperationDetail } from './operation-detail'
import { messageOf, useRuntimeThreads, useRuntimeTimeline } from './runtime-query'
import { TIMELINE_MAX_LIMIT, TIMELINE_PAGE_LIMIT } from './runtime'
import { runStatusTone } from './runtime-status'
import type { TimelineEntryView } from '@raptix/web-contracts'

export function RuntimeOperationsTab({ engagementId }: { engagementId: string }): ReactElement {
  const route = useRoute()
  // The operation detail route consumes the thread id from the URL: a foreign or unknown id is an explicit not-found.
  const detailThreadId = route.page === 'operation' && route.id ? route.id : null
  const threads = useRuntimeThreads(engagementId)
  const executionThreads = threads.data ?? []

  if (detailThreadId !== null) {
    const selected = executionThreads.find((t) => t.threadId === detailThreadId)
    if (threads.isPending) {
      return (
        <div className="space-y-4">
          <ActiveStopBanner engagementId={engagementId} />
          <Card><CardHeader title={`Operation ${detailThreadId}`} /><div className="p-4 space-y-2" aria-busy="true" role="status"><Skeleton className="h-10" /><Skeleton className="h-10" /></div></Card>
        </div>
      )
    }
    if (threads.isError) {
      return (
        <div className="space-y-4">
          <ActiveStopBanner engagementId={engagementId} />
          <Banner tone="warn" title="Threads source unavailable">{messageOf(threads.error, 'Threads could not be loaded.')} No substitute operation view is shown.</Banner>
        </div>
      )
    }
    if (selected === undefined) {
      return (
        <div className="space-y-4">
          <ActiveStopBanner engagementId={engagementId} />
          <Empty icon={Bot} title="Operation thread not found" action={<Button onClick={() => go('operations', { engagementId })}>Open operations</Button>}>
            No execution thread <span className="font-mono">{detailThreadId}</span> is owned by this engagement. Planning threads and foreign ids are not operation resources.
          </Empty>
        </div>
      )
    }
    return <OperationDetail engagementId={engagementId} thread={selected} />
  }

  return (
    <div className="space-y-4">
      <ActiveStopBanner engagementId={engagementId} />
      <Card>
        <CardHeader title="Operations" sub="Execution threads owned by this engagement. Execution never bypasses the planning handoff." />
        <p className="px-4 pb-2 text-xs text-muted">A run can be paused or cancelled here; a paused operation resumes from its checkpoint, and an operation is marked complete only after its last run ended. A stop is requested from Governance.</p>
        {threads.isPending ? <div className="space-y-2 p-4" aria-busy="true" role="status"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
          : threads.isError ? <p className="p-4 text-sm text-bad" role="alert">{messageOf(threads.error, 'Threads could not be loaded.')}</p>
          : executionThreads.length === 0 ? (
            <p className="p-4 text-sm text-muted">No execution thread yet. Create one in the AI workspace after confirming the planning handoff.</p>
          ) : (
            <div className="px-4 pb-4">
              <OperationsTable engagementId={engagementId} threads={executionThreads} />
            </div>
          )}
        <div className="px-4 pb-4">
          <Button variant="secondary" icon={Bot} onClick={() => go('project', { id: engagementId, tab: 'ai-workspace' })}>Open AI workspace</Button>
        </div>
      </Card>

      <TimelineCard engagementId={engagementId} />
    </div>
  )
}

/** Merged operations timeline: runs, checkpoint events and artifact presence, each with the time it was recorded. */
function TimelineCard({ engagementId }: { engagementId: string }): ReactElement {
  // The timeline loads one page at a time: the newest entries first, then more on request, up to the window bound.
  const [limit, setLimit] = useState(TIMELINE_PAGE_LIMIT)
  const timeline = useRuntimeTimeline(engagementId, limit)
  const canLoadMore = timeline.data?.hasMore === true && limit < TIMELINE_MAX_LIMIT
  return (
    <Card>
      <CardHeader title="Operations timeline" sub="Runs and checkpoint events in the order they were recorded. An artifact row marks when a file was last written; it is not an execution time." />
      {timeline.isPending ? <div className="space-y-2" aria-busy="true" role="status"><Skeleton className="h-10" /></div>
        : timeline.isError || !timeline.data ? (
          <Banner tone="warn" title="Timeline source unavailable">
            {messageOf(timeline.error, 'The merged timeline is not available right now.')} No substitute events are shown.
          </Banner>
        ) : (
          <div className="space-y-3">
            {timeline.data.unavailableThreads > 0 && (
              <Banner tone="warn" title="Some runtime threads are not shown">
                {timeline.data.unavailableThreads === 1 ? '1 thread has' : `${timeline.data.unavailableThreads} threads have`} a runtime binding that no longer matches persisted state, so its runs and checkpoints are left out.
              </Banner>
            )}
            {timeline.data.untimedCheckpoints > 0 && (
              <p className="text-xs text-muted">
                {timeline.data.untimedCheckpoints === 1 ? '1 checkpoint event has' : `${timeline.data.untimedCheckpoints} checkpoint events have`} no recorded time, so {timeline.data.untimedCheckpoints === 1 ? 'it is' : 'they are'} not placed here. Each operation&apos;s Trace shows them.
              </p>
            )}
            {timeline.data.truncated && (
              <p className="text-xs text-muted">The source window holds at most {TIMELINE_MAX_LIMIT} entries, so older activity beyond it is not projected.</p>
            )}
            {timeline.data.entries.length === 0 ? <p className="text-sm text-muted">No observed activity recorded yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-neutral">
                      <th className="py-2 pr-3 font-medium">Time (UTC)</th>
                      <th className="py-2 pr-3 font-medium">Source</th>
                      <th className="py-2 pr-3 font-medium">Event</th>
                      <th className="py-2 pr-3 font-medium">Agent</th>
                      <th className="py-2 pr-3 font-medium">Run</th>
                      <th className="py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeline.data.entries.map((entry) => <TimelineRow key={entry.id} entry={entry} />)}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <span className="text-xs text-muted">
                Showing {timeline.data.entries.length} {timeline.data.entries.length === 1 ? 'entry' : 'entries'}
                {timeline.data.hasMore ? ', more are available' : ''}
                {timeline.isPlaceholderData && <span role="status"> · loading more…</span>}
              </span>
              {canLoadMore && <Button size="sm" variant="secondary" onClick={() => setLimit(Math.min(limit + TIMELINE_PAGE_LIMIT, TIMELINE_MAX_LIMIT))}>Load more</Button>}
            </div>
          </div>
        )}
    </Card>
  )
}

const SOURCE_LABEL: Record<TimelineEntryView['source'], string> = { runtime: 'Run', checkpoint: 'Checkpoint', workspace: 'Artifact' }
const SOURCE_STYLE: Record<TimelineEntryView['source'], string> = {
  runtime: 'border-accent/30 text-accent',
  checkpoint: 'border-cyan/30 text-cyan',
  workspace: 'border-line text-muted',
}
const STATUS_TEXT = { ok: 'text-ok', bad: 'text-bad', warn: 'text-warn', neutral: 'text-muted' } as const

function TimelineRow({ entry }: { entry: TimelineEntryView }): ReactElement {
  const tone = entry.status ? runStatusTone(entry.status) : null
  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="whitespace-nowrap py-2 pr-3 font-mono text-neutral">{entry.at.replace('T', ' ').slice(0, 19)}</td>
      <td className="py-2 pr-3">
        <span className={cx('rounded-full border px-1.5 text-[10px] uppercase', SOURCE_STYLE[entry.source])}>{SOURCE_LABEL[entry.source]}</span>
      </td>
      <td className="py-2 pr-3">
        <div className="break-words text-fg">{entry.label}</div>
        {entry.tool && <div className="font-mono text-[11px] text-muted">{entry.tool}</div>}
      </td>
      <td className="py-2 pr-3 text-muted">{entry.agent ?? '—'}</td>
      <td className="py-2 pr-3 font-mono text-[11px] text-neutral">{entry.runId ?? '—'}</td>
      <td className={cx('py-2', tone ? STATUS_TEXT[tone] : 'text-muted')}>{entry.status ?? '—'}</td>
    </tr>
  )
}
