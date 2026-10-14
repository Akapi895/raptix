/**
 * Real governance panel (integration ticket 09): business plan lifecycle with
 * four-eyes decisions and the absolute 24h deadline, the live preflight
 * checklist and truthful emergency stops. OPPLAN (planning artifact) and tool
 * HITL decisions remain distinct records — this surface only manages the
 * persisted business plan approval.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { ClipboardCheck, Loader2, OctagonX } from 'lucide-react'
import { decidePlan, fetchPlans, fetchPreflight, proposePlan, requestEmergencyStop, savePlan } from '../api'
import { Button, Card, CardHeader, Empty, Input, Skeleton, Status, Textarea } from '../../ui'

export function RealGovernancePanel({ engagementId }: { engagementId: string }): ReactElement {
  const client = useQueryClient()
  const plans = useQuery({ queryKey: ['real', 'plans', engagementId], queryFn: () => fetchPlans(engagementId) })
  const preflight = useQuery({ queryKey: ['real', 'preflight', engagementId], queryFn: () => fetchPreflight(engagementId), refetchInterval: 30_000 })
  const [objective, setObjective] = useState('')
  const [stopReason, setStopReason] = useState('')
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
  const estop = useMutation({
    mutationFn: () => requestEmergencyStop(engagementId, { scope: 'project', reason: stopReason }),
    onSuccess: () => { setStopReason(''); setError(null); invalidate() },
    onError: (err) => setError(err instanceof Error ? err.message : 'The emergency stop was refused.'),
  })

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
                    <td className="py-2 pr-3 font-mono text-xs text-muted">{p.expiresAt === null ? '—' : p.expiresAt.replace('T', ' ').slice(0, 16) + 'Z'}</td>
                    <td className="py-2">
                      {p.status === 'draft' ? <Button onClick={() => propose.mutate(p.id)}>Propose</Button>
                        : p.status === 'proposed' ? (
                          <span className="flex gap-2">
                            <Button variant="primary" onClick={() => decide.mutate({ planId: p.id, decision: 'approved' })}>Approve</Button>
                            <Button variant="secondary" onClick={() => decide.mutate({ planId: p.id, decision: 'rejected' })}>Reject</Button>
                          </span>
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
