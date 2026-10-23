/**
 * Planning tab (plan P09, Planning slice) for the real project detail. The
 * handoff documents, the OPPLAN, the readiness and the one-way handoff come
 * from the planning port. A draft is edited on the server and published with a
 * digest precondition. Readiness is a runtime signal and never grants execution,
 * and an OPPLAN is never presented as business plan approval: a business plan is
 * a separate record, and none is recorded for this project here.
 */
import { useEffect, useState, type ReactElement } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Bot, Lock, PenLine, RefreshCw } from 'lucide-react'
import { go } from '../../router/navigate'
import { utcMinuteOr } from '../../platform/format'
import { Banner, Button, Card, CardHeader, DescList, Drawer, Segmented, Skeleton, Status, cx } from '../../ui/index'
import { useScopeRead } from '../scope'
import { PlanningError, usePlanningRead, usePlanningSource, usePlanningWrites } from './query'
import { agentRoleFor, planSummary, stepStates, type StepState } from './objectives'
import type { PlanningDocumentCard, PlanningDocumentState, PlanningObjective, PlanningOpplan } from './service'

const STATE_LABEL: Record<PlanningDocumentState, string> = { ready: 'Ready', missing: 'Missing', invalid: 'Invalid', unavailable: 'Unavailable' }
const NOT_READY_TEXT: Record<Exclude<PlanningDocumentState, 'ready'>, string> = {
  missing: 'This document has not been generated yet.',
  invalid: 'The stored document failed validation — regenerate it in the AI workspace or fix it in the draft editor.',
  unavailable: 'The document source is unavailable right now.',
}

const STEP_LABEL: Record<StepState, string> = { done: 'Done', running: 'Running', ready: 'Ready', blocked: 'Blocked', cancelled: 'Cancelled' }
const STEP_TEXT: Record<StepState, string> = { done: 'text-ok', running: 'text-primary', ready: 'text-fg', blocked: 'text-warn', cancelled: 'text-muted' }

type PlanSub = 'overview' | 'objectives' | 'documents' | 'reviews'

const SUB_OPTIONS: { id: PlanSub; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'objectives', label: 'Objectives & steps' },
  { id: 'documents', label: 'Documents' },
  { id: 'reviews', label: 'Reviews & versions' },
]

const messageOf = (error: unknown, fallback: string): string => (error instanceof PlanningError || error instanceof Error ? error.message : fallback)

/** A labelled value on the overview, with the text shown in place of a value the source does not record. */
function orNotRecorded(value: string | null): string {
  return value === null || value === '' ? 'Not recorded' : value
}

export function PlanningTab({ engagementId, handoffConfirmedAt, brief, updatedAt }: {
  engagementId: string
  handoffConfirmedAt: string | null
  brief: string | null
  updatedAt: string
}): ReactElement {
  const read = usePlanningRead(engagementId)
  const writes = usePlanningWrites(engagementId)
  const scope = useScopeRead()
  const [sub, setSub] = useState<PlanSub>('overview')
  const [actionError, setActionError] = useState<string | null>(null)
  const [editorName, setEditorName] = useState<string | null>(null)
  const [stepId, setStepId] = useState<string | null>(null)
  const confirm = useMutation({
    mutationFn: () => writes.confirm(),
    onSuccess: () => setActionError(null),
    onError: (error) => setActionError(messageOf(error, 'Confirming the handoff failed.')),
  })

  if (read.isPending) {
    return <div className="space-y-4" aria-busy="true" role="status"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>
  }
  if (read.isError || !read.data) {
    return (
      <div className="mx-auto max-w-xl pt-8 text-center" role="alert">
        <h2 className="text-base font-semibold">Could not load planning documents</h2>
        <p className="mt-2 break-words text-sm text-muted">{messageOf(read.error, 'The planning documents could not be loaded.')}</p>
        <Button variant="primary" className="mt-4" icon={RefreshCw} onClick={() => void read.refetch()}>Try again</Button>
      </div>
    )
  }
  const view = read.data
  const editorCard = editorName === null ? null : [...view.documents, view.opplan].find((c) => c.name === editorName) ?? null
  const objectives = view.opplan.objectives
  const states = stepStates(objectives)
  const summary = planSummary(objectives)
  const readyCount = view.documents.filter((card) => card.state === 'ready').length
  const handoffOpen = handoffConfirmedAt === null
  const approvedVersion = scope.data?.latestApprovedVersion ?? null
  const selected = stepId === null ? null : objectives.find((o) => o.id === stepId) ?? null

  const next = !view.ready
    ? { title: 'Complete the planning documents', why: view.reasons.join(' '), label: 'Review documents', tab: 'documents' as const }
    : handoffOpen
      ? { title: 'Complete the planning handoff', why: 'The documents are ready; confirm the handoff after you review them', label: 'Confirm handoff', tab: 'reviews' as const }
      : { title: 'Prepare execution', why: 'The handoff is confirmed. Preflight decides each run on its own thread.', label: 'Open Operations', tab: 'execution' as const }

  return (
    <div className="space-y-4">
      {actionError !== null && <Banner tone="bad" title="Handoff confirmation failed" action={<Button size="sm" variant="ghost" onClick={() => setActionError(null)}>Dismiss</Button>}>{actionError}</Banner>}

      <Card>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-xs">
          <span className="inline-flex items-center gap-1.5"><span className="text-muted">Current plan</span><span className="font-medium text-fg">OPPLAN · {STATE_LABEL[view.opplan.state]}</span></span>
          <span className="inline-flex items-center gap-1.5"><span className="text-muted">Scope &amp; ROE reference</span><span className="font-mono font-medium text-fg">{scope.isError ? 'unavailable' : scope.data ? (approvedVersion === null ? 'none approved' : `approved v${approvedVersion}`) : 'reading'}</span></span>
          <span className="inline-flex items-center gap-1.5"><span className="text-muted">Project updated</span><span className="text-fg">{utcMinuteOr(updatedAt)}</span></span>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
          <Button variant="secondary" icon={Bot} onClick={() => go('project', { id: engagementId, tab: 'ai-workspace' })}>Continue planning with AI</Button>
          <Button variant="secondary" onClick={() => setSub('reviews')}>Review changes</Button>
          <Button variant="primary" title="Opens Execution. Preflight decides whether a run can start." onClick={() => go('project', { id: engagementId, tab: 'operations' })}>Prepare execution</Button>
        </div>
      </Card>

      <Segmented<PlanSub> value={sub} onChange={setSub} options={SUB_OPTIONS} />

      {sub === 'overview' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Mission brief" sub="The engagement's purpose, as briefed and as the CONOPS records it." />
            <div className="space-y-3 p-4 text-sm">
              <p className="whitespace-pre-wrap">{orNotRecorded(brief)}</p>
              <div>
                <div className="text-xs font-medium text-muted">Success criteria</div>
                {view.successCriteria.length === 0 ? <p className="text-muted">None recorded in the CONOPS.</p> : (
                  <ul className="mt-1 list-inside list-disc">{view.successCriteria.map((c) => <li key={c}>{c}</li>)}</ul>
                )}
              </div>
              {view.opplan.threatProfile !== null && <p><span className="font-medium text-fg">Threat profile:</span> {view.opplan.threatProfile}</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Plan summary" sub="Each objective counted once, by the step state it is in." />
            <div className="p-4">
              <DescList
                items={[
                  { k: 'Objectives', v: String(summary.total) },
                  { k: 'Done (results)', v: String(summary.done) },
                  { k: 'Running', v: String(summary.running) },
                  { k: 'Ready to start', v: String(summary.ready) },
                  { k: 'Blocked', v: String(summary.blocked) },
                  { k: 'Cancelled', v: String(summary.cancelled) },
                ]}
              />
              <p className="mt-3 text-xs text-muted">Expected outputs are not recorded in the OPPLAN schema, so none is counted as present or missing.</p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Next action" />
            <div className="space-y-3 p-4 text-sm">
              <div>
                <div className="font-medium">{next.title}</div>
                <div className="text-xs text-muted">{next.why}</div>
              </div>
              <p className="text-xs text-muted">Documents: {readyCount} of {view.documents.length} ready · Scope: {approvedVersion === null ? 'no approved revision' : `approved v${approvedVersion}`} · Handoff: {handoffOpen ? 'not confirmed' : 'confirmed'}</p>
              <div>
                <Button variant="primary" onClick={() => next.tab === 'execution' ? go('project', { id: engagementId, tab: 'operations' }) : setSub(next.tab)}>{next.label}</Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Business plan" sub="A separate record with its own review and approval." />
            <p className="p-4 text-sm text-muted">No business plan is recorded for this project. The OPPLAN is the operational plan and is not a reviewer-approved business plan.</p>
          </Card>
        </div>
      )}

      {sub === 'objectives' && (
        <Card>
          <CardHeader title="Objectives & steps" sub="Each OPPLAN objective as a step: its state, the agent role its phase is routed to, and what it must show to be verified." />
          <div className="p-4 text-sm" data-testid="plan-doc-opplan">
            {view.opplan.state !== 'ready' ? (
              <OpplanState engagementId={engagementId} opplan={view.opplan} />
            ) : objectives.length === 0 ? (
              <p className="text-muted">No objectives yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th className="pb-2 pr-3 font-medium">Objective</th>
                      <th className="pb-2 pr-3 font-medium">Agent role</th>
                      <th className="pb-2 pr-3 font-medium">Step state</th>
                      <th className="pb-2 pr-3 font-medium">Blocked by</th>
                      <th className="pb-2 pr-3 font-medium">Success criteria</th>
                      <th className="pb-2 font-medium"><span className="sr-only">Details</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {objectives.map((o) => {
                      const state = states.get(o.id) ?? 'ready'
                      const role = agentRoleFor(o.phase)
                      return (
                        <tr key={o.id} className="border-b border-line align-top last:border-0">
                          <td className="py-2.5 pr-3">
                            <div className="font-mono text-xs text-muted">{o.id} · {o.phase}</div>
                            <div className="font-medium">{o.title}</div>
                          </td>
                          <td className="py-2.5 pr-3 text-xs">{role ?? 'Not defined for this phase'}</td>
                          <td className={cx('py-2.5 pr-3 text-xs font-medium', STEP_TEXT[state])}>{STEP_LABEL[state]}</td>
                          <td className="py-2.5 pr-3 font-mono text-xs">{o.blockedBy.join(', ') || '—'}</td>
                          <td className="py-2.5 pr-3 text-xs text-muted">{o.acceptanceCriteria.length === 0 ? 'None recorded' : `${o.acceptanceCriteria.length} criteria`}</td>
                          <td className="py-2.5"><Button size="sm" variant="ghost" onClick={() => setStepId(o.id)}>Details</Button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {objectives.length > 0 && (
              <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
                Execution links: this console does not link an objective to its runtime thread, so no step shows a run here. Results and verification come from the run, not from the plan.
              </p>
            )}
          </div>
        </Card>
      )}

      {sub === 'documents' && (
        <Card>
          <CardHeader title="Planning documents" sub="Generated in the AI workspace and stored in the engagement workspace. These are the documents the handoff depends on. The OPPLAN has its own tab." actions={<Button size="sm" variant="secondary" icon={Bot} onClick={() => go('project', { id: engagementId, tab: 'ai-workspace' })}>Open AI workspace</Button>} />
          <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
            {view.documents.map((card) => <DocumentCard key={card.name} engagementId={engagementId} card={card} onEdit={setEditorName} />)}
          </div>
        </Card>
      )}

      {sub === 'reviews' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader title="Planning handoff" sub="One-way confirmation after you review the planning documents. On a single-operator engagement it also approves the scope planned in roe.json. It can be set once and is never unset by the UI." />
              <p className="px-4 text-sm">
                {handoffConfirmedAt ? <span className="text-ok">Confirmed at {utcMinuteOr(handoffConfirmedAt)}</span> : <span className="text-muted">Not confirmed yet.</span>}
              </p>
              {!handoffConfirmedAt && (
                <div className="mt-3 px-4 pb-4">
                  <Button variant="primary" icon={Lock} disabled={confirm.isPending || !view.ready} title={view.ready ? 'Confirms planning handoff on the server (one-way)' : 'Required planning documents must be ready before handoff'}
                    onClick={() => { setActionError(null); confirm.mutate() }}>
                    {confirm.isPending ? 'Confirming…' : 'Confirm planning handoff'}
                  </Button>
                </div>
              )}
            </Card>
            <Card>
              <CardHeader title="Readiness" />
              <div className="p-4">
                <DescList
                  items={[
                    { k: 'State', v: <Status kind="gate" value={view.ready ? 'passed' : 'pending'} size="sm" label={view.ready ? 'Ready' : 'Blocked'} /> },
                    { k: 'Runtime signal', v: view.runtimeSignal },
                    { k: 'Reasons', v: view.reasons.length === 0 ? 'None' : view.reasons.join(' ') },
                  ]}
                />
              </div>
            </Card>
          </div>
          <Card>
            <CardHeader title="Document review" sub="The state of each planning document, read from its source." />
            <ul className="divide-y divide-line px-4">
              {[...view.documents, view.opplan].map((card) => (
                <li key={card.name} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="font-medium">{card.title}</span>
                  <span className="flex items-center gap-3">
                    <Status kind="gate" value={card.state === 'ready' ? 'passed' : card.state === 'invalid' ? 'failed' : 'pending'} size="sm" label={STATE_LABEL[card.state]} />
                    {card.name !== 'opplan' && <Button size="sm" variant="ghost" onClick={() => setEditorName(card.name)}>Source</Button>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="px-4 pb-4 pt-3 text-xs text-muted">The planning read carries no version history. Each document&apos;s published digest is shown in its source view. {readyCount} of {view.documents.length} documents are ready.</p>
          </Card>
        </div>
      )}

      <Drawer open={selected !== null} onClose={() => setStepId(null)} title={selected ? `${selected.id} · ${selected.title}` : ''} width={640}>
        {selected !== null && <StepDetail objective={selected} state={states.get(selected.id) ?? 'ready'} />}
      </Drawer>

      <Drawer open={editorCard !== null} onClose={() => setEditorName(null)} title={editorCard ? `${editorCard.title} — source & draft` : ''} width={760}>
        {editorCard !== null && editorName !== null && (
          <DocumentEditor engagementId={engagementId} name={editorName} title={editorCard.title} onClose={() => setEditorName(null)} writes={writes} />
        )}
      </Drawer>
    </div>
  )
}

/** One step's full record. A field the runtime did not write is shown as not recorded, never as an empty value. */
function StepDetail({ objective, state }: { objective: PlanningObjective; state: StepState }): ReactElement {
  return (
    <div className="space-y-4 text-sm">
      <DescList
        items={[
          { k: 'Phase', v: objective.phase },
          { k: 'Agent role', v: agentRoleFor(objective.phase) ?? 'Not defined for this phase' },
          { k: 'Plan status', v: objective.status },
          { k: 'Step state', v: STEP_LABEL[state] },
          { k: 'Blocked by', v: objective.blockedBy.join(', ') || 'Nothing' },
          { k: 'Priority', v: objective.priority === null ? 'Not recorded' : String(objective.priority) },
          { k: 'Owner', v: orNotRecorded(objective.owner) },
          { k: 'Parent objective', v: orNotRecorded(objective.parentId) },
          { k: 'Effects', v: orNotRecorded(objective.effects) },
          { k: 'OPSEC', v: orNotRecorded(objective.opsec) },
          { k: 'C2 tier', v: orNotRecorded(objective.c2Tier) },
          { k: 'Resources', v: objective.resources.join(', ') || 'Not recorded' },
          { k: 'MITRE', v: objective.mitre.join(', ') || 'Not recorded' },
        ]}
      />
      <div>
        <div className="text-xs font-medium text-muted">Description</div>
        <p className="mt-1 whitespace-pre-wrap">{orNotRecorded(objective.description)}</p>
      </div>
      <div>
        <div className="text-xs font-medium text-muted">Success criteria</div>
        {objective.acceptanceCriteria.length === 0 ? <p className="mt-1 text-muted">None recorded.</p> : (
          <ul className="mt-1 list-inside list-disc">{objective.acceptanceCriteria.map((c) => <li key={c}>{c}</li>)}</ul>
        )}
      </div>
      <div>
        <div className="text-xs font-medium text-muted">Notes</div>
        <p className="mt-1 whitespace-pre-wrap">{orNotRecorded(objective.notes)}</p>
      </div>
      <p className="border-t border-line pt-3 text-xs text-muted">Expected outputs and the run that produced them are not recorded on the plan, so this step shows no run and no evidence.</p>
    </div>
  )
}

/** The OPPLAN's own state when it has no objectives to show: not created yet, invalid, or unavailable. */
function OpplanState({ engagementId, opplan }: { engagementId: string; opplan: PlanningOpplan }): ReactElement {
  if (opplan.state === 'missing') {
    return <p className="text-muted">Not created yet. The operations agent creates OPPLAN after the planning handoff, so there is nothing to review here before then.</p>
  }
  if (opplan.state === 'invalid') {
    return (
      <div className="space-y-2">
        <p className="text-muted">The stored OPPLAN failed validation. The operations agent owns this document; the errors below show what is wrong with it.</p>
        <InvalidDocumentErrors engagementId={engagementId} name="opplan" />
      </div>
    )
  }
  return <p className="text-muted">The OPPLAN source is unavailable right now.</p>
}

/** The schema errors of a stored document that fails validation, read from the same source query the editor uses. */
function InvalidDocumentErrors({ engagementId, name }: { engagementId: string; name: string }): ReactElement {
  const source = usePlanningSource(engagementId, name)
  if (source.isPending) return <Skeleton className="mt-3 h-12" />
  if (source.isError || !source.data) {
    return <p className="mt-3 text-xs text-bad" role="alert">{messageOf(source.error, 'The stored document could not be read.')}</p>
  }
  const errors = source.data.errors
  if (errors.length === 0) return <></>
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-fg">Schema errors ({errors.length})</p>
      <ul className="mt-1 list-inside list-disc break-words text-xs text-bad">
        {errors.slice(0, 5).map((error) => <li key={error}>{error}</li>)}
      </ul>
      {errors.length > 5 && <p className="mt-1 text-xs text-muted">{errors.length - 5} more — open the source to see all of them.</p>}
    </div>
  )
}

function DocumentCard({ engagementId, card, onEdit }: { engagementId: string; card: PlanningDocumentCard; onEdit: (name: string) => void }): ReactElement {
  const ready = card.state === 'ready'
  return (
    <div className={cx('rounded-xl border p-4', ready ? 'border-line bg-panel' : 'border-line bg-subtle')} data-testid={`plan-doc-${card.name}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{card.title}</h3>
        <Status kind="gate" value={ready ? 'passed' : card.state === 'invalid' ? 'failed' : 'pending'} size="sm" label={STATE_LABEL[card.state]} />
      </div>
      {ready ? (
        <div className="mt-2 space-y-2 text-xs text-muted">
          {card.body !== null && <p className="whitespace-pre-wrap text-sm text-fg">{card.body}</p>}
          {card.facts.length > 0
            ? <DescList items={card.facts.map((f) => ({ k: f.label, v: f.value }))} />
            : <p>Generated by the planner. Open the source to review it before confirming the handoff.</p>}
        </div>
      ) : card.state !== 'ready' ? (
        <p className="mt-2 text-xs text-muted">{NOT_READY_TEXT[card.state]}</p>
      ) : null}
      {card.state === 'invalid' && <InvalidDocumentErrors engagementId={engagementId} name={card.name} />}
      <Button size="sm" variant="secondary" className="mt-3" icon={PenLine} onClick={() => onEdit(card.name)}>
        {ready ? 'View source & draft' : card.state === 'missing' ? 'Draft this document' : 'Open draft editor'}
      </Button>
    </div>
  )
}

/**
 * O06 (ADR-0083): source/draft editor for one planning document. The server holds
 * the draft and enforces the digest precondition: saving or publishing with a
 * stale base answers 409 instead of clobbering either a concurrent browser edit
 * or a model rewrite. ROE cannot be published here.
 */
function DocumentEditor({ engagementId, name, title, onClose, writes }: { engagementId: string; name: string; title: string; onClose: () => void; writes: ReturnType<typeof usePlanningWrites> }): ReactElement {
  const source = usePlanningSource(engagementId, name)
  const [text, setText] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const data = source.data
  useEffect(() => {
    if (data && text === null) setText(data.draft ?? data.source ?? '')
  }, [data, text])
  const baseDigest = data?.digest ?? null
  const savedDraft = data?.draft ?? null
  const dirty = text !== null && text !== (savedDraft ?? data?.source ?? '')
  const roeNote = data?.publishable === false

  const save = useMutation({
    mutationFn: () => writes.save(name, { body: text ?? '', baseDigest }),
    onSuccess: () => setNotice({ tone: 'ok', text: 'Draft saved server-side — it survives refresh and restarts and is not visible to agents.' }),
    onError: (error) => setNotice({ tone: 'bad', text: messageOf(error, 'Saving the draft failed.') }),
  })
  const publish = useMutation({
    mutationFn: () => writes.publish(name, { body: text ?? '', baseDigest }),
    onSuccess: () => setNotice({ tone: 'ok', text: 'Published to the engagement workspace with the digest precondition; agents read the new version on their next load.' }),
    onError: (error) => setNotice({ tone: 'bad', text: messageOf(error, 'Publishing failed.') }),
  })
  const discard = useMutation({
    mutationFn: () => writes.discard(name),
    onSuccess: async () => {
      // Re-seed from the refetched source: the cached draft is still present until it lands.
      const fresh = await source.refetch()
      setText(fresh.data ? fresh.data.source ?? '' : null)
      setNotice({ tone: 'ok', text: 'Draft discarded — the editor now shows the published source.' })
    },
    onError: (error) => setNotice({ tone: 'bad', text: messageOf(error, 'Discarding the draft failed.') }),
  })

  return (
    <div data-testid={`document-editor-${name}`} className="space-y-3">
      <p className="text-sm text-muted">{roeNote ? 'ROE is governed by the Scope & ROE revision workflow; publishing the file from the console is refused.' : 'Edits are server-side drafts. Publish validates the schema and replaces the workspace file only if it has not changed since you loaded it.'}</p>
      {notice && <Banner tone={notice.tone} title={notice.text} action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>} />}
      {data !== undefined && data.valid === false && data.source !== null && (
        <Banner tone="warn" title="The published document currently fails schema validation">
          <ul className="list-inside list-disc">{data.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>
        </Banner>
      )}
      {source.isPending ? (
        <div className="space-y-2" aria-busy="true" role="status"><Skeleton className="h-40" /></div>
      ) : source.isError || !data ? (
        <p className="text-sm text-bad" role="alert">{messageOf(source.error, 'The document source could not be loaded.')}</p>
      ) : (
        <>
          <textarea
            aria-label={`${title} draft`}
            className="mt-3 h-64 w-full rounded-xl border border-line bg-subtle p-3 font-mono text-xs text-fg"
            spellCheck={false}
            value={text ?? ''}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={save.isPending || !dirty} onClick={() => { setNotice(null); save.mutate() }}>
              {save.isPending ? 'Saving…' : dirty || savedDraft === null ? 'Save draft' : 'Draft saved'}
            </Button>
            {!roeNote && (
              <Button variant="secondary" disabled={publish.isPending || save.isPending} onClick={() => { setNotice(null); publish.mutate() }}>
                {publish.isPending ? 'Publishing…' : 'Publish to workspace'}
              </Button>
            )}
            {savedDraft !== null && (
              <Button variant="ghost" disabled={discard.isPending} onClick={() => { setNotice(null); discard.mutate() }}>
                {discard.isPending ? 'Discarding…' : 'Discard draft'}
              </Button>
            )}
            <Button variant="ghost" icon={RefreshCw} onClick={() => { setText(null); setNotice(null); void source.refetch() }}>Reload</Button>
            <Button variant="ghost" onClick={onClose}>Close editor</Button>
            <span className="ml-auto text-xs text-muted">
              {dirty ? 'Unsaved local edits' : savedDraft !== null ? 'Server draft loaded' : 'Published source loaded'}
              {baseDigest !== null && ` · base ${baseDigest.slice(0, 12)}`}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
