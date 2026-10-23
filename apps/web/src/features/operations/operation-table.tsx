/**
 * The Execution list: one row per operation, with its state, its latest run, the run and agent counts, when it started and
 * last changed, and the outcome its runs report. Each row reads its own runs and operation; the agent instances come from the
 * fleet read once for the whole list. A figure whose source failed says so in its cell.
 */
import type { ReactElement } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Ban, Loader2 } from 'lucide-react'
import { go } from '../../router/navigate'
import { utcMinute } from '../../platform/format'
import { Button, Status } from '../../ui/index'
import { OPERATION_TEXT } from './operation-state'
import { messageOf, useRuntimeCancel, useRuntimeFleet, useRuntimeOperation, useRuntimeRuns } from './runtime-query'
import type { RuntimeFleetBranch, RuntimeThread } from './runtime'
import { formatSpan, summariseOperation } from './operation-summary'
import { runStatusTone } from './runtime-status'

/** Run statuses the runtime still reports as in flight: the ones a stop can be requested for. */
const IN_FLIGHT = ['pending', 'running', 'submitting']

export function OperationsTable({ engagementId, threads }: { engagementId: string; threads: RuntimeThread[] }): ReactElement {
  const fleet = useRuntimeFleet(engagementId)
  const branches = fleet.data?.branches ?? null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-line text-neutral">
            <th className="py-2 pr-3 font-medium">Operation</th>
            <th className="py-2 pr-3 font-medium">State</th>
            <th className="py-2 pr-3 font-medium">Latest run</th>
            <th className="py-2 pr-3 font-medium">Runs</th>
            <th className="py-2 pr-3 font-medium">Started</th>
            <th className="py-2 pr-3 font-medium">Updated</th>
            <th className="py-2 pr-3 font-medium">Span</th>
            <th className="py-2 pr-3 font-medium">Agents</th>
            <th className="py-2 pr-3 font-medium">Outcome</th>
            <th className="py-2 font-medium"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {threads.map((thread) => <OperationRow key={thread.threadId} engagementId={engagementId} thread={thread} branches={branches} agentsError={fleet.isError} />)}
        </tbody>
      </table>
    </div>
  )
}

function OperationRow({ engagementId, thread, branches, agentsError }: {
  engagementId: string
  thread: RuntimeThread
  branches: RuntimeFleetBranch[] | null
  agentsError: boolean
}): ReactElement {
  const operation = useRuntimeOperation(engagementId, thread.threadId)
  const runs = useRuntimeRuns(engagementId, thread.threadId)
  const cancelRun = useRuntimeCancel(engagementId)
  const cancel = useMutation({ mutationFn: (runId: string) => cancelRun(thread.threadId, runId) })
  const summary = runs.data ? summariseOperation(thread, runs.data, branches ?? []) : null
  const inFlight = summary?.latestRun && IN_FLIGHT.includes(summary.latestRun.rawStatus) ? summary.latestRun : null
  const tone = summary?.latestRun ? runStatusTone(summary.latestRun.rawStatus) : null

  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="py-2.5 pr-3">
        <div className="font-mono text-xs font-medium text-fg">{thread.threadId}</div>
        <div className="text-[11px] text-muted">assistant {thread.assistantId}</div>
      </td>
      <td className="py-2.5 pr-3">
        {operation.isError ? <span role="alert" className="text-bad">{messageOf(operation.error, 'Unavailable')}</span>
          : <span className="text-fg">{operation.data ? (OPERATION_TEXT[operation.data.state] ?? operation.data.state) : 'reading…'}</span>}
      </td>
      <td className="py-2.5 pr-3">
        {runs.isError ? <span role="alert" className="text-bad">{messageOf(runs.error, 'Unavailable')}</span>
          : summary === null ? <span className="text-muted">reading…</span>
          : summary.latestRun === null ? <span className="text-muted">No run yet</span>
          : (
            <span className="flex flex-col gap-0.5">
              <span className="font-mono text-[11px] text-neutral">{summary.latestRun.runId}</span>
              <Status kind="gate" value={tone === 'ok' ? 'passed' : tone === 'bad' ? 'failed' : 'pending'} size="sm" label={summary.latestRun.rawStatus} />
            </span>
          )}
      </td>
      <td className="py-2.5 pr-3 tabular-nums">{summary?.runCount ?? '—'}</td>
      <td className="py-2.5 pr-3 text-muted">{summary?.startedAt ? utcMinute(summary.startedAt) : '—'}</td>
      <td className="py-2.5 pr-3 text-muted">{summary?.updatedAt ? utcMinute(summary.updatedAt) : '—'}</td>
      <td className="py-2.5 pr-3 tabular-nums text-muted">{summary?.spanMs != null ? formatSpan(summary.spanMs) : '—'}</td>
      <td className="py-2.5 pr-3 text-muted">
        {agentsError ? <span className="text-bad">not read</span>
          : branches === null ? '—'
          : summary ? `${summary.agents} (${summary.runningAgents} running)` : '—'}
      </td>
      <td className="py-2.5 pr-3 text-muted">
        {summary === null ? '—' : summary.runCount === 0 ? 'Not started' : `${summary.succeeded} succeeded · ${summary.failed} failed · ${summary.open} open`}
      </td>
      <td className="py-2.5">
        <div className="flex flex-col items-start gap-1">
          <Button size="sm" variant="secondary" onClick={() => go('operation', { id: thread.threadId, engagementId })}>Open</Button>
          {inFlight !== null && (
            <Button size="sm" variant="ghost" icon={Ban} disabled={cancel.isPending} onClick={() => cancel.mutate(inFlight.runId)}>
              {cancel.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
              Cancel run
            </Button>
          )}
          {cancel.isError && <span role="alert" className="text-bad">{messageOf(cancel.error, 'The cancel was refused.')}</span>}
        </div>
      </td>
    </tr>
  )
}
