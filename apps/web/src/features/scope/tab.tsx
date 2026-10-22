/* eslint-disable react-hooks/rules-of-hooks -- the member-label source is keyed on the module-constant DATA_MODE */
/**
 * Scope & ROE tab (plan P09, Scope slice), shared by the mock and the real
 * project detail. It reads and writes through the scope port and the assets
 * port. A scope revision supersedes the approved one only when an independent
 * reviewer approves it. Anything a source cannot model is named as unmodelled,
 * never shown as an empty list.
 */
import { useContext, useState, type ReactElement, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FileDiff, Loader2 } from 'lucide-react'
import { DATA_MODE, isRealMode } from '../../state/mode'
import { zonedToIso } from '../../platform/format'
import { SessionContext } from '../../platform/session'
import { useMemberLabels } from '../team'
import { useMe } from '../../state/console'
import { Banner, Button, Card, CardHeader, Empty, Input, Segmented, Select, Skeleton, Status, Textarea } from '../../ui/index'
import { useAssetList } from '../assets'
import { AssetPreviewModal } from '../assets'
import { useScopeRead, useScopeWrites } from './query'
import type { ScopeRead, ScopeRevision, ScopeRoe } from './service'

type Sub = 'assets' | 'roe' | 'docs' | 'hist'

const TIME_ZONES = ['UTC', 'Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles']

const STATUS_LABEL: Record<ScopeRevision['status'], string> = { pending: 'pending', approved: 'approved', rejected: 'rejected', superseded: 'superseded' }

/** Mock mode shows member ids, which are the names the mock records; real mode resolves member labels from the API. */
function useLabelFor(engagementId: string): (id: string) => string {
  if (DATA_MODE === 'real') return useMemberLabels(engagementId)
  return (id: string) => id
}

/** The actor's id as the approval records carry it: the session's member id in real mode, the persona name in mock mode. */
function useActorId(): string | null {
  const session = useContext(SessionContext)
  const me = useMe()
  return isRealMode() ? session?.session?.actor?.id ?? null : me.name
}

export function ScopeTab({ engagementId, documents }: { engagementId: string; documents?: ReactNode }): ReactElement {
  const read = useScopeRead()
  const writes = useScopeWrites()
  const assets = useAssetList({})
  const actorId = useActorId()
  const memberLabel = useLabelFor(engagementId)
  const [sub, setSub] = useState<Sub>('assets')
  const [assetPreview, setAssetPreview] = useState<string | null>(null)
  const [added, setAdded] = useState('')
  const [removed, setRemoved] = useState('')
  const [rationale, setRationale] = useState('')
  const [windowStart, setWindowStart] = useState('')
  const [windowEnd, setWindowEnd] = useState('')
  const [timeZone, setTimeZone] = useState('UTC')
  const [contacts, setContacts] = useState<string | null>(null)
  const [restrictions, setRestrictions] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = useMutation({
    mutationFn: (data: ScopeRead) => {
      // An unedited ROE field carries the approved value forward, never resets to empty.
      const approved = data.revisions.find((r) => r.status === 'approved') ?? null
      const baseline: ScopeRoe = approved?.roe ?? { windows: [], emergencyContacts: [], restrictions: [] }
      const windows = windowStart !== '' && windowEnd !== ''
        ? [{ start: zonedToIso(windowStart, timeZone), end: zonedToIso(windowEnd, timeZone), tz: timeZone }]
        : baseline.windows
      return writes.submit({
        diff: {
          added: added.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
          removed: removed.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
          rationale,
        },
        roe: data.supports.roeFields
          ? {
            windows,
            emergencyContacts: contacts === null ? baseline.emergencyContacts : contacts.split(',').map((s) => s.trim()).filter(Boolean),
            restrictions: restrictions === null ? baseline.restrictions : restrictions.split('\n').map((s) => s.trim()).filter(Boolean),
          }
          : baseline,
      })
    },
    onSuccess: () => {
      setAdded('')
      setRemoved('')
      setRationale('')
      setWindowStart('')
      setWindowEnd('')
      setContacts(null)
      setRestrictions(null)
      setError(null)
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The revision was refused.'),
  })
  const decide = useMutation({
    mutationFn: (input: { revisionId: string; decision: 'approved' | 'rejected' }) => writes.decide(input.revisionId, input.decision, reason.trim() || undefined),
    onSuccess: () => { setError(null); setReason('') },
    onError: (err) => setError(err instanceof Error ? err.message : 'The decision was refused.'),
  })

  if (read.isPending) return <Card><CardHeader title="Scope & ROE" /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  if (read.isError || !read.data) {
    return <Empty title="Scope data is unavailable" action={<Button onClick={() => void read.refetch()}>Retry</Button>}>
      {read.error instanceof Error ? read.error.message : 'The scope read failed.'}
    </Empty>
  }
  const view = read.data
  const effective = view.effective
  const pending = view.revisions.find((r) => r.status === 'pending') ?? null
  const latestRejected = view.revisions[0]?.status === 'rejected' ? view.revisions[0] : null
  const approvedNames = view.revisions.find((r) => r.status === 'approved')
  const kpis = assets.data?.kpis
  const assetItems = assets.data?.items ?? []
  const unmodelledOps = view.unmodelled.includes('operations') || view.unmodelled.includes('plans')

  return (
    <div className="space-y-4">
      {latestRejected && !pending && <Banner tone="bad" title="Scope / ROE returned for changes">Reason: {latestRejected.decisionComment ?? 'no reason was recorded'}. Submit a revision that addresses it.</Banner>}
      {pending && <Banner tone="warn" title="Awaiting approval of a new scope">v{pending.version} submitted by {memberLabel(pending.requestedBy)}. A reviewer other than the requester decides it.</Banner>}
      {effective.roe.emergencyContacts.length === 0 && <Banner tone="warn" title="Emergency contact is missing">Without an emergency contact the ROE cannot be approved and preflight stays blocked.</Banner>}
      {view.impact && (
        <Banner tone="bad" title={`Scope change: v${pending?.version ?? '—'} needs approval. Re-validation required`}>
          <ul className="list-disc pl-4">
            {view.impact.plans.length > 0 && <li>Plans moved to Re-validation Required: {view.impact.plans.join(', ')}.</li>}
            {view.impact.draftOps.length > 0 && <li>Operations that cannot start until re-validated: {view.impact.draftOps.join(', ')}.</li>}
            {view.impact.running.length > 0 && <li>Running now: {view.impact.running.join(', ')} continues under the last approved version.</li>}
            {view.impact.plans.length + view.impact.draftOps.length + view.impact.running.length === 0 && <li>No existing plans or operations are affected.</li>}
          </ul>
        </Banner>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="inline-flex items-center gap-1.5"><span className="text-muted">Effective version</span><span className="font-mono font-semibold text-fg">{effective.versionLabel ?? 'none yet'}</span>{effective.versionLabel !== null && <Status kind="roe" value="approved" size="sm" label="approved" />}</span>
          {pending && <span className="inline-flex items-center gap-1.5"><span className="text-muted">Proposed</span><span className="font-mono font-semibold text-fg">v{pending.version}</span><Status kind="roe" value="pending" size="sm" label="pending" /></span>}
          <span className="inline-flex items-center gap-1.5"><span className="text-muted">Emergency contact</span>{effective.roe.emergencyContacts.length > 0 ? <span className="text-fg">{effective.roe.emergencyContacts.join(', ')}</span> : <span className="font-medium text-bad">Missing — blocks approval</span>}</span>
          <span className="inline-flex flex-wrap items-center gap-1.5"><span className="text-muted">Assets</span>{kpis ? <span>{kpis.in ?? 0} approved in scope · {kpis.pending ?? 0} pending · {kpis.out ?? 0} out · {kpis.unclassified ?? 0} unclassified</span> : <span className="text-muted">loading</span>}</span>
        </div>
      </Card>

      <Segmented<Sub> value={sub} onChange={setSub} options={[{ id: 'assets', label: `Assets (${assetItems.length})` }, { id: 'roe', label: 'ROE' }, { id: 'docs', label: 'Documents' }, { id: 'hist', label: 'History' }]} />

      {sub === 'assets' && (
        <Card>
          <CardHeader title="Assets" sub="Pending assets are not approved in scope until a reviewer approves a revision that includes them" />
          {assets.isPending ? <Skeleton className="h-24" /> : assetItems.length === 0 ? <p className="p-4 text-sm text-muted">No assets in this engagement yet.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="p-3">Name</th><th className="p-3">Identifier</th><th className="p-3">Scope</th></tr></thead>
              <tbody>{assetItems.map(({ asset }) => <tr key={asset.id} className="border-t border-line"><td className="p-3"><button type="button" className="font-medium text-accent hover:underline" onClick={() => setAssetPreview(asset.id)}>{asset.name}</button></td><td className="p-3 font-mono text-xs">{asset.ident}</td><td className="p-3"><Status kind="scope" value={asset.scope} /></td></tr>)}</tbody>
            </table>
          )}
        </Card>
      )}

      {sub === 'roe' && (
        <>
          <Card>
            <CardHeader title="Effective scope (runtime bridge)" sub={`Authoritative approved version: ${effective.version === null ? 'none yet' : `v${effective.version}`} — what the runtime consumes through the read bridge (ADR-0072)`} />
            <div className="p-4 text-sm">
              <p className="text-muted">Root target (always in scope): <span className="font-mono">{effective.rootTarget ?? '—'}</span> · Approved in-scope targets: <span className="font-mono">{effective.inScope.length === 0 ? 'none yet' : effective.inScope.join(', ')}</span></p>
              <p className="mt-2 text-muted">Testing window: {effective.windowText ?? (effective.roe.windows.length === 0 ? 'none (always allowed)' : 'set')}</p>
              {effective.roe.restrictions.length > 0 && <p className="mt-2 text-muted">Restrictions: {effective.roe.restrictions.join(' · ')}</p>}
              {unmodelledOps && <p className="mt-2 text-xs text-muted">Operations and plans affected by a scope change are not modelled on this backend, so none are listed here.</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Scope & ROE revisions" sub={`Authoritative approved version: ${view.latestApprovedVersion === null ? 'none yet' : `v${view.latestApprovedVersion}`} — submitting a revision immediately supersedes it`} />
            <div className="p-4">
              {view.revisions.length === 0 ? (
                <p className="text-sm text-muted">No revisions yet. The engagement target is the initial authorized scope.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted"><th className="pb-2">Version</th><th className="pb-2">Status</th><th className="pb-2">Change</th><th className="pb-2">Requested by</th><th className="pb-2">Decision</th></tr></thead>
                  <tbody>
                    {view.revisions.map((r) => (
                      <tr key={r.id} className="border-t border-line">
                        <td className="py-2 pr-3 font-mono">v{r.version}</td>
                        <td className="py-2 pr-3"><Status kind="gate" value={r.status === 'approved' ? 'passed' : r.status === 'pending' ? 'pending' : 'failed'} size="sm" label={STATUS_LABEL[r.status]} /></td>
                        <td className="py-2 pr-3 text-xs text-muted">
                          {r.diff.rationale}
                          <details className="mt-1">
                            <summary className="cursor-pointer">diff + ROE</summary>
                            <div className="mt-1 space-y-1">
                              <p>Added: {r.diff.added.length === 0 ? '—' : r.diff.added.join(', ')}</p>
                              <p>Removed: {r.diff.removed.length === 0 ? 'none' : r.diff.removed.join(', ')}</p>
                              <p>Windows: {r.roe.windows.length === 0 ? 'none recorded on this revision' : r.roe.windows.map((w) => `${w.start} → ${w.end} (${w.tz})`).join(' · ')}</p>
                              <p>Contacts: {r.roe.emergencyContacts.length === 0 ? 'none recorded on this revision' : r.roe.emergencyContacts.join(', ')}</p>
                              <p>Restrictions: {r.roe.restrictions.length === 0 ? 'none recorded on this revision' : r.roe.restrictions.join(' · ')}</p>
                            </div>
                          </details>
                        </td>
                        <td className="py-2 pr-3 text-xs" title={r.requestedBy}>{memberLabel(r.requestedBy)}</td>
                        <td className="py-2 text-xs">
                          {r.status === 'pending' && r.requestedBy !== actorId ? (
                            <span className="flex flex-wrap gap-2">
                              <Button variant="primary" disabled={decide.isPending} onClick={() => decide.mutate({ revisionId: r.id, decision: 'approved' })}>Approve</Button>
                              <Button variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate({ revisionId: r.id, decision: 'rejected' })}>Reject</Button>
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
              {view.revisions.some((r) => r.status === 'pending' && r.requestedBy !== actorId) && (
                <div className="mt-3"><Input aria-label="Decision reason" placeholder="Reason (required to reject in mock mode)" value={reason} onChange={(e) => setReason(e.target.value)} className="max-w-md" /></div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Submit a revision" sub="New targets stay pending until a reviewer approves the revision; removals narrow the effective scope on approval" />
            <form
              className="grid gap-3 p-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (added.trim() === '' && removed.trim() === '') { setError('A scope revision needs at least one added or removed identifier.'); return }
                if ((windowStart === '') !== (windowEnd === '')) { setError('A ROE window needs both start and end (leave both empty to carry the approved windows forward).'); return }
                if ((windowStart !== '' || windowEnd !== '') && Date.parse(`${windowEnd}:00Z`) <= Date.parse(`${windowStart}:00Z`)) { setError('The ROE window end must be after its start.'); return }
                submit.mutate(view)
              }}
            >
              <label className="text-sm text-muted" htmlFor="scope-added">Added targets (one per line)</label>
              <Textarea id="scope-added" value={added} onChange={(e) => setAdded(e.target.value)} placeholder={'10.0.0.5\nweb.example.invalid'} />
              <label className="text-sm text-muted" htmlFor="scope-removed">Removed targets (one per line; the engagement target cannot be removed)</label>
              <Textarea id="scope-removed" value={removed} onChange={(e) => setRemoved(e.target.value)} placeholder="Identifiers of approved in-scope assets" />
              <label className="text-sm text-muted" htmlFor="scope-rationale">Rationale</label>
              <Input id="scope-rationale" required value={rationale} onChange={(e) => setRationale(e.target.value)} />
              {view.supports.roeFields && (
                <>
                  <label className="text-sm text-muted" htmlFor="scope-start">ROE window start (entered in the selected timezone; leave empty to keep the approved windows)</label>
                  <Input id="scope-start" type="datetime-local" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
                  <label className="text-sm text-muted" htmlFor="scope-end">ROE window end (same timezone as the start)</label>
                  <Input id="scope-end" type="datetime-local" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
                  <label className="text-sm text-muted" htmlFor="scope-tz">Window timezone (submitted as absolute ISO instants, never a mislabeled UTC)</label>
                  <Select id="scope-tz" aria-label="Window timezone" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
                    {TIME_ZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                  </Select>
                  <label className="text-sm text-muted" htmlFor="scope-contacts">Emergency contacts (comma-separated; carried from the approved ROE when unchanged)</label>
                  <Input id="scope-contacts" value={contacts ?? (approvedNames?.roe.emergencyContacts ?? []).join(', ')} onChange={(e) => setContacts(e.target.value)} placeholder="blue-team@example.invalid" />
                  <label className="text-sm text-muted" htmlFor="scope-restrictions">Restrictions (one per line; carried from the approved ROE when unchanged)</label>
                  <Textarea id="scope-restrictions" value={restrictions ?? (approvedNames?.roe.restrictions ?? []).join('\n')} onChange={(e) => setRestrictions(e.target.value)} placeholder="No destructive actions outside the window" />
                </>
              )}
              {!view.supports.roeFields && <p className="text-xs text-muted sm:col-span-2">The mock console keeps the testing window and contacts on the project record, so a revision here changes the scope and rationale only.</p>}
              <div className="sm:col-span-2">
                <Button type="submit" variant="primary" icon={FileDiff} disabled={submit.isPending}>
                  {submit.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
                  Submit revision
                </Button>
              </div>
            </form>
          </Card>
        </>
      )}

      {sub === 'docs' && (
        documents ?? <Card><CardHeader title="Documents" /><p className="p-4 text-sm text-muted">Documents are not modelled on this backend, so none are listed here.</p></Card>
      )}

      {sub === 'hist' && (
        <Card>
          <CardHeader title="ROE version history" sub={`Latest approved: ${view.latestApprovedVersion === null ? 'none yet' : `v${view.latestApprovedVersion}`}`} />
          {view.revisions.length === 0 ? <p className="p-4 text-sm text-muted">No changes recorded yet.</p> : (
            <ul className="divide-y divide-line/60 px-4 text-sm">
              {view.revisions.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="font-mono text-xs">v{r.version}</span>
                  <Status kind="gate" value={r.status === 'approved' ? 'passed' : r.status === 'pending' ? 'pending' : 'failed'} size="sm" label={STATUS_LABEL[r.status]} />
                  <span className="text-muted">requested by {memberLabel(r.requestedBy)}{r.decidedBy ? `, decided by ${memberLabel(r.decidedBy)}` : ''}</span>
                  <span className="text-muted">{r.diff.rationale}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {error !== null && <p className="text-sm text-bad" role="alert">{error}</p>}
      {assetPreview && <AssetPreviewModal key={assetPreview} id={assetPreview} onClose={() => setAssetPreview(null)} />}
    </div>
  )
}
