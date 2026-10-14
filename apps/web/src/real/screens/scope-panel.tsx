/**
 * Real scope/ROE governance panel (integration ticket 08). Submits scope
 * revisions (operator), records independent review decisions (reviewer) and
 * shows the authoritative version invalidation contract: submitting a
 * revision supersedes the previously approved one immediately.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { FileDiff, Loader2 } from 'lucide-react'
import { fetchScopeRevisions, decideScopeRevision, submitScopeRevision } from '../api'
import { Button, Card, CardHeader, Empty, Input, Skeleton, Status, Textarea } from '../../ui'

const STATUS_LABEL: Record<string, string> = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  superseded: 'superseded',
}

export function RealScopePanel({ engagementId }: { engagementId: string }): ReactElement {
  const client = useQueryClient()
  const revisions = useQuery({
    queryKey: ['real', 'scope-revisions', engagementId],
    queryFn: () => fetchScopeRevisions(engagementId),
  })
  const [added, setAdded] = useState('')
  const [rationale, setRationale] = useState('')
  const [windowStart, setWindowStart] = useState('')
  const [windowEnd, setWindowEnd] = useState('')
  const [contacts, setContacts] = useState('')
  const [error, setError] = useState<string | null>(null)

  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: ['real', 'scope-revisions', engagementId] })
    void client.invalidateQueries({ queryKey: ['real', 'asset-inventory', engagementId] })
  }

  const submit = useMutation({
    mutationFn: () => submitScopeRevision(engagementId, {
      diff: { added: added.split(/[\n,]/).map((s) => s.trim()).filter(Boolean), removed: [], rationale },
      roe: {
        windows: windowStart && windowEnd ? [{ start: windowStart, end: windowEnd, tz: 'UTC' }] : [],
        emergencyContacts: contacts.split(',').map((s) => s.trim()).filter(Boolean),
        restrictions: [],
      },
    }),
    onSuccess: () => {
      setAdded('')
      setRationale('')
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The revision was refused.'),
  })
  const decide = useMutation({
    mutationFn: (input: { revisionId: string; decision: 'approved' | 'rejected' }) => decideScopeRevision(engagementId, input.revisionId, input.decision),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The decision was refused.'),
  })

  if (revisions.isPending) {
    return <Card><CardHeader title="Scope & ROE" /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  }
  if (revisions.isError || !revisions.data) {
    return <Empty icon={FileDiff} title="Scope data is unavailable" action={<Button onClick={() => void revisions.refetch()}>Retry</Button>}>
      {revisions.error instanceof Error ? revisions.error.message : 'The revisions read failed.'}
    </Empty>
  }
  const view = revisions.data

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Scope & ROE revisions" sub={`Authoritative approved version: ${view.latestApprovedVersion === null ? 'none yet' : `v${view.latestApprovedVersion}`} — submitting a revision immediately supersedes it`} />
        <div className="p-4">
          {view.revisions.length === 0 ? (
            <p className="text-sm text-muted">No revisions yet. The engagement target is the initial authorized scope.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2">Version</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Change</th>
                  <th className="pb-2">Requested by</th>
                  <th className="pb-2">Decision</th>
                </tr>
              </thead>
              <tbody>
                {view.revisions.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="py-2 pr-3 font-mono">v{r.version}</td>
                    <td className="py-2 pr-3"><Status kind="gate" value={r.status === 'approved' ? 'passed' : r.status === 'pending' ? 'pending' : 'failed'} size="sm" label={STATUS_LABEL[r.status] ?? r.status} /></td>
                    <td className="py-2 pr-3 text-xs text-muted">{r.diff.rationale}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.requestedBy}</td>
                    <td className="py-2 text-xs">
                      {r.status === 'pending' ? (
                        <span className="flex gap-2">
                          <Button variant="primary" onClick={() => decide.mutate({ revisionId: r.id, decision: 'approved' })}>Approve</Button>
                          <Button variant="secondary" onClick={() => decide.mutate({ revisionId: r.id, decision: 'rejected' })}>Reject</Button>
                        </span>
                      ) : (
                        <span className="text-muted">{r.decidedBy ?? '—'}{r.decisionComment !== null ? `: ${r.decisionComment}` : ''}</span>
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
        <CardHeader title="Submit a revision" sub="New targets stay pending until a reviewer approves the revision that adds them" />
        <form
          className="grid gap-3 p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit.mutate()
          }}
        >
          <label className="text-sm text-muted" htmlFor="scope-added">Added targets (one per line)</label>
          <Textarea id="scope-added" value={added} onChange={(e) => setAdded(e.target.value)} placeholder={'10.0.0.5\nweb.example.invalid'} />
          <label className="text-sm text-muted" htmlFor="scope-rationale">Rationale</label>
          <Input id="scope-rationale" required value={rationale} onChange={(e) => setRationale(e.target.value)} />
          <label className="text-sm text-muted" htmlFor="scope-start">ROE window start (ISO-8601)</label>
          <Input id="scope-start" type="datetime-local" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
          <label className="text-sm text-muted" htmlFor="scope-end">ROE window end (ISO-8601)</label>
          <Input id="scope-end" type="datetime-local" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
          <label className="text-sm text-muted" htmlFor="scope-contacts">Emergency contacts (comma-separated)</label>
          <Input id="scope-contacts" value={contacts} onChange={(e) => setContacts(e.target.value)} placeholder="blue-team@example.invalid" />
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" icon={FileDiff} disabled={submit.isPending}>
              {submit.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              Submit revision
            </Button>
          </div>
        </form>
      </Card>

      {error !== null && <p className="text-sm text-bad" role="alert">{error}</p>}
    </div>
  )
}
