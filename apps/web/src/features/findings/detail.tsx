import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FilePlus2, Lock, Sparkles, Pencil, RotateCcw, Send, ShieldCheck } from 'lucide-react'
import { useSessionStore } from '../../state/session'
import { clearFindingRequest, findingRequestId, type FindingRequestScope } from './finding-session'
import { useFindingIdentity } from './presentation-context'
import { ROLE_LABEL } from '../../domain/policy'
import { type Finding } from '../../domain/entities'
import { FindingReadError, useEvidenceList, useFindingDetail, useFindingWrites } from './query'
import type { FindingActivityKind, FindingTransitionTarget } from './service'
import { ReproducePanel } from './reproduce'
import { AddToReport } from './add-to-report'
import { useAiActions } from './ai-actions'
import { EvidenceTab } from './evidence'
import { FindingDenied } from './access'
import { Banner, Button, Card, CardHeader, Check, DescList, Empty, Field, Locked, Mono, PageHeader, Person, PersonaHint, Select, Sev, Skeleton, Status, Table, Tabs, Textarea, Timeline, cx } from '../../ui/index'
import { go, useRoute } from '../../router/navigate'
import { realControlGap, useCan, useMe, useReadOnly } from '../../state/console'
import { useFindingReportChoices } from './projection'
import { useResourceScope } from '../../state/resource-scope'
import { useProjectStore, useToastStore } from '../../state/stores'
const activityTime = (value: string) => new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const FLOW = ['Draft', 'In Review', 'Confirmed', 'Remediation', 'Retest', 'Resolved']
const FLOW_IDX: Record<string, number> = { ai_suggested: -1, draft: 0, returned: 0, review: 1, confirmed: 2, remediation: 3, retest: 4, resolved: 5 }
/**
 * Finding detail (ticket 31/32): the record, history/metadata and linked
 * evidence come from the typed detail read through Query — role-sensitive
 * masking (`viewSensitive`) is applied by the service, not by the screen.
 * Lifecycle actions run through the typed write handlers (ticket 32): each
 * transition is role/state gated at the handler and publishes a ChangeSet
   * both this view and legacy consumers observe.
 */
export function FindingDetail() {
  const route = useRoute()
  const identity = useFindingIdentity()
  const me = useMe()
  const pid = useProjectStore((state) => state.pid)
  return <FindingDetailBody key={`${identity.trustedActorId ?? me.email}:${pid}:${route.id}`} />
}
function FindingDetailBody() {
  const route = useRoute()
  const identity = useFindingIdentity()
  const can = useCan()
  const readOnly = useReadOnly()
  const me = useMe()
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const db = useFindingReportChoices()
  const writes = useFindingWrites()
  const queryClient = useQueryClient()
  const detail = useFindingDetail(route.id)
  useResourceScope(detail.data?.finding.projectId)
  const [note, setNote] = useState('')
  const [commentSaving, setCommentSaving] = useState(false)
  const [olderComments, setOlderComments] = useState<Finding['comments']>([])
  const [olderHistory, setOlderHistory] = useState<Finding['history']>([])
  const [activityCursors, setActivityCursors] = useState<Partial<Record<FindingActivityKind, string | null>>>({})
  const [activityLoading, setActivityLoading] = useState<FindingActivityKind | null>(null)
  const activityVersion = useRef<number | undefined>(undefined)
  useEffect(() => {
    activityVersion.current = detail.data?.finding.version
    setOlderComments([]); setOlderHistory([]); setActivityCursors({}); setActivityLoading(null)
  }, [detail.data?.finding.version])
  const [rep, setRep] = useState(false)
  const ai = useAiActions()
  if (!route.id || detail.isError) {
    return <FindingDenied id={route.id} error={detail.isError ? (detail.error as FindingReadError) : new FindingReadError({ kind: 'not-found', message: 'Finding not found.' })} />
  }
  if (detail.isPending || !detail.data) {
    return <div aria-busy="true" aria-label="Loading finding"><Skeleton className="h-72" /></div>
  }
  const data = detail.data
  const f = data.finding
  const tab = route.tab || 'overview'
  const ro = readOnly(f.projectId)
  const reviewer = can('reviewFinding', f.projectId)
  const author = can('createFinding', f.projectId)
  // Four-eyes: the author cannot decide its own review unless the deployment is single-operator (ADR-0100). The server
  // enforces the rule; the control says so before the click.
  const selfReview = identity.independentReviewRequired && identity.trustedActorId !== null && f.owner === identity.trustedActorId
  const proj = data.project
  const op = data.operation
  const step = data.step
    const noEv = f.evidence.length === 0
  const roReason = me.role === 'viewer' ? 'The Client / Viewer role is read-only.' : 'Project is closed — read-only.'
  const reviewDecision = f.lastReviewDecision
  const returnedNote = f.status === 'returned' ? reviewDecision?.action === 'returned' ? { by: reviewDecision.actorId, at: activityTime(reviewDecision.createdAt), text: reviewDecision.reason ?? '' } : [...olderHistory, ...f.history].reverse().find((event) => event.text.startsWith('Returned for changes')) : undefined
  const reports = db.reports.filter((r) => r.projectId === f.projectId && ['draft', 'returned'].includes(r.status))
  const inReport = db.reports.filter((r) => r.findings.includes(f.id)).map((r) => ({ id: r.id, title: r.title }))
  const reportReason = realControlGap('finding.reportLink') ?? (f.status === 'ai_suggested' ? 'AI suggestions are unverified and cannot be included in a report. Verify the finding first.' : ro ? roReason : !can('editReport', f.projectId) ? `The ${ROLE_LABEL[me.role]} role cannot edit reports.` : ['draft', 'review', 'returned'].includes(f.status) ? 'Only confirmed findings can be added to a report.' : '')

  const lastDecision = reviewDecision ? { text: `${reviewDecision.action === 'confirmed' ? 'Confirmed' : 'Returned for changes'} @ v${reviewDecision.version}`, by: reviewDecision.actorId } : [...olderHistory, ...f.history].reverse().find((h) => /Confirmed|Returned/.test(h.text))
  /** One lifecycle move through the typed handler; the handler is the
   *  enforcer — a refusal (role, state, read-only) surfaces its reason. */
  const runTransition = async (to: FindingTransitionTarget, msg: string, opts?: { note?: string; warn?: boolean }) => {
    const res = await writes.transition(f.id, to, opts?.note, f.version)
    if (res.ok) {
      toast(msg, opts?.warn ? 'warn' : 'ok')
      await queryClient.invalidateQueries({ queryKey: ['finding'] })
    }
    else toast(res.failure.message, 'warn')
  }
  const doSubmit = () => { void runTransition('review', `${f.id} submitted for review.`) }
  const approve = () => confirm({ title: `Confirm ${f.id}?`, body: 'The finding will move to "Confirmed" and can be added to reports.', confirmLabel: 'Confirm Finding', onConfirm: () => { void runTransition('confirmed', `${f.id} was confirmed.`) } })
  const sendBack = () => confirm({ title: `Return ${f.id} for changes`, body: 'The author will be notified with your reason so they can make changes.', confirmLabel: 'Return for Changes', danger: true, reasonLabel: 'Reason for returning', reasonRequired: true, onConfirm: (r) => { void runTransition('returned', `${f.id} returned to the author.`, { note: r, warn: true }) } })

  const actions: ReactNode[] = []
  if (['review', 'confirmed', 'remediation', 'retest'].includes(f.status)) actions.push(<Button key="edit-content" icon={Pencil} disabled={ro || !author} title="Editing confirmed content returns the finding to review." onClick={() => go('finding-new', { id: f.id })}>Edit Finding</Button>)
  if (['draft', 'returned'].includes(f.status)) {
    actions.push(
      <Button key="e" icon={Pencil} disabled={ro || !author} title={ro ? roReason : !author ? `The ${ROLE_LABEL[me.role]} role cannot edit.` : ''} onClick={() => go('finding-new', { id: f.id })}>Edit Draft</Button>,
      <Button key="s" variant="primary" icon={Send} disabled={ro || !author || noEv} title={ro ? roReason : !author ? 'You do not have permission to submit for review.' : noEv ? 'At least 1 piece of evidence is required to submit for review — add it in the Evidence tab.' : ''} onClick={doSubmit}>Submit for Review</Button>,
    )
  }
  if (f.status === 'ai_suggested') {
    const w = ai.why(f)
    const dismissWhy = ai.dismissWhy(f)
    actions.push(
      <Button key="d" disabled={!!dismissWhy || !!f.suggestionDisposition?.dismissed} title={dismissWhy || 'Dismiss with a reason'} onClick={() => ai.dismiss(f)}>Dismiss</Button>,
      <Button key="v" variant="primary" icon={ShieldCheck} disabled={!!w} title={w || 'Verify the suggestion and create a finding in review'} onClick={() => ai.verify(f)}>Verify & create finding</Button>,
    )
  }
  if (f.status === 'review') {
    actions.push(
      <Button key="r" variant="danger" icon={RotateCcw} disabled={ro || !reviewer || selfReview} title={ro ? roReason : !reviewer ? 'Only a Reviewer or Manager can return findings.' : selfReview ? 'The author of this finding cannot return its own review.' : ''} onClick={sendBack}>Return for Changes</Button>,
      <Button key="c" variant="primary" icon={ShieldCheck} disabled={ro || !reviewer || selfReview} title={ro ? roReason : !reviewer ? 'Only a Reviewer or Manager can confirm findings.' : selfReview ? 'The author of this finding cannot confirm its own review.' : ''} onClick={approve}>Confirm Finding</Button>,
    )
  }
  if (f.status === 'confirmed') actions.push(<Button key="rm" variant="primary" disabled={ro || !(reviewer || author)} title={ro ? roReason : ''} onClick={() => confirm({ title: 'Move to remediation?', body: 'Marks the finding as being remediated by the asset owner.', confirmLabel: 'Move to Remediation', onConfirm: () => { void runTransition('remediation', `${f.id} moved to In Remediation.`) } })}>Send to Remediation</Button>)
  if (f.status === 'remediation') actions.push(<Button key="rt" variant="primary" icon={RotateCcw} disabled={ro || !(reviewer || author)} title={ro ? roReason : ''} onClick={() => { void runTransition('retest', `${f.id} is awaiting retest.`) }}>Request Retest</Button>)
  if (f.status === 'retest') actions.push(<Button key="gt" variant="primary" icon={RotateCcw} onClick={() => go('finding', { id: f.id, tab: 'retest' })}>Record Retest</Button>)
  actions.push(
    <Button key="rep" icon={FilePlus2} disabled={!!reportReason} title={reportReason || 'Add this finding to a report in the same project'} onClick={() => setRep(true)}>Add to Report</Button>,
  )

  const postComment = async () => {
    if (!note.trim() || commentSaving) return
    setCommentSaving(true)
    const requestScope: FindingRequestScope = { deploymentId: identity.deploymentId, actorId: identity.actorId, engagementId: f.projectId, findingId: f.id, action: 'comment', payload: { text: note.trim() } }
    try {
      const requestId = await findingRequestId(requestScope)
      const result = await writes.addComment(f.id, note.trim(), f.version ?? 1, requestId)
      if (!result.ok) { toast(result.failure.message, 'warn'); return }
      await clearFindingRequest(requestScope)
      setNote('')
      setOlderComments([]); setOlderHistory([]); setActivityCursors({})
      await queryClient.invalidateQueries({ queryKey: ['finding'] })
      toast('Comment posted.')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The comment could not be saved.', 'warn')
    } finally {
      setCommentSaving(false)
    }
  }
  const activityCursor = (kind: FindingActivityKind) => activityCursors[kind] === undefined ? f.activityCursors?.[kind] ?? null : activityCursors[kind] ?? null
  const loadOlderActivity = async (kind: 'comments' | 'history') => {
    const cursor = activityCursor(kind)
    if (!cursor || activityLoading) return
    setActivityLoading(kind)
    const page = await writes.loadActivity(f.id, kind, cursor, f.version ?? 1)
    if (activityVersion.current !== f.version) return
    setActivityLoading(null)
    if (!page.ok) { toast(page.failure.message, 'warn'); return }
    const events = [...page.data.items].reverse()
    if (kind === 'comments') setOlderComments((previous) => [...events.map((item) => ({ by: item.actorId, at: activityTime(item.createdAt), text: item.text })), ...previous])
    else setOlderHistory((previous) => [...events.map((item) => ({ at: activityTime(item.createdAt), by: item.actorId, text: item.text })), ...previous])
    setActivityCursors((previous) => ({ ...previous, [kind]: page.data.nextCursor }))
  }

  return (
    <div>
      <PageHeader
        back={{ label: 'Findings', to: () => go('findings') }}
        title={f.title}
        meta={<><Sev v={f.severity} /><Status kind="finding" value={f.status} /></>}
        sub={<span className="flex flex-wrap items-center gap-x-4 gap-y-1"><Mono className="text-accent">{f.id}</Mono><span>Project <Mono>{f.projectId}</Mono></span><span>Owner: {f.owner}</span><span>Updated {f.updated}</span></span>}
        actions={actions}
      />
      {ro && <Banner tone="warn" icon={Lock} title="Read-only mode">{roReason} Actions that change data are disabled, each with an explanation.</Banner>}
      {returnedNote && (
        <Banner tone="bad" icon={RotateCcw} title={`Returned by ${returnedNote.by} — ${returnedNote.at}`} action={!ro && author ? <Button size="sm" variant="secondary" icon={Pencil} onClick={() => go('finding-new', { id: f.id })}>Edit now</Button> : undefined}>
          <span className="whitespace-pre-wrap">{returnedNote.text.replace(/^Returned for changes(?::\s*)?/, '')}</span>
        </Banner>
      )}
      {f.status === 'ai_suggested' && (
        <Banner tone="warn" icon={Sparkles} title="AI Suggested — unverified">
          {data.producer ? `Produced from ${data.producer.path}. ` : 'Proposed by the AI Operator. '}Not a finding yet: excluded from confirmed counts, severity charts and reports. {f.suggestionDisposition?.dismissed ? `Dismissed: ${f.suggestionDisposition.reason}` : 'Verify it against the source output before importing it as a draft.'}
        </Banner>
      )}
      {f.status === 'review' && !reviewer && !ro && <PersonaHint need="Reviewer">{'This finding is awaiting review by a Reviewer or Manager.'}</PersonaHint>}
      {['draft', 'returned'].includes(f.status) && !author && !ro && me.role !== 'viewer' && <PersonaHint need="Operator">Editing and submitting for review require the Operator or Manager role.</PersonaHint>}
      <Tabs
        value={tab} onChange={(t) => go('finding', { id: f.id, tab: t })}
        tabs={[{ id: 'overview', label: 'Summary & workflow' }, { id: 'evidence', label: 'Evidence', count: f.evidence.length }, { id: 'retest', label: 'Retest', count: f.retests.length }, { id: 'reproduce', label: 'Reproduce' }]}
      />
      {tab === 'evidence' ? <EvidenceTab f={f} evs={data.evidence} ro={ro} /> : tab === 'retest' ? <RetestTab key={`${f.id}:${f.version}`} f={f} ro={ro} roReason={roReason} /> : tab === 'reproduce' ? <ReproducePanel finding={f} readArtifact={writes.readArtifact} /> : (
        <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
          <div className="space-y-6">
            {data.producer && <Card>
              <CardHeader title={data.producer.evidence ? 'Runtime producer output' : 'Imported producer lineage'} sub={`${data.producer.path}${data.producer.sizeBytes === undefined ? '' : ` · ${data.producer.sizeBytes} bytes`}`} />
              <div className="space-y-3 text-sm">
                {data.producer.resolved === false && <Banner tone="warn" title="Producer source is not retained">The imported claim keeps its source reference, but the server could not resolve it to retained artifact bytes.</Banner>}
                {data.producer.digest && <p className="break-all text-xs text-muted">Producer source SHA-256: <span className="font-mono">{data.producer.digest}</span></p>}
                {data.producer.quality?.defaultSeverity && <Banner tone="warn" title="Severity is a parser default">The source did not include a recognized severity. Review the value before curation.</Banner>}
                {data.producer.quality?.placeholderDescription && <Banner tone="warn" title="Description is a placeholder">The source did not provide a description.</Banner>}
                {data.producer.quality?.placeholderEvidence && <Banner tone="warn" title="Evidence is a placeholder">The source did not provide an evidence reference.</Banner>}
                {data.producer.quality?.unreadable && <Banner tone="warn" title="Producer source is unreadable">The retained source could not be parsed completely.</Banner>}
                {data.producer.evidence && <div><div className="mb-1 text-xs text-muted">Producer evidence text — not an evidence reference</div><p className="whitespace-pre-wrap leading-relaxed">{data.producer.evidence}</p></div>}
                {data.producer.attackVector && <div><div className="mb-1 text-xs text-muted">Attack vector</div><p className="whitespace-pre-wrap leading-relaxed">{data.producer.attackVector}</p></div>}
              </div>
            </Card>}
            <Card>
              <CardHeader title="Analysis & impact" />
              <div className="space-y-4 text-sm">
                <div><div className="mb-1 text-xs text-muted">Description</div><p className="leading-relaxed">{f.desc}</p></div>
                <div><div className="mb-1 text-xs text-muted">Technical observations</div><p className="leading-relaxed">{step ? `${step.id} (${step.technique}) on ${step.asset}: ${step.output}` : 'No linked step observation.'}</p></div>
                <div><div className="mb-1 text-xs text-muted">Impact</div><p className="leading-relaxed">{f.impact || 'Not recorded.'}</p></div>
                <div><div className="mb-1 text-xs text-muted">Recommendations</div><p className="leading-relaxed">{f.rec || 'Not recorded.'}</p></div>
                <div><div className="mb-1 text-xs text-muted">Severity rationale</div><p className="leading-relaxed">{f.severityRationale || 'Not recorded.'}</p></div>
                <div><div className="mb-1 text-xs text-muted">Scope note</div><p className="leading-relaxed">{f.scopeNote || 'Not recorded.'}</p></div>
              </div>
            </Card>
            <Card>
              <CardHeader title="Links" />
              <DescList cols={2} items={[
                { k: 'Affected asset', v: <Mono>{f.references?.assetId ?? 'Not linked'}</Mono> },
                { k: 'Evidence', v: f.evidence.length ? f.evidence.map((id) => <button key={id} className="mr-2 whitespace-nowrap font-mono text-[13px] text-link hover:underline" onClick={() => go('evidence', { id })}>{id}</button>) : <span className="text-muted">None linked</span> },
                { k: 'Operation step', v: op && step ? <button className="whitespace-nowrap font-mono text-[13px] text-link hover:underline" onClick={() => go('operation', { id: op.id, tab: 'console' })}>{op.id} / {step.id} — {step.name}</button> : '—' },
                { k: 'Confidence', v: f.status === 'ai_suggested' ? 'Low — AI inference, needs verification' : f.evidence.length ? 'Supported by linked evidence — a recorded claim, not proven exploitability' : 'Low — no evidence linked' },
                { k: 'Reviewer decision', v: f.status === 'ai_suggested' ? 'Not submitted' : lastDecision ? `${lastDecision.text} by ${lastDecision.by}` : 'Pending' },
                { k: 'Execution', v: <span className="break-all text-xs">Thread: {f.references?.threadId ?? '—'}<br />Run: {f.references?.runId ?? '—'}<br />Binding: {f.references?.bindingId ?? '—'}</span> },
                { k: 'ATT&CK technique', v: f.technique ? <button className="text-left text-link hover:underline" onClick={() => go('technique', { id: f.technique })}><Mono>{f.technique}</Mono>{data.techniqueName ? ` — ${data.techniqueName}` : ''}</button> : 'Not linked' },
                { k: 'Client', v: proj?.client },
                { k: 'Recorded', v: f.date },
                { k: 'Included in reports', v: inReport.length ? inReport.map((r) => <button key={r.id} className="mr-2 font-mono text-[13px] text-link hover:underline" onClick={() => go('report', { id: r.id })}>{r.id}</button>) : 'Not yet' },
              ]} />
            </Card>
            <Card>
              <CardHeader title="Execution timeline" sub="From the source step through evidence to this finding." />
              <Timeline items={[
                ...(step && step.ts !== '—' ? [{ at: `${step.ts} (UTC+7)`, title: `Step ${step.id} executed — ${step.name}`, sub: `${step.agent} on ${step.asset} · ${step.technique}`, tone: 'cyan' as const }] : []),
                ...data.evidence.map((e) => ({ at: e.at, title: `Evidence ${e.ref} captured`, sub: `${e.kind} · ${e.by}`, tone: 'accent' as const })),
                { at: f.date, title: `${f.id} recorded`, sub: f.status === 'ai_suggested' ? 'Suggested by AI Operator' : f.owner, tone: 'accent' as const },
              ]} />
            </Card>
            <Card>
              <CardHeader title="Reviewer comments" sub={`${olderComments.length + f.comments.length} loaded${activityCursor('comments') ? ' · older comments available' : ''}`} />
              {f.comments.length === 0 ? <div className="mb-4 text-sm text-muted">No comments yet.</div> : (
                <ul className="mb-4 space-y-3">
                  {[...olderComments, ...f.comments].map((c, i) => (
                    <li key={c.id ?? `${c.at}:${c.by}:${i}`} className={cx('rounded-lg border p-3', f.status === 'returned' && i === olderComments.length + f.comments.length - 1 ? 'border-bad/40 bg-bad/5' : 'border-line')}>
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted"><Person name={c.by} /><span className="font-mono">{c.at}</span></div>
                      <div className="whitespace-pre-wrap text-sm">{c.text}</div>
                    </li>
                  ))}
                </ul>
              )}
              {activityCursor('comments') && <Button size="sm" variant="ghost" disabled={activityLoading !== null} onClick={() => { void loadOlderActivity('comments') }}>{activityLoading === 'comments' ? 'Loading…' : 'Load older comments'}</Button>}
              <Textarea aria-label="Comment" value={note} onChange={(e) => setNote(e.target.value)} disabled={ro} placeholder={ro ? roReason : 'Write a comment for the reviewer / owner…'} className="min-h-20" />
              <div className="mt-2 flex justify-end"><Button onClick={() => { void postComment() }} disabled={ro || commentSaving || !note.trim()} title={ro ? roReason : !note.trim() ? 'Enter a comment.' : ''}>Post comment</Button></div>
            </Card>
          </div>
          <div className="space-y-6">
            <Card>
              <CardHeader title="Workflow" />
              {f.status === 'ai_suggested' && <div className="mb-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">Step 0 — AI Suggested (unverified). Verify to enter the workflow.</div>}
              <ol className="mb-4 space-y-1.5">
                {FLOW.map((s, i) => {
                  const cur = FLOW_IDX[f.status]
                  return (
                    <li key={s} className={cx('flex items-center gap-2 rounded-lg border px-3 py-2 text-xs', i === cur ? 'border-accent bg-accent/10 text-fg' : i < cur ? 'border-ok/40 text-fg' : 'border-line text-muted')}>
                      <span className={cx('flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold', i < cur ? 'bg-ok text-white' : i === cur ? 'bg-primary text-primary-fg' : 'bg-hover')}>{i < cur ? '✓' : i + 1}</span>
                      {s}{i === cur && f.status === 'returned' && <span className="ml-auto text-bad">Returned for changes</span>}{i === cur && f.status !== 'returned' && <span className="ml-auto text-accent">Current</span>}
                    </li>
                  )
                })}
              </ol>
              <div className="mb-3 text-xs font-medium text-muted">Change history</div>
              {[...olderHistory, ...f.history].length === 0 ? <div className="text-sm text-muted">No history recorded.</div> : (
                <Timeline items={[...olderHistory, ...f.history].reverse().map((h) => ({ at: h.at, title: h.text, sub: h.by, tone: /Returned/.test(h.text) ? 'bad' : /Confirmed|Resolved|resolved/.test(h.text) ? 'ok' : /review/i.test(h.text) ? 'warn' : 'accent' }))} />
              )}
              {activityCursor('history') && <Button size="sm" variant="ghost" disabled={activityLoading !== null} onClick={() => { void loadOlderActivity('history') }}>{activityLoading === 'history' ? 'Loading…' : 'Load older history'}</Button>}
            </Card>
          </div>
        </div>
      )}
      <AddToReport open={rep} onClose={() => setRep(false)} f={f} reports={reports} />
    </div>
  )
}
const RETEST_STATE: Record<string, { label: string; tone: 'ok' | 'bad' | 'warn' | 'neutral' }> = {
  'Resolved': { label: 'Resolved', tone: 'ok' }, 'Persists': { label: 'Still present', tone: 'bad' }, 'Partial': { label: 'Partially resolved', tone: 'warn' },
}
function RetestTab({ f, ro, roReason }: { f: Finding; ro: boolean; roReason: string }) {
  const identity = useFindingIdentity()
  const toast = useToastStore((s) => s.toast)
  const can = useCan()
  const me = useMe()
  const writes = useFindingWrites()
  const queryClient = useQueryClient()
  const evidence = useEvidenceList({})
  const [result, setResult] = useState('Resolved')
  const [note, setNote] = useState('')
  const [captureIds, setCaptureIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [tried, setTried] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [olderRetests, setOlderRetests] = useState<Finding['retests']>([])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const stageOk = ['confirmed', 'remediation', 'retest'].includes(f.status)
  const resolutionEvidence = [...new Map((evidence.data?.items ?? []).filter((item) => item.projectId === f.projectId && item.captureId && ['standard', 'sensitive'].includes(item.classification ?? '') && item.canViewOriginal).map((item) => [item.captureId, item])).values()]
  const roleOk = can('createFinding', f.projectId) || can('reviewFinding', f.projectId)
  const inputReason = ro ? roReason : !roleOk ? `The ${ROLE_LABEL[me.role]} role cannot record retests.` : !stageOk ? 'Retest is only available after the finding has been confirmed.' : ''
  const reason = inputReason || (result === 'Resolved' && f.status !== 'retest' ? 'Move the finding to retest before resolving it.' : result === 'Resolved' && captureIds.length === 0 ? 'Select at least one classified retained capture to resolve this finding.' : '')
  const save = async () => {
    setTried(true)
    if (!note.trim() || saving || reason) return
    setSaving(true)
    const requestScope: FindingRequestScope = { deploymentId: identity.deploymentId, actorId: identity.actorId, engagementId: f.projectId, findingId: f.id, action: 'retest', payload: { result, note: note.trim(), captureIds: [...captureIds].sort() } }
    try {
      const requestId = await findingRequestId(requestScope)
      const res = await writes.recordRetest(f.id, { result, note: note.trim(), requestId, expectedVersion: f.version ?? 1, captureIds })
      if (!res.ok) { setErr(res.failure.message); return }
      await clearFindingRequest(requestScope)
      toast(result === 'Resolved' ? `${f.id} was marked Resolved.` : 'Retest result recorded.', result === 'Resolved' ? 'ok' : 'warn')
      setNote(''); setTried(false); setErr(null); setCaptureIds([])
      await queryClient.invalidateQueries({ queryKey: ['finding'] })
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'The retest could not be saved.')
    } finally {
      setSaving(false)
    }
  }
  const retestCursor = cursor === undefined ? f.activityCursors?.retests ?? null : cursor
  const loadOlder = async () => {
    if (!retestCursor || loadingHistory) return
    setLoadingHistory(true)
    const page = await writes.loadActivity(f.id, 'retests', retestCursor, f.version ?? 1)
    setLoadingHistory(false)
    if (!page.ok) { setErr(page.failure.message); return }
    setOlderRetests((previous) => [...[...page.data.items].reverse().map((item) => ({ at: activityTime(item.createdAt), by: item.actorId, result: item.result ?? '', note: item.note ?? '' })), ...previous])
    setCursor(page.data.nextCursor)
  }
  return (
    <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
      <div>
        <div className="mb-3 text-sm font-semibold">Retest history</div>
        <Table
          rows={[...olderRetests, ...f.retests].reverse()} rowKey={(r) => r.at + r.by + r.note}
          empty={<Empty icon={RotateCcw} title="No retests yet">Current state: <b>Undetermined</b>. Record a result after the owner remediates.</Empty>}
          cols={[
            { key: 'at', header: 'Date', render: (r) => <span className="text-xs">{r.at}</span> },
            { key: 'by', header: 'Tester', render: (r) => r.by },
            { key: 'op', header: 'Source operation', hideBelow: 'md', render: () => <Mono>{f.op || '—'}</Mono> },
            { key: 'res', header: 'Result', render: (r) => { const m = RETEST_STATE[r.result] || { label: r.result, tone: 'neutral' as const }; return <Status kind="generic" value={m.tone} label={m.label} size="sm" /> } },
            { key: 'note', header: 'Notes', render: (r) => <span className="text-sm">{r.note}</span> },
          ]}
        />
        {retestCursor && <Button size="sm" variant="ghost" disabled={loadingHistory} onClick={() => { void loadOlder() }}>{loadingHistory ? 'Loading…' : 'Load older retests'}</Button>}
      </div>
      <Card>
        <CardHeader title="Record retest" sub="A “Resolved” result closes the finding." />
        {reason && <div className="mb-3"><Locked reason={reason} /></div>}
        {err && <Banner tone="bad" title="The retest was not recorded">{err}</Banner>}
        <div className="space-y-4">
          <Field label="Result" required><Select value={result} onChange={(e) => setResult(e.target.value)} disabled={!!inputReason || saving}><option value="Resolved">Resolved</option><option value="Persists">Still present</option><option value="Partial">Partially resolved</option></Select></Field>
          <Field label="Notes" required error={tried && !note.trim() ? 'Enter notes about the retest.' : undefined}><Textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={!!inputReason || saving} placeholder="Describe how you tested and what you observed" /></Field>
          {result === 'Resolved' && <fieldset disabled={!!inputReason || saving} className="space-y-2 rounded-lg border border-line p-3"><legend className="px-1 text-xs font-medium">Classified retained evidence (required to resolve)</legend>{resolutionEvidence.length === 0 ? <p className="text-xs text-muted">No readable classified captures are available. Upload and classify a capture in the Evidence tab; attaching it to the finding is not required for retest.</p> : resolutionEvidence.map((item) => <Check key={item.captureId} checked={captureIds.includes(item.captureId!)} onChange={(checked) => setCaptureIds((current) => checked ? [...new Set([...current, item.captureId!])] : current.filter((id) => id !== item.captureId))} label={`${item.name ?? item.ref} · ${item.classification}`} />)}</fieldset>}
          {evidence.isError && <p role="alert" className="text-xs text-bad">Retest capture inventory is unavailable. Reload before resolving.</p>}
          <div className="text-xs text-muted">Related operation: <Mono>{f.op || '—'}</Mono> · The server verifies evidence access and integrity before resolution.</div>
          <Button variant="primary" icon={RotateCcw} onClick={save} disabled={!!reason || saving} title={reason}>Record result</Button>
        </div>
      </Card>
    </div>
  )
}
