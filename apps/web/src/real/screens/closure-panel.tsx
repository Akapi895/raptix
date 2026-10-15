/**
 * Real closure panel (integration ticket 17). The checklist is the server's
 * read of the authoritative operation/stop, C2 session, finding, report and
 * approval state — unknown sources block as unavailable. The request requires
 * a passing checklist; the confirming transition rechecks it atomically, and
 * closed engagements are read-only by enforcement at every mutation and
 * execution entrypoint, not merely in this UI.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { CheckCircle2, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { decideClosure, fetchClosure, requestClosure } from '../api'
import { Banner, Button, Card, CardHeader, DescList, Empty, Input, Skeleton, Status } from '../../ui'
import { utcMinute, utcMinuteOr } from '../format'

const CHECK_LABEL: Record<string, string> = {
  runtime: 'Runtime requests settled',
  estop: 'No unresolved emergency stops',
  c2: 'No live C2 session grants',
  findings: 'No findings left in review',
  reports: 'All reports delivered',
  approvals: 'No pending approvals',
  'scope-reviews': 'No pending scope reviews',
  'plan-reviews': 'No pending plan reviews',
  'grant-reviews': 'No pending grant reviews',
  'provider-sessions': 'Provider sessions disconnected',
  'runtime-questions': 'Runtime runs and questions settled',
}

export function RealClosurePanel({ engagementId }: { engagementId: string }): ReactElement {
  const client = useQueryClient()
  const closure = useQuery({ queryKey: ['real', 'closure', engagementId], queryFn: () => fetchClosure(engagementId) })
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const invalidate = (): void => { void client.invalidateQueries({ queryKey: ['real', 'closure', engagementId] }) }

  const request = useMutation({
    mutationFn: () => requestClosure(engagementId, reason),
    onSuccess: () => { setError(null); setNotice('Closure requested; an independent reviewer must confirm it.'); setReason(''); invalidate() },
    onError: (err) => { setNotice(null); setError(err instanceof Error ? err.message : 'The closure request was refused.') },
  })
  const decide = useMutation({
    mutationFn: (decision: 'confirmed' | 'rejected' | 'cancelled') => decideClosure(engagementId, decision),
    onSuccess: (_data, decision) => {
      setError(null)
      setNotice(decision === 'confirmed' ? 'Engagement closed; it is now read-only.' : decision === 'rejected' ? 'The closure request was rejected.' : 'The closure request was cancelled.')
      invalidate()
    },
    onError: (err) => { setNotice(null); setError(err instanceof Error ? err.message : 'The closure decision was refused.') },
  })

  if (closure.isPending) return <Card><CardHeader title="Close engagement" /><div className="p-4"><Skeleton className="h-32" /></div></Card>
  if (closure.isError || !closure.data) {
    return <Empty icon={Lock} title="The closure surface is unavailable" action={<Button onClick={() => void closure.refetch()}>Retry</Button>}>
      {closure.error instanceof Error ? closure.error.message : 'The closure read failed.'}
    </Empty>
  }
  const view = closure.data
  const row = view.closure
  const pending = row?.status === 'requested'
  const isClosed = view.readOnly

  return (
    <div className="space-y-4">
      {isClosed && (
        <Banner tone="ok" icon={Lock} title="This engagement is closed">
          Mutations and execution are refused server-side on every entrypoint; the records below stay available. Closure is not deletion — workspace data is retained.
        </Banner>
      )}
      {error !== null && <p className="text-sm text-bad" role="alert">{error}</p>}
      {notice !== null && <p className="text-sm text-good" role="status">{notice}</p>}

      <Card>
        <CardHeader title="Closure checklist" sub="Read live from the authoritative sources at request time — unavailable sources block closure instead of passing silently" />
        <div className="p-4">
          {row === null && (
            <p className="text-sm text-muted">No closure has been requested for this engagement.</p>
          )}
            <ul className="space-y-2">
              {view.checklist.entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
                  <Status kind="gate" value={e.state === 'pass' ? 'passed' : e.state === 'fail' ? 'failed' : 'pending'} size="sm" label={CHECK_LABEL[e.id] ?? e.id} />
                  <span className="min-w-0 flex-1 text-xs text-muted">{e.detail ?? (e.state === 'pass' ? 'settled' : 'unknown state')}</span>
                </li>
              ))}
            </ul>
        </div>
      </Card>

      {row !== null && (
        <Card>
          <CardHeader title="Closure record" sub="Persisted request and decision history with trusted actors" />
          <div className="p-4">
            <DescList
              items={[
                { k: 'Status', v: <Status kind="gate" value={row.status === 'closed' ? 'passed' : row.status === 'requested' ? 'pending' : 'failed'} size="sm" label={row.status} /> },
                { k: 'Requested by', v: <span className="font-mono">{row.requestedBy}</span> },
                { k: 'Reason', v: row.reason },
                { k: 'Decided by', v: row.decidedBy ? <span className="font-mono">{row.decidedBy}</span> : '—' },
                { k: 'Decided at', v: utcMinuteOr(row.decidedAt) },
                { k: 'Updated', v: utcMinute(row.updatedAt) },
              ]}
            />
          </div>
        </Card>
      )}

      {!isClosed && (
        <Card>
          <CardHeader title={pending ? 'Pending closure request' : 'Request closure'} sub={pending ? 'An independent reviewer-or-above must confirm or reject; the checklist is rechecked at the final transition' : 'The request is refused while any checklist item is not settled'} />
          <form
            className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto]"
            onSubmit={(e) => { e.preventDefault(); if (reason.trim()) request.mutate() }}
          >
            <label className="grid gap-1 text-xs text-muted" htmlFor="closure-reason">
              Reason (audited, required)
              <Input id="closure-reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this engagement is complete" />
            </label>
            <Button type="submit" variant="primary" icon={CheckCircle2} disabled={request.isPending || !reason.trim() || pending}>
              {request.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              Request closure
            </Button>
          </form>
          {pending && (
            <div className="flex flex-wrap gap-2 border-t border-line p-4">
              <Button variant="primary" icon={ShieldCheck} disabled={decide.isPending} onClick={() => decide.mutate('confirmed')}>Confirm (independent)</Button>
              <Button variant="danger" disabled={decide.isPending} onClick={() => decide.mutate('rejected')}>Reject</Button>
              <Button variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate('cancelled')}>Cancel my request</Button>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
