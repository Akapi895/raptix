/**
 * Trace and results for one execution thread of the engagement (real mode, plan P12).
 * Tool activity is the runtime's checkpoint history and run outcomes are its run list;
 * both show the runtime's own status words and never map an unknown word to success.
 */
import { useState, type ReactElement } from 'react'
import { Activity } from 'lucide-react'
import { go, useRoute } from '../../router/navigate'
import { utcMinute } from '../../real/format'
import { ExecutionLogs } from '../../real/screens/execution-logs'
import { useProjectStore } from '../../state/stores'
import { Banner, Button, Card, CardHeader, Empty, Select, Skeleton } from '../../ui'
import { messageOf, useRuntimeRuns, useRuntimeSnapshot, useRuntimeThreads } from './runtime-query'
import type { RuntimeThread } from './runtime'

export function RealTrace(): ReactElement {
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  if (pid === 'all') {
    return <Empty icon={Activity} title="Choose a project">Trace and results belong to one engagement. Select a project first.</Empty>
  }
  return <TraceForProject engagementId={pid} preferredThreadId={route.id ?? null} />
}

function TraceForProject({ engagementId, preferredThreadId }: { engagementId: string; preferredThreadId: string | null }): ReactElement {
  const threads = useRuntimeThreads(engagementId)
  const [picked, setPicked] = useState<string | null>(null)
  if (threads.isPending) {
    return <Card><CardHeader title="Trace and results" /><div className="space-y-2 p-4" aria-busy="true" role="status"><Skeleton className="h-10" /><Skeleton className="h-10" /></div></Card>
  }
  if (threads.isError) {
    return <Banner tone="warn" title="Threads source unavailable">{messageOf(threads.error, 'Threads could not be loaded.')} No substitute trace is shown.</Banner>
  }
  const list = threads.data ?? []
  // A thread id from the URL wins when this engagement owns it; otherwise the first execution thread is shown.
  const selected = list.find((t) => t.threadId === (picked ?? preferredThreadId)) ?? list[0]
  if (selected === undefined) {
    return <Empty icon={Activity} title="No execution thread yet">Trace and results appear after an execution thread runs. Create one in the AI workspace after confirming the planning handoff.</Empty>
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Trace and results"
          sub="Tool activity and run outcomes for one execution thread, shown as the runtime reports them."
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label="Execution thread" value={selected.threadId} onChange={(e) => setPicked(e.target.value)} className="w-64">
                {list.map((t) => <option key={t.threadId} value={t.threadId}>{t.threadId} · {t.assistantId}</option>)}
              </Select>
              <Button size="sm" variant="secondary" onClick={() => go('operation', { id: selected.threadId })}>Open operation</Button>
            </div>
          )}
        />
      </Card>
      <RunResults engagementId={engagementId} thread={selected} />
      <ToolTrace engagementId={engagementId} thread={selected} />
    </div>
  )
}

function RunResults({ engagementId, thread }: { engagementId: string; thread: RuntimeThread }): ReactElement {
  const runs = useRuntimeRuns(engagementId, thread.threadId)
  return (
    <Card>
      <CardHeader title="Results" sub="Runs of this thread with the runtime's status words." />
      <div className="p-4">
        {runs.isPending ? <p role="status" className="text-sm text-muted">Loading runs…</p>
          : runs.isError ? <p role="alert" className="text-sm text-bad">Runs unavailable: {messageOf(runs.error, 'The runs could not be loaded.')}</p>
          : (runs.data ?? []).length === 0 ? <p className="text-sm text-muted">No run has started on this thread.</p>
          : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="py-2 font-medium">Run</th><th className="py-2 font-medium">Status</th><th className="py-2 font-medium">Updated</th></tr></thead>
              <tbody>
                {(runs.data ?? []).map((run) => (
                  <tr key={run.runId} className="border-t border-line">
                    <td className="py-2 font-mono text-xs">{run.runId}</td>
                    <td className="py-2">{run.rawStatus}</td>
                    <td className="py-2 text-muted">{utcMinute(run.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </Card>
  )
}

function ToolTrace({ engagementId, thread }: { engagementId: string; thread: RuntimeThread }): ReactElement {
  const snapshot = useRuntimeSnapshot(engagementId, thread.threadId)
  return (
    <Card>
      <CardHeader title="Tool trace" sub="Checkpoint history across this thread. Events without run attribution stay thread-level." />
      <div className="space-y-3 p-4">
        {snapshot.isPending ? <p role="status" className="text-sm text-muted">Loading tool trace…</p>
          : snapshot.isError ? <p role="alert" className="text-sm text-bad">Tool trace unavailable: {messageOf(snapshot.error, 'The thread could not be read.')}</p>
          : (
            <>
              {snapshot.data?.transcriptsTruncated && <Banner tone="warn" title="Trace truncated">Older checkpoint events are omitted by the source.</Banner>}
              <ExecutionLogs entries={snapshot.data?.transcripts ?? []} assistantId={thread.assistantId} />
            </>
          )}
      </div>
    </Card>
  )
}
