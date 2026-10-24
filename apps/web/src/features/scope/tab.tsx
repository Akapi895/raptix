/**
 * Scope & ROE tab (plan P09, Scope slice), shared by the mock and the real
 * project detail. It reads and writes through the scope port and the assets
 * port. A scope revision supersedes the approved one only when an independent
 * reviewer approves it. Anything a source cannot model is named as unmodelled,
 * never shown as an empty list, and an enforcement state the console does not
 * receive is shown as not reported, never as enforced.
 */
import { useContext, useState, type ReactElement, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FileDiff, Loader2, RefreshCw } from 'lucide-react'
import { utcMinuteOr, zonedToIso } from '../../platform/format'
import { SessionContext } from '../../platform/session'
import { useMemberLabels } from '../team'
import { go } from '../../router/navigate'
import { Button, Card, CardHeader, Empty, Input, Segmented, Select, Skeleton, Status, Textarea } from '../../ui/index'
import { useAssetList } from '../assets'
import { useScopeRead, useScopeWrites } from './query'
import type { ScopeRead, ScopeRevision, ScopeRoe } from './service'
import { effectiveRows, NOT_MODELLED, policyRows, type Decision } from './effective'

type Sub = 'effective' | 'roe' | 'changes' | 'docs'
type DecisionFilter = 'all' | Decision

const TIME_ZONES = ['UTC', 'Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles']

const STATUS_LABEL: Record<ScopeRevision['status'], string> = { pending: 'pending', approved: 'approved', rejected: 'rejected', superseded: 'superseded' }

const SUB_OPTIONS: { id: Sub; label: string }[] = [
  { id: 'effective', label: 'Effective scope' },
  { id: 'roe', label: 'ROE & policies' },
  { id: 'changes', label: 'Changes & approvals' },
  { id: 'docs', label: 'Documents' },
]

const DECISION_OPTIONS: { id: DecisionFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'in', label: 'In scope' },
  { id: 'excluded', label: 'Excluded' },
  { id: 'pending', label: 'Pending' },
  { id: 'undetermined', label: 'Not determined' },
]

const DECISION_LABEL: Record<Decision, string> = { in: 'In scope', excluded: 'Excluded', pending: 'Pending', undetermined: 'Not determined' }
const DECISION_TEXT: Record<Decision, string> = { in: 'text-ok', excluded: 'text-bad', pending: 'text-warn', undetermined: 'text-muted' }

/** The actor's member id, as the approval records carry it. */
function useActorId(): string | null {
  const session = useContext(SessionContext)
  return session?.session?.actor?.id ?? null
}

export function ScopeTab({ engagementId, documents }: { engagementId: string; documents?: ReactNode }): ReactElement {
  const read = useScopeRead()
  const writes = useScopeWrites()
  const assets = useAssetList({})
  const actorId = useActorId()
  const memberLabel = useMemberLabels(engagementId)
  const [sub, setSub] = useState<Sub>('effective')
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>('all')
  const [search, setSearch] = useState('')
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
  const unmodelledOps = view.unmodelled.includes('operations') || view.unmodelled.includes('plans')
  const checkedAt = read.dataUpdatedAt ? utcMinuteOr(new Date(read.dataUpdatedAt).toISOString()) : null
  const rows = effectiveRows(view, assets.data?.items ?? [])
  const excluded = rows.filter((row) => row.decision === 'excluded')
  const visibleRows = rows.filter((row) => (decisionFilter === 'all' || row.decision === decisionFilter)
    && (search.trim() === '' || row.target.toLowerCase().includes(search.trim().toLowerCase()) || row.type.toLowerCase().includes(search.trim().toLowerCase())))
  const expiry = effective.roe.windows.reduce<string | null>((latest, w) => (latest === null || w.end > latest ? w.end : latest), null)
  const reValidation = (view.impact?.plans.length ?? 0) + (view.impact?.draftOps.length ?? 0)

  // What stops a run from being authorised against this scope. Planning handoff and governance preflight are read on their own tabs.
  const blockers: { key: string; title: string; detail: string; tab: Sub; action: string }[] = []
  if (effective.version === null) blockers.push({ key: 'none', title: 'No approved scope revision yet', detail: 'A run cannot be authorised against an approved scope until a revision is approved.', tab: 'changes', action: 'Open changes' })
  if (pending) blockers.push({ key: 'pending', title: `v${pending.version} awaits an independent reviewer`, detail: `Submitted by ${memberLabel(pending.requestedBy)}. Its targets stay pending until it is approved.`, tab: 'changes', action: 'Review change' })
  if (latestRejected && !pending) blockers.push({ key: 'returned', title: `v${latestRejected.version} was returned for changes`, detail: `Reason: ${latestRejected.decisionComment ?? 'no reason was recorded'}.`, tab: 'changes', action: 'Open changes' })
  if (effective.roe.emergencyContacts.length === 0) blockers.push({ key: 'contact', title: 'Emergency contact is missing', detail: 'Without an emergency contact the ROE cannot be approved and preflight stays blocked.', tab: 'roe', action: 'Open ROE & policies' })
  if (reValidation > 0) blockers.push({ key: 'revalidate', title: `${reValidation} plan or operation needs re-validation`, detail: 'The pending scope change moves them to re-validation before they can start.', tab: 'changes', action: 'Open impact preview' })
  if ((kpis?.pending ?? 0) > 0) blockers.push({ key: 'pending-assets', title: `${kpis?.pending} asset(s) pending approval`, detail: 'Pending assets are not approved targets until a reviewer approves a revision that includes them.', tab: 'effective', action: 'Open effective scope' })

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="inline-flex items-center gap-1.5"><span className="text-muted">Effective version</span><span className="font-mono font-semibold text-fg">{effective.versionLabel ?? 'none yet'}</span>{effective.versionLabel !== null && <Status kind="roe" value="approved" size="sm" label="approved" />}</span>
          {pending && <span className="inline-flex items-center gap-1.5"><span className="text-muted">Proposed</span><span className="font-mono font-semibold text-fg">v{pending.version}</span><Status kind="roe" value="pending" size="sm" label="pending" /></span>}
          <span className="inline-flex items-center gap-1.5"><span className="text-muted">Testing window</span><span className="text-fg">{effective.windowText ?? (effective.roe.windows.length === 0 ? 'none (always allowed)' : 'set')}</span>{expiry !== null && <span className="text-muted">· latest window ends {utcMinuteOr(expiry)}</span>}</span>
          <span className="inline-flex items-center gap-1.5"><span className="text-muted">Emergency contact</span>{effective.roe.emergencyContacts.length > 0 ? <span className="text-fg">{effective.roe.emergencyContacts.join(', ')}</span> : <span className="font-medium text-bad">Missing — blocks approval</span>}</span>
          <span className="inline-flex flex-wrap items-center gap-1.5"><span className="text-muted">Assets</span>{kpis ? <span>{kpis.in ?? 0} in scope · {kpis.pending ?? 0} pending · {kpis.out ?? 0} out · {kpis.unclassified ?? 0} unclassified</span> : <span className="text-muted">loading</span>}</span>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="What blocks execution"
          sub={checkedAt === null ? 'Read from the scope source' : `Last checked ${checkedAt}. Read from the scope revisions, the effective scope and the asset records.`}
          actions={<Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => void read.refetch()}>Recheck</Button>}
        />
        {blockers.length === 0 ? (
          <p className="p-4 text-sm text-muted">No blocker in the scope source. Planning handoff and governance preflight are checked on their own tabs and in the project overview.</p>
        ) : (
          <ul className="divide-y divide-line">
            {blockers.map((b) => (
              <li key={b.key} className="flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-warn px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{b.title}</div>
                  <div className="text-xs text-muted">{b.detail}</div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setSub(b.tab)}>{b.action}</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {error !== null && <p className="text-sm text-bad" role="alert">{error}</p>}

      <Segmented<Sub> value={sub} onChange={setSub} options={SUB_OPTIONS} />

      {sub === 'effective' && (
        <>
          <Card>
            <CardHeader title="Exclusions" sub={excluded.length === 0 ? 'No target is excluded from the scope.' : `${excluded.length} excluded. An excluded target is never a target, whatever else the scope says.`} />
            {excluded.length > 0 && (
              <ul className="divide-y divide-line">
                {excluded.map((row) => (
                  <li key={row.key} className="flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-bad px-4 py-2.5 text-sm">
                    <span className="font-mono">{row.target}</span>
                    <span className="text-xs text-muted">{row.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Effective scope" sub={`What the runtime reads as approved: version ${effective.versionLabel ?? 'none yet'}. A target is allowed only when its decision is In scope.`} />
            <div className="flex flex-wrap items-center gap-3 px-4 pb-3">
              <Segmented<DecisionFilter> value={decisionFilter} onChange={setDecisionFilter} options={DECISION_OPTIONS} />
              <Input aria-label="Search targets" placeholder="Search by target or type" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
            </div>
            {assets.isPending ? <Skeleton className="mx-4 mb-4 h-24" /> : visibleRows.length === 0 ? (
              <Empty title={rows.length === 0 ? 'No target in the effective scope' : 'No target matches these filters'}>
                {rows.length === 0 ? 'Approve a scope revision to name targets here.' : 'Clear the search or the decision filter.'}
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-line text-left text-xs text-muted">
                      <th className="p-3 font-medium">Target</th>
                      <th className="p-3 font-medium">Type</th>
                      <th className="p-3 font-medium">Decision</th>
                      <th className="p-3 font-medium">Source</th>
                      <th className="p-3 font-medium">Reason</th>
                      <th className="p-3 font-medium"><span className="sr-only">Asset</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => {
                      const assetId = row.assetId
                      return (
                        <tr key={row.key} className="border-b border-line last:border-0">
                          <td className="p-3 font-mono text-xs">{row.target}</td>
                          <td className="p-3 text-xs">{row.type}</td>
                          <td className={`p-3 text-xs font-medium ${DECISION_TEXT[row.decision]}`}>{DECISION_LABEL[row.decision]}</td>
                          <td className="p-3 text-xs text-muted">{row.source}</td>
                          <td className="p-3 text-xs text-muted">{row.reason}</td>
                          <td className="p-3">
                            {assetId !== null && <Button size="sm" variant="ghost" onClick={() => go('asset', { id: assetId })}>Open asset</Button>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="px-4 pb-4 pt-3 text-xs text-muted">
              Constraints by port, protocol or method are not modelled on this backend, so none are shown. Check target needs the runtime&apos;s own evaluator and is not available from this console yet.
            </p>
          </Card>
        </>
      )}

      {sub === 'roe' && (
        <Card>
          <CardHeader title="ROE & policies" sub={`Approved ROE: ${view.latestApprovedVersion === null ? 'none yet' : `v${view.latestApprovedVersion}`}. Approved means the revision records the value; enforcement is what the runtime reports.`} />
          <div className="overflow-x-auto p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="pb-2 pr-3 font-medium">Policy</th>
                  <th className="pb-2 pr-3 font-medium">Value</th>
                  <th className="pb-2 font-medium">Enforcement</th>
                </tr>
              </thead>
              <tbody>
                {policyRows(view).map((row) => (
                  <tr key={row.policy} className="border-b border-line last:border-0 align-top">
                    <td className="py-2.5 pr-3 font-medium">{row.policy}</td>
                    <td className={`py-2.5 pr-3 ${row.value === NOT_MODELLED ? 'text-muted' : ''}`}>{row.value}</td>
                    <td className="py-2.5 text-xs text-muted">{row.enforcement}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 pb-4 text-xs text-muted">This console does not receive a runtime enforcement report, so a policy shows not reported rather than enforced. A checkbox here does not prove the runtime applies it.</p>
        </Card>
      )}

      {sub === 'changes' && (
        <>
          <Card>
            <CardHeader title="Impact preview" sub="What the pending scope change does to plans and operations, as the server reports it." />
            <div className="p-4 text-sm">
              {view.impact === null ? (
                <p className="text-muted">No impact is reported for this change.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-4">
                  {view.impact.plans.length > 0 && <li>Plans moved to Re-validation Required: {view.impact.plans.join(', ')}.</li>}
                  {view.impact.draftOps.length > 0 && <li>Operations that cannot start until re-validated: {view.impact.draftOps.join(', ')}.</li>}
                  {view.impact.running.length > 0 && <li>Running now: {view.impact.running.join(', ')} continues under the last approved version.</li>}
                  {view.impact.plans.length + view.impact.draftOps.length + view.impact.running.length === 0 && <li>No existing plans or operations are affected.</li>}
                </ul>
              )}
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
                <div className="mt-3"><Input aria-label="Decision reason" placeholder="Reason (required to reject)" value={reason} onChange={(e) => setReason(e.target.value)} className="max-w-md" /></div>
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
    </div>
  )
}
