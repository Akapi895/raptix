/**
 * Real operations panel (integration ticket 05): the engagement's owned
 * execution threads and their runtime runs with truthful raw statuses and
 * retained engagement/thread/run/request identities (D2 - no separate
 * persisted business-operation record is invented).
 */
import { type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import type { ScopedRunView, ThreadBindingView } from '@raptix/web-contracts'
import { getThread, listRunsOfThread, listThreads } from '../api'
import { fetchTimeline } from '../api'
import { utcMinute } from '../format'
import { go, useRoute } from '../../router/navigate'
import { Banner, Button, Card, CardHeader, Empty, Skeleton, Status, cx } from '../../ui'
import { ExecutionLogs } from './execution-logs'

const STATUS_TONE: Record<string, 'ok' | 'bad' | 'warn' | 'neutral'> = {
  // W24: the runtime reports success/error/timeout/interrupted; unknown
  // statuses must never be rendered as success.
  success: 'ok', completed: 'ok',
  failed: 'bad', error: 'bad', timeout: 'bad', rejected: 'bad',
  interrupted: 'warn', running: 'warn', pending: 'warn', submitting: 'warn', submitted: 'warn', awaiting_approval: 'warn', uncertain: 'warn',
  cancelled: 'neutral', canceled: 'neutral',
}

export function RealOperationsPanel({ engagementId }: { engagementId: string }): ReactElement {
  const route = useRoute()
  // W22: the operation detail route consumes the thread id from the URL — a
  // foreign or unknown id renders an explicit not-found, never the full list.
  const detailThreadId = route.page === 'operation' && route.id ? route.id : null
  const threads = useQuery({ queryKey: ['real', 'threads', engagementId], queryFn: () => listThreads(engagementId) })
  const executionThreads = (threads.data?.threads ?? []).filter((t) => t.kind === 'execution')

  if (detailThreadId !== null) {
    const selected = executionThreads.find((t) => t.threadId === detailThreadId)
    return (
      <div className="space-y-4">
        {threads.isPending ? <Card><CardHeader title={`Operation ${detailThreadId}`} /><div className="p-4 space-y-2" aria-busy="true" role="status"><Skeleton className="h-10" /><Skeleton className="h-10" /></div></Card>
          : threads.isError ? <Banner tone="warn" title="Threads source unavailable">{threads.error instanceof Error ? threads.error.message : 'Threads could not be loaded.'} No substitute operation view is shown.</Banner>
          : selected === undefined ? (
            <Empty icon={Bot} title="Operation thread not found" action={<Button onClick={() => go('operations', { engagementId })}>Open operations</Button>}>
              No execution thread <span className="font-mono">{detailThreadId}</span> is owned by this engagement. Planning threads and foreign ids are not operation resources.
            </Empty>
          ) : (
            <Card>
              <CardHeader title={`Operation thread ${selected.threadId}`} sub={`Assistant ${selected.assistantId ?? '—'} — bound runtime runs for this thread only`} />
              <div className="p-4"><ThreadRuns thread={selected} /></div>
            </Card>
          )}
        <TimelineCard engagementId={engagementId} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Execution threads" sub="Owned runtime bindings for this engagement. Execution never bypasses the planning handoff." />
        {threads.isPending ? <div className="space-y-2" aria-busy="true" role="status"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
          : threads.isError ? <p className="text-sm text-bad" role="alert">{threads.error instanceof Error ? threads.error.message : 'Threads could not be loaded.'}</p>
          : executionThreads.length === 0 ? (
            <p className="text-sm text-muted">No execution thread yet. Create one in the AI workspace after confirming the planning handoff.</p>
          ) : (
            <ul className="space-y-2">
              {executionThreads.map((t) => <ThreadRuns key={t.threadId} thread={t} />)}
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

/** Merged operations timeline: runtime/checkpoint/workspace entries keep their source labels. */
function TimelineCard({ engagementId }: { engagementId: string }): ReactElement {
  const timeline = useQuery({ queryKey: ['real', 'timeline', engagementId], queryFn: () => fetchTimeline(engagementId), retry: false, refetchInterval: 5_000 })
  return (
    <Card>
      <CardHeader title="Operations timeline" sub="Merged log of runtime run states, checkpoint events and workspace artifact presence. Artifact mtimes are presence markers, not exact execution times." />
      {timeline.isPending ? <div className="space-y-2" aria-busy="true" role="status"><Skeleton className="h-10" /></div>
        : timeline.isError ? (
          <Banner tone="warn" title="Timeline source unavailable">
            {timeline.error instanceof Error ? timeline.error.message : 'The merged timeline is not available right now.'} No substitute events are shown.
          </Banner>
        ) : timeline.data.entries.length === 0 ? (
          <p className="text-sm text-muted">No observed activity recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {timeline.data.truncated && <Banner tone="warn" title="Timeline truncated">The server projection truncated this timeline.</Banner>}
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
          </div>
        )}
    </Card>
  )
}

function ThreadRuns({ thread }: { thread: ThreadBindingView }): ReactElement {
  const snapshot = useQuery({
    queryKey: ['real', 'thread', thread.engagementId, thread.threadId],
    queryFn: () => getThread(thread.engagementId, thread.threadId),
    retry: false,
    refetchInterval: 5_000,
  })
  const runs = useQuery({
    queryKey: ['real', 'runs', thread.engagementId, thread.threadId],
    queryFn: () => listRunsOfThread(thread.engagementId, thread.threadId),
    refetchInterval: (query) => {
      const active = query.state.data?.runs.some((r) => ['pending', 'running', 'submitting'].includes(r.rawStatus))
      return active ? 5_000 : false
    },
  })
  const list = runs.data?.runs ?? []
  return (
    <li className="rounded-xl border border-line bg-subtle p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-medium text-fg">{thread.threadId}</span>
        <span className="text-xs text-muted">assistant {thread.assistantId}</span>
        <span className="text-xs text-neutral">bound {utcMinute(thread.createdAt)}</span>
      </div>
      {runs.isPending ? <div className="mt-2" aria-busy="true" role="status"><Skeleton className="h-8" /></div>
        : runs.isError ? <p className="mt-2 text-sm text-bad" role="alert">{runs.error instanceof Error ? runs.error.message : 'Runs could not be loaded.'}</p>
        : list.length === 0 ? <p className="mt-2 text-sm text-muted">No runs on this thread yet.</p>
        : (
          <table className="mt-2 w-full text-left text-xs">
            <thead>
              <tr className="text-neutral">
                <th className="py-1 pr-3 font-medium">Run</th>
                <th className="py-1 pr-3 font-medium">Request</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 pr-3 font-medium">Created</th>
                <th className="py-1 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => <RunRow key={r.runId} run={r} />)}
            </tbody>
          </table>
      )}
      <section aria-label={`Tool activity ${thread.threadId}`} className="mt-4 space-y-2">
        <h3 className="text-sm font-semibold">Tool calls & execution logs</h3>
        <p className="text-xs text-muted">Checkpoint history across this thread; events without run attribution are not assigned to the latest run.</p>
        {snapshot.isPending ? <p role="status">Loading tool activity…</p> : snapshot.isError ? <p role="alert" className="text-sm text-bad">Tool activity unavailable: {snapshot.error.message}</p> : <>
          {snapshot.data?.transcriptsTruncated && <Banner tone="warn" title="Tool history truncated">Older checkpoint events are omitted by the source.</Banner>}
          <ExecutionLogs entries={snapshot.data?.transcripts ?? []} assistantId={thread.assistantId} />
        </>}
      </section>
    </li>
  )
}

function RunRow({ run }: { run: ScopedRunView }): ReactElement {
  const tone = STATUS_TONE[run.rawStatus] ?? 'neutral'
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 pr-3 font-mono text-fg">{run.runId}</td>
      <td className="py-1.5 pr-3 font-mono text-neutral">{run.requestId}</td>
      <td className={cx('py-1.5 pr-3', {
        ok: 'text-ok', bad: 'text-bad', warn: 'text-warn', neutral: 'text-muted',
      }[tone])}><Status kind="gate" value={tone === 'ok' ? 'passed' : tone === 'bad' ? 'failed' : 'pending'} size="sm" label={run.rawStatus} /></td>
      <td className="py-1.5 pr-3 text-muted">{utcMinute(run.createdAt)}</td>
      <td className="py-1.5 text-muted">{utcMinute(run.updatedAt)}</td>
    </tr>
  )
}
