/**
 * Real C2 session-access panel (integration ticket 12). A connected session
 * is not an authorization: commands dispatch only under a live approved
 * grant with an absolute deadline. Operators request access, reviewers
 * decide independently; expired grants are swept server-side and shown
 * truthfully.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { fetchC2Grants, requestC2Grant, decideC2Grant } from '../api'
import { Button, Card, CardHeader, Empty, Input, Skeleton, Status, Textarea } from '../../ui'

const STATUS_LABEL: Record<string, string> = {
  requested: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  revoked: 'revoked',
  expired: 'expired',
}

export function RealC2Panel({ engagementId }: { engagementId: string }): ReactElement {
  const client = useQueryClient()
  const grants = useQuery({
    queryKey: ['real', 'c2-grants', engagementId],
    queryFn: () => fetchC2Grants(engagementId),
  })
  const [sessionId, setSessionId] = useState('')
  const [reason, setReason] = useState('')
  const [hours, setHours] = useState('4')
  const [error, setError] = useState<string | null>(null)

  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: ['real', 'c2-grants', engagementId] })
  }

  const request = useMutation({
    mutationFn: () => requestC2Grant(engagementId, {
      sessionId: sessionId.trim(),
      reason: reason.trim(),
      expiresAt: new Date(Date.now() + Math.min(24, Math.max(1, Number(hours) || 1)) * 3_600_000).toISOString(),
    }),
    onSuccess: () => {
      setSessionId('')
      setReason('')
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The grant request was refused.'),
  })
  const decide = useMutation({
    mutationFn: (input: { grantId: string; decision: 'approved' | 'rejected' | 'revoked' }) => decideC2Grant(engagementId, input.grantId, input.decision),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The decision was refused.'),
  })

  if (grants.isPending) {
    return <Card><CardHeader title="C2 session access" /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  }
  if (grants.isError || !grants.data) {
    return <Empty icon={KeyRound} title="C2 grants are unavailable" action={<Button onClick={() => void grants.refetch()}>Retry</Button>}>
      {grants.error instanceof Error ? grants.error.message : 'The grants read failed.'}
    </Empty>
  }
  const view = grants.data

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="C2 session grants" sub={`Command dispatch requires a live approved grant per session — absolute deadline, no grace period (max ${view.maxGrantHours}h)`} />
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
                    <td className="py-2 pr-3 text-xs">{g.expiresAt.replace('T', ' ').slice(0, 16) + 'Z'}</td>
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
        <form
          className="grid gap-3 p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            request.mutate()
          }}
        >
          <label className="text-sm text-muted" htmlFor="c2-session">Session id</label>
          <Input id="c2-session" required value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="sess-1" />
          <label className="text-sm text-muted" htmlFor="c2-reason">Reason</label>
          <Textarea id="c2-reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="whoami on web-1 for lateral check" />
          <label className="text-sm text-muted" htmlFor="c2-hours">Duration (hours, 1-24)</label>
          <Input id="c2-hours" type="number" min={1} max={24} value={hours} onChange={(e) => setHours(e.target.value)} />
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
