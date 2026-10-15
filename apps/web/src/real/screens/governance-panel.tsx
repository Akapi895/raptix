/**
 * Real governance panel (integration ticket 09): business plan lifecycle with
 * four-eyes decisions and the absolute 24h deadline, the live preflight
 * checklist and truthful emergency stops. OPPLAN (planning artifact) and tool
 * HITL decisions remain distinct records — this surface only manages the
 * persisted business plan approval.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { ClipboardCheck, GitCompareArrows, Loader2, OctagonX, ShieldCheck } from 'lucide-react'
import { bindPlan, comparePlans, decidePlan, fetchPlans, fetchPreflight, listThreads, proposePlan, requestEmergencyStop, revisePlan, savePlan, type PlanView } from '../api'
import { utcMinuteOr } from '../format'
import { Button, Card, CardHeader, Empty, Input, Select, Skeleton, Status, Textarea } from '../../ui'

export function RealGovernancePanel({ engagementId }: { engagementId: string }): ReactElement {
  const client = useQueryClient()
  const plans = useQuery({ queryKey: ['real', 'plans', engagementId], queryFn: () => fetchPlans(engagementId) })
  const preflight = useQuery({ queryKey: ['real', 'preflight', engagementId], queryFn: () => fetchPreflight(engagementId), refetchInterval: 30_000 })
  const [objective, setObjective] = useState('')
  const [stopReason, setStopReason] = useState('')
  /** planId being revised (approved plans only); its revision body is drafted below the table. */
  const [reviseTarget, setReviseTarget] = useState<PlanView | null>(null)
  const [revisionObjective, setRevisionObjective] = useState('')
  const [compareBase, setCompareBase] = useState('')
  const [compareRevision, setCompareRevision] = useState('')
  const [bindPlanId, setBindPlanId] = useState('')
  const [bindThreadId, setBindThreadId] = useState('')
  const [binding, setBinding] = useState<{ id: string; planVersion: number; threadId: string; status: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: ['real', 'plans', engagementId] })
    void client.invalidateQueries({ queryKey: ['real', 'preflight', engagementId] })
  }

  const draft = useMutation({
    mutationFn: () => savePlan(engagementId, { objective, methods: [] }),
    onSuccess: () => { setObjective(''); setError(null); invalidate() },
    onError: (err) => setError(err instanceof Error ? err.message : 'The draft was refused.'),
  })
  const propose = useMutation({
    mutationFn: (planId: string) => proposePlan(engagementId, planId),
    onSuccess: () => { setError(null); invalidate() },
    onError: (err) => setError(err instanceof Error ? err.message : 'The proposal was refused.'),
  })
  const decide = useMutation({
    mutationFn: (input: { planId: string; decision: 'approved' | 'rejected' }) => decidePlan(engagementId, input.planId, input.decision),
    onSuccess: () => { setError(null); invalidate() },
    onError: (err) => setError(err instanceof Error ? err.message : 'The decision was refused.'),
  })
  const revise = useMutation({
    mutationFn: () => revisePlan(engagementId, reviseTarget!.id, { objective: revisionObjective, methods: [] }),
    onSuccess: () => { setReviseTarget(null); setRevisionObjective(''); setError(null); invalidate() },
    onError: (err) => setError(err instanceof Error ? err.message : 'The revision was refused; the reviewed version is unchanged.'),
  })
  const estop = useMutation({
    mutationFn: () => requestEmergencyStop(engagementId, { scope: 'project', reason: stopReason }),
    onSuccess: () => { setStopReason(''); setError(null); invalidate() },
    onError: (err) => setError(err instanceof Error ? err.message : 'The emergency stop was refused.'),
  })
  const bind = useMutation({
    mutationFn: () => bindPlan(engagementId, bindPlanId, bindThreadId),
    onSuccess: (view) => { setBinding({ id: view.id, planVersion: view.planVersion, threadId: view.threadId ?? bindThreadId, status: view.status }); setBindPlanId(''); setBindThreadId(''); setError(null); invalidate() },
    onError: (err) => { setBinding(null); setError(err instanceof Error ? err.message : 'The binding was refused by preflight or plan gates.') },
  })
  const threads = useQuery({ queryKey: ['real', 'threads', engagementId], queryFn: () => listThreads(engagementId) })
  const executionThreads = (threads.data?.threads ?? []).filter((t) => t.kind === 'execution')

  if (plans.isPending || preflight.isPending) {
    return <Card><CardHeader title="Governance" /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  }
  if (plans.isError || !plans.data) {
    return <Empty icon={ClipboardCheck} title="Governance data is unavailable" action={<Button onClick={() => void plans.refetch()}>Retry</Button>}>
      {plans.error instanceof Error ? plans.error.message : 'The plans read failed.'}
    </Empty>
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Preflight" sub="Live readiness: project handoff, approved ROE + window, targets, emergency contact, active stops" />
        <div className="grid gap-2 p-4 sm:grid-cols-2">
          {preflight.data === undefined
            ? null
            : preflight.data.checks.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-sm">
                <Status kind="gate" value={c.state === 'pass' ? 'passed' : c.state === 'fail' ? 'failed' : 'pending'} size="sm" label={c.id} />
                <span className={c.state === 'fail' ? 'text-bad' : 'text-muted'}>{c.detail ?? (c.state === 'pass' ? 'OK' : c.state)}</span>
              </div>
            ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Business plans" sub={`One authoritative plan; approvals pin the scope version and expire in ${plans.data.deadlineHours}h`} />
        <div className="p-4">
          {plans.data.plans.length === 0 ? (
            <p className="text-sm text-muted">No business plan yet. Draft one below, propose it against the approved scope, then an independent reviewer decides.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2">Version</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Objective</th>
                  <th className="pb-2">Pinned ROE</th>
                  <th className="pb-2">Expires</th>
                  <th className="pb-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {plans.data.plans.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="py-2 pr-3 font-mono">v{p.version}</td>
                    <td className="py-2 pr-3"><Status kind="gate" value={p.status === 'approved' ? 'passed' : p.status === 'proposed' || p.status === 'draft' ? 'pending' : 'failed'} size="sm" label={p.status} /></td>
                    <td className="py-2 pr-3">{p.objective}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{p.roeVersion === null ? '—' : `v${p.roeVersion}`}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-muted">{utcMinuteOr(p.expiresAt)}</td>
                    <td className="py-2">
                      {p.status === 'draft' ? <Button onClick={() => propose.mutate(p.id)}>Propose</Button>
                        : p.status === 'proposed' ? (
                          <span className="flex gap-2">
                            <Button variant="primary" onClick={() => decide.mutate({ planId: p.id, decision: 'approved' })}>Approve</Button>
                            <Button variant="secondary" onClick={() => decide.mutate({ planId: p.id, decision: 'rejected' })}>Reject</Button>
                          </span>
                        ) : p.status === 'approved' ? (
                          <Button variant="secondary" icon={GitCompareArrows} onClick={() => { setReviseTarget(p); setRevisionObjective('') }}>Revise</Button>
                        ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              draft.mutate()
            }}
          >
            <label className="text-sm text-muted" htmlFor="plan-objective">Objective</label>
            <Textarea id="plan-objective" required value={objective} onChange={(e) => setObjective(e.target.value)} />
            <div className="sm:col-span-2">
              <Button type="submit" variant="primary" disabled={draft.isPending}>
                {draft.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
                Draft plan
              </Button>
            </div>
          </form>
        </div>
      </Card>

      {reviseTarget !== null && (
        <Card>
          <CardHeader title={`Revise plan v${reviseTarget.version}`} sub="The reviewed version stays approved and unchanged; the revision is a new draft for independent re-review" />
          <form
            className="grid gap-3 p-4 sm:grid-cols-2"
            onSubmit={(e) => { e.preventDefault(); revise.mutate() }}
          >
            <label className="text-sm text-muted" htmlFor="revision-objective">Revised objective (base: “{reviseTarget.objective.slice(0, 80)}{reviseTarget.objective.length > 80 ? '…' : ''}”)</label>
            <Textarea id="revision-objective" required value={revisionObjective} onChange={(e) => setRevisionObjective(e.target.value)} />
            <div className="sm:col-span-2 flex gap-2">
              <Button type="submit" variant="primary" disabled={revise.isPending}>
                {revise.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
                Create revision draft
              </Button>
              <Button type="button" variant="secondary" onClick={() => setReviseTarget(null)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {plans.data.plans.length >= 2 && (
        <Card>
          <CardHeader title="Compare plan versions" sub="Side-by-side read of two persisted versions; the review decides, never the diff" />
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <label className="text-sm text-muted" htmlFor="compare-base">Base version
              <Select id="compare-base" aria-label="Base plan version" value={compareBase} onChange={(e) => setCompareBase(e.target.value)}>
                <option value="">Select…</option>
                {plans.data.plans.map((p) => <option key={p.id} value={p.id}>v{p.version} ({p.status})</option>)}
              </Select>
            </label>
            <label className="text-sm text-muted" htmlFor="compare-revision">Revision
              <Select id="compare-revision" aria-label="Revision plan version" value={compareRevision} onChange={(e) => setCompareRevision(e.target.value)}>
                <option value="">Select…</option>
                {plans.data.plans.map((p) => <option key={p.id} value={p.id}>v{p.version} ({p.status})</option>)}
              </Select>
            </label>
          </div>
          {compareBase !== '' && compareRevision !== '' && <PlanComparison engagementId={engagementId} planId={compareRevision} baseId={compareBase} />}
        </Card>
      )}

      <Card>
        <CardHeader title="Bind an approved plan to an execution thread" sub="The binding re-runs preflight, the absolute 24h approval deadline and the scope pin on the server; execution rechecks it at every submit/resume" />
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <label className="text-sm text-muted" htmlFor="bind-plan">Approved plan
            <Select id="bind-plan" aria-label="Approved plan" value={bindPlanId} onChange={(e) => setBindPlanId(e.target.value)}>
              <option value="">Select…</option>
              {plans.data.plans.filter((p) => p.status === 'approved').map((p) => <option key={p.id} value={p.id}>v{p.version} — {p.objective.slice(0, 60)}</option>)}
            </Select>
          </label>
          <label className="text-sm text-muted" htmlFor="bind-thread">Execution thread
            <Select id="bind-thread" aria-label="Execution thread" value={bindThreadId} onChange={(e) => setBindThreadId(e.target.value)}>
              <option value="">Select…</option>
              {executionThreads.map((t) => <option key={t.threadId} value={t.threadId}>{t.threadId}</option>)}
            </Select>
          </label>
          <div className="sm:col-span-2">
            <Button variant="primary" icon={ShieldCheck} disabled={bind.isPending || bindPlanId === '' || bindThreadId === ''} onClick={() => bind.mutate()}>
              {bind.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              Bind operation
            </Button>
          </div>
          {binding !== null && (
            <p className="sm:col-span-2 text-xs text-muted" role="status">
              Bound <span className="font-mono">{binding.id}</span> — plan v{binding.planVersion} ↔ thread <span className="font-mono">{binding.threadId}</span> ({binding.status}).
            </p>
          )}
          {threads.isError && <p className="sm:col-span-2 text-sm text-bad" role="alert">{threads.error instanceof Error ? threads.error.message : 'Threads could not be loaded.'}</p>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Emergency stop" sub="Project-scope stop; outcomes are truthful and work never auto-resumes" />
        <form
          className="grid gap-3 p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            estop.mutate()
          }}
        >
          <label className="text-sm text-muted" htmlFor="estop-reason">Reason</label>
          <Input id="estop-reason" required value={stopReason} onChange={(e) => setStopReason(e.target.value)} />
          <div className="sm:col-span-2">
            <Button type="submit" variant="danger" icon={OctagonX} disabled={estop.isPending}>Emergency stop (project)</Button>
          </div>
        </form>
      </Card>

      {error !== null && <p className="text-sm text-bad" role="alert">{error}</p>}
    </div>
  )
}

/** Persisted plan comparison — both sides come from the server, never local edits. */
function PlanComparison({ engagementId, planId, baseId }: { engagementId: string; planId: string; baseId: string }): ReactElement {
  const comparison = useQuery({
    queryKey: ['real', 'plan-compare', engagementId, planId, baseId],
    queryFn: () => comparePlans(engagementId, planId, baseId),
    retry: false,
  })
  if (comparison.isPending) return <div className="px-4 pb-4" aria-busy="true" role="status"><Skeleton className="h-16" /></div>
  if (comparison.isError || !comparison.data) {
    return <p className="px-4 pb-4 text-sm text-bad" role="alert">{comparison.error instanceof Error ? comparison.error.message : 'The comparison failed.'}</p>
  }
  const { base, revision } = comparison.data
  const rows: Array<{ label: string; base: string; revision: string }> = [
    { label: 'Status', base: base.status, revision: revision.status },
    { label: 'Objective', base: base.objective || '—', revision: revision.objective || '—' },
    { label: 'Pinned ROE', base: base.roeVersion === null ? '—' : `v${base.roeVersion}`, revision: revision.roeVersion === null ? '—' : `v${revision.roeVersion}` },
    { label: 'Decided by', base: base.decidedBy ?? '—', revision: revision.decidedBy ?? '—' },
    { label: 'Expires', base: utcMinuteOr(base.expiresAt), revision: utcMinuteOr(revision.expiresAt) },
  ]
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted">
          <th className="pb-2" /><th className="pb-2">Base</th><th className="pb-2">Revision</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-t border-line">
            <td className="py-2 pr-3 text-xs text-muted">{row.label}</td>
            <td className="py-2 pr-3 text-xs">{row.base}</td>
            <td className="py-2 text-xs">{row.revision}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
