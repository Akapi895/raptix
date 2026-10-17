/**
 * Scope and ROE panel (plan P09, Scope slice). Submits scope revisions
 * (operator), records independent review decisions (reviewer) and shows the
 * authoritative version invalidation contract: submitting a revision supersedes
 * the previously approved one immediately. ROE edits are timezone-true (ISO
 * instants with explicit offsets) and unedited fields are carried forward from
 * the approved revision, never silently reset. Reads and writes go through the
 * scope port; the requester and decider are shown by member label.
 */
import { useMutation } from '@tanstack/react-query'
import { useEffect, useState, type ReactElement } from 'react'
import { FileDiff, Loader2 } from 'lucide-react'
import { zonedToIso } from '../../real/format'
import { useSession } from '../../real/session'
import { useMemberLabels } from '../../real/member-labels'
import { Button, Card, CardHeader, Empty, Input, Select, Skeleton, Status, Textarea } from '../../ui'
import { useScopeRead, useScopeWrites } from './query'

const STATUS_LABEL: Record<string, string> = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  superseded: 'superseded',
}

const TIME_ZONES = ['UTC', 'Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles']

export function ScopePanel({ engagementId }: { engagementId: string }): ReactElement {
  const read = useScopeRead()
  const writes = useScopeWrites()
  const actorId = useSession().session?.actor?.id ?? null
  const memberLabel = useMemberLabels(engagementId)
  const [added, setAdded] = useState('')
  const [removed, setRemoved] = useState('')
  const [rationale, setRationale] = useState('')
  const [windowStart, setWindowStart] = useState('')
  const [windowEnd, setWindowEnd] = useState('')
  const [timeZone, setTimeZone] = useState('UTC')
  const [contacts, setContacts] = useState('')
  const [restrictions, setRestrictions] = useState('')
  const [error, setError] = useState<string | null>(null)

  // An unedited field carries the approved value forward, never reset to empty.
  // The baseline refreshes only when a new approval exists.
  const approved = read.data?.revisions.find((r) => r.status === 'approved') ?? null
  useEffect(() => {
    setContacts(approved === null ? '' : (approved.roe.emergencyContacts ?? []).join(', '))
    setRestrictions(approved === null ? '' : (approved.roe.restrictions ?? []).join('\n'))
  }, [approved?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- re-baseline on a new approval only

  const submit = useMutation({
    mutationFn: () => {
      let windows: { start: string; end: string; tz: string }[] = approved?.roe.windows ?? []
      if (windowStart !== '' && windowEnd !== '') {
        windows = [{ start: zonedToIso(windowStart, timeZone), end: zonedToIso(windowEnd, timeZone), tz: timeZone }]
      }
      return writes.submit({
        diff: {
          added: added.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
          removed: removed.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
          rationale,
        },
        roe: {
          windows,
          emergencyContacts: contacts.split(',').map((s) => s.trim()).filter(Boolean),
          restrictions: restrictions.split('\n').map((s) => s.trim()).filter(Boolean),
        },
      })
    },
    onSuccess: () => {
      setAdded('')
      setRemoved('')
      setRationale('')
      setWindowStart('')
      setWindowEnd('')
      setError(null)
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The revision was refused.'),
  })
  const decide = useMutation({
    mutationFn: (input: { revisionId: string; decision: 'approved' | 'rejected' }) => writes.decide(input.revisionId, input.decision),
    onSuccess: () => setError(null),
    onError: (err) => setError(err instanceof Error ? err.message : 'The decision was refused.'),
  })

  if (read.isPending) {
    return <Card><CardHeader title="Scope & ROE" /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  }
  if (read.isError || !read.data) {
    return <Empty icon={FileDiff} title="Scope data is unavailable" action={<Button onClick={() => void read.refetch()}>Retry</Button>}>
      {read.error instanceof Error ? read.error.message : 'The revisions read failed.'}
    </Empty>
  }
  const view = read.data
  const effective = view.effective

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Effective scope (runtime bridge)" sub={`Authoritative approved version: ${effective.version === null ? 'none yet' : `v${effective.version}`} — what the runtime consumes through the read bridge (ADR-0072)`} />
        <div className="p-4 text-sm">
          <p className="text-muted">
            Root target (always in scope): <span className="font-mono">{effective.rootTarget ?? '—'}</span>
            {' · '}Approved in-scope targets: <span className="font-mono">{effective.inScope.length === 0 ? 'none yet' : effective.inScope.join(', ')}</span>
          </p>
          {effective.roe.restrictions.length > 0 && (
            <p className="mt-2 text-muted">Restrictions: {effective.roe.restrictions.join(' · ')}</p>
          )}
        </div>
      </Card>

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
                    <td className="py-2 pr-3 text-xs text-muted">
                      {r.diff.rationale}
                      <details className="mt-1">
                        <summary className="cursor-pointer">diff + ROE</summary>
                        <div className="mt-1 space-y-1">
                          <p>Added: {r.diff.added.length === 0 ? '—' : r.diff.added.join(', ')}</p>
                          <p>Removed: {r.diff.removed.length === 0 ? 'none' : r.diff.removed.join(', ')}</p>
                          <p>Windows: {r.roe.windows.length === 0 ? 'none (always allowed)' : r.roe.windows.map((w) => `${w.start} → ${w.end} (${w.tz})`).join(' · ')}</p>
                          <p>Contacts: {r.roe.emergencyContacts.length === 0 ? 'none' : r.roe.emergencyContacts.join(', ')}</p>
                          <p>Restrictions: {r.roe.restrictions.length === 0 ? 'none' : r.roe.restrictions.join(' · ')}</p>
                        </div>
                      </details>
                    </td>
                    <td className="py-2 pr-3 text-xs" title={r.requestedBy}>{memberLabel(r.requestedBy)}</td>
                    <td className="py-2 text-xs">
                      {r.status === 'pending' && r.requestedBy !== actorId ? (
                        <span className="flex gap-2">
                          <Button variant="primary" onClick={() => decide.mutate({ revisionId: r.id, decision: 'approved' })}>Approve</Button>
                          <Button variant="secondary" onClick={() => decide.mutate({ revisionId: r.id, decision: 'rejected' })}>Reject</Button>
                        </span>
                      ) : r.status === 'pending' ? (
                        <span className="text-muted" title="The requester cannot decide their own revision">Awaiting an independent reviewer</span>
                      ) : (
                        <span className="text-muted">{r.decidedBy === null ? '—' : memberLabel(r.decidedBy)}{r.decisionComment !== null ? `: ${r.decisionComment}` : ''}</span>
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
        <CardHeader title="Submit a revision" sub="New targets stay pending until a reviewer approves the revision; removals narrow the effective scope on approval" />
        <form
          className="grid gap-3 p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (added.trim() === '' && removed.trim() === '') {
              setError('A scope revision needs at least one added or removed identifier.')
              return
            }
            if ((windowStart === '') !== (windowEnd === '')) {
              setError('A ROE window needs both start and end (leave both empty to carry the approved windows forward).')
              return
            }
            if ((windowStart !== '' || windowEnd !== '') && Date.parse(`${windowEnd}:00Z`) <= Date.parse(`${windowStart}:00Z`)) {
              setError('The ROE window end must be after its start.')
              return
            }
            submit.mutate()
          }}
        >
          <label className="text-sm text-muted" htmlFor="scope-added">Added targets (one per line)</label>
          <Textarea id="scope-added" value={added} onChange={(e) => setAdded(e.target.value)} placeholder={'10.0.0.5\nweb.example.invalid'} />
          <label className="text-sm text-muted" htmlFor="scope-removed">Removed targets (one per line; the engagement target cannot be removed)</label>
          <Textarea id="scope-removed" value={removed} onChange={(e) => setRemoved(e.target.value)} placeholder="Identifiers of approved in-scope assets" />
          <label className="text-sm text-muted" htmlFor="scope-rationale">Rationale</label>
          <Input id="scope-rationale" required value={rationale} onChange={(e) => setRationale(e.target.value)} />
          <label className="text-sm text-muted" htmlFor="scope-start">ROE window start (entered in the selected timezone; leave empty to keep the approved windows)</label>
          <Input id="scope-start" type="datetime-local" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
          <label className="text-sm text-muted" htmlFor="scope-end">ROE window end (same timezone as the start)</label>
          <Input id="scope-end" type="datetime-local" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
          <label className="text-sm text-muted" htmlFor="scope-tz">Window timezone (submitted as absolute ISO instants, never a mislabeled UTC)</label>
          <Select id="scope-tz" aria-label="Window timezone" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
            {TIME_ZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </Select>
          <label className="text-sm text-muted" htmlFor="scope-contacts">Emergency contacts (comma-separated; carried from the approved ROE when unchanged)</label>
          <Input id="scope-contacts" value={contacts} onChange={(e) => setContacts(e.target.value)} placeholder="blue-team@example.invalid" />
          <label className="text-sm text-muted" htmlFor="scope-restrictions">Restrictions (one per line; carried from the approved ROE when unchanged)</label>
          <Textarea id="scope-restrictions" value={restrictions} onChange={(e) => setRestrictions(e.target.value)} placeholder="No destructive actions outside the window" />
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
