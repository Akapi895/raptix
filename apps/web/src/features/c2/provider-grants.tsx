/**
 * Session access grants (plan P12, C2 slice). Operators request a grant for a
 * session with a reason and an absolute expiry; a reviewer decides independently.
 * Command dispatch needs a live approved grant, so this card is the gate the
 * console below it depends on. The duration is clamped to the bounds the server
 * enforces, never to a bound the console invents.
 */
import { useState, type ReactElement } from 'react'
import { useMutation } from '@tanstack/react-query'
import { KeyRound, Loader2 } from 'lucide-react'
import { utcMinute } from '../../real/format'
import { Button, Card, CardHeader, Empty, Input, Skeleton, Status, Textarea } from '../../ui'
import { messageOf, useProviderGrants, useProviderWrites } from './provider-query'

const STATUS_LABEL: Record<string, string> = { requested: 'pending', approved: 'approved', rejected: 'rejected', revoked: 'revoked', expired: 'expired' }

export function GrantsCard({ engagementId }: { engagementId: string }): ReactElement {
  const grants = useProviderGrants(engagementId)
  const writes = useProviderWrites(engagementId)
  const [sessionId, setSessionId] = useState('')
  const [reason, setReason] = useState('')
  const [hours, setHours] = useState('4')
  const [error, setError] = useState<string | null>(null)

  // The form clamps to the effective bounds the server reports.
  const bounds = { min: grants.data?.bounds.minHours ?? 1, max: grants.data?.bounds.maxHours ?? 24 }

  const request = useMutation({
    mutationFn: () => writes.requestGrant({
      sessionId: sessionId.trim(),
      reason: reason.trim(),
      expiresAt: new Date(Date.now() + Math.min(bounds.max, Math.max(bounds.min, Number(hours) || bounds.min)) * 3_600_000).toISOString(),
    }),
    onSuccess: () => { setSessionId(''); setReason(''); setError(null) },
    onError: (err) => setError(messageOf(err, 'The grant request was refused.')),
  })
  const decide = useMutation({
    mutationFn: (input: { grantId: string; decision: 'approved' | 'rejected' | 'revoked' }) => writes.decideGrant(input.grantId, input.decision),
    onSuccess: () => setError(null),
    onError: (err) => setError(messageOf(err, 'The decision was refused.')),
  })

  if (grants.isPending) {
    return <Card><CardHeader title="C2 session access" /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  }
  if (grants.isError || !grants.data) {
    return <Empty icon={KeyRound} title="C2 grants are unavailable" action={<Button onClick={() => void grants.refetch()}>Retry</Button>}>
      {messageOf(grants.error, 'The grants read failed.')}
    </Empty>
  }
  const view = grants.data

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="C2 session grants" sub={`Command dispatch requires a live approved grant per session — absolute deadline, no grace period (max ${view.bounds.maxHours}h)`} />
        <div className="p-4">
          {view.grants.length === 0 ? (
            <p className="text-sm text-muted">No grants yet. Request session access below; a reviewer must approve before any command runs.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2">Session</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Reason</th>
                  <th className="pb-2">Requested by</th>
                  <th className="pb-2">Expires</th>
                  <th className="pb-2">Decision</th>
                </tr>
              </thead>
              <tbody>
                {view.grants.map((g) => (
                  <tr key={g.id} className="border-t border-line">
                    <td className="py-2 pr-3 font-mono text-xs">{g.sessionId}</td>
                    <td className="py-2 pr-3"><Status kind="gate" value={g.status === 'approved' ? 'passed' : g.status === 'requested' ? 'pending' : 'failed'} size="sm" label={STATUS_LABEL[g.status] ?? g.status} /></td>
                    <td className="py-2 pr-3 text-xs text-muted">{g.reason}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{g.actorId}</td>
                    <td className="py-2 pr-3 text-xs">{utcMinute(g.expiresAt)}</td>
                    <td className="py-2 text-xs">
                      {g.status === 'requested' ? (
                        <span className="flex gap-2">
                          <Button variant="primary" onClick={() => decide.mutate({ grantId: g.id, decision: 'approved' })}>Approve</Button>
                          <Button variant="secondary" onClick={() => decide.mutate({ grantId: g.id, decision: 'rejected' })}>Reject</Button>
                        </span>
                      ) : g.status === 'approved' ? (
                        <Button variant="secondary" onClick={() => decide.mutate({ grantId: g.id, decision: 'revoked' })}>Revoke</Button>
                      ) : (
                        <span className="text-muted">{g.reviewerId ?? '—'}</span>
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
        <CardHeader title="Request session access" sub="State the session and why; the request records the actor and an absolute expiry for independent review" />
        <form className="grid gap-3 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); request.mutate() }}>
          <label className="text-sm text-muted" htmlFor="c2-session">Session id</label>
          <Input id="c2-session" required value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="sess-1" />
          <label className="text-sm text-muted" htmlFor="c2-reason">Reason</label>
          <Textarea id="c2-reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="whoami on web-1 for lateral check" />
          <label className="text-sm text-muted" htmlFor="c2-hours">Duration (hours, {bounds.min}-{bounds.max})</label>
          <Input id="c2-hours" type="number" min={bounds.min} max={bounds.max} value={hours} onChange={(e) => setHours(e.target.value)} />
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" icon={KeyRound} disabled={request.isPending}>
              {request.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              Request grant
            </Button>
          </div>
        </form>
      </Card>

      {error !== null && <p className="text-sm text-bad" role="alert">{error}</p>}
    </div>
  )
}
