/**
 * One execution thread's runs and its tool activity (plan P12, Operations slice; lifecycle P11).
 * Every status is the runtime's own word: an unknown word is never shown as
 * success. Cancel appears for a run the runtime still reports in flight; pause
 * for a running run of an operation that can pause; resume and complete follow
 * the operation state the runtime reports.
 */
import { useRef, useState, type ReactElement } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Ban, CheckCheck, Loader2, Pause, Play } from 'lucide-react'
import { utcMinute } from '../../platform/format'
import { ExecutionLogs } from '../../real/screens/execution-logs'
import { Banner, Button, Skeleton, Status, cx } from '../../ui/index'
import { messageOf, useRuntimeCancel, useRuntimeOperation, useRuntimeOperationControls, useRuntimeRuns, useRuntimeSnapshot } from './runtime-query'
import type { RuntimeRun, RuntimeThread } from './runtime'
import { runStatusTone } from './runtime-status'

/** Runs a user may cancel: the ones the runtime still reports as in flight. */
const CANCELLABLE = ['pending', 'running', 'submitting']
/** Runs the runtime can pause at a safe point. */
const PAUSABLE = ['pending', 'running']
/** The run statuses the server accepts as terminal before an operation can be marked complete. */
const TERMINAL_RUN = ['success', 'error', 'timeout', 'interrupted']
/** Operation states the runtime reports; an unknown one is shown as written. */
const OPERATION_TEXT: Record<string, string> = {
  bound: 'bound, not started',
  running: 'running',
  pause_requested: 'pause requested, not yet paused',
  paused: 'paused at a checkpoint',
  completed: 'completed',
}

export function ThreadRuns({ engagementId, thread }: { engagementId: string; thread: RuntimeThread }): ReactElement {
  const snapshot = useRuntimeSnapshot(engagementId, thread.threadId)
  const runs = useRuntimeRuns(engagementId, thread.threadId)
  const operation = useRuntimeOperation(engagementId, thread.threadId)
  const controls = useRuntimeOperationControls(engagementId)
  const list = runs.data ?? []
  const state = operation.data?.state ?? null
  const finished = operation.data?.latestRunStatus != null && TERMINAL_RUN.includes(operation.data.latestRunStatus)

  // The request id is the idempotency key of a resume: a lost answer retries with the same id, so the runtime replays one run.
  const resumeRequest = useRef<string | null>(null)
  const resume = useMutation({
    mutationFn: () => {
      if (resumeRequest.current === null) resumeRequest.current = crypto.randomUUID()
      return controls.resume(thread.threadId, resumeRequest.current)
    },
    onSuccess: () => { resumeRequest.current = null },
  })
  const complete = useMutation({ mutationFn: () => controls.complete(thread.threadId) })

  return (
    <li className="rounded-xl border border-line bg-subtle p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-medium text-fg">{thread.threadId}</span>
        <span className="text-xs text-muted">assistant {thread.assistantId}</span>
        <span className="text-xs text-neutral">bound {utcMinute(thread.createdAt)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-neutral">Operation</span>
        {operation.isError ? <span role="alert" className="text-bad">{messageOf(operation.error, 'The operation state could not be read.')}</span>
          : <span className="text-fg">{state === null ? 'reading…' : (OPERATION_TEXT[state] ?? state)}</span>}
        {state === 'paused' && (
          <Button size="sm" variant="primary" icon={Play} disabled={resume.isPending} onClick={() => resume.mutate()}>
            {resume.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
            Resume operation
          </Button>
        )}
        {state !== null && state !== 'completed' && finished && (
          <Button size="sm" variant="secondary" icon={CheckCheck} disabled={complete.isPending} onClick={() => complete.mutate()}>
            Mark operation complete
          </Button>
        )}
        {resume.isError && <span role="alert" className="text-bad">{messageOf(resume.error, 'The resume was refused.')}</span>}
        {complete.isError && <span role="alert" className="text-bad">{messageOf(complete.error, 'The completion was refused.')}</span>}
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
              {list.map((r) => <RunRow key={r.runId} engagementId={engagementId} run={r} canPause={state === 'bound' || state === 'running'} />)}
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

function RunRow({ engagementId, run, canPause }: { engagementId: string; run: RuntimeRun; canPause: boolean }): ReactElement {
  const cancelRun = useRuntimeCancel(engagementId)
  // The runtime accepts a stop before it ends the run. The row says "requested" from the accepted answer, and it names
  // the end only from the run's own status once that leaves the in-flight set, never from the request itself.
  const [stopRequested, setStopRequested] = useState(false)
  const cancel = useMutation({ mutationFn: () => cancelRun(run.threadId, run.runId), onSuccess: () => setStopRequested(true) })
  const controls = useRuntimeOperationControls(engagementId)
  const pause = useMutation({ mutationFn: () => controls.pause(run.threadId, run.runId) })
  const tone = runStatusTone(run.rawStatus)
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
            <Button variant="secondary" icon={Ban} disabled={cancel.isPending || stopRequested} onClick={() => cancel.mutate()}>
              {cancel.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
              {stopRequested ? 'Stop requested' : 'Cancel run'}
            </Button>
            {stopRequested && <span role="status" className="text-warn">The runtime accepted the stop; it has not yet confirmed that the run ended.</span>}
            {canPause && PAUSABLE.includes(run.rawStatus) && (
              <Button variant="secondary" icon={Pause} disabled={pause.isPending} onClick={() => pause.mutate()}>
                {pause.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
                Pause run
              </Button>
            )}
            {cancel.isError && <span role="alert" className="text-bad">{messageOf(cancel.error, 'The cancel was refused.')}</span>}
            {pause.isError && <span role="alert" className="text-bad">{messageOf(pause.error, 'The pause was refused.')}</span>}
          </span>
        ) : stopRequested ? (
          <span role="status" className="text-ok">Run ended after the stop request; the runtime reports {run.rawStatus}.</span>
        ) : <span className="text-muted">—</span>}
      </td>
    </tr>
  )
}
