/**
 * Real planning panel (integration ticket 04): the engagement's actual plan
 * documents, bundle states, readiness and the one-way handoff confirmation.
 * Readiness is a runtime signal only — it never grants execution permission,
 * and an OPPLAN document is never presented as business plan approval (D2).
 */
import { useEffect, useState, type ReactElement } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, CheckCircle2, CircleAlert, FileText, Lock, PenLine, RefreshCw } from 'lucide-react'
import { PLANNING_DOCUMENTS, type ConopsView, type DeconflictionView, type OpplanView, type PlanningDocument, type PlanningDocumentName, type PlanningView, type PlanningState, type RoEView } from '@raptix/web-contracts'
import { confirmHandoff, discardDocumentDraft, fetchDocumentSource, fetchPlanning, publishDocumentDraft, saveDocumentDraft } from '../api'
import { projectKeys } from '../queries'
import { go } from '../../router/navigate'
import { Banner, Button, Card, CardHeader, DescList, Drawer, Skeleton, Status, cx } from '../../ui'
import { utcMinuteOr } from '../format'

/* The four documents with a summary card; the rest of the PREPARE bundle is reviewed through BundleDocCard. */
/* OPPLAN is the living operational plan, not part of the handoff. */
const HANDOFF_DOCUMENTS = PLANNING_DOCUMENTS.filter((name) => name !== 'opplan')
const PREPARE_DOCUMENTS_WITHOUT_CARD: readonly PlanningDocumentName[] = ['threat-profile', 'contact', 'data-handling', 'abort', 'cleanup']
const READINESS_TEXT: Record<string, string> = {
  authorization_not_confirmed: 'Authorization is not confirmed for this engagement.',
  metadata_needs_review: 'The stored target has not been verified yet.',
  engagement_name_mismatch: 'The planning documents disagree on the engagement name.',
  authorization_reference_missing: 'The ROE has no authorization reference.',
  target_not_in_scope: 'The ROE in_scope list does not contain the engagement target.',
}
const DOCUMENT_STATE_TEXT: Record<string, string> = { missing: 'is not drafted yet', invalid: 'fails schema validation', unavailable: 'cannot be read right now' }

/** The server's machine reasons (`roe:missing`, `target_not_in_scope`) as a sentence the operator can act on. */
function describeReadinessReason(reason: string): string {
  const [name, state] = reason.split(':').map((part) => part.trim())
  if (state !== undefined && name in PLANNING_DOCUMENT_TITLES && state in DOCUMENT_STATE_TEXT) return `${PLANNING_DOCUMENT_TITLES[name]} ${DOCUMENT_STATE_TEXT[state]}.`
  return READINESS_TEXT[reason] ?? reason
}

const STATE_TONE: Record<PlanningState, 'ok' | 'bad' | 'warn' | 'neutral'> ={ ready: 'ok', missing: 'neutral', invalid: 'bad', unavailable: 'warn' }
const STATE_LABEL: Record<PlanningState, string> = { ready: 'Ready', missing: 'Missing', invalid: 'Invalid', unavailable: 'Unavailable' }
const PLANNING_DOCUMENT_TITLES: Record<string, string> = {
  roe: 'Rules of Engagement', conops: 'Concept of Operations', deconfliction: 'Deconfliction', opplan: 'Operation Plan (OPPLAN)',
  'threat-profile': 'Threat Profile', contact: 'Contact', 'data-handling': 'Data Handling', abort: 'Abort', cleanup: 'Cleanup',
}

export function RealPlanningPanel({ engagementId, handoffConfirmedAt }: { engagementId: string; handoffConfirmedAt: string | null }): ReactElement {
  const client = useQueryClient()
  const planning = useQuery({ queryKey: ['real', 'planning', engagementId], queryFn: () => fetchPlanning(engagementId) })
  const [patchError, setPatchError] = useState<string | null>(null)
  const [editorName, setEditorName] = useState<string | null>(null)
  const confirm = useMutation({
    mutationFn: () => confirmHandoff(engagementId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['real', 'planning'] })
      void client.invalidateQueries({ queryKey: projectKeys.detail(engagementId) })
      void client.invalidateQueries({ queryKey: ['real', 'projects'] })
    },
    onError: (error) => setPatchError(error instanceof Error ? error.message : 'Confirming the handoff failed.'),
  })

  if (planning.isPending) {
    return <div className="space-y-4" aria-busy="true" role="status"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>
  }
  if (planning.isError || !planning.data) {
    const message = planning.error instanceof Error ? planning.error.message : 'The planning documents could not be loaded.'
    return (
      <div className="mx-auto max-w-xl pt-8 text-center" role="alert">
        <h2 className="text-base font-semibold">Could not load planning documents</h2>
        <p className="mt-2 break-words text-sm text-muted">{message}</p>
        <Button variant="primary" className="mt-4" icon={RefreshCw} onClick={() => void planning.refetch()}>Try again</Button>
      </div>
    )
  }
  const view: PlanningView = planning.data
  const editorDoc = editorName === null ? null : PLANNING_DOCUMENTS.includes(editorName as (typeof PLANNING_DOCUMENTS)[number]) ? PLANNING_DOCUMENT_TITLES[editorName] : null

  return (
    <div className="space-y-4">
      {view.readiness.state === 'ready' ? (
        <Banner tone="ok" icon={CheckCircle2} title="Planning documents ready">
          All required documents are present and valid. Review each document, then confirm the planning handoff. Readiness is a runtime signal — execution still requires the approved lifecycle steps and never follows from this banner alone.
        </Banner>
      ) : (
        <Banner tone="warn" icon={CircleAlert} title="Planning is blocked">
          <ul className="list-inside list-disc">
            {view.readiness.reasons.map((reason) => <li key={reason} title={reason}>{describeReadinessReason(reason)}</li>)}
          </ul>
        </Banner>
      )}
      {patchError && <Banner tone="bad" title="Handoff confirmation failed" action={<Button size="sm" variant="ghost" onClick={() => setPatchError(null)}>Dismiss</Button>}>{patchError}</Banner>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Plan documents" sub="Generated in the AI workspace and stored in the engagement workspace. These are the documents the handoff depends on; the OPPLAN is shown separately below." />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <PlanCard engagementId={engagementId} name="roe" title="Rules of Engagement" onEdit={setEditorName} doc={view.documents.roe} render={(c) => (
                <DescList
                  items={[
                    { k: 'Engagement type', v: c.engagement_type },
                    { k: 'Window', v: `${c.start_date} → ${c.end_date}` },
                    { k: 'Testing window', v: c.testing_window },
                    { k: 'Authorization', v: c.authorization_reference ?? 'Not recorded' },
                    { k: 'Scope', v: `${(c.in_scope ?? []).length} in / ${(c.out_of_scope ?? []).length} out` },
                    { k: 'Prohibited actions', v: String((c.prohibited_actions ?? []).length) },
                  ]}
                />
              )} />
              <PlanCard engagementId={engagementId} name="conops" title="Concept of Operations" onEdit={setEditorName} doc={view.documents.conops} render={(c) => (
                <div className="space-y-2">
                  <p className="whitespace-pre-wrap text-sm text-fg">{c.executive_summary}</p>
                  {c.success_criteria && c.success_criteria.length > 0 && <p><span className="font-medium text-fg">Success criteria:</span> {c.success_criteria.join('; ')}</p>}
                </div>
              )} />
              <PlanCard engagementId={engagementId} name="deconfliction" title="Deconfliction" onEdit={setEditorName} doc={view.documents.deconfliction} render={(c) => (
                <DescList
                  items={[
                    { k: 'SOC contact', v: c.soc_contact ?? 'Not recorded' },
                    { k: 'Notification', v: c.notification_procedure ?? 'Not recorded' },
                    { k: 'Identifiers', v: String((c.identifiers ?? []).length) },
                  ]}
                />
              )} />
              {PREPARE_DOCUMENTS_WITHOUT_CARD.map((name) => (
                <BundleDocCard key={name} engagementId={engagementId} name={name} title={PLANNING_DOCUMENT_TITLES[name] ?? name} state={view.bundle[name]} onEdit={setEditorName} />
              ))}
            </div>
          </Card>
          <OpplanCard engagementId={engagementId} doc={view.documents.opplan} />
          <Card>
            <CardHeader title="Document bundle" sub="Every required planning document and its current state." />
            <ul className="flex flex-wrap gap-2">
              {HANDOFF_DOCUMENTS.map((name) => {
                const state = view.bundle[name]
                return (
                  <li key={name} className={cx('inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium', {
                    ok: 'border-ok/30 bg-ok-soft text-ok', bad: 'border-bad/30 bg-bad-soft text-bad', warn: 'border-warn/30 bg-warn-soft text-warn', neutral: 'border-line bg-subtle text-muted',
                  }[STATE_TONE[state]])}>
                    <FileText size={12} aria-hidden />{name}: {STATE_LABEL[state]}
                  </li>
                )
              })}
            </ul>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Planning handoff" sub="One-way confirmation after you review the planning documents. On a single-operator engagement it also approves the scope planned in roe.json. It can be set once and is never unset by the UI." />
            <p className="text-sm">
              {handoffConfirmedAt ? <span className="text-ok">Confirmed at {utcMinuteOr(handoffConfirmedAt)}</span> : <span className="text-muted">Not confirmed yet.</span>}
            </p>
            {!handoffConfirmedAt && (
              <div className="mt-3">
                <Button variant="primary" icon={Lock} disabled={confirm.isPending || view.readiness.state !== 'ready'} title={view.readiness.state === 'ready' ? 'Confirms planning handoff on the server (one-way)' : 'Required planning documents must be ready before handoff'}
                  onClick={() => { setPatchError(null); confirm.mutate() }}>
                  {confirm.isPending ? 'Confirming…' : 'Confirm planning handoff'}
                </Button>
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="AI workspace" />
            <p className="text-sm text-muted">Plan documents are drafted with the assistant in the engagement's planning conversations.</p>
            <div className="mt-3">
              <Button variant="secondary" icon={Bot} onClick={() => go('project', { id: engagementId, tab: 'ai-workspace' })}>Open AI workspace</Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Readiness" />
            <DescList
              items={[
                { k: 'State', v: <Status kind="gate" value={view.readiness.state === 'ready' ? 'passed' : 'pending'} size="sm" label={view.readiness.state === 'ready' ? 'Ready' : 'Blocked'} /> },
                { k: 'Runtime signal', v: view.readiness.runtimeSignal },
                { k: 'Reasons', v: view.readiness.reasons.length === 0 ? 'None' : view.readiness.reasons.map(describeReadinessReason).join(' ') },
              ]}
            />
          </Card>
        </div>
      </div>
      <Drawer open={editorDoc !== null && editorName !== null} onClose={() => setEditorName(null)} title={editorDoc ? `${editorDoc} — source & draft` : ''} width={760}>
        {editorDoc !== null && editorName !== null && (
          <DocumentEditor engagementId={engagementId} name={editorName} title={editorDoc} onClose={() => setEditorName(null)} />
        )}
      </Drawer>
    </div>
  )
}

/** The schema errors of a stored document that exists but fails validation, read from the same source query the editor uses. */
function InvalidDocumentErrors({ engagementId, name }: { engagementId: string; name: string }): ReactElement {
  const source = useQuery({ queryKey: ['real', 'document', engagementId, name], queryFn: () => fetchDocumentSource(engagementId, name) })
  if (source.isPending) return <Skeleton className="mt-3 h-12" />
  if (source.isError || !source.data) {
    return <p className="mt-3 text-xs text-bad" role="alert">{source.error instanceof Error ? source.error.message : 'The stored document could not be read.'}</p>
  }
  const errors = source.data.validation.errors
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

/**
 * The living operational plan (OPPLAN), in full. The operations agent creates it
 * after the planning handoff and updates it on every objective change during
 * execution, so it sits beside the planning documents and never gates the handoff.
 */
function OpplanCard({ engagementId, doc }: { engagementId: string; doc: PlanningDocument<OpplanView> }): ReactElement {
  return (
    <Card>
      <CardHeader title="Operation Plan (OPPLAN)" sub="The living operational plan: the operations agent creates it after the planning handoff and updates it on every objective change during execution." />
      <div className="p-4 text-sm" data-testid="plan-doc-opplan">
        {doc.state === 'ready' ? (
          <div className="space-y-3">
            <p><span className="font-medium text-fg">Threat profile:</span> {doc.content.threat_profile}</p>
            {(doc.content.objectives ?? []).length === 0 ? (
              <p className="text-muted">No objectives yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="pb-2 pr-3">ID</th><th className="pb-2 pr-3">Objective</th><th className="pb-2 pr-3">Phase</th><th className="pb-2 pr-3">Status</th><th className="pb-2 pr-3">Blocked by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(doc.content.objectives ?? []).map((o) => (
                      <tr key={o.id} className="border-t border-line align-top">
                        <td className="py-2 pr-3 font-mono text-xs">{o.id}</td>
                        <td className="py-2 pr-3"><div className="font-medium">{o.title}</div><p className="mt-1 text-xs text-muted">{o.description}</p></td>
                        <td className="py-2 pr-3 text-xs">{o.phase}</td>
                        <td className="py-2 pr-3 text-xs">{o.status ?? 'pending'}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{(o.blocked_by ?? []).join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : doc.state === 'missing' ? (
          <p className="text-muted">Not created yet. The operations agent creates OPPLAN after the planning handoff, so there is nothing to review here before then.</p>
        ) : doc.state === 'invalid' ? (
          <div className="space-y-2">
            <p className="text-muted">The stored OPPLAN failed validation. The operations agent owns this document; the errors below show what is wrong with it.</p>
            <InvalidDocumentErrors engagementId={engagementId} name="opplan" />
          </div>
        ) : (
          <p className="text-muted">The OPPLAN source is unavailable right now.</p>
        )}
      </div>
    </Card>
  )
}

/** A PREPARE document the console does not summarize: reviewed through its source, the same as the typed cards. */
function BundleDocCard({ engagementId, name, title, state, onEdit }: { engagementId: string; name: string; title: string; state: PlanningState; onEdit: (name: string) => void }): ReactElement {
  if (state !== 'ready') return <DocUnavailable engagementId={engagementId} name={name} title={title} state={state} onEdit={onEdit} />
  return (
    <div className="rounded-xl border border-line bg-panel p-4" data-testid={`plan-doc-${name}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Status kind="gate" value="passed" size="sm" label="Ready" />
      </div>
      <p className="mt-2 text-xs text-muted">Generated by the planner. Open the source to review it before confirming the handoff.</p>
      <Button size="sm" variant="secondary" className="mt-3" icon={PenLine} onClick={() => onEdit(name)}>View source & draft</Button>
    </div>
  )
}

function DocUnavailable({ engagementId, name, title, state, onEdit }: { engagementId: string; name: string; title: string; state: Exclude<PlanningState, 'ready'>; onEdit: (name: string) => void }): ReactElement {
  return (
    <div className="rounded-xl border border-line bg-subtle p-4" data-testid={`plan-doc-${name}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Status kind="gate" value={state === 'invalid' ? 'failed' : 'pending'} size="sm" label={STATE_LABEL[state]} />
      </div>
      <p className="mt-2 text-xs text-muted">
        {state === 'missing' ? 'This document has not been generated yet.' : state === 'invalid' ? 'The stored document failed validation — regenerate it in the AI workspace or fix it in the draft editor.' : 'The document source is unavailable right now.'}
      </p>
      {state === 'invalid' && <InvalidDocumentErrors engagementId={engagementId} name={name} />}
      <Button size="sm" variant="secondary" className="mt-3" icon={PenLine} onClick={() => onEdit(name)}>
        {state === 'missing' ? 'Draft this document' : 'Open draft editor'}
      </Button>
    </div>
  )
}

function PlanCard<T extends RoEView | ConopsView | DeconflictionView | OpplanView>({ engagementId, name, title, doc, render, onEdit }: {
  engagementId: string
  name: string
  title: string
  doc: PlanningDocument<T>
  render: (content: T) => ReactElement
  onEdit: (name: string) => void
}): ReactElement {
  if (doc.state !== 'ready') return <DocUnavailable engagementId={engagementId} name={name} title={title} state={doc.state} onEdit={onEdit} />
  return (
    <div className="rounded-xl border border-line bg-panel p-4" data-testid={`plan-doc-${name}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Status kind="gate" value="passed" size="sm" label="Ready" />
      </div>
      <div className="mt-2 text-xs text-muted">{render(doc.content)}</div>
      <Button size="sm" variant="secondary" className="mt-3" icon={PenLine} onClick={() => onEdit(name)}>View source & draft</Button>
    </div>
  )
}

/**
 * O06 (ADR-0083): source/draft editor for one allowlisted planning document.
 * The server holds the draft and enforces the digest precondition: saving or
 * publishing with a stale base answers 409 instead of clobbering either a
 * concurrent browser edit or a model rewrite. ROE cannot be published here —
 * scope/ROE changes go through the Scope & ROE revision workflow.
 */
function DocumentEditor({ engagementId, name, title, onClose }: { engagementId: string; name: string; title: string; onClose: () => void }): ReactElement {
  const client = useQueryClient()
  const source = useQuery({ queryKey: ['real', 'document', engagementId, name], queryFn: () => fetchDocumentSource(engagementId, name) })
  const [text, setText] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null)
  useEffect(() => {
    if (source.data && text === null) setText(source.data.draft?.body ?? source.data.source ?? '')
  }, [source.data, text])
  const baseDigest = source.data?.digest ?? null
  const savedDraft = source.data?.draft ?? null
  const dirty = text !== null && text !== (savedDraft?.body ?? source.data?.source ?? '')

  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: ['real', 'document', engagementId, name] })
    void client.invalidateQueries({ queryKey: ['real', 'planning', engagementId] })
  }
  const save = useMutation({
    mutationFn: () => saveDocumentDraft(engagementId, name, { body: text ?? '', baseDigest }),
    onSuccess: () => { setNotice({ tone: 'ok', text: 'Draft saved server-side — it survives refresh and restarts and is not visible to agents.' }); invalidate() },
    onError: (error) => setNotice({ tone: 'bad', text: error instanceof Error ? error.message : 'Saving the draft failed.' }),
  })
  const publish = useMutation({
    mutationFn: () => publishDocumentDraft(engagementId, name, { body: text ?? '', baseDigest }),
    onSuccess: () => { setNotice({ tone: 'ok', text: 'Published to the engagement workspace with the digest precondition; agents read the new version on their next load.' }); invalidate() },
    onError: (error) => setNotice({ tone: 'bad', text: error instanceof Error ? error.message : 'Publishing failed.' }),
  })
  const discard = useMutation({
    mutationFn: () => discardDocumentDraft(engagementId, name),
    onSuccess: () => { setNotice({ tone: 'ok', text: 'Draft discarded — the editor now shows the published source.' }); invalidate() },
    onError: (error) => setNotice({ tone: 'bad', text: error instanceof Error ? error.message : 'Discarding the draft failed.' }),
  })

  const roeNote = name === 'roe'
  return (
    <div data-testid={`document-editor-${name}`} className="space-y-3">
      <p className="text-sm text-muted">{roeNote ? 'ROE is governed by the Scope & ROE revision workflow; publishing the file from the console is refused.' : 'Edits are server-side drafts. Publish validates the schema and replaces the workspace file only if it has not changed since you loaded it.'}</p>
      {notice && <Banner tone={notice.tone} title={notice.text} action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>} />}
      {source.data?.validation.valid === false && source.data.source !== null && (
        <Banner tone="warn" title="The published document currently fails schema validation">
          <ul className="list-inside list-disc">{source.data.validation.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>
        </Banner>
      )}
      {source.isPending ? (
        <div className="space-y-2" aria-busy="true" role="status"><Skeleton className="h-40" /></div>
      ) : source.isError || !source.data ? (
        <p className="text-sm text-bad" role="alert">{source.error instanceof Error ? source.error.message : 'The document source could not be loaded.'}</p>
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
            {savedDraft && (
              <Button variant="ghost" disabled={discard.isPending} onClick={() => { setNotice(null); discard.mutate() }}>
                {discard.isPending ? 'Discarding…' : 'Discard draft'}
              </Button>
            )}
            <Button variant="ghost" icon={RefreshCw} onClick={() => { setText(null); setNotice(null); void source.refetch() }}>Reload</Button>
            <Button variant="ghost" onClick={onClose}>Close editor</Button>
            <span className="ml-auto text-xs text-muted">
              {dirty ? 'Unsaved local edits' : savedDraft ? 'Server draft loaded' : 'Published source loaded'}
              {baseDigest !== null && ` · base ${baseDigest.slice(0, 12)}`}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
