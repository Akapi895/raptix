/**
 * Tool trace for one execution thread of the engagement (real mode, plan P12): the runtime's checkpoint history,
 * shown with its own words. Run outcomes are on the operation page (results-panel).
 */
import { useState, type ReactElement } from 'react'
import { Activity } from 'lucide-react'
import { go, useRoute } from '../../router/navigate'
import { ExecutionLogs } from '../../real/screens/execution-logs'
import { useProjectStore } from '../../state/stores'
import { Banner, Button, Card, CardHeader, Empty, Select, Skeleton } from '../../ui/index'
import { messageOf, useRuntimeSnapshot, useRuntimeThreads } from './runtime-query'
import type { RuntimeThread } from './runtime'

export function RealTrace(): ReactElement {
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  if (pid === 'all') {
    return <Empty icon={Activity} title="Choose a project">Tool trace belongs to one engagement. Select a project first.</Empty>
  }
  return <TraceForProject engagementId={pid} preferredThreadId={route.id ?? null} />
}

function TraceForProject({ engagementId, preferredThreadId }: { engagementId: string; preferredThreadId: string | null }): ReactElement {
  const threads = useRuntimeThreads(engagementId)
  const [picked, setPicked] = useState<string | null>(null)
  if (threads.isPending) {
    return <Card><CardHeader title="Trace" /><div className="space-y-2 p-4" aria-busy="true" role="status"><Skeleton className="h-10" /><Skeleton className="h-10" /></div></Card>
  }
  if (threads.isError) {
    return <Banner tone="warn" title="Threads source unavailable">{messageOf(threads.error, 'Threads could not be loaded.')} No substitute trace is shown.</Banner>
  }
  const list = threads.data ?? []
  // A thread id from the URL wins when this engagement owns it; otherwise the first execution thread is shown.
  const selected = list.find((t) => t.threadId === (picked ?? preferredThreadId)) ?? list[0]
  if (selected === undefined) {
    return <Empty icon={Activity} title="No execution thread yet">Tool trace appears after an execution thread runs. Create one in the AI workspace after confirming the planning handoff.</Empty>
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Trace"
          sub="Checkpoint tool activity of one execution thread, shown as the runtime reports it. Outcomes are on the operation page."
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
      <ToolTrace engagementId={engagementId} thread={selected} />
    </div>
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
