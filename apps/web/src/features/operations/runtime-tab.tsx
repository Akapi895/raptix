/**
 * Operations tab over the runtime (plan P12, Operations slice), shared by the real
 * project detail, the operations feature route and the AI workspace history. The
 * engagement's execution threads and their runs show the runtime's raw statuses
 * with their identities. Pause, resume and completion follow the operation state the
 * runtime reports (plan P11). A stop is requested from Governance, and a stop that
 * still blocks work is named here.
 */
import type { ReactElement } from 'react'
import { Bot } from 'lucide-react'
import { go, useRoute } from '../../router/navigate'
import { Banner, Button, Card, CardHeader, Empty, Skeleton, cx } from '../../ui'
import { ACTIVE_STOP_OUTCOMES } from '../governance/service'
import { useGovernanceStops } from '../governance/query'
import { ThreadRuns } from './runtime-runs'
import { ThreadResults } from './results-panel'
import { PlanSteps } from './plan-steps'
import { messageOf, useRuntimeThreads, useRuntimeTimeline } from './runtime-query'
import type { RuntimeThread } from './runtime'

export function RuntimeOperationsTab({ engagementId }: { engagementId: string }): ReactElement {
  const route = useRoute()
  // The operation detail route consumes the thread id from the URL: a foreign or unknown id is an explicit not-found.
  const detailThreadId = route.page === 'operation' && route.id ? route.id : null
  const threads = useRuntimeThreads(engagementId)
  const executionThreads = threads.data ?? []

  if (detailThreadId !== null) {
    const selected = executionThreads.find((t) => t.threadId === detailThreadId)
    return (
      <div className="space-y-4">
        <ActiveStopBanner engagementId={engagementId} />
        {threads.isPending ? <Card><CardHeader title={`Operation ${detailThreadId}`} /><div className="p-4 space-y-2" aria-busy="true" role="status"><Skeleton className="h-10" /><Skeleton className="h-10" /></div></Card>
          : threads.isError ? <Banner tone="warn" title="Threads source unavailable">{messageOf(threads.error, 'Threads could not be loaded.')} No substitute operation view is shown.</Banner>
          : selected === undefined ? (
            <Empty icon={Bot} title="Operation thread not found" action={<Button onClick={() => go('operations', { engagementId })}>Open operations</Button>}>
              No execution thread <span className="font-mono">{detailThreadId}</span> is owned by this engagement. Planning threads and foreign ids are not operation resources.
            </Empty>
          ) : (
            <>
            <PlanSteps engagementId={engagementId} />
            <ThreadResults engagementId={engagementId} thread={selected} />
            <Card>
              <CardHeader title={`Operation thread ${selected.threadId}`} sub={`Assistant ${selected.assistantId} — bound runtime runs for this thread only`} />
              <div className="p-4"><ul><ThreadRuns engagementId={engagementId} thread={selected} /></ul></div>
            </Card>
            </>
          )}
        <TimelineCard engagementId={engagementId} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <ActiveStopBanner engagementId={engagementId} />
      <Card>
        <CardHeader title="Execution threads" sub="Owned runtime bindings for this engagement. Execution never bypasses the planning handoff." />
        <p className="px-4 pb-2 text-xs text-muted">A run can be paused or cancelled here; a paused operation resumes from its checkpoint, and an operation is marked complete only after its last run ended. A stop is requested from Governance.</p>
        {threads.isPending ? <div className="space-y-2" aria-busy="true" role="status"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
          : threads.isError ? <p className="text-sm text-bad" role="alert">{messageOf(threads.error, 'Threads could not be loaded.')}</p>
          : executionThreads.length === 0 ? (
            <p className="text-sm text-muted">No execution thread yet. Create one in the AI workspace after confirming the planning handoff.</p>
          ) : (
            <ul className="space-y-2">
              {executionThreads.map((t: RuntimeThread) => <ThreadRuns key={t.threadId} engagementId={engagementId} thread={t} />)}
            </ul>
          )}
        <div className="mt-4">
          <Button variant="secondary" icon={Bot} onClick={() => go('project', { id: engagementId, tab: 'ai-workspace' })}>Open AI workspace</Button>
        </div>
      </Card>

      <TimelineCard engagementId={engagementId} />
    </div>
  )
}

/** An emergency stop that still blocks work is named here, with the place where it is resolved. */
function ActiveStopBanner({ engagementId }: { engagementId: string }): ReactElement | null {
  const stops = useGovernanceStops(engagementId)
  const active = (stops.data ?? []).filter((stop) => ACTIVE_STOP_OUTCOMES.includes(stop.outcome))
  if (active.length === 0) return null
  return (
    <Banner tone="warn" title={`${active.length} emergency stop${active.length === 1 ? '' : 's'} still ${active.length === 1 ? 'blocks' : 'block'} work`} action={<Button size="sm" variant="secondary" onClick={() => go('project', { id: engagementId, tab: 'governance' })}>Open Governance</Button>}>
      Work does not restart until a stop is explicitly resolved in Governance.
    </Banner>
  )
}

/** Merged operations timeline: runtime, checkpoint and workspace entries keep their source labels. */
function TimelineCard({ engagementId }: { engagementId: string }): ReactElement {
  const timeline = useRuntimeTimeline(engagementId)
  return (
    <Card>
      <CardHeader title="Operations timeline" sub="Merged log of runtime run states, checkpoint events and workspace artifact presence. Artifact mtimes are presence markers, not exact execution times." />
      {timeline.isPending ? <div className="space-y-2" aria-busy="true" role="status"><Skeleton className="h-10" /></div>
        : timeline.isError || !timeline.data ? (
          <Banner tone="warn" title="Timeline source unavailable">
            {messageOf(timeline.error, 'The merged timeline is not available right now.')} No substitute events are shown.
          </Banner>
        ) : (
          <div className="space-y-2">
            {timeline.data.unavailableThreads > 0 && (
              <Banner tone="warn" title="Some runtime threads are not shown">
                {timeline.data.unavailableThreads === 1 ? '1 thread has' : `${timeline.data.unavailableThreads} threads have`} a runtime binding that no longer matches persisted state, so its runs and checkpoints are left out.
              </Banner>
            )}
            {timeline.data.truncated && <Banner tone="warn" title="Timeline truncated">The server projection truncated this timeline.</Banner>}
            {timeline.data.entries.length === 0 ? <p className="text-sm text-muted">No observed activity recorded yet.</p> : (
              <ul className="space-y-1.5">
                {timeline.data.entries.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-neutral">{e.at.replace('T', ' ').slice(0, 19)}Z</span>
                    <span className={cx('rounded-full border px-1.5 text-[10px] uppercase', {
                      runtime: 'border-accent/30 text-accent', checkpoint: 'border-cyan/30 text-cyan', workspace: 'border-line text-muted',
                    }[e.source])}>{e.source}</span>
                    <span className="min-w-0 flex-1 break-words text-fg">{e.label}</span>
                    {e.agent && <span className="text-xs text-muted">{e.agent}</span>}
                    {e.tool && <span className="font-mono text-xs text-muted">{e.tool}</span>}
                    {e.runId && <span className="font-mono text-xs text-neutral">{e.runId}</span>}
                    {e.status && <span className="text-xs text-muted">{e.status}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
    </Card>
  )
}
