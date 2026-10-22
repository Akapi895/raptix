/**
 * Planning tab (plan P09, Planning slice) for the real project detail. The
 * handoff documents, the OPPLAN, the readiness and the one-way handoff come
 * from the planning port. A draft is edited on the server and published with a
 * digest precondition. Readiness is a runtime signal and never grants execution,
 * and an OPPLAN is never presented as business plan approval.
 */
import { useEffect, useState, type ReactElement } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Bot, CheckCircle2, CircleAlert, FileText, Lock, PenLine, RefreshCw } from 'lucide-react'
import { go } from '../../router/navigate'
import { utcMinuteOr } from '../../platform/format'
import { Banner, Button, Card, CardHeader, DescList, Drawer, Skeleton, Status, cx } from '../../ui/index'
import { PlanningError, usePlanningRead, usePlanningSource, usePlanningWrites } from './query'
import type { PlanningDocumentCard, PlanningDocumentState, PlanningOpplan } from './service'

const STATE_TONE: Record<PlanningDocumentState, 'ok' | 'bad' | 'warn' | 'neutral'> = { ready: 'ok', missing: 'neutral', invalid: 'bad', unavailable: 'warn' }
const STATE_LABEL: Record<PlanningDocumentState, string> = { ready: 'Ready', missing: 'Missing', invalid: 'Invalid', unavailable: 'Unavailable' }
const NOT_READY_TEXT: Record<Exclude<PlanningDocumentState, 'ready'>, string> = {
  missing: 'This document has not been generated yet.',
  invalid: 'The stored document failed validation — regenerate it in the AI workspace or fix it in the draft editor.',
  unavailable: 'The document source is unavailable right now.',
}

const messageOf = (error: unknown, fallback: string): string => (error instanceof PlanningError || error instanceof Error ? error.message : fallback)

export function PlanningTab({ engagementId, handoffConfirmedAt }: { engagementId: string; handoffConfirmedAt: string | null }): ReactElement {
  const read = usePlanningRead(engagementId)
  const writes = usePlanningWrites(engagementId)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editorName, setEditorName] = useState<string | null>(null)
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

  return (
    <div className="space-y-4">
      {view.ready ? (
        <Banner tone="ok" icon={CheckCircle2} title="Planning documents ready">
          All required documents are present and valid. Review each document, then confirm the planning handoff. Readiness is a runtime signal — execution still requires the approved lifecycle steps and never follows from this banner alone.
        </Banner>
      ) : (
        <Banner tone="warn" icon={CircleAlert} title="Planning is blocked">
          <ul className="list-inside list-disc">
            {view.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </Banner>
      )}
      {actionError !== null && <Banner tone="bad" title="Handoff confirmation failed" action={<Button size="sm" variant="ghost" onClick={() => setActionError(null)}>Dismiss</Button>}>{actionError}</Banner>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Plan documents" sub="Generated in the AI workspace and stored in the engagement workspace. These are the documents the handoff depends on; the OPPLAN is shown separately below." />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {view.documents.map((card) => <DocumentCard key={card.name} engagementId={engagementId} card={card} onEdit={setEditorName} />)}
            </div>
          </Card>
          <OpplanCard engagementId={engagementId} opplan={view.opplan} />
          <Card>
            <CardHeader title="Document bundle" sub="Every required planning document and its current state." />
            <ul className="flex flex-wrap gap-2">
              {view.documents.map((card) => (
                <li key={card.name} className={cx('inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium', {
                  ok: 'border-ok/30 bg-ok-soft text-ok', bad: 'border-bad/30 bg-bad-soft text-bad', warn: 'border-warn/30 bg-warn-soft text-warn', neutral: 'border-line bg-subtle text-muted',
                }[STATE_TONE[card.state]])}>
                  <FileText size={12} aria-hidden />{card.name}: {STATE_LABEL[card.state]}
                </li>
              ))}
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
                <Button variant="primary" icon={Lock} disabled={confirm.isPending || !view.ready} title={view.ready ? 'Confirms planning handoff on the server (one-way)' : 'Required planning documents must be ready before handoff'}
                  onClick={() => { setActionError(null); confirm.mutate() }}>
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
                { k: 'State', v: <Status kind="gate" value={view.ready ? 'passed' : 'pending'} size="sm" label={view.ready ? 'Ready' : 'Blocked'} /> },
                { k: 'Runtime signal', v: view.runtimeSignal },
                { k: 'Reasons', v: view.reasons.length === 0 ? 'None' : view.reasons.join(' ') },
              ]}
            />
          </Card>
        </div>
      </div>
      <Drawer open={editorCard !== null} onClose={() => setEditorName(null)} title={editorCard ? `${editorCard.title} — source & draft` : ''} width={760}>
        {editorCard !== null && editorName !== null && (
          <DocumentEditor engagementId={engagementId} name={editorName} title={editorCard.title} onClose={() => setEditorName(null)} writes={writes} />
        )}
      </Drawer>
    </div>
  )
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
 * The living operational plan (OPPLAN), in full. The operations agent creates it
 * after the planning handoff and updates it on every objective change during
 * execution, so it sits beside the planning documents and never gates the handoff.
 */
function OpplanCard({ engagementId, opplan }: { engagementId: string; opplan: PlanningOpplan }): ReactElement {
  return (
    <Card>
      <CardHeader title="Operation Plan (OPPLAN)" sub="The living operational plan: the operations agent creates it after the planning handoff and updates it on every objective change during execution." />
      <div className="p-4 text-sm" data-testid="plan-doc-opplan">
        {opplan.state === 'ready' ? (
          <div className="space-y-3">
            <p><span className="font-medium text-fg">Threat profile:</span> {opplan.threatProfile}</p>
            {opplan.objectives.length === 0 ? (
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
                    {opplan.objectives.map((o) => (
                      <tr key={o.id} className="border-t border-line align-top">
                        <td className="py-2 pr-3 font-mono text-xs">{o.id}</td>
                        <td className="py-2 pr-3"><div className="font-medium">{o.title}</div><p className="mt-1 text-xs text-muted">{o.description}</p></td>
                        <td className="py-2 pr-3 text-xs">{o.phase}</td>
                        <td className="py-2 pr-3 text-xs">{o.status}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{o.blockedBy.join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : opplan.state === 'missing' ? (
          <p className="text-muted">Not created yet. The operations agent creates OPPLAN after the planning handoff, so there is nothing to review here before then.</p>
        ) : opplan.state === 'invalid' ? (
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
