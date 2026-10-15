/**
 * Real agent fleet/fanout panel (integration ticket 13). Three identities
 * stay distinct: assistant graph catalog IDs (not endpoint health), bound
 * runtime threads and checkpoint-provenance subagent branches. Missing
 * runtime data renders as unknown — no heartbeat is fabricated. Branch-level
 * retry/reassign/cancel and allocation have no runtime action contract and
 * are surfaced as recorded exclusions (D1/D2); run-level cancel reuses the
 * ticket 05 cancel API.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Bot, Loader2 } from 'lucide-react'
import type { ReactElement } from 'react'
import { fetchFleet, cancelRun } from '../api'
import { go, useRoute } from '../../router/navigate'
import { Banner, Button, Card, CardHeader, Empty, Skeleton, Status } from '../../ui'
import { utcMinuteOr } from '../format'

const STATE_LABEL: Record<string, string> = { running: 'running', ended: 'ended', unknown: 'unknown' }

/** W24: an ended branch is only "passed" when its outcome is not failed/cancelled. */
function branchStatusValue(branch: { state: 'running' | 'ended' | 'unknown'; outcome: string | null }): 'passed' | 'failed' | 'pending' {
  if (branch.state !== 'ended') return 'pending'
  if (branch.outcome === 'failed') return 'failed'
  if (branch.outcome === 'cancelled' || branch.outcome === 'canceled') return 'pending'
  return 'passed'
}

export function RealFleetPanel({ engagementId }: { engagementId: string }): ReactElement {
  const client = useQueryClient()
  const route = useRoute()
  const fleet = useQuery({
    queryKey: ['real', 'fleet', engagementId],
    queryFn: () => fetchFleet(engagementId),
    // W13 read-only v1: live read only — the panel re-reads the runtime on an
    // interval; every mutation surface stays a recorded exclusion.
    refetchInterval: 15_000,
  })
  const cancel = useMutation({
    mutationFn: (input: { threadId: string; runId: string }) => cancelRun(engagementId, input.threadId, input.runId),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['real', 'fleet', engagementId] }),
  })
  const cancelError = cancel.error instanceof Error ? cancel.error.message : null

  if (fleet.isPending) {
    return <Card><CardHeader title="Agent fleet" /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  }
  if (fleet.isError || !fleet.data) {
    return <Empty icon={Bot} title="Fleet data is unavailable" action={<Button onClick={() => void fleet.refetch()}>Retry</Button>}>
      {fleet.error instanceof Error ? fleet.error.message : 'The fleet read failed.'}
    </Empty>
  }
  const view = fleet.data

  // W22: the agent and branch detail routes consume the resource id from the
  // URL. Unknown or foreign ids render an explicit not-found, never the fleet.
  if (route.page === 'agent' && route.id) {
    const agent = view.agents.find((a) => a.graphId === route.id)
    return agent === undefined ? (
      <Empty icon={Bot} title="Assistant graph not found" action={<Button onClick={() => go('agents', { engagementId })}>Open the fleet</Button>}>
        No assistant graph <span className="font-mono">{route.id}</span> exists in this deployment catalog.
      </Empty>
    ) : (
      <Card>
        <CardHeader title={`Assistant graph ${agent.graphId}`} sub={`Source: ${view.sources.agents} — catalog identity only; no endpoint health or heartbeat exists at this layer`} />
        <dl className="grid gap-2 p-4 text-sm sm:grid-cols-2">
          <dt className="text-muted">Graph id</dt><dd className="font-mono text-xs">{agent.graphId}</dd>
        </dl>
      </Card>
    )
  }
  if (route.page === 'ai-branch' && route.id) {
    const branch = view.branches.find((b) => b.key === route.id || `${b.threadId}::${b.key}` === route.id)
    return branch === undefined ? (
      <Empty icon={Bot} title="Branch not found" action={<Button onClick={() => go('agents', { engagementId })}>Open the fleet</Button>}>
        No subagent branch <span className="font-mono">{route.id}</span> is recorded in this engagement's checkpoint transcripts.
      </Empty>
    ) : (
      <Card>
        <CardHeader title={`Branch ${branch.key}`} sub={`Thread ${branch.threadId} — observed start/end pairing from durable checkpoint transcripts`} />
        <dl className="grid gap-2 p-4 text-sm sm:grid-cols-2">
          <dt className="text-muted">Agent</dt><dd className="font-mono text-xs">{branch.agent}</dd>
          <dt className="text-muted">State</dt><dd><Status kind="gate" value={branchStatusValue(branch)} size="sm" label={STATE_LABEL[branch.state] ?? branch.state} /></dd>
          <dt className="text-muted">Outcome</dt><dd className="text-xs">{branch.outcome ?? '—'}</dd>
          <dt className="text-muted">Started</dt><dd className="font-mono text-xs">{utcMinuteOr(branch.startedAt)}</dd>
          <dt className="text-muted">Ended</dt><dd className="font-mono text-xs">{utcMinuteOr(branch.endedAt)}</dd>
        </dl>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Assistant graph catalog" sub={`Source: ${view.sources.agents} — catalog identity only; no endpoint health or heartbeat exists at this layer`} />
        <div className="p-4">
          {view.agents.length === 0 ? (
            <p className="text-sm text-muted">No assistant graphs are configured for this deployment.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {view.agents.map((a) => (
                <li key={a.graphId} className="rounded-lg border border-line px-3 py-1 font-mono text-xs">{a.graphId}</li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title={`Bound threads (${view.counts.threads}${view.counts.threadsTruncated ? '+, truncated' : ''})`} sub={`Source: ${view.sources.threads} — raw runtime thread status; ${view.counts.activeRuns} active run(s)`} />
        <div className="p-4">
          {view.threads.length === 0 ? (
            <p className="text-sm text-muted">No threads are bound to this engagement yet. Start one from Operations.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2">Thread</th>
                  <th className="pb-2">Kind</th>
                  <th className="pb-2">Assistant</th>
                  <th className="pb-2">Runtime status</th>
                  <th className="pb-2">Active run</th>
                </tr>
              </thead>
              <tbody>
                {view.threads.map((t) => (
                  <tr key={t.threadId} className="border-t border-line">
                    <td className="py-2 pr-3 font-mono text-xs">{t.threadId}</td>
                    <td className="py-2 pr-3 text-xs">{t.kind ?? '—'}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{t.assistantId ?? '—'}</td>
                    <td className="py-2 pr-3"><Status kind="gate" value={t.rawStatus === 'busy' ? 'pending' : t.rawStatus === 'error' ? 'failed' : t.rawStatus === null ? 'pending' : 'passed'} size="sm" label={t.rawStatus ?? 'unknown'} /></td>
                    <td className="py-2 text-xs">
                      {t.activeRunId !== null ? (
                        <span className="flex items-center gap-2">
                          <span className="font-mono">{t.activeRunId}</span>
                          <Button variant="secondary" icon={Ban} disabled={cancel.isPending} onClick={() => cancel.mutate({ threadId: t.threadId, runId: t.activeRunId! })}>
                            {cancel.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title={`Subagent branches (${view.counts.branches}; ${view.counts.runningBranches} running)`} sub={`Source: ${view.sources.branches} — observed start/end pairing from durable checkpoint transcripts`} />
        <div className="p-4">
          {view.branches.length === 0 ? (
            <p className="text-sm text-muted">No subagent invocations recorded in the checkpoint transcripts yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2">Thread</th>
                  <th className="pb-2">Agent</th>
                  <th className="pb-2">State</th>
                  <th className="pb-2">Outcome</th>
                  <th className="pb-2">Started</th>
                  <th className="pb-2">Ended</th>
                </tr>
              </thead>
              <tbody>
                {view.branches.map((b) => (
                  <tr key={`${b.threadId}::${b.key}`} className="border-t border-line">
                    <td className="py-2 pr-3 font-mono text-xs">{b.threadId}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{b.agent}</td>
                    <td className="py-2 pr-3"><Status kind="gate" value={branchStatusValue(b)} size="sm" label={STATE_LABEL[b.state] ?? b.state} /></td>
                    <td className="py-2 pr-3 text-xs">{b.outcome ?? '—'}</td>
                    <td className="py-2 pr-3 text-xs">{utcMinuteOr(b.startedAt)}</td>
                    <td className="py-2 text-xs">{utcMinuteOr(b.endedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Banner tone="warn" title="Branch-level controls are excluded by decision (D1/D2)">
        The runtime exposes run-level cancel only. Branch retry, reassign, branch cancel and agent allocation/grouping have no runtime action contract, so they render as unavailable instead of fabricated controls. Available: {view.excludedActions.join(', ')}.
      </Banner>

      {cancelError !== null && <p className="text-sm text-bad" role="alert">{cancelError}</p>}
    </div>
  )
}
