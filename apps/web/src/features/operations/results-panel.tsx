/** Results of one execution thread (real mode, plan P12): the runtime's run and branch outcomes and the findings that cite the thread. */
import type { ReactElement } from 'react'
import type { CuratedFindingView } from '@raptix/web-contracts'
import { go } from '../../router/navigate'
import { utcMinute } from '../../platform/format'
import { Banner, Button, Card, CardHeader, cx } from '../../ui/index'
import { runStatusTone, type StatusTone } from './runtime-status'
import { messageOf, useRuntimeFleet, useRuntimeRuns } from './runtime-query'
import { summariseThreadResults } from './results-model'
import { useCuratedFindings } from './results-query'
import type { RuntimeFleetBranch, RuntimeRun, RuntimeThread } from './runtime'

export function ThreadResults({ engagementId, thread }: { engagementId: string; thread: RuntimeThread }): ReactElement {
  const runs = useRuntimeRuns(engagementId, thread.threadId)
  const fleet = useRuntimeFleet(engagementId)
  const curated = useCuratedFindings(engagementId)

  const loading = runs.isPending || fleet.isPending || curated.isPending
  const failure = runs.isError ? messageOf(runs.error, 'Runs could not be loaded.')
    : fleet.isError ? messageOf(fleet.error, 'Branch outcomes could not be loaded.')
    : curated.isError ? messageOf(curated.error, 'Findings could not be loaded.')
    : null

  return (
    <Card>
      <CardHeader title="Results" sub="Outcomes as the runtime reports them. A failed step is not automatically a finding." />
      <div className="space-y-4 p-4">
        {loading ? <p role="status" className="text-sm text-muted">Loading results…</p>
          : failure !== null ? <Banner tone="warn" title="Results unavailable">{failure} No substitute outcome is shown.</Banner>
          : <ResultsBody thread={thread} runs={runs.data ?? []} branches={fleet.data?.branches ?? []} findings={curated.data?.findings ?? []} engagementId={engagementId} />}
      </div>
    </Card>
  )
}

const TONE_TEXT: Record<StatusTone, string> = { ok: 'text-ok', bad: 'text-bad', warn: 'text-warn', neutral: 'text-muted' }

function ResultsBody({ thread, runs, branches, findings, engagementId }: {
  thread: RuntimeThread
  runs: RuntimeRun[]
  branches: RuntimeFleetBranch[]
  findings: CuratedFindingView[]
  engagementId: string
}): ReactElement {
  const results = summariseThreadResults(thread.threadId, runs, branches, findings)
  return (
    <>
      {results.unsuccessfulBranches > 0 && (
        <Banner tone="bad" title={`${results.unsuccessfulBranches} branch${results.unsuccessfulBranches === 1 ? '' : 'es'} ended without a success outcome`}>
          The runtime reported a non-success outcome or none for these branches.
        </Banner>
      )}
      {results.partial && (
        <Banner tone="warn" title="Results are partial">
          {results.inFlightRuns > 0 ? `${results.inFlightRuns} run${results.inFlightRuns === 1 ? ' is' : 's are'} still in flight. ` : ''}
          Some runs stopped early, so the outcome is not final.
        </Banner>
      )}

      <section aria-label="Run outcomes" className="space-y-2">
        <h3 className="text-sm font-semibold">Runs</h3>
        {results.runsByStatus.length === 0 ? <p className="text-sm text-muted">No run has started on this thread.</p> : (
          <ul className="flex flex-wrap gap-2">
            {results.runsByStatus.map(({ status, count }) => (
              <li key={status} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-xs">
                <span className={cx('font-mono', TONE_TEXT[runStatusTone(status)])}>{status}</span>
                <span className="text-muted">×{count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Branch outcomes" className="space-y-2">
        <h3 className="text-sm font-semibold">Branches</h3>
        {results.branches.length === 0 ? <p className="text-sm text-muted">No subagent branch was recorded for this thread.</p> : (
          <ul className="space-y-1 text-sm">
            {results.branches.map((branch) => (
              <li key={branch.key} className="flex flex-wrap items-center gap-2 border-t border-line pt-1">
                <span className="font-mono text-xs">{branch.agent}</span>
                <span className="text-muted">{branch.state}</span>
                <span>{branch.outcome ?? 'no outcome reported'}</span>
                {branch.endedAt !== null && <span className="text-xs text-muted">ended {utcMinute(branch.endedAt)}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Findings from this operation" className="space-y-2">
        <h3 className="text-sm font-semibold">Findings from this operation</h3>
        {results.findings.length === 0 ? (
          <p className="text-sm text-muted">No finding cites this operation yet. Confirm the impact of a result before it becomes a finding.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {results.findings.map((finding) => (
              <li key={finding.id} className="flex flex-wrap items-center gap-2">
                <button type="button" className="text-left text-accent hover:underline" onClick={() => go('finding', { id: finding.id, engagementId })}>{finding.title}</button>
                <span className="text-xs text-muted">{finding.severity} · {finding.status}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={() => go('finding-new', { engagementId })}>Create finding</Button>
          <Button size="sm" variant="secondary" onClick={() => go('evidence', { engagementId })}>Attach evidence</Button>
          <Button size="sm" variant="secondary" onClick={() => go('project', { id: engagementId, tab: 'findings' })}>Open findings</Button>
        </div>
        <p className="text-xs text-muted">AI-proposed findings are not verified. They are reviewed and imported as drafts in the Findings tab, and never count as findings until a person confirms them.</p>
      </section>
    </>
  )
}
