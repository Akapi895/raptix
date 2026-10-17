/**
 * Governance tab (plan P09, Governance slice) for the real project detail. The
 * business plan lifecycle, the live preflight and the binding come from the
 * governance port. A plan approval is an independent decision that pins the
 * scope version and expires at an absolute deadline; the server re-checks both
 * at every bind and at every start. Schedules and emergency stops are separate
 * cards on the same port.
 */
import { useState, type ReactElement } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ClipboardCheck, GitCompareArrows, Loader2, ShieldCheck } from 'lucide-react'
import { utcMinuteOr } from '../../real/format'
import { Button, Card, CardHeader, Empty, Select, Skeleton, Status, Textarea } from '../../ui'
import { SchedulesCard } from './schedules'
import { StopsCard } from './stops'
import { messageOf, useExecutionThreads, useGovernancePlans, useGovernancePreflight, useGovernanceWrites, usePlanComparison } from './query'
import type { ExecutionThread, GovernancePlan, PreflightCheck } from './service'

const parseMethods = (value: string): string[] => value.split('\n').map((s) => s.trim()).filter(Boolean)

export function GovernanceTab({ engagementId }: { engagementId: string }): ReactElement {
  const plans = useGovernancePlans(engagementId)
  const threads = useExecutionThreads(engagementId)
  const [bindThreadId, setBindThreadId] = useState('')
  const preflight = useGovernancePreflight(engagementId, bindThreadId === '' ? null : bindThreadId)
  const [reviseTarget, setReviseTarget] = useState<GovernancePlan | null>(null)

  if (plans.isPending) {
    return <Card><CardHeader title="Governance" /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  }
  if (plans.isError || !plans.data) {
    return <Empty icon={ClipboardCheck} title="Governance data is unavailable" action={<Button onClick={() => void plans.refetch()}>Retry</Button>}>
      {messageOf(plans.error, 'The plans read failed.')}
    </Empty>
  }
  const all = plans.data.plans
  const approved = all.filter((p) => p.status === 'approved')
  const executionThreads: ExecutionThread[] = threads.data ?? []

  return (
    <div className="space-y-4">
      <PreflightCard checks={preflight.data?.checks} pending={preflight.isPending} />
      <PlansCard engagementId={engagementId} plans={all} deadlineHours={plans.data.deadlineHours} onRevise={(plan) => setReviseTarget(plan)} />
      {reviseTarget !== null && <ReviseCard engagementId={engagementId} base={reviseTarget} onClose={() => setReviseTarget(null)} />}
      {all.length >= 2 && <CompareCard engagementId={engagementId} plans={all} />}
      <BindCard engagementId={engagementId} approved={approved} threads={executionThreads} threadsError={threads.isError ? messageOf(threads.error, 'Threads could not be loaded.') : null} onThread={setBindThreadId} />
      <SchedulesCard engagementId={engagementId} approved={approved} threads={executionThreads} />
      <StopsCard engagementId={engagementId} />
    </div>
  )
}

function PreflightCard({ checks, pending }: { checks: PreflightCheck[] | undefined; pending: boolean }): ReactElement {
  return (
    <Card>
      <CardHeader title="Preflight" sub="Live readiness: project handoff, approved ROE + window, targets, emergency contact, active stops" />
      <div className="grid gap-2 p-4 sm:grid-cols-2">
        {pending || checks === undefined
          ? <Skeleton className="h-12 sm:col-span-2" />
          : checks.map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-sm">
              <Status kind="gate" value={c.state === 'pass' ? 'passed' : c.state === 'fail' ? 'failed' : 'pending'} size="sm" label={c.id} />
              <span className={c.state === 'fail' ? 'text-bad' : 'text-muted'}>{c.detail ?? (c.state === 'pass' ? 'OK' : c.state)}</span>
            </div>
          ))}
      </div>
    </Card>
  )
}

/** The business plans table with its lifecycle actions, and the draft form for a new plan. */
function PlansCard({ engagementId, plans, deadlineHours, onRevise }: { engagementId: string; plans: GovernancePlan[]; deadlineHours: number; onRevise: (plan: GovernancePlan) => void }): ReactElement {
  const writes = useGovernanceWrites(engagementId)
  const [objective, setObjective] = useState('')
  const [methods, setMethods] = useState('')
  const [error, setError] = useState<string | null>(null)
  const draft = useMutation({
    mutationFn: () => writes.draftPlan({ objective, methods: parseMethods(methods) }),
    onSuccess: () => { setObjective(''); setMethods(''); setError(null) },
    onError: (err) => setError(messageOf(err, 'The draft was refused.')),
  })
  const propose = useMutation({
    mutationFn: (planId: string) => writes.proposePlan(planId),
    onSuccess: () => setError(null),
    onError: (err) => setError(messageOf(err, 'The proposal was refused.')),
  })
  // The decision carries the version the reviewer actually read (CAS).
  const decide = useMutation({
    mutationFn: (input: { planId: string; decision: 'approved' | 'rejected'; expectedVersion: number }) => writes.decidePlan(input.planId, input.decision, input.expectedVersion),
    onSuccess: () => setError(null),
    onError: (err) => setError(messageOf(err, 'The decision was refused.')),
  })

  return (
    <Card>
      <CardHeader title="Business plans" sub={`One authoritative plan; approvals pin the scope version and expire in ${deadlineHours}h`} />
      <div className="p-4">
        {plans.length === 0 ? (
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
              {plans.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="py-2 pr-3 font-mono">v{p.version}</td>
                  <td className="py-2 pr-3"><Status kind="gate" value={p.status === 'approved' ? 'passed' : p.status === 'proposed' || p.status === 'draft' ? 'pending' : 'failed'} size="sm" label={p.status} /></td>
                  <td className="py-2 pr-3">{p.objective}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{p.roeVersion === null ? '—' : `v${p.roeVersion}`}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-muted">{p.expiresAt === null ? '—' : utcMinuteOr(p.expiresAt)}</td>
                  <td className="py-2">
                    {p.status === 'draft' ? <Button onClick={() => propose.mutate(p.id)}>Propose</Button>
                      : p.status === 'proposed' ? (
                        <span className="flex gap-2">
                          <Button variant="primary" onClick={() => decide.mutate({ planId: p.id, decision: 'approved', expectedVersion: p.version })}>Approve</Button>
                          <Button variant="secondary" onClick={() => decide.mutate({ planId: p.id, decision: 'rejected', expectedVersion: p.version })}>Reject</Button>
                        </span>
                      ) : p.status === 'approved' ? (
                        <Button variant="secondary" icon={GitCompareArrows} onClick={() => onRevise(p)}>Revise</Button>
                      ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); draft.mutate() }}>
          <label className="text-sm text-muted" htmlFor="plan-objective">Objective</label>
          <Textarea id="plan-objective" required value={objective} onChange={(e) => setObjective(e.target.value)} />
          <label className="text-sm text-muted" htmlFor="plan-methods">Methods (one per line)</label>
          <Textarea id="plan-methods" value={methods} onChange={(e) => setMethods(e.target.value)} placeholder={'web\ninternal'} />
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" disabled={draft.isPending}>
              {draft.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              Draft plan
            </Button>
          </div>
        </form>
        {error !== null && <p className="mt-3 text-sm text-bad" role="alert">{error}</p>}
      </div>
    </Card>
  )
}

/** A revision draft copied from an approved plan; the reviewed version stays approved and unchanged. */
function ReviseCard({ engagementId, base, onClose }: { engagementId: string; base: GovernancePlan; onClose: () => void }): ReactElement {
  const writes = useGovernanceWrites(engagementId)
  const [objective, setObjective] = useState(base.objective)
  const [methods, setMethods] = useState(base.methods.join('\n'))
  const [error, setError] = useState<string | null>(null)
  const revise = useMutation({
    mutationFn: () => writes.revisePlan(base.id, { objective, methods: parseMethods(methods) }),
    onSuccess: () => onClose(),
    onError: (err) => setError(messageOf(err, 'The revision was refused; the reviewed version is unchanged.')),
  })
  return (
    <Card>
      <CardHeader title={`Revise plan v${base.version}`} sub="The reviewed version stays approved and unchanged; the revision is a new draft for independent re-review" />
      <form className="grid gap-3 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); revise.mutate() }}>
        <label className="text-sm text-muted" htmlFor="revision-objective">Revised objective (base: “{base.objective.slice(0, 80)}{base.objective.length > 80 ? '…' : ''}”)</label>
        <Textarea id="revision-objective" required value={objective} onChange={(e) => setObjective(e.target.value)} />
        <label className="text-sm text-muted" htmlFor="revision-methods">Revised methods — copied from the base; edit as needed (one per line)</label>
        <Textarea id="revision-methods" value={methods} onChange={(e) => setMethods(e.target.value)} />
        <div className="sm:col-span-2 flex gap-2">
          <Button type="submit" variant="primary" disabled={revise.isPending}>
            {revise.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            Create revision draft
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
        {error !== null && <p className="sm:col-span-2 text-sm text-bad" role="alert">{error}</p>}
      </form>
    </Card>
  )
}

/** Persisted comparison of two plan versions: the side-by-side read decides nothing; the review does. */
function CompareCard({ engagementId, plans }: { engagementId: string; plans: GovernancePlan[] }): ReactElement {
  const [baseId, setBaseId] = useState('')
  const [revisionId, setRevisionId] = useState('')
  return (
    <Card>
      <CardHeader title="Compare plan versions" sub="Side-by-side read of two persisted versions; the review decides, never the diff" />
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <label className="text-sm text-muted" htmlFor="compare-base">Base version
          <Select id="compare-base" aria-label="Base plan version" value={baseId} onChange={(e) => setBaseId(e.target.value)}>
            <option value="">Select…</option>
            {plans.map((p) => <option key={p.id} value={p.id}>v{p.version} ({p.status})</option>)}
          </Select>
        </label>
        <label className="text-sm text-muted" htmlFor="compare-revision">Revision
          <Select id="compare-revision" aria-label="Revision plan version" value={revisionId} onChange={(e) => setRevisionId(e.target.value)}>
            <option value="">Select…</option>
            {plans.map((p) => <option key={p.id} value={p.id}>v{p.version} ({p.status})</option>)}
          </Select>
        </label>
      </div>
      {baseId !== '' && revisionId !== '' && <PlanComparison engagementId={engagementId} planId={revisionId} baseId={baseId} />}
    </Card>
  )
}

function PlanComparison({ engagementId, planId, baseId }: { engagementId: string; planId: string; baseId: string }): ReactElement {
  const comparison = usePlanComparison(engagementId, planId, baseId)
  if (comparison.isPending) return <div className="px-4 pb-4" aria-busy="true" role="status"><Skeleton className="h-16" /></div>
  if (comparison.isError || !comparison.data) {
    return <p className="px-4 pb-4 text-sm text-bad" role="alert">{messageOf(comparison.error, 'The comparison failed.')}</p>
  }
  const { base, revision } = comparison.data
  const rows: Array<{ label: string; base: string; revision: string }> = [
    { label: 'Status', base: base.status, revision: revision.status },
    { label: 'Objective', base: base.objective || '—', revision: revision.objective || '—' },
    { label: 'Methods', base: base.methods.length === 0 ? '—' : base.methods.join(', '), revision: revision.methods.length === 0 ? '—' : revision.methods.join(', ') },
    { label: 'Pinned ROE', base: base.roeVersion === null ? '—' : `v${base.roeVersion}`, revision: revision.roeVersion === null ? '—' : `v${revision.roeVersion}` },
    { label: 'Decided by', base: base.decidedBy ?? '—', revision: revision.decidedBy ?? '—' },
    { label: 'Expires', base: base.expiresAt === null ? '—' : utcMinuteOr(base.expiresAt), revision: revision.expiresAt === null ? '—' : utcMinuteOr(revision.expiresAt) },
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

/** Binds an approved plan to an execution thread; the server re-runs preflight, the deadline and the scope pin. */
function BindCard({ engagementId, approved, threads, threadsError, onThread }: { engagementId: string; approved: GovernancePlan[]; threads: ExecutionThread[]; threadsError: string | null; onThread: (threadId: string) => void }): ReactElement {
  const writes = useGovernanceWrites(engagementId)
  const [planId, setPlanId] = useState('')
  const [threadId, setThreadId] = useState('')
  const [bound, setBound] = useState<{ id: string; planVersion: number; threadId: string; status: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bind = useMutation({
    mutationFn: () => writes.bindPlan(planId, threadId),
    onSuccess: (view) => {
      setBound({ id: view.id, planVersion: view.planVersion, threadId: view.threadId ?? threadId, status: view.status })
      setPlanId('')
      setThreadId('')
      setError(null)
      onThread('')
    },
    onError: (err) => { setBound(null); setError(messageOf(err, 'The binding was refused by preflight or plan gates.')) },
  })
  return (
    <Card>
      <CardHeader title="Bind an approved plan to an execution thread" sub="The binding re-runs preflight, the absolute 24h approval deadline and the scope pin on the server; execution rechecks it at every submit/resume" />
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <label className="text-sm text-muted" htmlFor="bind-plan">Approved plan
          <Select id="bind-plan" aria-label="Approved plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">Select…</option>
            {approved.map((p) => <option key={p.id} value={p.id}>v{p.version} — {p.objective.slice(0, 60)}</option>)}
          </Select>
        </label>
        <label className="text-sm text-muted" htmlFor="bind-thread">Execution thread
          <Select id="bind-thread" aria-label="Execution thread" value={threadId} onChange={(e) => { setThreadId(e.target.value); onThread(e.target.value) }}>
            <option value="">Select…</option>
            {threads.map((t) => <option key={t.threadId} value={t.threadId}>{t.threadId}</option>)}
          </Select>
        </label>
        <div className="sm:col-span-2">
          <Button variant="primary" icon={ShieldCheck} disabled={bind.isPending || planId === '' || threadId === ''} onClick={() => bind.mutate()}>
            {bind.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            Bind operation
          </Button>
        </div>
        {bound !== null && (
          <p className="sm:col-span-2 text-xs text-muted" role="status">
            Bound <span className="font-mono">{bound.id}</span> — plan v{bound.planVersion} ↔ thread <span className="font-mono">{bound.threadId}</span> ({bound.status}).
          </p>
        )}
        {threadsError !== null && <p className="sm:col-span-2 text-sm text-bad" role="alert">{threadsError}</p>}
        {error !== null && <p className="sm:col-span-2 text-sm text-bad" role="alert">{error}</p>}
      </div>
    </Card>
  )
}
