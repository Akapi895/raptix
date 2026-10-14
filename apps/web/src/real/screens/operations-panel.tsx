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
import { listRunsOfThread, listThreads } from '../api'
import { fetchTimeline } from '../api'
import { go } from '../../router/navigate'
import { Banner, Button, Card, CardHeader, Skeleton, Status, cx } from '../../ui'

function fmt(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16) + 'Z'
}

const STATUS_TONE: Record<string, 'ok' | 'bad' | 'warn' | 'neutral'> = {
  completed: 'ok', failed: 'bad', cancelled: 'neutral', interrupted: 'warn',
  running: 'warn', pending: 'warn', awaiting_approval: 'warn',
}

export function RealOperationsPanel({ engagementId }: { engagementId: string }): ReactElement {
  const threads = useQuery({ queryKey: ['real', 'threads', engagementId], queryFn: () => listThreads(engagementId) })
  const executionThreads = (threads.data?.threads ?? []).filter((t) => t.kind === 'execution')

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
          <Button variant="secondary" icon={Bot} onClick={() => go('ai-operator', { id: engagementId })}>Open AI workspace</Button>
        </div>
      </Card>

      <TimelineCard engagementId={engagementId} />
    </div>
  )
}

/** Merged operations timeline: runtime/checkpoint/workspace entries keep their source labels. */
function TimelineCard({ engagementId }: { engagementId: string }): ReactElement {
  const timeline = useQuery({ queryKey: ['real', 'timeline', engagementId], queryFn: () => fetchTimeline(engagementId), retry: false })
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
        <span className="text-xs text-neutral">bound {fmt(thread.createdAt)}</span>
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
      <td className="py-1.5 pr-3 text-muted">{fmt(run.createdAt)}</td>
      <td className="py-1.5 text-muted">{fmt(run.updatedAt)}</td>
    </tr>
  )
}
