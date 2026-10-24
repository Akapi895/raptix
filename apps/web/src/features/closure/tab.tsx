/**
 * Close engagement tab (plan P09, Closure slice), shared by the mock and the
 * real project detail. The checklist, the closure record, the request and the
 * decision come from the closure port. The reopen action and the summary cards come
 * through slots. An engagement that is closed is read-only, and a
 * condition the source cannot read blocks closure rather than passing.
 */
import { useState, type ReactElement, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, Lock, ShieldCheck } from 'lucide-react'
import { go } from '../../router/navigate'
import { useMemberLabels } from '../team'
import { utcMinute, utcMinuteOr } from '../../platform/format'
import { Banner, Button, Card, CardHeader, Check, DescList, Empty, Input, Skeleton, Status } from '../../ui/index'
import { ClosureError, useClosureRead, useClosureWrites } from './query'

export function ClosureTab({ engagementId, summary, extraActions }: { engagementId: string; summary?: ReactNode; extraActions?: ReactNode }): ReactElement {
  const closure = useClosureRead(engagementId)
  const writes = useClosureWrites(engagementId)
  const label = useMemberLabels(engagementId)
  const [reason, setReason] = useState('')
  const [waive, setWaive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const request = useMutation({
    mutationFn: () => writes.request({ reason: reason.trim(), waiverNoFindings: waive }),
    onSuccess: () => { setError(null); setNotice('Closure requested; an independent reviewer must confirm it.'); setReason(''); setWaive(false) },
    onError: (err) => { setNotice(null); setError(err instanceof ClosureError || err instanceof Error ? err.message : 'The closure request was refused.') },
  })
  const decide = useMutation({
    mutationFn: (decision: 'confirmed' | 'rejected' | 'cancelled') => writes.decide(decision, reason.trim()),
    onSuccess: (_record, decision) => {
      setError(null)
      setNotice(decision === 'confirmed' ? 'Engagement closed; it is now read-only.' : decision === 'rejected' ? 'The closure request was rejected.' : 'The closure request was cancelled.')
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
  const row = view.record
  const pending = row?.status === 'requested'
  const items = waive && view.waivedChecklist ? view.waivedChecklist : view.checklist
  const failing = items.filter((i) => !i.ok)
  const busy = request.isPending || decide.isPending

  return (
    <div className="space-y-5">
      {view.readOnly && (
        <Banner tone="ok" icon={Lock} title="This engagement is closed">
          Mutations and execution are refused server-side on every entrypoint; the records below stay available. Closure is not deletion — workspace data is retained.
        </Banner>
      )}
      {error !== null && <p className="text-sm text-bad" role="alert">{error}</p>}
      {notice !== null && <p className="text-sm text-good" role="status">{notice}</p>}

      {summary}

      <Card>
        <CardHeader title="Closure checklist" sub='Read live from the authoritative sources at request time — unavailable sources block closure instead of passing silently' />
        <div className="p-4">
          {row === null && <p className="mb-3 text-sm text-muted">No closure has been requested for this engagement.</p>}
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
                <Status kind="gate" value={i.ok ? 'passed' : i.unknown ? 'pending' : 'failed'} size="sm" label={i.label} />
                <span className="min-w-0 flex-1 text-xs text-muted">{i.detail}</span>
                {!i.ok && i.fix && <Button size="sm" onClick={() => go(i.fix!.page, { id: i.fix!.id, tab: i.fix!.tab })}>Fix</Button>}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {row !== null && (
        <Card>
          <CardHeader title="Closure record" sub="Persisted request and decision history with trusted actors" />
          <div className="p-4">
            <DescList items={[
              { k: 'Status', v: <Status kind="gate" value={row.status === 'closed' ? 'passed' : row.status === 'requested' ? 'pending' : 'failed'} size="sm" label={row.status} /> },
              { k: 'Requested by', v: <span title={row.requestedBy}>{label(row.requestedBy)}</span> },
              { k: 'Reason', v: row.reason },
              { k: 'Decided by', v: row.decidedBy ? <span title={row.decidedBy}>{label(row.decidedBy)}</span> : '—' },
              { k: 'Decided at', v: utcMinuteOr(row.decidedAt) },
              { k: 'Updated', v: utcMinute(row.updatedAt) },
            ]} />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Closure actions" />
        {view.readOnly ? (
          <div className="p-4 text-sm text-muted">{extraActions ?? 'Closed engagements take no new actions here.'}</div>
        ) : (
          <div className="space-y-4 p-4">
            {!pending && view.requestBlockReason && failing.length > 0 && (
              <div className="text-sm"><p className="mb-2 font-medium text-bad">Closure is blocked. Resolve these first:</p><ul className="list-disc pl-5 text-muted">{failing.map((i) => <li key={i.id}>{i.label}</li>)}</ul></div>
            )}
            {!pending && (
              <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) request.mutate() }}>
                <label className="grid gap-1 text-xs text-muted" htmlFor="closure-reason">
                  Reason (audited, required)
                  <Input id="closure-reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this engagement is complete" />
                </label>
                <Button type="submit" variant="primary" icon={CheckCircle2} disabled={busy || !reason.trim() || !view.canRequest || !!view.requestBlockReason} title={view.canRequest ? view.requestBlockReason ?? undefined : view.requestReason ?? undefined}>
                  Request closure
                </Button>
              </form>
            )}
            {!pending && !view.canRequest && view.requestReason && <p className="text-xs text-muted">{view.requestReason}</p>}
            {!pending && view.canRequest && view.requestBlockReason && failing.length === 0 && <p className="text-xs text-muted">{view.requestBlockReason}</p>}
            {!pending && view.waivedChecklist !== null && failing.length > 0 && (
              <Check checked={waive} onChange={setWaive} label="Approved no-findings closure: no confirmed findings; documented in the reason instead of a delivered report" />
            )}
            {pending && (
              <Input aria-label="Decision reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required to reject)" className="max-w-md" />
            )}
            {pending && (
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon={ShieldCheck} disabled={busy || !view.canDecide} title={view.canDecide ? undefined : view.decideReason ?? undefined} onClick={() => decide.mutate('confirmed')}>Confirm (independent)</Button>
                <Button variant="danger" disabled={busy || !view.canDecide} title={view.canDecide ? undefined : view.decideReason ?? undefined} onClick={() => decide.mutate('rejected')}>Reject</Button>
                <Button variant="ghost" disabled={busy} onClick={() => decide.mutate('cancelled')}>Cancel my request</Button>
              </div>
            )}
            {extraActions}
          </div>
        )}
      </Card>
    </div>
  )
}
