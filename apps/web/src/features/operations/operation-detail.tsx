/**
 * One operation, read on five tabs: its overview with the state and the controls it allows, its live runs and the timeline
 * entries that name them, the agent instances the fleet bound to it, the trace of its tool activity, and its results. Plan
 * status, execution outcome and verification stay apart: a run that succeeded does not by itself verify its objective.
 */
import { useState, type ReactElement } from 'react'
import { go } from '../../router/navigate'
import { utcMinute } from '../../platform/format'
import { Banner, Button, Card, CardHeader, DescList, Segmented, Skeleton } from '../../ui/index'
import { ACTIVE_STOP_OUTCOMES } from '../governance/service'
import { useGovernanceStops } from '../governance/query'
import { OperationControls, RunTable } from './runtime-runs'
import { ExecutionLogs } from './views/execution-logs'
import { ThreadResults } from './results-panel'
import { PlanSteps } from './plan-steps'
import { messageOf, useRuntimeFleet, useRuntimeRuns, useRuntimeSnapshot, useRuntimeTimeline } from './runtime-query'
import { TIMELINE_MAX_LIMIT, type RuntimeThread } from './runtime'
import { formatSpan, summariseOperation } from './operation-summary'

type DetailTab = 'overview' | 'live' | 'agents' | 'trace' | 'results'

const DETAIL_TABS: { id: DetailTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'live', label: 'Live' },
  { id: 'agents', label: 'Agent instances' },
  { id: 'trace', label: 'Trace' },
  { id: 'results', label: 'Results' },
]

/** An emergency stop that still blocks work is named here, with the place where it is resolved. */
export function ActiveStopBanner({ engagementId }: { engagementId: string }): ReactElement | null {
  const stops = useGovernanceStops(engagementId)
  const active = (stops.data ?? []).filter((stop) => ACTIVE_STOP_OUTCOMES.includes(stop.outcome))
  if (active.length === 0) return null
  return (
    <Banner tone="warn" title={`${active.length} emergency stop${active.length === 1 ? '' : 's'} still ${active.length === 1 ? 'blocks' : 'block'} work`} action={<Button size="sm" variant="secondary" onClick={() => go('project', { id: engagementId, tab: 'governance' })}>Open Governance</Button>}>
      Work does not restart until a stop is explicitly resolved in Governance.
    </Banner>
  )
}

export function OperationDetail({ engagementId, thread }: { engagementId: string; thread: RuntimeThread }): ReactElement {
  const [tab, setTab] = useState<DetailTab>('overview')
  return (
    <div className="space-y-4">
      <ActiveStopBanner engagementId={engagementId} />
      <Card>
        <CardHeader title={`Operation ${thread.threadId}`} sub={`Assistant ${thread.assistantId} · bound ${utcMinute(thread.createdAt)}`} />
        <div className="px-4 pb-4">
          <Segmented<DetailTab> value={tab} onChange={setTab} options={DETAIL_TABS} />
        </div>
        <div className="space-y-4 px-4 pb-4">
          {tab === 'overview' && <OverviewTab engagementId={engagementId} thread={thread} />}
          {tab === 'live' && <LiveTab engagementId={engagementId} thread={thread} />}
          {tab === 'agents' && <AgentsTab engagementId={engagementId} thread={thread} />}
          {tab === 'trace' && <TraceTab engagementId={engagementId} thread={thread} />}
          {tab === 'results' && <ResultsTab engagementId={engagementId} thread={thread} />}
        </div>
      </Card>
    </div>
  )
}

function OverviewTab({ engagementId, thread }: { engagementId: string; thread: RuntimeThread }): ReactElement {
  const runs = useRuntimeRuns(engagementId, thread.threadId)
  const fleet = useRuntimeFleet(engagementId)
  const summary = runs.data ? summariseOperation(thread, runs.data, fleet.data?.branches ?? []) : null
  return (
    <div className="space-y-4">
      <OperationControls engagementId={engagementId} thread={thread} />
      {runs.isError ? <p className="text-sm text-bad" role="alert">{messageOf(runs.error, 'Runs could not be loaded.')}</p>
        : summary === null ? <Skeleton className="h-24" />
        : (
          <DescList
            items={[
              { k: 'Runs', v: String(summary.runCount) },
              { k: 'Latest run', v: summary.latestRun ? `${summary.latestRun.runId} · ${summary.latestRun.rawStatus}` : 'No run yet' },
              { k: 'Started', v: summary.startedAt ? utcMinute(summary.startedAt) : 'Not started' },
              { k: 'Last change', v: summary.updatedAt ? utcMinute(summary.updatedAt) : '—' },
              { k: 'Span', v: summary.spanMs === null ? '—' : `${formatSpan(summary.spanMs)} from first start to last change` },
              { k: 'Agent instances', v: fleet.isError ? 'not read' : fleet.data ? `${summary.agents} (${summary.runningAgents} running)` : 'reading…' },
            ]}
          />
        )}
      <p className="text-xs text-muted">
        The runtime does not report this operation&apos;s objective, plan and ROE version, current phase or step, execution context, or verification. The plan status below comes from the planning objectives, which the runtime does not link to this operation.
      </p>
      <PlanSteps engagementId={engagementId} />
    </div>
  )
}

function LiveTab({ engagementId, thread }: { engagementId: string; thread: RuntimeThread }): ReactElement {
  const runs = useRuntimeRuns(engagementId, thread.threadId)
  // The run filter needs the whole window, not the first page: an older run's entries would otherwise be missed.
  const timeline = useRuntimeTimeline(engagementId, TIMELINE_MAX_LIMIT)
  const runIds = new Set((runs.data ?? []).map((run) => run.runId))
  const entries = (timeline.data?.entries ?? []).filter((entry) => entry.runId != null && runIds.has(entry.runId))
  return (
    <div className="space-y-4">
      <section aria-label="Runs" className="space-y-2">
        <h3 className="text-sm font-semibold">Runs</h3>
        <RunTable engagementId={engagementId} thread={thread} />
      </section>
      <section aria-label="Timeline of this operation" className="space-y-2">
        <h3 className="text-sm font-semibold">Timeline of this operation</h3>
        <p className="text-xs text-muted">Only entries that name one of this operation&apos;s runs are shown.</p>
        {timeline.isPending ? <Skeleton className="h-16" />
          : timeline.isError ? <p className="text-sm text-bad" role="alert">{messageOf(timeline.error, 'The timeline is not available right now.')}</p>
          : entries.length === 0 ? <p className="text-sm text-muted">No observed activity for this operation&apos;s runs yet.</p>
          : (
            <ul className="space-y-1.5">
              {entries.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-neutral">{entry.at.replace('T', ' ').slice(0, 19)}Z</span>
                  <span className="text-[10px] uppercase text-muted">{entry.source}</span>
                  <span className="min-w-0 flex-1 break-words text-fg">{entry.label}</span>
                  {entry.agent && <span className="text-xs text-muted">{entry.agent}</span>}
                  {entry.tool && <span className="font-mono text-xs text-muted">{entry.tool}</span>}
                  {entry.status && <span className="text-xs text-muted">{entry.status}</span>}
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  )
}

function AgentsTab({ engagementId, thread }: { engagementId: string; thread: RuntimeThread }): ReactElement {
  const fleet = useRuntimeFleet(engagementId)
  if (fleet.isPending) return <Skeleton className="h-24" />
  if (fleet.isError || !fleet.data) {
    return <p className="text-sm text-bad" role="alert">{messageOf(fleet.error, 'The agent instances could not be read.')}</p>
  }
  const mine = fleet.data.branches.filter((branch) => branch.threadId === thread.threadId)
  if (mine.length === 0) return <p className="text-sm text-muted">No agent instance is bound to this operation.</p>
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-line text-neutral">
              <th className="py-2 pr-3 font-medium">Instance</th>
              <th className="py-2 pr-3 font-medium">Agent</th>
              <th className="py-2 pr-3 font-medium">State</th>
              <th className="py-2 pr-3 font-medium">Outcome</th>
              <th className="py-2 pr-3 font-medium">Started</th>
              <th className="py-2 font-medium">Ended</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((branch) => (
              <tr key={branch.key} className="border-b border-line last:border-0">
                <td className="py-2 pr-3 font-mono text-fg">{branch.key}</td>
                <td className="py-2 pr-3">{branch.agent}</td>
                <td className="py-2 pr-3 text-muted">{branch.state}</td>
                <td className="py-2 pr-3 text-muted">{branch.outcome ?? 'not reported'}</td>
                <td className="py-2 pr-3 text-muted">{branch.startedAt ? utcMinute(branch.startedAt) : '—'}</td>
                <td className="py-2 text-muted">{branch.endedAt ? utcMinute(branch.endedAt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">The fleet read does not report parent or dispatch identities, so none is shown.</p>
    </div>
  )
}

function TraceTab({ engagementId, thread }: { engagementId: string; thread: RuntimeThread }): ReactElement {
  const snapshot = useRuntimeSnapshot(engagementId, thread.threadId)
  if (snapshot.isPending) return <Skeleton className="h-24" />
  if (snapshot.isError) return <p className="text-sm text-bad" role="alert">Tool activity unavailable: {messageOf(snapshot.error, 'The thread could not be read.')}</p>
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Checkpoint history across this thread; events without run attribution are not assigned to the latest run.</p>
      {snapshot.data.transcriptsTruncated && <Banner tone="warn" title="Tool history truncated">Older checkpoint events are omitted by the source.</Banner>}
      <ExecutionLogs entries={snapshot.data.transcripts} assistantId={thread.assistantId} />
    </div>
  )
}

function ResultsTab({ engagementId, thread }: { engagementId: string; thread: RuntimeThread }): ReactElement {
  return (
    <div className="space-y-4">
      <ThreadResults engagementId={engagementId} thread={thread} />
      <Card>
        <CardHeader title="Three statuses" sub="Each answers a different question, so they are read separately." />
        <div className="p-4">
          <DescList
            items={[
              { k: 'Plan status', v: 'The objective status the planning objectives carry (see Overview).' },
              { k: 'Execution outcome', v: 'Each run’s status as the runtime reports it (see Live).' },
              { k: 'Verification', v: 'Whether the objective’s success criteria were met, with evidence, is not recorded by the runtime. A run that succeeded does not verify its objective.' },
            ]}
          />
        </div>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => go('project', { id: engagementId, tab: 'ai-workspace' })}>Return to the AI workspace</Button>
        <Button variant="secondary" onClick={() => go('project', { id: engagementId, tab: 'planning' })}>Review objectives in Planning</Button>
      </div>
    </div>
  )
}
