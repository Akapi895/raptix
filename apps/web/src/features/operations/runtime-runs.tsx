/**
 * One execution thread's runs and its tool activity (plan P12, Operations slice).
 * Every status is the runtime's own word: an unknown word is never shown as
 * success. Cancel appears only for a run the runtime still reports in flight.
 */
import type { ReactElement } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Ban, Loader2 } from 'lucide-react'
import { utcMinute } from '../../real/format'
import { ExecutionLogs } from '../../real/screens/execution-logs'
import { Banner, Button, Skeleton, Status, cx } from '../../ui'
import { messageOf, useRuntimeCancel, useRuntimeRuns, useRuntimeSnapshot } from './runtime-query'
import type { RuntimeRun, RuntimeThread } from './runtime'

/** Runs a user may cancel: the ones the runtime still reports as in flight. */
const CANCELLABLE = ['pending', 'running', 'submitting']

const STATUS_TONE: Record<string, 'ok' | 'bad' | 'warn' | 'neutral'> = {
  // W24: the runtime reports success/error/timeout/interrupted; unknown
  // statuses must never be rendered as success.
  success: 'ok', completed: 'ok',
  failed: 'bad', error: 'bad', timeout: 'bad', rejected: 'bad',
  interrupted: 'warn', running: 'warn', pending: 'warn', submitting: 'warn', submitted: 'warn', awaiting_approval: 'warn', uncertain: 'warn',
  cancelled: 'neutral', canceled: 'neutral',
}

export function ThreadRuns({ engagementId, thread }: { engagementId: string; thread: RuntimeThread }): ReactElement {
  const snapshot = useRuntimeSnapshot(engagementId, thread.threadId)
  const runs = useRuntimeRuns(engagementId, thread.threadId)
  const list = runs.data ?? []
  return (
    <li className="rounded-xl border border-line bg-subtle p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-medium text-fg">{thread.threadId}</span>
        <span className="text-xs text-muted">assistant {thread.assistantId}</span>
        <span className="text-xs text-neutral">bound {utcMinute(thread.createdAt)}</span>
      </div>
      {runs.isPending ? <div className="mt-2" aria-busy="true" role="status"><Skeleton className="h-8" /></div>
        : runs.isError ? <p className="mt-2 text-sm text-bad" role="alert">{messageOf(runs.error, 'Runs could not be loaded.')}</p>
        : list.length === 0 ? <p className="mt-2 text-sm text-muted">No runs on this thread yet.</p>
        : (
          <table className="mt-2 w-full text-left text-xs">
            <thead>
              <tr className="text-neutral">
                <th className="py-1 pr-3 font-medium">Run</th>
                <th className="py-1 pr-3 font-medium">Request</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 pr-3 font-medium">Created</th>
                <th className="py-1 pr-3 font-medium">Updated</th>
                <th className="py-1 font-medium">Control</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => <RunRow key={r.runId} engagementId={engagementId} run={r} />)}
            </tbody>
          </table>
        )}
      <section aria-label={`Tool activity ${thread.threadId}`} className="mt-4 space-y-2">
        <h3 className="text-sm font-semibold">Tool calls & execution logs</h3>
        <p className="text-xs text-muted">Checkpoint history across this thread; events without run attribution are not assigned to the latest run.</p>
        {snapshot.isPending ? <p role="status">Loading tool activity…</p> : snapshot.isError ? <p role="alert" className="text-sm text-bad">Tool activity unavailable: {messageOf(snapshot.error, 'The thread could not be read.')}</p> : <>
          {snapshot.data?.transcriptsTruncated && <Banner tone="warn" title="Tool history truncated">Older checkpoint events are omitted by the source.</Banner>}
          <ExecutionLogs entries={snapshot.data?.transcripts ?? []} assistantId={thread.assistantId} />
        </>}
      </section>
    </li>
  )
}

function RunRow({ engagementId, run }: { engagementId: string; run: RuntimeRun }): ReactElement {
  const cancelRun = useRuntimeCancel(engagementId)
  const cancel = useMutation({ mutationFn: () => cancelRun(run.threadId, run.runId) })
  const tone = STATUS_TONE[run.rawStatus] ?? 'neutral'
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 pr-3 font-mono text-fg">{run.runId}</td>
      <td className="py-1.5 pr-3 font-mono text-neutral">{run.requestId}</td>
      <td className={cx('py-1.5 pr-3', {
        ok: 'text-ok', bad: 'text-bad', warn: 'text-warn', neutral: 'text-muted',
      }[tone])}><Status kind="gate" value={tone === 'ok' ? 'passed' : tone === 'bad' ? 'failed' : 'pending'} size="sm" label={run.rawStatus} /></td>
      <td className="py-1.5 pr-3 text-muted">{utcMinute(run.createdAt)}</td>
      <td className="py-1.5 pr-3 text-muted">{utcMinute(run.updatedAt)}</td>
      <td className="py-1.5">
        {CANCELLABLE.includes(run.rawStatus) ? (
          <span className="flex flex-col items-start gap-1">
            <Button variant="secondary" icon={Ban} disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              {cancel.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
              Cancel run
            </Button>
            {cancel.isError && <span role="alert" className="text-bad">{messageOf(cancel.error, 'The cancel was refused.')}</span>}
          </span>
        ) : <span className="text-muted">—</span>}
      </td>
    </tr>
  )
}
